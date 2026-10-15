/**
 * live-call-store.ts — the module-level owner of the one realtime call
 *.
 *
 * The nook projection and the character dialogue are two doors onto the same
 * call. Ownership cannot live in a component: two components would each keep
 * their own `useRef` resources and their own idea of "is a call up". So the
 * state machine, the WebRTC resources, the frame listener and the throttled
 * snapshots live here, and `live-call.ts` is a zero-side-effect React binding.
 *
 * Hard rules this file keeps:
 *   - At most ONE call, cross-character (§2.1). `start()` adopts a call for the
 *     same character and closes a different one first (§2.2 freeze 1).
 *   - `stop(owner)` is a lifecycle guard: it does nothing for a non-matching
 *     owner, so unmounting one entry never kills another entry's call (§5.1).
 *   - The store NEVER opens a WebSocket or invents a frame name (§2.3): it
 *     listens to the `airp:character-frame` relay `useWorld` already dispatches.
 *   - `getSnapshot()` / `getLines()` are pure reads returning a reference that
 *     only changes when the content really changed — what
 *     `useSyncExternalStore`'s `Object.is` check needs, and what keeps the
 *     250ms tick from re-rendering an idle rail (same discipline as
 *     `agent-activity-store.ts`).
 *   - No React import: the binding is a separate export (§2.2 freeze 3).
 */

import { agentActivityStore, type AgentActivityStore } from './agent-activity-store.js';
import { AirpRequestError } from './airp-gateway.js';
import { isCharacterFrame } from './character-frame-queue.js';
import { UI_COPY } from './legacy-ui-copy.js';
import { translate, type Locale } from './translate.js';
import {
  startVoiceLiveCall,
  type VoiceLiveFailure,
  type VoiceLiveFailureDetail,
  type VoiceLiveTransport,
} from './voice-live-call.js';

/**
 * Which voice backend a call runs on. The server
 * decides and reports it through `/api/live/config`; the store's job is to open
 * the right transport and then look identical either way, so the two entries,
 * the subtitle projection and `stop(owner)` need no idea which one is up.
 */
export type VoiceProvider = 'gpt-live' | 'voice-live';

/** The global snapshot. Idle means `characterId === null` and `phase === 'idle'`. */
export interface LiveCallState {
  phase: 'idle' | 'connecting' | 'live' | 'error';
  /** Human-readable, mapped from the server `code` (`errorText`). */
  error?: string;
  /** The character on the call; null when there is none. */
  characterId: string | null;
  /** The entry that opened the call (`nook:<id>` / `dialogue:<id>`). */
  owner: string | null;
  inputText: string;
  outputText: string;
  /**
   * What the character is doing right now, so the silence while she thinks
   * reads as thinking rather than as a dropped call. voice-live only; absent on
   * GPT Live, which has no such signal.
   */
  bot?: CallBotState;
  /** A short in-call notice (one turn failed, the call goes on). Clears itself. */
  notice?: string;
  /** Epoch ms at which this month's minutes run out; null = unlimited; absent = unknown. */
  endsAt?: number | null;
  /** Where to get more minutes / a plan with calls, kept from the refusal. */
  billingUrl?: string;
}

export type CallBotState = 'listening' | 'thinking' | 'speaking';

/** The character's real lines — a projection of the existing frames. */
export interface LiveCallLines {
  streaming: string;
  lines: string[];
}

export interface StartCallOptions {
  characterId: string;
  /** The call's spoken language (`/api/live/session` `language`). The error copy follows it (ja / ko / en). */
  locale: 'en' | 'ja' | 'ko';
  /** Exact world root captured by the UI action that started this call. */
  savePath: string;
  /** Origin entry; `stop(owner)` only hangs up when it matches. */
  owner: string;
  /** The interface language for the copy (errors, notices). Defaults to `locale`. */
  uiLocale?: Locale;
}

export interface LiveCallStore {
  subscribe(listener: () => void): () => void;
  /** Reference-stable: the same object until the content changes. */
  getSnapshot(): LiveCallState;
  /** Reference-stable: same rule as `getSnapshot`. */
  getLines(): LiveCallLines;
  /** Readiness gate (`GET /api/live/config`). False until that resolves. */
  isAvailable(): boolean;
  /**
   * The transport a call started now would use. `gpt-live` until the config
   * probe answers, so a read before then is conservative rather than wrong.
   */
  getProvider(): VoiceProvider;
  /** Idempotent readiness probe; triggered on first subscription. */
  ensureConfig(): void;
  /** MUST run inside a user action (getUserMedia). Closes any other call first. */
  start(opts: StartCallOptions): Promise<void>;
  /**
   * Hang up. Idempotent.
   * - no `owner`: close whatever is up (explicit user hangup).
   * - with `owner`: only when it matches, otherwise nothing happens (no error,
   * no request) — the design notes
   */
  stop(owner?: string): Promise<void>;
  /** World/save changed or disappeared: local self-clear, NO network request (§3.5). */
  clearAll(reason: 'world-unavailable' | 'save-changed'): void;
  /** Lazy clock (`TICK_MS`); production arms a timer, tests call it directly. */
  tick(now?: number): void;
}

