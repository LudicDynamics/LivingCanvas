/// <reference types="vite/client" />
// Browser mode: the AIRP server + pi-rp agents run inside a Web Worker in this
// tab (apps/browser-runtime) instead of on a host. Locally it is experimental
// and default OFF: `?mode=browser` (this load) or the 「浏览器模式（实验）」
// setting (localStorage). When off, nothing here runs except a check that
// retires the runtime Service Worker if an earlier session left it installed.
//
// Transport: `/api/…` requests (fetch and element loads) reach the Worker via
// public/airp-runtime-sw.js → this page → Worker; `WebSocket('/ws…')` is
// replaced by a shim over Worker messages.
//
// Two deployments, one code path (switches are Vite env, all public values):
//   - local dev host (default): the host serves the runtime bundles, the VFS
//     image, a world catalog stand-in, the model proxy and the /net forwarder
//     under /api/browser-runtime (apps/server/src/routes/browser-runtime.ts).
//   - static site (canvas.worldlines.gg, deploy/canvas/README.md):
//       VITE_AIRP_RUNTIME_BASE=/runtime/<rid>/  worker.js, server.js, pi.js, sqlite3.wasm, image.bin
//       VITE_AIRP_BROWSER_MODE=always           the only mode; the toggle is hidden
//       VITE_AIRP_CATALOG=services              (default on a static site) storage public list + download-url
//       VITE_AIRP_ID_BASE / VITE_AIRP_STORAGE_BASE
//       VITE_AIRP_DATA_BASE                     (from the mode, lib/build-mode.ts; `off` = none) settings,
//                                               favorites, likes, comments, save summaries with the account's token
//       VITE_AIRP_CHRONICLE_BASE / _BILLING_BASE (from the mode; chronicle `off` = none) play counts and
//                                               the player's playthroughs; the wallet in the account panel
//       VITE_AIRP_MODEL_BASE                    (default https://ai.worldlines.gg/v1) with the account's token —
//                                               chat, TTS, voice input and images (VITE_AIRP_IMAGE_MODEL);
//                                               「使用本机密钥」 (lib/local-key.ts) moves chat / images / TTS / STT to the
//                                               player's own providers, straight from this tab
//       VITE_AIRP_AUDIO_BASE                    (default <base>/audio/) platform audio as static files
//     No /net forwarder and no model proxy; entering a world needs an account.
import { createAuthPrompt } from './auth-prompt.js';
import { localKeySettings, registerLocalKeyRuntime, runtimeRoutes } from './local-key.js';
import { localTtsFeature } from './tts-readiness.js';
import { reportWorkerError } from './analytics.js';
import { workerErrorMessage, workerErrorText, workerScriptStatus } from './worker-error.js';
import { missingRuntimeFeatures, OutdatedBrowserError } from './browser-support.js';
import { buildMode, buildModeProblem, buildVersion } from './build-mode.js';
import { perfMark } from './perf.js';
import { currentLocale } from './i18n.js';
import { VOICE_LIVE_AVAILABLE } from './plans.js';
import { bootText } from './boot-copy.js';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const FLAG = 'airp.browserMode';
const HOST = `${BASE}/api/browser-runtime`;
const ENV = import.meta.env as Record<string, string | undefined>;
const envValue = (k: string) => (ENV[k] ?? '').trim() || null;

