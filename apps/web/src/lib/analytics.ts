/**
 * 改进产品：匿名使用数据 + 前端错误.
 * Events go to chronicle `POST /v1/events` (the Worldlines platform services/chronicle, the closed list below; the
 * server checks the same list and prop whitelist and drops anything else). the design notes
 *
 * What is sent: an event NAME from a closed list, a few whitelisted props (ids, enums, small counts), the world id,
 * a per-TAB random session id (sessionStorage — not a device id, gone when the tab closes), the app version, the
 * interface language and the channel keyword (`?src=`, lib/attribution.ts) when one is remembered. The server adds
 * the account (only when the call carries the sign-in) and phone / tablet / desktop from the User-Agent (not the UA).
 * Never: prompts, chat, story text, names, emails, free text. Error messages are scrubbed (emails, tokens, URL
 * queries) and cut to 300 characters; stack frames keep only file:line:col.
 *
 * Who sends (decided per flush, `modeFor`):
 *   - switched off (Account → 设置 「改进产品：发送匿名使用数据」, or Do Not Track / Global Privacy Control while the
 *     player never chose) → nothing; the queue is dropped
 *   - signed in (account data synced) → through this app's server, `/api/account-data/events`, which forwards with
 *     the account's token (the page never holds it) → the rows carry the uid (retention numbers); on the browser
 *     version the last flush when leaving goes straight to chronicle instead (that server runs in this closing tab)
 *   - signed out on the browser version (canvas.worldlines.gg, a static site) → straight to chronicle, anonymous
 *     (navigator.sendBeacon, text/plain = no CORS preflight; fetch keepalive as the fallback)
 *   - signed out on the local version (a computer running the Node server) → nothing: a local install only reports
 *     once the player signed in to a Worldlines account
 * Never in tests / SSR (no window) and never before startAnalytics().
 */