export interface LiveCallDeps {
  now?: () => number;
  fetch?: typeof fetch;
  createPeerConnection?: () => RTCPeerConnection;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  createAudio?: () => HTMLAudioElement;
  /** Event bus; defaults to `window`. Tests inject an in-memory one. */
  events?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** Selected-save identity source; defaults to the app's shared owner. */
  activeSaveStore?: AgentActivityStore;
  /** The voice-live transport; defaults to the real one (`voice-live-call.ts`). */
  startVoiceLive?: typeof startVoiceLiveCall;
}

interface LiveConfig {
  ok: boolean;
  available: boolean;
  reason?: string;
  model: string;
  voices: string[];
  /** Added by the provider seam; absent on an older server, which means gpt-live. */
  provider?: VoiceProvider;
}

interface LiveSessionResponse {
  ok: boolean;
  sessionId: string;
  sdp: string;
  character: string;
  voice: string;
}

/** How long to wait for ICE gathering before sending the offer as-is. */
const ICE_GATHERING_TIMEOUT_MS = 10_000;
/** How long to wait for the data channel's `session.started` after the answer. */
const SESSION_START_TIMEOUT_MS = 20_000;
/** Hangup wait for `session.closed` before we close the peer locally anyway. */
const SESSION_CLOSE_TIMEOUT_MS = 15_000;
/** Subtitle commit cadence. */
const TICK_MS = 250;
/** How long an in-call notice ("say that again") stays up. */
const NOTICE_MS = 6_000;

/** Server `code` → the copy key that names the human-readable reason. */
const ERROR_COPY_KEYS: Record<string, keyof (typeof UI_COPY)['en']> = {
  unsupported: 'liveErrorUnconfigured',
  no_active_world: 'liveErrorWorld',
  world_changed: 'liveErrorWorldChanged',
  not_found: 'liveErrorCharacter',
  invalid_argument: 'liveErrorRequest',
  forbidden: 'liveErrorVoice',
  invalid_offer: 'liveErrorOffer',
  internal: 'liveErrorGeneric',
};

/** A client-side failure (or a voice-line refusal) with no HTTP payload of ours. */
class LiveClientError extends Error {
  readonly code: VoiceLiveFailure;
  readonly detail: VoiceLiveFailureDetail;
  constructor(code: VoiceLiveFailure, detail: VoiceLiveFailureDetail = {}) {
    super(code);
    this.name = 'LiveClientError';
    this.code = code;
    this.detail = detail;
  }
}

/** One-shot gate for the two data-channel handshakes. */
interface Gate<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function makeGate<T>(): Gate<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** No-op bus so the store can be imported where there is no DOM (tests, SSR). */
const NOOP_EVENTS: Pick<Window, 'addEventListener' | 'removeEventListener'> = {
  addEventListener: () => {},
  removeEventListener: () => {},
};

/** Module constants, reused so "no call" never allocates a fresh object. */
const IDLE: LiveCallState = {
  phase: 'idle',
  characterId: null,
  owner: null,
  inputText: '',
  outputText: '',
};
const EMPTY_LINES: LiveCallLines = { streaming: '', lines: [] };

/**
 * Read a `/api/live/*` JSON response while preserving the gateway's
 * cross-cutting 409 handling: a `no_active_world` answer means the world
 * vanished under the app, and the existing `airp:world-unavailable` forward
 * must still run (the store is itself a subscriber of that event, §3.5).
 */
async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const code = typeof payload?.code === 'string' ? payload.code : null;
    if (code === 'no_active_world' && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('airp:world-unavailable'));
    }
    throw new AirpRequestError(String(response.status), response.status, payload);
  }
  return (payload ?? {}) as T;
}

/**
 * Wait until ICE gathering finishes so the offer carries its candidates in one
 * shot: we have no trickle channel, the SDP travels over a single HTTP POST.
 * The timeout is a ceiling, not a promise — on expiry we send what we have and
 * let the server's `invalid_offer` be the visible verdict.
 */