/** The static-site switches, resolved once. Exported for the settings UI and tests. */
export const browserDeployment = (() => {
  const runtimeBase = envValue('VITE_AIRP_RUNTIME_BASE');
  const staticSite = runtimeBase !== null;
  const withSlash = (u: string) => (u.endsWith('/') ? u : `${u}/`);
  return {
    /** Browser mode is the only mode (no toggle). */
    always: envValue('VITE_AIRP_BROWSER_MODE') === 'always',
    /** No dev host behind this page: runtime files are static, no /net, no model proxy. */
    staticSite,
    runtimeBase: withSlash(runtimeBase ?? `${HOST}/dist/`),
    catalog: envValue('VITE_AIRP_CATALOG') ?? (staticSite ? 'services' : 'host'),
    identity: (envValue('VITE_AIRP_ID_BASE') ?? 'https://auth.worldlines.gg').replace(/\/+$/, ''),
    storage: (envValue('VITE_AIRP_STORAGE_BASE') ?? 'https://storage.worldlines.gg').replace(/\/+$/, ''),
    /** The account's settings / favorites / ratings / save summaries (sync/account-data.ts); `off` = none. */
    data: (envValue('VITE_AIRP_DATA_BASE') ?? 'off').replace(/\/+$/, ''),
    /** Play counts (public numbers) and this player's playthroughs. */
    chronicle: (envValue('VITE_AIRP_CHRONICLE_BASE') ?? 'off').replace(/\/+$/, ''),
    /** The account's wallet in the account panel. */
    billing: (envValue('VITE_AIRP_BILLING_BASE') ?? 'https://billing.worldlines.gg').replace(/\/+$/, ''),
    /** The Worldlines model gateway; null = the dev host's model proxy. */
    modelBase: envValue('VITE_AIRP_MODEL_BASE') ?? (staticSite ? 'https://ai.worldlines.gg/v1' : null),
    /** JSON { "<model id the server asks for>": "<gateway model id>" }; empty = none. */
    modelMap: envValue('VITE_AIRP_MODEL_MAP'),
    /** Image model through the gateway, `openai/<id>` (the writer's generate_image and covers). */
    imageModel: envValue('VITE_AIRP_IMAGE_MODEL') ?? 'openai/gpt-image-1',
    /** Optional `character=voice,…` routing to the studio voice (AIRP_TTS_CHARACTER_VOICES). */
    characterVoices: envValue('VITE_AIRP_TTS_CHARACTER_VOICES'),
    /**
     * The guest trial: signed out, the trial world (末班车) plays on a guest session.
     * Static site only; its worlds ship with the runtime (`trial.json`).
     */
    guestTrial: staticSite && envValue('VITE_AIRP_GUEST_TRIAL') === '1',
    /** Platform audio as static files; null = the dev host answers /api/audio. */
    audioBase: envValue('VITE_AIRP_AUDIO_BASE') ?? (staticSite ? `${BASE}/audio/` : null),
  };
})();
const SW_URL = `${BASE}/airp-runtime-sw.js${browserDeployment.audioBase ? `?audio=${encodeURIComponent(browserDeployment.audioBase)}` : ''}`;

export function browserModeSetting(): boolean {
  try { return localStorage.getItem(FLAG) === '1'; } catch { return false; }
}
export function setBrowserModeSetting(on: boolean) {
  try { if (on) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch { /* storage blocked */ }
}
export function browserModeRequested(): boolean {
  if (browserDeployment.always) return true;
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'browser') return true;
  if (mode === 'network') return false;
  return browserModeSetting();
}

/** Default path: if a previous browser-mode session left our Service Worker in control, answer it "passthrough" and unregister it. */
export function retireRuntimeServiceWorker() {
  const sw = navigator.serviceWorker;
  const ours = (u: string | undefined) => !!u && new URL(u).pathname.endsWith('/airp-runtime-sw.js');
  if (!sw?.controller || !ours(sw.controller.scriptURL)) return;
  sw.addEventListener('message', (e: MessageEvent) => { if (e.data?.type === 'airp-runtime-fetch') e.ports[0]?.postMessage({ passthrough: true }); });
  void sw.getRegistrations().then((rs) => rs.forEach((r) => { if (ours(r.active?.scriptURL)) void r.unregister(); }));
}

type Waiter = (m: any) => void;
let worker: Worker | null = null;
let seq = 0;
const waiters = new Map<number | string, Waiter>();
const sockets = new Map<number, RuntimeWebSocket>();
let ready: Promise<any> | null = null;
/** Frames seen per `type` on runtime sockets — for headless checks (window.__airpRuntime.frames). */
const frameTally: Record<string, number> = {};