export const ANALYTICS_EVENTS = [
  'lobby_view', 'world_tile_open', 'world_enter', 'opening_done', 'tutorial_step', 'first_turn', 'turn', 'session_turn', 'world_leave', 'dice_roll',
  'item_obtained', 'scene_entered', 'ending_reached', 'account_open', 'board_open', 'subscribe_click', 'redeem_attempt',
  'invite_share', 'share_card', 'local_key_enabled', 'tts_failed', 'image_failed', 'error',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export const OPT_KEY = 'airp.analytics'; // '1' = the player turned it on, '0' = off, absent = the default
export const SESSION_KEY = 'airp.analytics.session';
export const PRODUCT = 'livingcanvas';
export const MAX_BATCH = 50;
export const MAX_EVENT_BYTES = 2048;
export const MAX_BODY_BYTES = 60_000; // under the 64 KB keepalive / beacon limit
export const QUEUE_CAP = 200;
export const FLUSH_MS = 10_000;
export const MAX_ERRORS = 20;
export const SERVER_PATH = '/api/account-data/events';

const WORD = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const WORLD_ID = /^[A-Za-z0-9._:/@-]{1,128}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{22,64}$/;
const SRC = /^[a-z0-9._-]{1,40}$/;
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

type Rule = { t: 'word' } | { t: 'bool' } | { t: 'int'; min: number; max: number } | { t: 'enum'; v: readonly string[] } | { t: 'text'; max: number } | { t: 'frames' };
type Spec = Record<string, Rule & { req?: boolean }>;
const word = { t: 'word' } as const;
export const PROP_SPECS: Record<AnalyticsEventName, Spec> = {
  lobby_view: {},
  world_tile_open: {},
  world_enter: { resumed: { t: 'bool' }, tracked: { t: 'bool' } },
  opening_done: { skipped: { t: 'bool' } },
  tutorial_step: { step: { ...word, req: true }, action: { t: 'enum', v: ['shown', 'done', 'skipped'], req: true } },
  first_turn: {},
  turn: { count: { t: 'int', min: 1, max: 100_000, req: true } },
  session_turn: { n: { t: 'int', min: 1, max: 100_000, req: true }, place: word },
  world_leave: { turns: { t: 'int', min: 0, max: 100_000, req: true }, place: word },
  dice_roll: { outcome: word },
  item_obtained: {},
  scene_entered: {},
  ending_reached: { ending: word },
  account_open: { tab: word },
  board_open: {},
  subscribe_click: { plan: word },
  redeem_attempt: { result: { ...word, req: true } },
  invite_share: { channel: word },
  share_card: { kind: word },
  local_key_enabled: { provider: word },
  tts_failed: { reason: word },
  image_failed: { reason: word },
  error: {
    kind: { t: 'enum', v: ['error', 'rejection', 'boundary', 'worker'], req: true },
    message: { t: 'text', max: 300, req: true },
    stack: { t: 'frames' },
    route: { t: 'text', max: 120 },
    count: { t: 'int', min: 1, max: 10_000 },
  },
};

export type Props = Record<string, string | number | boolean | string[] | undefined>;
export interface QueuedEvent { name: AnalyticsEventName; at: number; world_id?: string; props?: Props }

const okRule = (r: Rule, v: unknown): boolean => {
  switch (r.t) {
    case 'word': return typeof v === 'string' && WORD.test(v);
    case 'bool': return typeof v === 'boolean';
    case 'int': return Number.isSafeInteger(v) && (v as number) >= r.min && (v as number) <= r.max;
    case 'enum': return typeof v === 'string' && r.v.includes(v);
    case 'text': return typeof v === 'string' && v.length > 0 && v.length <= r.max && !/[\u0000-\u001f\u007f]/.test(v);
    case 'frames': return Array.isArray(v) && v.length <= 5 && v.every((f) => typeof f === 'string' && f.length > 0 && f.length <= 160 && !/[\u0000-\u001f\u007f]/.test(f));
  }
};

/** One event checked against the closed list + prop whitelist + size; null = drop it. */
export function validateEvent(name: unknown, props: unknown = undefined, worldId: unknown = undefined, at = Date.now()): QueuedEvent | null {
  if (typeof name !== 'string' || !(ANALYTICS_EVENTS as readonly string[]).includes(name)) return null;
  const spec = PROP_SPECS[name as AnalyticsEventName];
  const ev: QueuedEvent = { name: name as AnalyticsEventName, at };
  if (worldId != null) {
    if (typeof worldId !== 'string' || !WORLD_ID.test(worldId)) return null;
    ev.world_id = worldId;
  }
  const out: Props = {};
  const given = props && typeof props === 'object' ? (props as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(given)) {
    if (v === undefined) continue;
    const rule = spec[k];
    if (!rule || !okRule(rule, v)) return null;
    out[k] = v as Props[string];
  }
  for (const [k, rule] of Object.entries(spec)) if (rule.req && !(k in out)) return null;
  if (Object.keys(out).length) ev.props = out;
  if (byteLength(JSON.stringify(ev)) > MAX_EVENT_BYTES) return null;
  return ev;
}

const byteLength = (s: string) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length * 3);

// ── scrubbing ────────────────────────────────────────────────────────────────

/** Remove what could identify someone or unlock something: emails, tokens / keys, URL queries and fragments. */
export function scrubText(raw: unknown, max = 300): string {
  let s = String(raw ?? '');
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]');
  s = s.replace(/\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s"'<>()]+/gi, (u) => {
    try {
      const url = new URL(u);
      if (url.username || url.password) url.username = url.password = '';
      return `${url.origin}${url.pathname}`.replace(/\/$/, url.pathname === '/' ? '' : '/');
    } catch {
      return '[url]';
    }
  });
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  s = s.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?/g, '[token]');
  s = s.replace(/\b(?:wl_pat_|sk-|sk_live_|sk_test_|rk_live_|pk_live_|ghp_|xox[bp]-)[A-Za-z0-9_-]{6,}/g, '[token]');
  s = s.replace(/\b[0-9a-f]{24,}\b/gi, '[token]');
  // No lookbehind: this must run on browsers too old for the runtime (lib/browser-support.ts reports them).
  s = s.replace(/(^|[^A-Za-z0-9+_-])([A-Za-z0-9+_-]{32,}={0,2})/g, (_, pre: string, m: string) => pre + (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? '[token]' : m));
  s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return [...s].length > max ? `${[...s].slice(0, max - 1).join('')}…` : s;
}