function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onStateChange);
      pc.removeEventListener('icecandidate', onCandidate);
      resolve();
    };
    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const onCandidate = (event: RTCPeerConnectionIceEvent) => {
      if (!event.candidate) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onStateChange);
    pc.addEventListener('icecandidate', onCandidate);
  });
}

/** Resolve when `promise` settles OR after `ms`, whichever comes first. It
 * NEVER rejects: this is the best-effort `session.closed` wait on hangup, where
 * a dead channel must not stall cleanup. */
function waitOrTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

/** Resolve to `true` when `promise` settles first, `false` on timeout. Never
 * rejects — used to gate `phase:'live'` on `session.started`. */
function waitForSignalOrTimeout(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

/** `2026-11-01T00:00:00Z` → `2026-11-01`, in Japan time (the billing month's zone). */
function resetDate(iso: string | undefined): string | null {
  const ms = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) return null;
  return new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The voice line's own refusals, in the interface language. Named `t` so
 * `pnpm check:i18n` sees every key.
 */
function voiceFailureText(code: VoiceLiveFailure, detail: VoiceLiveFailureDetail, uiLocale: Locale): string | null {
  const t = (key: string, values?: Record<string, string | number>) => translate(uiLocale, key, values);
  // A map, not a `switch`: `tools/check-ws-contract.mjs` reads `case '…'` in
  // this file as canvas frame names, and these are failure reasons.
  const date = resetDate(detail.resetsAt);
  const copy: Partial<Record<VoiceLiveFailure, () => string>> = {
    minutes_exhausted: () => (date
      ? t('This month’s call minutes are used up. They come back on {date}.', { date })
      : t('This month’s call minutes are used up.')),
    time_limit: () => t('The call reached its time limit. Call again to keep talking.'),
    plan_required: () => t('Your plan does not include voice calls.'),
    call_in_progress: () => t('You are already on a call in another tab or device. Hang up there first.'),
    line_busy: () => t('Every voice line is busy right now. Try again in a minute.'),
    signed_out: () => t('Sign in to make a voice call.'),
    network: () => t('The connection to the call dropped. Check your network and try again.'),
  };
  return copy[code]?.() ?? null;
}

/** The in-call notice for one failed turn. */
function turnFailedText(uiLocale: Locale): string {
  const t = (key: string) => translate(uiLocale, key);
  return t('That reply did not come through. Say it again — still listening.');
}

/** Map any failure to the copy the player reads. Never a raw status or code. */
function errorText(error: unknown, locale: StartCallOptions['locale'], uiLocale: Locale = locale): string {
  if (error instanceof LiveClientError) {
    const specific = voiceFailureText(error.code, error.detail, uiLocale);
    if (specific) return specific;
  }
  // ja keeps its hand-written legacy copy; every other language reads the English value through messages.json
  // (zh-CN / ko entries since 2026-10-03), like NookView does.
  const copy = locale === 'ja' ? UI_COPY.ja : (Object.fromEntries(Object.entries(UI_COPY.en).map(([k, v]) => [k, translate(locale, v)])) as Record<keyof (typeof UI_COPY)['en'], string>);
  if (error instanceof LiveClientError) {
    if (error.code === 'mic_denied') return copy.liveErrorMicDenied;
    if (error.code === 'mic_unsupported') return copy.liveErrorMicUnsupported;
    if (error.code === 'unavailable') return copy.liveErrorUnconfigured;
    if (error.code === 'world_changed') return copy.liveErrorWorldChanged;
    return copy.liveErrorConnection;
  }
  if (error instanceof AirpRequestError) {
    const code = typeof error.payload?.code === 'string' ? error.payload.code : null;
    const key = code ? ERROR_COPY_KEYS[code] : undefined;
    return key ? copy[key] : copy.liveErrorGeneric;
  }
  return copy.liveErrorGeneric;
}

/** Shallow equality over the six frozen fields — the "really changed" test. */
function isSameState(a: LiveCallState, b: LiveCallState): boolean {
  return (
    a.phase === b.phase &&
    a.error === b.error &&
    a.characterId === b.characterId &&
    a.owner === b.owner &&
    a.inputText === b.inputText &&
    a.outputText === b.outputText &&
    a.bot === b.bot &&
    a.notice === b.notice &&
    a.endsAt === b.endsAt &&
    a.billingUrl === b.billingUrl
  );
}

export function createLiveCallStore(deps: LiveCallDeps = {}): LiveCallStore {
  const now = deps.now ?? (() => Date.now());
  // Named `fetch` on purpose: `tools/check-request-bodies.mjs` pins each body by
  // finding `fetch('<route>', …)` in the file named by its `BODIES.file`.
  const fetch: typeof globalThis.fetch = deps.fetch ?? globalThis.fetch?.bind(globalThis);
  const events = deps.events ?? (typeof window !== 'undefined' ? window : NOOP_EVENTS);
  const activeSaveStore = deps.activeSaveStore ?? agentActivityStore;
  const openPeer = deps.createPeerConnection ?? (() => new RTCPeerConnection());
  const openAudio = deps.createAudio ?? (() => new Audio());

  const listeners = new Set<() => void>();

  // The immutable snapshot. `committed` is only ever replaced whole; the
  // `pending*` buffers are what a tick folds into it (§4.2).
  let committed: LiveCallState = IDLE;
  let committedLines: LiveCallLines = EMPTY_LINES;
  let pendingInput = '';
  let pendingOutput = '';
  let pendingStreaming = '';
  let pendingLines: string[] = [];
  let linesDirty = false;
  /** When the current in-call notice comes down (0 = none up). */
  let noticeUntil = 0;
  /**
   * The transport carries her lines itself (voice-live `segment`), so the
   * canvas's `character_*` frames for the same turn are the SAME words a second
   * time — and a canvas `error` is one failed turn, not a failed call.
   */
  let transportOwnsLines = false;

  // Resources — the whole reason this store exists (§5.1).
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let stream: MediaStream | null = null;
  let audio: HTMLAudioElement | null = null;
  /** The voice-live transport, when that is the provider. Never both at once. */
  let voiceLive: VoiceLiveTransport | null = null;

  let startedGate: Gate<boolean> | null = null;
  let closedGate: Gate<void> | null = null;
  /** Bumped by `start()`, `stop()` and `clearAll()`; the stale-failure guard. */
  let generation = 0;
  let activeLocale: StartCallOptions['locale'] = 'en';
  let activeUiLocale: Locale = 'en';
  let activeCallSavePath: string | null = null;
  let callAbort: AbortController | null = null;
  let available = false;
  // Conservative until the probe answers: gpt-live is the shape every existing
  // consumer already expects, so a read before the answer is never surprising.
  let provider: VoiceProvider = 'gpt-live';
  let configRequested = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  function isCurrentCall(callGeneration: number, savePath: string): boolean {
    return (
      generation === callGeneration &&
      activeCallSavePath === savePath &&
      activeSaveStore.isSaveActive(savePath)
    );
  }

  function notify(): void {
    for (const cb of listeners) cb();
  }

  /** Reference-stable commit: a new object only when a field really changed,
   * and always the `IDLE` constant for an idle snapshot (§4.2). */
  function commitState(patch: Partial<LiveCallState>): void {
    const next = { ...committed, ...patch };
    if (isSameState(next, committed)) return;
    committed = isSameState(next, IDLE) ? IDLE : next;
    notify();
  }

  function commitLines(): void {
    if (!linesDirty) return;
    committedLines = { streaming: pendingStreaming, lines: pendingLines.slice() };
    linesDirty = false;
    notify();
  }

  /** Drop every transcript buffer and the committed subtitle snapshot. */
  function clearBooks(): void {
    pendingInput = '';
    pendingOutput = '';
    pendingStreaming = '';
    pendingLines = [];
    linesDirty = false;
    if (committedLines !== EMPTY_LINES) {
      committedLines = EMPTY_LINES;
      notify();
    }
  }

  function hasClockWork(): boolean {
    return (
      pendingInput !== committed.inputText ||
      pendingOutput !== committed.outputText ||
      linesDirty ||
      noticeUntil !== 0
    );
  }

  function armClock(): void {
    if (timer !== null) return;
    timer = setInterval(() => tick(), TICK_MS);
  }

  function disarmClock(): void {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  /** The lazy clock (§4.4): production arms it, tests call `tick()` directly. */
  function tick(at: number = now()): void {
    if (noticeUntil !== 0 && at >= noticeUntil) {
      noticeUntil = 0;
      commitState({ notice: undefined });
    }
    if (pendingInput !== committed.inputText || pendingOutput !== committed.outputText) {
      commitState({ inputText: pendingInput, outputText: pendingOutput });
    }
    commitLines();
    if (!hasClockWork()) disarmClock();
  }

  /** Release every local resource. Never touches the network — `stop()` owns that. */
  function releaseLocal(): void {
    // Cancel an in-progress voice-live permission/ticket wait as well as its
    // installed resources; no late completion may open a socket for old work.
    const pendingAbort = callAbort;
    callAbort = null;
    pendingAbort?.abort();
    try {
      voiceLive?.stop();
    } catch {
      /* already torn down */
    }
    voiceLive = null;
    transportOwnsLines = false;
    noticeUntil = 0;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    try {
      dc?.close();
    } catch {
      /* already closing */
    }
    dc = null;
    try {
      pc?.close();
    } catch {
      /* already closing */
    }
    pc = null;
    if (audio) {
      audio.srcObject = null;
      audio = null;
    }
  }

  function setAvailable(next: boolean): void {
    if (next === available) return;
    available = next;
    notify();
  }

  function fail(error: unknown): void {
    const billingUrl = error instanceof LiveClientError ? error.detail.billingUrl : undefined;
    commitState({
      phase: 'error',
      error: errorText(error, activeLocale, activeUiLocale),
      bot: undefined,
      notice: undefined,
      ...(billingUrl ? { billingUrl } : {}),
    });
  }

  /** One turn failed; the call goes on. Up for `NOTICE_MS`, or until she speaks. */
  function showNotice(text: string): void {
    noticeUntil = now() + NOTICE_MS;
    commitState({ notice: text });
    armClock();
  }

  /** Append one raw transcript fragment. The display text is the exact
   * concatenation of the deltas — no separator, no trimming (§4.6). */
  function applyTranscriptDelta(channel: 'input' | 'output', message: Record<string, unknown>): void {
    const delta = typeof message.delta === 'string' ? message.delta : '';
    if (delta === '') return;
    if (channel === 'input') pendingInput += delta;
    else pendingOutput += delta;
    armClock();
  }

  /** The data channel is the only place transcript events arrive; audio itself
   * is on the media track (`session.output_audio.delta` MUST NOT be expected). */
  function onDataChannelMessage(event: MessageEvent, savePath: string, callGeneration: number): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      return; // A non-JSON frame is not ours to guess at.
    }
    // Read `type` through a local so the frame-name scanner
    // (tools/check-ws-contract.mjs) does not read the `'string'` typeof guard
    // as a frame. The dotted cases stay dotted so the same scanner does not
    // read `'started'` as a frame name.
    const raw = message.type;
    const type = typeof raw === 'string' ? raw : '';
    if (!isCurrentCall(callGeneration, savePath)) {
      // A local hangup bumps generation before waiting for this acknowledgement.
      if (
        type === 'session.closed' &&
        callGeneration + 1 === generation &&
        activeCallSavePath === savePath &&
        activeSaveStore.isSaveActive(savePath)
      ) closedGate?.resolve();
      return;
    }
    switch (type) {
      case 'session.started':
        startedGate?.resolve(true);
        break;
      case 'session.closed':
        closedGate?.resolve();
        break;
      case 'session.input_transcript.delta':
        applyTranscriptDelta('input', message);
        break;
      case 'session.output_transcript.delta':
        applyTranscriptDelta('output', message);
        break;
      default:
        break;
    }
  }

  /**
   * Character speech reuses the frames `useWorld` already dispatches (§3.4).
   * One listener per store, mounted once — never a second socket, never a new
   * frame name. Subtitle frames only fill the buffers; `tick()` commits them.
   */
  function onCharacterFrame(event: Event): void {
    const detail = (event as CustomEvent).detail;
    if (!isCharacterFrame(detail)) return;
    if (detail.savePath !== activeCallSavePath || !activeCallSavePath || !activeSaveStore.isSaveActive(activeCallSavePath)) return;
    if (detail.characterId !== committed.characterId) return;
    if (transportOwnsLines) return;
    if (detail.type === 'character_delta') pendingStreaming += detail.delta;
    else if (detail.type === 'character_message') {
      pendingLines.push(detail.text);
      pendingStreaming = '';
    } else if (detail.type === 'character_idle') pendingStreaming = '';
    else if (detail.type === 'error') {
      // §3.4 step 6: the server already wrote the sentence, and the player
      // must see it in the same event loop — so this one commits synchronously.
      if (committed.phase === 'connecting' || committed.phase === 'live') {
        commitState({ phase: 'error', error: detail.message });
      }
      return;
    } else return;
    linesDirty = true;
    armClock();
  }

  /** World gone: the backend already closed its handles, so a `close` POST
   * would only 409. Clear locally and let the guards drop stale failures. */
  function onWorldUnavailable(): void {
    clearAll('world-unavailable');
  }

  function ensureConfig(): void {
    if (configRequested) return;
    configRequested = true;
    void (async () => {
      try {
        const config = await readJson<LiveConfig>(await fetch('/api/live/config'));
        // An older server has no `provider` field; that answer means gpt-live,
        // which is exactly what this store did before the seam existed.
        provider = config.provider === 'voice-live' ? 'voice-live' : 'gpt-live';
        setAvailable(config.ok === true && config.available === true);
      } catch {
        setAvailable(false);
      }
    })();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    // Readiness is probed lazily: with no subscriber nobody can render the
    // entry, so nobody needs the answer (§2.1 `ensureConfig`).
    ensureConfig();
    return () => listeners.delete(listener);
  }

  async function start(opts: StartCallOptions): Promise<void> {
    if (!opts.savePath || !activeSaveStore.isSaveActive(opts.savePath)) return;
    if (activeCallSavePath && !activeSaveStore.isSaveActive(activeCallSavePath)) clearAll('save-changed');
    if (!activeSaveStore.isSaveActive(opts.savePath)) return;
    activeLocale = opts.locale;
    activeUiLocale = opts.uiLocale ?? opts.locale;
    // Same character already talking? Adopt: keep the transport, move the owner.
    // This is what makes "the two entries share one call" observable (§3.1-3).
    if (committed.phase === 'connecting' || committed.phase === 'live') {
      if (committed.characterId === opts.characterId && activeCallSavePath === opts.savePath) {
        commitState({ owner: opts.owner });
        return;
      }
    }

    // A different character, or a call left in `error` → close it first (§3.2-4).
    // The cast re-widens `phase`: TS narrowed it to the non-idle branch above,
    // but `stop()` reassigns `committed` where flow analysis cannot follow.
    if ((committed.phase as LiveCallState['phase']) !== 'idle') {
      await stop();
      if ((committed.phase as LiveCallState['phase']) !== 'idle') return;
      if (!activeSaveStore.isSaveActive(opts.savePath)) return;
    }

    generation += 1;
    const gen = generation;
    activeCallSavePath = opts.savePath;
    const callController = new AbortController();
    callAbort = callController;

    // Readiness gate: never open a microphone on a server that cannot host the
    // call — the 503 would arrive only after the permission prompt (§3.2-2).
    if (!available) {
      fail(new LiveClientError('unavailable'));
      return;
    }

    startedGate = makeGate<boolean>();
    const gate = startedGate;
    closedGate = null;
    clearBooks();
    commitState({
      phase: 'connecting',
      characterId: opts.characterId,
      owner: opts.owner,
      inputText: '',
      outputText: '',
      error: undefined,
      bot: undefined,
      notice: undefined,
      endsAt: undefined,
      billingUrl: undefined,
    });

    // voice-live is a different transport, not a different call: it fills the
    // same snapshot, answers the same `stop(owner)`, and the two entries cannot
    // tell which one is up. The GPT Live path below is untouched.
    if (provider === 'voice-live') {
      await startOnVoiceLive(gate, gen, opts.characterId, opts.savePath, callController.signal);
      return;
    }

    try {
      // 1. Microphone — inside the user's click, never on mount (§2.9).
      const getUserMedia =
        deps.getUserMedia ??
        (typeof navigator !== 'undefined'
          ? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
          : undefined);
      if (!getUserMedia) throw new LiveClientError('mic_unsupported');
      let media: MediaStream;
      try {
        media = await getUserMedia({ audio: true });
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          throw new LiveClientError('mic_denied');
        }
        throw new LiveClientError('mic_unsupported');
      }
      if (!isCurrentCall(gen, opts.savePath)) {
        for (const track of media.getTracks()) track.stop();
        return;
      }
      stream = media;

      // 2. Peer connection; the synthesized voice arrives as a remote track.
      const peer = openPeer();
      pc = peer;
      const player = openAudio();
      player.autoplay = true;
      audio = player;
      peer.addEventListener('track', (event) => {
        if (!isCurrentCall(gen, opts.savePath)) return;
        const [remote] = event.streams;
        if (remote && audio) audio.srcObject = remote;
      });
      peer.addEventListener('connectionstatechange', () => {
        if (isCurrentCall(gen, opts.savePath) && peer.connectionState === 'failed' && committed.phase === 'live') {
          fail(new LiveClientError('connection'));
        }
      });
      for (const track of media.getTracks()) peer.addTrack(track, media);

      // 3. Data channel FIRST, so no early event is missed. We never send
      //    `session.start` here — the HTTP call already starts the session.
      const channel = peer.createDataChannel('oai-events');
      dc = channel;
      channel.addEventListener('message', (event) => onDataChannelMessage(event, opts.savePath, gen));

      // 4. Offer with ICE already gathered (single-shot SDP, no trickle).
      const offer = await peer.createOffer();
      if (!isCurrentCall(gen, opts.savePath)) return;
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer, ICE_GATHERING_TIMEOUT_MS);
      if (!isCurrentCall(gen, opts.savePath)) return;
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new LiveClientError('connection');

      // 5. Our server creates the Live session and attaches the sideband.
      if (!isCurrentCall(gen, opts.savePath)) return;
      const result = await readJson<LiveSessionResponse>(
        await fetch('/api/live/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ character: opts.characterId, sdp, language: opts.locale, savePath: opts.savePath }),
          signal: callController.signal,
        }),
      );
      if (!isCurrentCall(gen, opts.savePath)) return;

      // 6. Answer from OpenAI, relayed by our server.
      await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp });
      if (!isCurrentCall(gen, opts.savePath)) return;

      // 7. Only `session.started` promotes the call to `live`; the HTTP 200 is
      //    the server's word, not the session's. Committed synchronously so the
      //    TTS gate in the dialogue reads `live` in this same event loop.
      const started = await waitForSignalOrTimeout(gate.promise, SESSION_START_TIMEOUT_MS);
      if (!isCurrentCall(gen, opts.savePath) || (committed.phase as LiveCallState['phase']) !== 'connecting') return;
      if (!started) throw new LiveClientError('connection');
      commitState({ phase: 'live' });
      if (!isCurrentCall(gen, opts.savePath)) return;
      await audio.play().catch(() => {
        /* Autoplay blocked: the subtitle still tells the player what was said. */
      });
    } catch (err) {
      if (!isCurrentCall(gen, opts.savePath)) return;
      releaseLocal();
      fail(err);
    }
  }

  /**
   * The voice-live half of `start`.
   *
   * Shorter than the GPT Live path because there is no SDP to exchange and no
   * server-side session to create: our server reverse-proxies the socket, and
   * the call IS the socket. `hello` is what promotes the call to `live`, the
   * same way `session.started` does for GPT Live — the socket opening is the
   * transport's word, not the session's.
   */
  async function startOnVoiceLive(
    gate: Gate<boolean>,
    gen: number,
    characterId: string,
    savePath: string,
    signal: AbortSignal,
  ): Promise<void> {
    const open = deps.startVoiceLive ?? startVoiceLiveCall;
    transportOwnsLines = true;
    try {
      const transport = await open({
        characterId,
        savePath,
        signal,
        isCurrent: () => isCurrentCall(gen, savePath),
        onReady: () => {
          if (isCurrentCall(gen, savePath)) gate.resolve(true);
        },
        onInputText: (text) => {
          if (!isCurrentCall(gen, savePath)) return;
          pendingInput = text;
          armClock();
        },
        onLine: (text) => {
          if (!isCurrentCall(gen, savePath)) return;
          pendingLines.push(text);
          pendingStreaming = '';
          linesDirty = true;
          // She is talking again: the "say it again" notice has done its job.
          if (noticeUntil !== 0) {
            noticeUntil = 0;
            commitState({ notice: undefined });
          }
          armClock();
        },
        onBotState: (state) => {
          if (!isCurrentCall(gen, savePath)) return;
          commitState({ bot: state === 'idle' ? 'listening' : state });
        },
        onThought: () => {
          /* Display-only and silent (integration.md §3.3); no surface yet. */
        },
        onNotice: () => {
          if (!isCurrentCall(gen, savePath)) return;
          showNotice(turnFailedText(activeUiLocale));
          commitState({ bot: 'listening' });
        },
        onAllowance: (remainingSeconds) => {
          if (!isCurrentCall(gen, savePath)) return;
          commitState({ endsAt: remainingSeconds === null ? null : now() + remainingSeconds * 1000 });
        },
        onError: (reason, detail) => {
          if (!isCurrentCall(gen, savePath)) return;
          gate.resolve(false);
          releaseLocal();
          fail(new LiveClientError(reason, detail));
        },
        onClosed: () => {
          if (!isCurrentCall(gen, savePath)) return;
          gate.resolve(false);
          releaseLocal();
          if (committed.phase === 'connecting' || committed.phase === 'live') {
            fail(new LiveClientError('connection'));
          }
        },
      });
      if (!isCurrentCall(gen, savePath)) {
        transport.stop();
        return;
      }
      voiceLive = transport;
    } catch {
      // `startVoiceLiveCall` already reported through `onError`; the throw only
      // unwinds this function.
      return;
    }

    const started = await waitForSignalOrTimeout(gate.promise, SESSION_START_TIMEOUT_MS);
    if (!isCurrentCall(gen, savePath) || (committed.phase as LiveCallState['phase']) !== 'connecting') return;
    if (!started) {
      releaseLocal();
      fail(new LiveClientError('connection'));
      return;
    }
    commitState({ phase: 'live', bot: committed.bot ?? 'listening' });
  }

  async function stop(owner?: string): Promise<void> {
    // The lifecycle guard (§3.1-2): an entry only hangs up the call IT opened.
    if (owner !== undefined && committed.owner !== owner) return;
    if (committed.phase === 'idle') return;

    const savePath = activeCallSavePath;
    if (!savePath || !activeSaveStore.isSaveActive(savePath)) {
      clearAll('save-changed');
      return;
    }
    generation += 1;
    callAbort?.abort();
    callAbort = null;
    const gen = generation;
    const wasActive = committed.phase === 'connecting' || committed.phase === 'live';
    const characterId = committed.characterId;

    // Ask the session to close and give it the frozen window for
    // `session.closed`. A silent session MUST NOT stall the hangup.
    let closed: Promise<void> | null = null;
    if (dc?.readyState === 'open') {
      closedGate = makeGate<void>();
      closed = closedGate.promise;
      try {
        dc.send(JSON.stringify({ type: 'session.close' }));
      } catch {
        closed = null;
      }
    }
    if (closed) await waitOrTimeout(closed, SESSION_CLOSE_TIMEOUT_MS);

    // A save switch clears the call and owns teardown; never let this stale
    // continuation close or clear a later call.
    if (gen !== generation) return;

    if (characterId && provider === 'gpt-live') {
      try {
        await fetch('/api/live/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ character: characterId, savePath }),
        });
      } catch {
        /* Server gone; ours is the cleanup that still matters. */
      }
    }
    if (gen !== generation) return;

    releaseLocal();
    startedGate?.resolve(false);
    closedGate?.resolve();
    startedGate = null;
    closedGate = null;
    activeCallSavePath = null;
    clearBooks();
    disarmClock();
    if (wasActive || committed.phase === 'error') commitState({ ...IDLE, error: undefined, bot: undefined, notice: undefined, endsAt: undefined, billingUrl: undefined });
  }
  function clearAll(_reason: 'world-unavailable' | 'save-changed'): void {
    generation += 1;
    callAbort?.abort();
    callAbort = null;
    disarmClock();
    releaseLocal();
    startedGate?.resolve(false);
    closedGate?.resolve();
    startedGate = null;
    closedGate = null;
    activeCallSavePath = null;
    const hadSnapshot = committed !== IDLE;
    pendingInput = '';
    pendingOutput = '';
    pendingStreaming = '';
    pendingLines = [];
    linesDirty = false;
    noticeUntil = 0;
    transportOwnsLines = false;
    committed = IDLE;
    committedLines = EMPTY_LINES;
    if (hadSnapshot) notify();
  }

  events.addEventListener('airp:character-frame', onCharacterFrame);
  events.addEventListener('airp:world-unavailable', onWorldUnavailable);
  activeSaveStore.subscribe(() => {
    if (activeCallSavePath && !activeSaveStore.isSaveActive(activeCallSavePath)) {
      clearAll('save-changed');
    }
  });

  return {
    subscribe,
    getSnapshot: () => committed,
    getLines: () => committedLines,
    isAvailable: () => available,
    getProvider: () => provider,
    ensureConfig,
    start,
    stop,
    clearAll,
    tick,
  };
}

/**
 * Is this character on the call right now? Their canvas frames during a call
 * belong to the call (its brain runs on the same agent), so the dialogue of
 * ANOTHER character must not read them as a reply it cannot place.
 */
export function callCarries(state: Pick<LiveCallState, 'phase' | 'characterId'>, characterId: string): boolean {
  return (state.phase === 'connecting' || state.phase === 'live') && state.characterId === characterId;
}

/** The one call, process-wide. Two entries, one owner of the transport. */
export const liveCallStore: LiveCallStore = createLiveCallStore();

/** Test seam: reset the singleton between cases (mirrors the rail store's). */
export function resetLiveCallForTest(): void {
  liveCallStore.clearAll('world-unavailable');
}