function call(msg: any, transfer: Transferable[] = []): Promise<any> {
  const id = ++seq;
  return new Promise((resolve) => { waiters.set(id, resolve); worker!.postMessage({ ...msg, id }, transfer); });
}

/** WebSocket stand-in for `/ws`: frames ride Worker messages to the in-Worker server's ws shim. */
class RuntimeWebSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
  readyState = 0; binaryType: BinaryType = 'blob'; protocol = ''; extensions = ''; bufferedAmount = 0;
  onopen: ((e: Event) => void) | null = null; onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null; onerror: ((e: Event) => void) | null = null;
  readonly id = ++seq;
  constructor(readonly url: string, path: string) {
    super();
    sockets.set(this.id, this);
    void ready!.then(() => worker!.postMessage({ type: 'ws-open', id: this.id, url: path }));
  }
  private fire(e: Event, h: ((e: any) => void) | null) { this.dispatchEvent(e); h?.call(this, e); }
  _frame(m: any) {
    if (m.type === 'ws-opened') { this.readyState = 1; this.fire(new Event('open'), this.onopen); }
    else if (m.type === 'ws-message') {
      const t = typeof m.data === 'string' ? /"type":"([^"]+)"/.exec(m.data.slice(0, 200))?.[1] ?? '?' : 'binary';
      frameTally[t] = (frameTally[t] ?? 0) + 1;
      this.fire(new MessageEvent('message', { data: m.data }), this.onmessage);
    }
    else if (m.type === 'ws-closed') {
      if (this.readyState === 3) return;
      this.readyState = 3;
      sockets.delete(this.id);
      this.fire(new CloseEvent('close', { code: m.code ?? 1005, reason: m.reason ?? '', wasClean: true }), this.onclose);
    }
  }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState !== 1) throw new DOMException('WebSocket is not open', 'InvalidStateError');
    worker!.postMessage({ type: 'ws-send', id: this.id, data });
  }
  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    worker!.postMessage({ type: 'ws-close', id: this.id, code, reason });
  }
}

function installWebSocketShim() {
  const Native = window.WebSocket;
  const Patched = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const u = new URL(String(url), window.location.href);
    const path = u.pathname.startsWith(BASE) ? u.pathname.slice(BASE.length) : u.pathname;
    // `/ws` (the canvas) and `/ws/stt` (voice input, transcribed through the AI service) are the in-tab server's.
    if (u.host === window.location.host && (path === '/ws' || path === '/ws/stt')) return new RuntimeWebSocket(u.href, path + u.search);
    return new Native(url, protocols);
  } as unknown as typeof WebSocket;
  Object.assign(Patched, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, prototype: Native.prototype });
  window.WebSocket = Patched;
}

async function relayFetch(e: MessageEvent) {
  if (e.data?.type !== 'airp-runtime-fetch') return;
  const port = e.ports[0];
  await ready;
  const { method, url, headers, body } = e.data;
  const r = await call({ type: 'fetch', method, url, headers, body: body ? new Uint8Array(body) : null });
  if (r.type === 'error') { reportWorkerError(r.message); port.postMessage({ status: 500, headers: { 'content-type': 'text/plain' }, body: r.message }); return; }
  port.postMessage({ status: r.status, headers: r.headers, body: r.body }, r.body ? [r.body.buffer] : []);
}

/**
 * Where the in-tab runtime gets worlds (apps/browser-runtime/src/catalog.ts).
 * Default: this host's stand-in locally, the Worldlines services on a static
 * site. `?catalog=services|host` (or localStorage `airp.browserCatalog`, also a
 * JSON config) overrides; the runtime is the same either way.
 */