/** The top 5 stack frames as `file.js:line:col` (file name only — no host, path or query). */
export function stackTop5(stack: unknown): string[] {
  if (typeof stack !== 'string') return [];
  const out: string[] = [];
  for (const line of stack.split('\n')) {
    const m = /([^\s/\\()@]+?\.(?:m?js|ts|tsx|jsx|wasm|html)|<anonymous>)(?:\?[^\s:)]*)?:(\d+)(?::(\d+))?/.exec(line);
    if (!m) continue;
    const frame = scrubText(`${m[1]}:${m[2]}${m[3] ? `:${m[3]}` : ''}`, 160);
    if (frame) out.push(frame);
    if (out.length === 5) break;
  }
  return out;
}

/** The route for an error: the page path only (no query, no fragment), scrubbed. */
export function routeOf(pathname: unknown): string | undefined {
  if (typeof pathname !== 'string' || !pathname) return undefined;
  return scrubText(pathname.split(/[?#]/)[0], 120) || undefined;
}

// ── the switch ───────────────────────────────────────────────────────────────

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
interface NavLike { doNotTrack?: string | null; globalPrivacyControl?: boolean }
const kvOf = (): KV | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};
const navOf = (): NavLike | null => (typeof navigator === 'undefined' ? null : (navigator as NavLike));

/** Default when the player never chose: on, unless the browser asks not to be tracked. */
export function analyticsDefault(nav: NavLike | null = navOf()): boolean {
  return !(nav?.doNotTrack === '1' || nav?.globalPrivacyControl === true);
}
/** The player's choice wins over the default. */
export function analyticsEnabled(kv: KV | null = kvOf(), nav: NavLike | null = navOf()): boolean {
  let v: string | null = null;
  try { v = kv?.getItem(OPT_KEY) ?? null; } catch { /* storage blocked */ }
  if (v === '1') return true;
  if (v === '0') return false;
  return analyticsDefault(nav);
}
export function setAnalyticsEnabled(on: boolean, kv: KV | null = kvOf()): void {
  try { kv?.setItem(OPT_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
  if (!on) client?.clear();
}

/** A per-tab random id (sessionStorage; memory when blocked). */
export function sessionIdOf(store: KV | null = (() => { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; } })()): string {
  try {
    const had = store?.getItem(SESSION_KEY);
    if (had && SESSION_ID.test(had)) return had;
  } catch { /* blocked */ }
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try { store?.setItem(SESSION_KEY, id); } catch { /* blocked */ }
  return id;
}

/** A value usable as a `word` prop (ids, enums), or undefined (the prop is then left out, not the event). */
export function asWord(v: unknown): string | undefined {
  return typeof v === 'string' && WORD.test(v) ? v : undefined;
}

/** Which turn numbers are reported: the first (`first_turn`) and every 5th (`turn`). */
export function turnEvent(count: number): { name: 'first_turn' } | { name: 'turn'; count: number } | null {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  if (count === 1) return { name: 'first_turn' };
  return count % 5 === 0 && count <= 100_000 ? { name: 'turn', count } : null;
}

/**
 * Turns per VISIT (one tab session × one world; chronicle `visits`). `first_turn` / `turn` count per
 * save, so a resumed save never showed a first turn and a visit's depth was invisible. A visit's n-th turn is sent at
 * the first turn of each console bucket (0 / 1–2 / 3–5 / 6–10 / 11–20 / 21+) and then 51, 101, 201, 501, 1001 …
 */
export function isVisitMilestone(n: number): boolean {
  if (!Number.isSafeInteger(n) || n < 1 || n > 100_000) return false;
  if (n <= 21) return [1, 2, 3, 6, 11, 21].includes(n);
  const m = n - 1;
  const mag = 10 ** Math.floor(Math.log10(m));
  return [1, 2, 5].includes(m / mag);
}

export interface VisitTracker {
  /** The world loaded (world_enter); re-entering the same world in this tab continues its count. */
  enter(worldId: string | null | undefined, place?: string | null): void;
  /** The player is somewhere else in the world (a layer / place id). */
  place(place: string | null | undefined): void;
  /** A writer turn finished in the open world → session_turn at a milestone. */
  turn(place?: string | null): void;
  /** Leaving the world / hiding the tab → world_leave {turns, place} when it changed since the last one. */
  leave(opts?: { close?: boolean }): void;
}

export function createVisitTracker(send: (name: 'session_turn' | 'world_leave', props: Props, worldId: string) => void): VisitTracker {
  const turns = new Map<string, number>();
  let world: string | null = null;
  let where: string | undefined;
  let lastLeave = '';
  return {
    enter(worldId, place) {
      if (world && world !== worldId) this.leave({ close: true });
      world = worldId && WORLD_ID.test(worldId) ? worldId : null;
      where = asWord(place);
      lastLeave = '';
      if (world && !turns.has(world)) turns.set(world, 0);
    },
    place(place) {
      if (world) where = asWord(place) ?? where;
    },
    turn(place) {
      if (!world) return;
      if (place !== undefined) this.place(place);
      const n = (turns.get(world) ?? 0) + 1;
      turns.set(world, n);
      if (isVisitMilestone(n)) send('session_turn', { n, ...(where ? { place: where } : {}) }, world);
    },
    leave(opts) {
      if (!world) return;
      const n = Math.min(turns.get(world) ?? 0, 100_000);
      const key = `${n}|${where ?? ''}`;
      if (key !== lastLeave) send('world_leave', { turns: n, ...(where ? { place: where } : {}) }, world);
      lastLeave = key;
      if (opts?.close) world = null;
    },
  };
}

// ── the client ───────────────────────────────────────────────────────────────

export type SendMode = 'server' | 'direct' | 'off';
export interface AnalyticsEnv {
  /** chronicle `<base>/v1/events` */
  endpoint: string;
  sessionId: string;
  appVersion: string;
  locale: () => string;
  src: () => string | undefined;
  enabled: () => boolean;
  mode: () => SendMode;
  /** When the server route says "not signed in": may the batch go straight to chronicle (browser version)? */
  directFallback: () => boolean;
  fetch: typeof fetch;
  sendBeacon?: ((url: string, data: Blob) => boolean) | null;
  now?: () => number;
}

export interface ErrorInput { kind: 'error' | 'rejection' | 'boundary' | 'worker'; message: unknown; stack?: unknown; route?: unknown }

export function createAnalytics(env: AnalyticsEnv) {
  const now = env.now ?? Date.now;
  let queue: QueuedEvent[] = [];
  const retried = new WeakSet<QueuedEvent>();
  let inflight: Promise<void> | null = null;
  const errors = new Map<string, { extra: number; input: { kind: ErrorInput['kind']; message: string; stack: string[]; route?: string } }>();
  let errorSends = 0;

  function push(ev: QueuedEvent | null): boolean {
    if (!ev || !env.enabled()) return false;
    queue.push(ev);
    if (queue.length > QUEUE_CAP) queue = queue.slice(queue.length - QUEUE_CAP);
    return true;
  }

  function track(name: AnalyticsEventName, props?: Props, worldId?: string | null): boolean {
    return push(validateEvent(name, props, worldId ?? undefined, now()));
  }

  function errorProps(e: { kind: ErrorInput['kind']; message: string; stack: string[]; route?: string }, count?: number): Props {
    return { kind: e.kind, message: e.message, ...(e.stack.length ? { stack: e.stack } : {}), ...(e.route ? { route: e.route } : {}), ...(count ? { count } : {}) };
  }

  /** An error: the first of its kind is sent (≤ 20 per session); repeats are counted and sent once on leaving. */
  function trackError(input: ErrorInput): boolean {
    const message = scrubText(input.message, 300) || 'unknown';
    const stack = stackTop5(input.stack);
    // 「报告问题」 attaches the last few as fingerprints (never the text), sending switched on or not.
    noteRecentError({ kind: input.kind, message, top: stack[0] ?? '' });
    if (!env.enabled()) return false;
    const fp = `${input.kind}|${message}|${stack[0] ?? ''}`;
    const seen = errors.get(fp);
    if (seen) { seen.extra += 1; return false; }
    if (errorSends >= MAX_ERRORS) return false;
    const e = { kind: input.kind, message, stack, route: routeOf(input.route) };
    errors.set(fp, { extra: 0, input: e });
    errorSends += 1;
    return track('error', errorProps(e, 1));
  }

  /** Leaving: one follow-up per repeated error with how many more times it happened. */
  function settleRepeats() {
    for (const rec of errors.values()) {
      if (!rec.extra) continue;
      track('error', errorProps(rec.input, Math.min(rec.extra, 10_000)));
      rec.extra = 0;
    }
  }

  function takeBatch(): QueuedEvent[] {
    const batch: QueuedEvent[] = [];
    let bytes = 200;
    while (queue.length && batch.length < MAX_BATCH) {
      const n = byteLength(JSON.stringify(queue[0])) + 1;
      if (batch.length && bytes + n > MAX_BODY_BYTES) break;
      bytes += n;
      batch.push(queue.shift()!);
    }
    return batch;
  }

  function bodyOf(batch: QueuedEvent[]): string {
    const loc = env.locale();
    const src = env.src();
    return JSON.stringify({
      product: PRODUCT,
      session_id: env.sessionId,
      app_version: env.appVersion,
      ...(LOCALE.test(loc) ? { locale: loc } : {}),
      ...(src && SRC.test(src) ? { src } : {}),
      events: batch,
    });
  }

  /** Put a batch back: 429 always (bounded), network / 5xx once. */
  function requeue(batch: QueuedEvent[], always: boolean) {
    const back = always ? batch : batch.filter((e) => !retried.has(e));
    for (const e of back) retried.add(e);
    queue = [...back, ...queue].slice(0, QUEUE_CAP);
  }

  async function sendDirect(body: string, batch: QueuedEvent[], final: boolean): Promise<void> {
    if (env.sendBeacon) {
      try {
        if (env.sendBeacon(env.endpoint, new Blob([body], { type: 'text/plain' }))) return;
      } catch { /* fall through */ }
    }
    try {
      const res = await env.fetch(env.endpoint, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain' } });
      if (res.status === 429) requeue(batch, true);
      else if (res.status >= 500) requeue(batch, false);
    } catch {
      if (!final) requeue(batch, false);
    }
  }

  async function sendServer(body: string, batch: QueuedEvent[], final: boolean): Promise<void> {
    try {
      const res = await env.fetch(SERVER_PATH, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json', 'x-airp-settings': '1' } });
      const json = (await res.json().catch(() => null)) as { available?: boolean; status?: number } | null;
      if (json?.available === false) {
        if (env.directFallback()) await sendDirect(body, batch, final);
        return;
      }
      const status = typeof json?.status === 'number' ? json.status : res.status;
      if (status === 429) requeue(batch, true);
      else if (status >= 500) requeue(batch, false);
    } catch {
      if (!final) requeue(batch, false);
    }
  }

  async function flushOnce(final: boolean) {
    if (final) settleRepeats();
    if (!queue.length) return;
    if (!env.enabled()) { queue = []; return; }
    const mode = env.mode();
    if (mode === 'off') { queue = []; return; }
    // Leaving the browser version: the server route lives in this very tab (its Worker), so the page that would relay
    // the request is the one going away — a beacon straight to chronicle survives it (anonymous: no uid on these rows).
    const viaServer = mode === 'server' && !(final && env.directFallback());
    while (queue.length) {
      const batch = takeBatch();
      const body = bodyOf(batch);
      if (viaServer) await sendServer(body, batch, final);
      else await sendDirect(body, batch, final);
      if (!final) break; // one batch per tick; the rest goes next time
    }
  }

  function flush(final = false): Promise<void> {
    if (inflight && !final) return inflight;
    const p = flushOnce(final).finally(() => { if (inflight === p) inflight = null; });
    inflight = p;
    return p;
  }

  return {
    track,
    trackError,
    flush,
    pending: () => queue.slice(),
    clear: () => { queue = []; },
  };
}
export type Analytics = ReturnType<typeof createAnalytics>;

// ── recent errors for 「报告问题 / 卡住了」 (lib/report-issue.ts) ─────────────────

/** The newest distinct errors of this tab (kind + scrubbed message + top frame), in memory only. */
const RECENT_ERRORS = 5;
let recentErrors: { kind: ErrorInput['kind']; message: string; top: string }[] = [];
export function noteRecentError(e: { kind: ErrorInput['kind']; message: string; top: string }): void {
  recentErrors = [e, ...recentErrors.filter((x) => !(x.kind === e.kind && x.message === e.message && x.top === e.top))].slice(0, RECENT_ERRORS);
}
export function clearRecentErrors(): void {
  recentErrors = [];
}

/**
 * chronicle's error fingerprint (the Worldlines platform services/chronicle/src/analytics/vocab.mjs `errorFingerprint`):
 * sha256(kind \0 message with digits → # \0 top frame), the first 32 hex — so a report's codes match the console's
 * 前端错误 list. Async (WebCrypto); null where there is no WebCrypto.
 */
export async function errorFingerprint(e: { kind: string; message: string; top?: string }): Promise<string | null> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) return null;
  const data = new TextEncoder().encode(`${e.kind}\u0000${e.message.replace(/\d+/g, '#')}\u0000${e.top ?? ''}`);
  const hash = new Uint8Array(await subtle.digest('SHA-256', data));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** The fingerprints of this tab's newest errors (≤ 5, newest first). */
export async function recentErrorFingerprints(): Promise<string[]> {
  const out: string[] = [];
  for (const e of recentErrors) {
    const fp = await errorFingerprint(e).catch(() => null);
    if (fp && !out.includes(fp)) out.push(fp);
  }
  return out;
}

// ── the app's instance ───────────────────────────────────────────────────────

let client: Analytics | null = null;
/** Events queued this page, per name — for headless checks (window.__airpAnalytics.tracked); names and counts only. */
const trackedTally: Partial<Record<AnalyticsEventName, number>> = {};

/** No-op until startAnalytics() (tests, SSR, the perception page). */
export function track(name: AnalyticsEventName, props?: Props, worldId?: string | null): void {
  try { if (client?.track(name, props, worldId)) trackedTally[name] = (trackedTally[name] ?? 0) + 1; } catch { /* never break the app */ }
}
export function reportError(input: ErrorInput): void {
  try { client?.trackError(input); } catch { /* never break the app */ }
}
/** A writer turn finished: the n-th turn of this SAVE → first_turn / every 5th turn (per visit: `visit.turn`). */
export function trackTurn(count: number, worldId?: string | null): void {
  const t = turnEvent(count);
  if (!t) return;
  if (t.name === 'first_turn') track('first_turn', undefined, worldId);
  else track('turn', { count: t.count }, worldId);
}

/** This tab's visit (App.tsx: world_enter → visit.enter, each turn → visit.turn, the launcher → visit.leave). */
export const visit: VisitTracker = createVisitTracker((name, props, worldId) => track(name, props, worldId));

export interface StartOptions {
  chronicleBase: string;
  staticSite: boolean;
  appVersion: string;
  signedIn: () => boolean;
  locale: () => string;
  src: () => string | undefined;
}

/** Which way a flush goes (see the header). */
export function modeFor(o: { enabled: boolean; signedIn: boolean; staticSite: boolean }): SendMode {
  if (!o.enabled) return 'off';
  if (o.signedIn) return 'server';
  return o.staticSite ? 'direct' : 'off';
}

/** Turn it on for this tab: flush timer, pagehide / hidden, global error handlers. Once. */
export function startAnalytics(o: StartOptions): Analytics | null {
  if (client || typeof window === 'undefined') return client;
  const nav = navigator as Navigator & { sendBeacon?: (u: string, d: Blob) => boolean };
  client = createAnalytics({
    endpoint: `${o.chronicleBase.replace(/\/+$/, '')}/v1/events`,
    sessionId: sessionIdOf(),
    appVersion: o.appVersion,
    locale: o.locale,
    src: o.src,
    enabled: () => analyticsEnabled(),
    mode: () => modeFor({ enabled: analyticsEnabled(), signedIn: o.signedIn(), staticSite: o.staticSite }),
    directFallback: () => o.staticSite,
    fetch: (...a) => window.fetch(...a),
    sendBeacon: typeof nav.sendBeacon === 'function' ? (u, d) => nav.sendBeacon!(u, d) : null,
  });
  const c = client;
  window.setInterval(() => { void c.flush(); }, FLUSH_MS);
  // The visit's turns + place go into the same last flush (a closed tab never sends anything after this).
  window.addEventListener('pagehide', () => { visit.leave(); void c.flush(true); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { visit.leave(); void c.flush(true); } });
  installErrorCapture(window, c);
  (window as unknown as { __airpAnalytics?: unknown }).__airpAnalytics = { tracked: trackedTally };
  return c;
}

/** window.onerror + unhandledrejection → `error` events (resource load failures are not errors here). */
export function installErrorCapture(win: Pick<Window, 'addEventListener' | 'location'>, c: Pick<Analytics, 'trackError'>): void {
  win.addEventListener('error', (e: Event) => {
    const ev = e as ErrorEvent;
    if (!(typeof ErrorEvent !== 'undefined' && ev instanceof ErrorEvent) && !('message' in ev)) return; // <img>/<script> load errors
    const err = ev.error as { stack?: unknown; message?: unknown } | undefined;
    c.trackError({ kind: 'error', message: err?.message ?? ev.message, stack: err?.stack ?? (ev.filename ? `at ${ev.filename}:${ev.lineno}:${ev.colno}` : undefined), route: win.location?.pathname });
  });
  win.addEventListener('unhandledrejection', (e: Event) => {
    const reason = (e as PromiseRejectionEvent).reason as { stack?: unknown; message?: unknown } | unknown;
    const r = reason && typeof reason === 'object' ? (reason as { stack?: unknown; message?: unknown }) : null;
    c.trackError({ kind: 'rejection', message: r?.message ?? String(reason), stack: r?.stack, route: win.location?.pathname });
  });
}

/** The in-tab runtime's errorText ("Name: message\n<stack>") → an error event. */
export function reportWorkerError(text: unknown): void {
  const s = String(text ?? '');
  const nl = s.indexOf('\n');
  reportError({ kind: 'worker', message: nl < 0 ? s : s.slice(0, nl), stack: nl < 0 ? undefined : s.slice(nl + 1), route: typeof location !== 'undefined' ? location.pathname : undefined });
}

/** The app version: VITE_AIRP_APP_VERSION, else the runtime id of a static deploy, else "local". */
export function appVersionOf(env: Record<string, string | undefined>): string {
  const explicit = (env.VITE_AIRP_APP_VERSION ?? '').trim();
  const rid = /\/runtime\/([^/]+)\/?$/.exec((env.VITE_AIRP_RUNTIME_BASE ?? '').trim())?.[1] ?? '';
  const v = (explicit || rid || 'local').replace(/[^A-Za-z0-9._+-]/g, '').slice(0, 40);
  return v || 'local';
}