function catalogConfig() {
  let v: string | null = new URLSearchParams(window.location.search).get('catalog');
  try { v ??= localStorage.getItem('airp.browserCatalog'); } catch { /* storage blocked */ }
  v ??= browserDeployment.catalog;
  // A static site ships the trial worlds next to its runtime (deploy/canvas/assemble-browser.mjs buildTrial).
  const trial = browserDeployment.staticSite ? new URL(`${browserDeployment.runtimeBase}trial.json`, window.location.href).href : null;
  if (v === 'services') return { kind: 'services', identity: browserDeployment.identity, storage: browserDeployment.storage, trial };
  if (v?.startsWith('{')) { try { return JSON.parse(v); } catch { /* fall through */ } }
  return { kind: 'host', base: `${window.location.origin}${HOST}/catalog` };
}

/** The in-tab server's environment for this deployment. */
function serverEnv(world: string | undefined): Record<string, string> {
  const d = browserDeployment;
  const env: Record<string, string> = {
    AIRP_REPO_ROOT: '/repo', AIRP_WORLD: world ? `templates/${world}` : 'worlds/.none',
    PI_PACKAGE_DIR: '/repo/vendor/pi-rp/packages/coding-agent', PI_OFFLINE: '1', AIRP_WRITER_THINKING: 'low',
    // 远端世界 / 发布: the same Worldlines services the local app uses (identity + storage).
    AIRP_ID_BASE: d.identity, AIRP_STORAGE_BASE: d.storage, AIRP_DATA_BASE: d.data, AIRP_CHRONICLE_BASE: d.chronicle, AIRP_BILLING_BASE: d.billing,
  };
  // The build mode, said explicitly to the in-tab server too (apps/server/src/deploy-mode.ts checks it again).
  const mode = buildMode();
  if (mode) {
    env.AIRP_DEPLOY = mode.deploy;
    env.WORLDLINES_LOGIN = mode.login;
    if (mode.services.AIRP_AI_ACCOUNT_BASE) env.AIRP_AI_ACCOUNT_BASE = mode.services.AIRP_AI_ACCOUNT_BASE;
    const v = buildVersion();
    env.AIRP_RELEASE = v.version;
    if (v.sha) env.AIRP_BUILD_SHA = v.sha;
  }
  if (d.modelBase) {
    // Voice, voice input and pictures go to the same Worldlines AI service as
    // chat, billed to the account; the Worker's gateway fetch adds the token
    // (apps/server/src/ai-gateway.ts). No provider key ever reaches this tab.
    env.AIRP_AI_BASE = d.modelBase;
    env.AIRP_IMAGE_MODEL = d.imageModel;
    if (d.characterVoices) env.AIRP_TTS_CHARACTER_VOICES = d.characterVoices;
    // Studio voice: hidden unless this browser's local-TTS toggle is on (lib/tts-readiness.ts).
    if (localTtsFeature()) env.AIRP_LOCAL_TTS = '1';
    // Live calls from a tab go to the AI service's own voice channel
    // (ai.worldlines.gg /v1/voice/live, Fish voices in the cloud — no Mac on the
    // host's network): the in-tab server trades the account token for a one-use
    // ticket (engine/voice-live-ticket.ts) and the page dials ai directly, the
    // character answering over the same call (voice-live-brain.ts). Until
    // VOICE_LIVE_AVAILABLE (plans.ts, the one switch for launch) the tab stays on
    // GPT Live, which the service does not carry: it reports itself unavailable
    // and the call button stays hidden (never a direct OpenAI call).
    if (VOICE_LIVE_AVAILABLE) {
      env.AIRP_VOICE_PROVIDER = 'voice-live';
      env.VOICE_LIVE_TICKETS_URL = `${d.modelBase.replace(/\/+$/, '')}/voice/live/ticket`;
    } else {
      env.AIRP_VOICE_PROVIDER = 'gpt-live';
    }
  }
  if (!d.staticSite) {
    // Local dev host: the account is for sync/publish, so the play gate stays off.
    env.AIRP_PLAY_WITHOUT_ACCOUNT = '1';
  } else {
    // Static site: sign in straight at the identity service (no remote asked for
    // /auth/config), and the sign-in returns to this page's own origin, where the
    // Service Worker hands /api/remote/login/callback/… to this tab's server.
    env.AIRP_AUTH_PROVIDER = 'worldlines';
    env.AIRP_AUTH_URL = d.identity;
    env.AIRP_LOGIN_ORIGIN = window.location.origin;
    if (d.guestTrial) env.AIRP_GUEST_TRIAL = '1';
  }
  return env;
}

const SW_RELOAD_MARK = 'airp-sw-reload';
const session = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

/**
 * Wait until the Service Worker controls this page. A first visit gets control
 * from `clients.claim()` in the worker's activate step. A hard reload
 * (Cmd/Ctrl+Shift+R) loads the page past an already-active worker and stays
 * uncontrolled — it used to hang forever on 「注册 Service Worker…」. Ask the worker
 * to claim us; if that does not land within 3 s, reload once normally (a plain
 * reload is always controlled), and only then give up with an error.
 */
async function takeControl(registration: ServiceWorkerRegistration): Promise<void> {
  const changed = new Promise<boolean>((r) => navigator.serviceWorker.addEventListener('controllerchange', () => r(true), { once: true }));
  registration.active?.postMessage({ type: 'airp-claim' });
  const ok = await Promise.race([changed, new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]);
  if (ok || navigator.serviceWorker.controller) { session.set(SW_RELOAD_MARK, null); return; }
  if (session.get(SW_RELOAD_MARK) !== '1') {
    session.set(SW_RELOAD_MARK, '1');
    window.location.reload();
    await new Promise(() => {}); // the page is going away
  }
  session.set(SW_RELOAD_MARK, null);
  throw new Error(bootText(currentLocale(), 'swControl'));
}

/**
 * A started runtime: the Worker, its image download, and the events it sent before startBrowserMode set its
 * handlers. index.html starts one before this bundle loads on a static site (same shape, plain JS there).
 */
interface EarlyRuntime { worker: Worker; image: Promise<ArrayBuffer>; messages: MessageEvent[]; errors: ErrorEvent[]; url: string }
function startRuntime(workerUrl: string, imageUrl: string): EarlyRuntime {
  const worker = new Worker(workerUrl, { type: 'module' });
  const r: EarlyRuntime = { worker, url: workerUrl, messages: [], errors: [], image: fetch(imageUrl).then((res) => {
    if (!res.ok) throw new Error(`runtime image: HTTP ${res.status}`);
    return res.arrayBuffer();
  }) };
  r.image.catch(() => { /* awaited by startBrowserMode */ });
  worker.onmessage = (e) => { r.messages.push(e); };
  worker.onerror = (e) => { r.errors.push(e); };
  return r;
}
function adoptEarlyRuntime(workerUrl: string): EarlyRuntime | null {
  const w = window as unknown as { __airpEarlyRuntime?: EarlyRuntime };
  const early = w.__airpEarlyRuntime ?? null;
  delete w.__airpEarlyRuntime;
  if (!early?.worker) return null;
  // Only a Worker for the runtime this bundle was built against; anything else is dropped.
  if (new URL(early.url, window.location.href).href !== new URL(workerUrl, window.location.href).href) { early.worker.terminate(); return null; }
  return early;
}

/**
 * After a boot, let the Service Worker store the files that never change (airp-runtime-sw.js `precache`):
 * on a first visit they loaded before the worker controlled the page. Already stored files are skipped.
 */
function cacheStaticFiles() {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return;
  const base = browserDeployment.runtimeBase;
  const urls = ['worker.js', 'server.js', 'pi.js', 'sqlite3.wasm', 'image.bin', 'intros.json'].map((f) => `${base}${f}`);
  for (const el of document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href]')) {
    const href = 'src' in el ? el.src : el.href;
    if (href && new URL(href).pathname.includes('/assets/')) urls.push(href);
  }
  sw.postMessage({ type: 'airp-cache', urls });
}

/**
 * The player opened a world's card in the lobby: let the in-tab runtime download that world into its blob
 * cache while they read (apps/browser-runtime/src/worlds.ts `prefetch`), so 「开始新游戏」 starts from local
 * bytes. Browser mode only; skipped with Save-Data on. Signed out, the runtime does nothing.
 */
export function prefetchWorld(worldPath: string | null | undefined) {
  if (!worker || !worldPath) return;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (saveData) return;
  worker.postMessage({ type: 'prefetch-world', worldPath });
}

export interface BrowserModeInfo { bootMs: number; imageBytes: number; persist: unknown; marks: unknown }

/** Start the runtime and route /api + /ws to it. Resolves once the in-Worker server is listening. */
export async function startBrowserMode(opts: { templates?: string; world?: string; onStatus?: (s: string) => void } = {}): Promise<BrowserModeInfo> {
  const t0 = performance.now();
  const status = opts.onStatus ?? (() => {});
  // No mode, no runtime: a build that does not say remote|local and login on|off must not run half-configured.
  const problem = buildModeProblem();
  if (problem) throw new Error(`This build has no valid mode (config/.env.remote | config/.env.local): ${problem}`);
  if (browserDeployment.staticSite && buildMode()?.deploy !== 'remote') throw new Error('A static-site build must be a remote build (AIRP_DEPLOY=remote).');
  let fail: (e: Error) => void = () => {};
  ready = new Promise((resolve, reject) => { waiters.set('ready', resolve); fail = reject; });
  if (!('serviceWorker' in navigator)) throw new Error('browser mode needs Service Workers (https or localhost)');
  // Too old for the runtime (lib/browser-support.ts): say so, before a Worker dies on a regex it cannot construct.
  const missing = missingRuntimeFeatures();
  if (missing.length) {
    (window as unknown as { __airpEarlyRuntime?: EarlyRuntime }).__airpEarlyRuntime?.worker?.terminate();
    throw new OutdatedBrowserError(missing);
  }

  // The Worker and its base image do not need the Service Worker: start both first, so their downloads
  // (and the Worker's own server.js / sqlite3.wasm, worker.ts) run while the SW registers. On a static
  // site index.html has already started them before this bundle arrived (window.__airpEarlyRuntime).
  const workerUrl = `${browserDeployment.runtimeBase}worker.js`;
  const templates = opts.templates ?? new URLSearchParams(window.location.search).get('templates') ?? '';
  const imageUrl = browserDeployment.staticSite
    ? `${browserDeployment.runtimeBase}image.bin` // templates are never packed on a static site
    : `${HOST}/image${templates ? `?templates=${encodeURIComponent(templates)}` : ''}`;
  // The image holds what every session needs (presets, skills, extensions, pi-rp
  // metadata); worlds come from the catalog, one at a time, when opened.
  // `?templates=a,b` still packs whole templates into the image (old checks).
  const early = adoptEarlyRuntime(workerUrl) ?? startRuntime(workerUrl, imageUrl);
  worker = early.worker;
  perfMark('workerCreated');
  const imageP = early.image;

  status(bootText(currentLocale(), 'registering'));
  await navigator.serviceWorker.register(SW_URL, { scope: `${BASE}/` });
  const registration = await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await takeControl(registration);
  perfMark('swReady');
  navigator.serviceWorker.addEventListener('message', (e) => { void relayFetch(e); });
  installWebSocketShim();

  // Once per quiet period, not once per refused model call (lib/auth-prompt.ts).
  const askToSignIn = createAuthPrompt(() => { void import('./account-open.js').then((a) => a.openAccountPanel('play')); });
  // The guest trial is over (credits used up / past the trial world): its own line, its own quiet period.
  const askAfterTrial = createAuthPrompt(() => { void import('./account-open.js').then((a) => a.openAccountPanel('trial')); });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'ws-message' || m.type === 'ws-opened' || m.type === 'ws-closed') { sockets.get(m.id)?._frame(m); return; }
    if (m.type === 'ready') { waiters.get('ready')?.(m); return; }
    if (m.id !== undefined && waiters.has(m.id)) { const w = waiters.get(m.id)!; waiters.delete(m.id); w(m); return; }
    // A socket's open failed in the Worker: close that socket (the app reconnects); it is not a boot failure.
    if (m.type === 'error' && m.id !== undefined && sockets.has(m.id)) {
      reportWorkerError(m.message);
      sockets.get(m.id)!._frame({ type: 'ws-closed', code: 1011, reason: 'runtime error' });
      return;
    }
    if (m.type === 'error') { reportWorkerError(m.message); fail(new Error(m.message)); console.error('[browser-runtime]', m.message); return; }
    if (m.type === 'auth-required') { if (m.reason === 'trial') askAfterTrial(); else askToSignIn(); return; }
    if (m.type === 'log') console[m.level === 'error' ? 'error' : 'log']('[browser-runtime]', m.message);
  };
  worker.onerror = (e) => {
    const failed = (text: string) => { reportWorkerError(text); fail(new Error(`runtime worker failed: ${text.slice('WorkerError: '.length).split('\n')[0]}`)); };
    // No message at all (a script that did not load / start): find out whether the script is reachable.
    if (workerErrorMessage(e)) failed(workerErrorText(e));
    else void workerScriptStatus(new URL(workerUrl, window.location.href).href).then((why) => failed(workerErrorText(e, why)));
  };
  // What the Worker said before these handlers were set (buffered since it started).
  for (const e of early.messages.splice(0)) worker.onmessage!.call(worker, e);
  for (const e of early.errors.splice(0)) worker.onerror!.call(worker, e);
  (window as any).__airpRuntime = { frames: frameTally, call, flush: (full?: boolean) => call({ type: 'flush', full }), stats: () => call({ type: 'stats' }) };

  status(bootText(currentLocale(), 'preparing'));
  const image = await imageP;
  const imageBytes = image.byteLength;
  perfMark('imageFetched');
  status(bootText(currentLocale(), 'starting'));
  // No default world at boot: the launcher opens one (and fetches it) on demand.
  const world = opts.world ?? templates.split(',').filter(Boolean)[0];
  const d = browserDeployment;
  let modelMap: Record<string, string> = {};
  try { modelMap = d.modelMap ? JSON.parse(d.modelMap) : {}; } catch { console.error('[browser-mode] VITE_AIRP_MODEL_MAP is not JSON'); }
  worker.postMessage({
    type: 'init', image, persist: { ns: 'web' },
    // Models: the Worldlines gateway with the account's token, or (dev) the host's key-holding proxy.
    ...(d.modelBase ? { model: { base: d.modelBase, product: 'livingcanvas', map: modelMap } } : { modelProxy: `${window.location.origin}${HOST}/model` }),
    // The player's own keys, per capability (this browser only; the Worker keeps them in memory).
    ...(d.modelBase ? { localKey: runtimeRoutes(localKeySettings()) } : {}),
    // The /net forwarder exists only on the dev host; a static site calls auth / storage directly (CORS).
    ...(d.staticSite ? {} : { netProxy: `${window.location.origin}${HOST}/net` }),
    catalog: catalogConfig(),
    env: serverEnv(world),
  }, [image]);
  const r = await ready;
  perfMark('runtimeReady');
  // 「使用本机密钥」 switches live: the Worker routes the next request by it.
  if (d.modelBase) registerLocalKeyRuntime((routes) => call({ type: 'local-key', config: routes }));
  window.addEventListener('pagehide', () => { void call({ type: 'flush' }); });
  if (d.staticSite) setTimeout(() => cacheStaticFiles(), 5000);
  return { bootMs: Math.round(performance.now() - t0), imageBytes, persist: r.persist, marks: r.marks };
}
