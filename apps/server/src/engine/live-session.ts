import WebSocket from 'ws';
import {
  LIVE_VOICES,
  parseFrontmatter,
  sanitiseTtsText,
  type LiveLanguage,
} from '@airp/shared';
import type { JsonAgentSessionEvent } from '../../../../vendor/pi-rp/packages/coding-agent/dist/index.js';
import { messageText } from './event-bridge.js';
import type { AgentLifecycleManager } from './lifecycle.js';
import {
  createLiveSidebandChannel,
  receiptLine,
  receiptOf,
  type ActionReceipt,
  type DuplexCharacterChannel,
} from './character-duplex.js';

/** What one `deliver` produced: her words, and what she actually did. */
export interface DeliveryOutcome {
  /** The chunks that were spoken, in order, receipt line included. */
  spoken: string[];
  /** The world-changing tool calls of that turn (`receiptOf`). */
  receipt: ActionReceipt[];
  /** False when the turn failed or produced nothing speakable. */
  ok: boolean;
}

/**
 * Live call backend.
 *
 * One Live session per character. The browser owns the WebRTC media and the
 * data channel; this module owns the sideband WebSocket, which carries the
 * transcript, the client delegations, and the `session.*.append` channels that
 * feed the character's true lines back to the voice front-end.
 *
 * The character agent stays the ONE character brain (invariant 1): a delegation
 * is turned into an ordinary pi-rp turn, and only its already-written reply is
 * spoken. Nothing about the personality, world, or tool schemas is copied into
 * `instructions`.
 *
 * Like the TTS router there is deliberately NO module-level state: every call
 * re-reads env (`readLiveConfig`, the base URL), so a rotated key takes effect
 * without a restart and tests may set env after import.
 */

/** The voice model. Frozen by the design notes (2026-09-14 probe). */
const LIVE_MODEL = 'gpt-live-1';
/** Default upstream base; the same fallback TTS/connection-settings use. */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
/**
 * `session.commentary.append` caps `content` at 500 tokens. TTS already picked
 * 500 CHARS as the conservative equivalent (tts.ts:24-25); this channel reuses
 * that number so the two speech paths cannot drift.
 */
const MAX_COMMENTARY_CHARS = 500;
/** Character-turn budget. Matches `AgentLifecycleManager`'s default (lifecycle.ts:57). */
const TURN_TIMEOUT_MS = 90_000;
/** Sideband attach budget: a socket that never opens must not hang the request. */
const SIDEBAND_OPEN_TIMEOUT_MS = 10_000;
/** Upstream `POST /live/sessions` budget; a hung request surfaces as upstream_unreachable. */
const UPSTREAM_SESSION_TIMEOUT_MS = 20_000;
/** How much input transcript is kept for delegation task text + captions. */
const TRANSCRIPT_WINDOW = 4000;
/**
 * After `session.delegation.created`, transcript fragments for the utterance
 * may still be in flight.
 * A short settle window lets them land before the task text is read, without
 * making the user wait on a stale read.
 */
const DELEGATION_SETTLE_MS = 300;

/** A character has at most one live call; `sessionId` and `sdp` are opaque. */
export interface LiveCallHandle {
  readonly characterId: string;
  readonly worldRoot: string;
  readonly sessionId: string;
  readonly voice: string;
  /** Upstream answer SDP, verbatim — the browser feeds it to setRemoteDescription. */
  readonly sdp: string;
}

/**
 * Narrow sideband client. The real one wraps `ws`; tests inject a fake, which is
 * what makes the delegation timeout path observable without a live call.
 */
export interface LiveSidebandSocket {
  send(data: string): void;
  close(): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (data: string) => void): void;
  onError(listener: (error: Error) => void): void;
  onClose(listener: () => void): void;
}

export interface LiveSessionDeps {
  readonly repoRoot: string;
  /** The same manager M1 passes to the world router. */
  readonly lifecycle: AgentLifecycleManager;
  /** `characters/<id>/README.md` in the captured root (null when missing). */
  readonly readCharacterReadme: (characterId: string, worldRoot: string) => Promise<string | null>;
  /** Visible failure (WS frame or log's visible slot, never a silent stall). */
  readonly onVisibleFailure: (characterId: string, reason: string, savePath: string) => void;
  /**
   * Test seam. Optional so M1's
   * call site is unchanged; defaults to global `fetch`.
   */
  readonly fetchImpl?: typeof fetch;
  /**
   * Test seam for the sideband. Defaults to a `ws` client pointed at the URL
   * derived from `OPENAI_BASE_URL`.
   */
  readonly connectSideband?: (
    url: string,
    headers: Record<string, string>,
  ) => LiveSidebandSocket;
}

/** M1 maps `status`/`code` straight onto the HTTP response. */
export class LiveCallError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'LiveCallError';
    this.code = code;
    this.status = status;
  }
}

interface ActiveCall {
  readonly characterId: string;
  readonly sessionId: string;
  readonly voice: string;
  readonly worldRoot: string;
  readonly language: LiveLanguage;
  readonly socket: LiveSidebandSocket;
  /**
   * The backend-independent voice link (character-duplex.ts): the registry
   * says "speak" / "notice", the channel owns the sideband frames. Assigned
   * right after construction — its event-id salt reads this call's transcript.
   */
  channel: DuplexCharacterChannel;
  /** Input transcript not yet consumed by a delegation. */
  pendingInput: string;
  /** Rolling output transcript; also salts append event_ids so each is unique. */
  outputTranscript: string;
  /** Serialises turns so one RpcClient never sees two prompts at once. */
  turnQueue: Promise<void>;
  /** Set once we have begun tearing down; suppresses the drop-as-failure path. */
  closing: boolean;
}

/**
 * Readiness gate for `GET /api/live/config`. Re-reads env every call: the test
 * harness sets `OPENAI_API_KEY` after import.
 */
export function readLiveConfig(): {
  available: boolean;
  reason?: string;
  model: string;
  voices: readonly string[];
} {
  const key = (process.env.OPENAI_API_KEY ?? '').trim();
  return key
    ? { available: true, model: LIVE_MODEL, voices: LIVE_VOICES }
    : {
        available: false,
        // Through the Worldlines AI service (the browser version) there are no
        // live calls: the service does not carry them.
        reason: (process.env.AIRP_AI_BASE ?? '').trim()
          ? 'Live calls are not available in this version'
          : 'OPENAI_API_KEY is not set on the server',
        model: LIVE_MODEL,
        voices: LIVE_VOICES,
      };
}

/**
 * The whole voice front-end prompt. Exactly three
 * blocks, and no more: identity, speaking language, delegation policy.
 *
 * The three API labels are kept verbatim in both languages — they are structure
 * the model was trained on, not prose (live-prompting.md "Delegation").
 */
export function buildLiveInstructions(input: {
  name: string;
  description?: string;
  language: LiveLanguage;
}): string {
  const name = input.name.trim() || 'the character';
  const description = input.description?.trim();

  if (input.language === 'ja') {
    const identity = description ? `あなたは${name}です。${description}` : `あなたは${name}です。`;
    return [
      identity,
      '自然な日本語で、落ち着いた速さで話してください。ユーザーが話し始めたら口を止め、聞いてください。',
      '',
      'Delegation policy:',
      'Backend tools:',
      '- このキャラクター自身の世界：記憶、周囲の状況、持ち物、そして物語の中での行動。',
      '',
      'Delegate to the backend when:',
      '- キャラクターの世界の事実・判断・行動が必要なとき。',
      '- この会話だけで答えられない記憶や推論が必要なとき。',
      '',
      'Do not delegate to the backend when:',
      '- すでに交わした会話だけで答えられるとき。',
      '- あいさつや聞き返しだけのとき。',
    ].join('\n');
  }

  if (input.language === 'ko') {
    const identity = description ? `당신은 ${name}입니다. ${description}` : `당신은 ${name}입니다.`;
    return [
      identity,
      '자연스러운 한국어로, 차분한 속도로 말하세요. 사용자가 말을 시작하면 멈추고 들으세요.',
      '',
      'Delegation policy:',
      'Backend tools:',
      '- 이 캐릭터 자신의 세계: 기억, 주변 상황, 소지품, 그리고 이야기 속 행동.',
      '',
      'Delegate to the backend when:',
      '- 캐릭터의 세계에 관한 사실·판단·행동이 필요할 때.',
      '- 이 대화만으로는 답할 수 없는 기억이나 추론이 필요할 때.',
      '',
      'Do not delegate to the backend when:',
      '- 이미 나눈 대화만으로 답할 수 있을 때.',
      '- 인사나 되묻기뿐일 때.',
    ].join('\n');
  }

  const identity = description ? `You are ${name}. ${description}` : `You are ${name}.`;
  return [
    identity,
    'Speak natural, unhurried English. Stop speaking when the user interrupts and listen.',
    '',
    'Delegation policy:',
    'Backend tools:',
    "- The character's own world: their memory, surroundings, possessions, and actions in the story.",
    '',
    'Delegate to the backend when:',
    "- The request needs a fact, a decision, or an action from the character's world.",
    '- The answer needs memory or reasoning beyond this conversation.',
    '',
    'Do not delegate to the backend when:',
    '- You can answer from what has already been said.',
    '- The user only greets you or asks you to repeat something.',
  ].join('\n');
}

/** Terminators that end a spoken sentence (ASCII + CJK full width). */
const SENTENCE_END = /[.!?。！？…]/;
/** Quotes/brackets that may trail a terminator before the boundary. */
const TRAILING = /["'”’」』）)]/;

function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    if (!SENTENCE_END.test(text[i])) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < text.length && SENTENCE_END.test(text[j])) j++;
    while (j < text.length && TRAILING.test(text[j])) j++;
    while (j < text.length && /\s/.test(text[j])) j++;
    out.push(text.slice(start, j));
    start = j;
    i = j;
  }
  if (start < text.length) out.push(text.slice(start));
  return out.filter((s) => s.trim() !== '');
}

/**
 * Last-resort split for a single sentence longer than the append cap. Clause
 * punctuation first, then whitespace, then (only when a single word overflows)
 * a hard cut — the character budget MUST hold, but a normal long sentence is
 * only ever cut at a clause boundary.
 */
function splitOversized(sentence: string, limit: number): string[] {
  const out: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current.trim()) out.push(current.trim());
    current = '';
  };
  for (const part of sentence.split(/(?<=[，、,;；:])/)) {
    if (part.length > limit) {
      flush();
      let rest = part;
      while (rest.length > limit) {
        let cut = rest.lastIndexOf(' ', limit);
        if (cut <= 0) cut = limit;
        if (rest.slice(0, cut).trim()) out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut);
      }
      current = rest;
      continue;
    }
    if (current.length + part.length > limit) flush();
    current += part;
  }
  flush();
  return out;
}

/**
 * Sanitise a character reply, then split it at sentence boundaries into
 * `session.commentary.append`-sized chunks. Returns
 * `[]` for text that sanitises to nothing, so callers can fall back visibly
 * instead of appending an empty string.
 */
export function toCommentaryChunks(text: string): string[] {
  const clean = sanitiseTtsText(text);
  if (!clean) return [];

  const chunks: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const sentence of splitSentences(clean)) {
    if (sentence.trim().length > MAX_COMMENTARY_CHARS) {
      flush();
      for (const piece of splitOversized(sentence, MAX_COMMENTARY_CHARS)) chunks.push(piece);
      continue;
    }
    if (current.length + sentence.length > MAX_COMMENTARY_CHARS) flush();
    current += sentence;
  }
  flush();
  return chunks;
}

/** `https://host/v1` → `wss://host` (the `/v1` path is re-added once, never doubled). */
function sidebandOrigin(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  return base.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
}

function defaultSideband(
  url: string,
  headers: Record<string, string>,
): LiveSidebandSocket {
  const ws = new WebSocket(url, { headers });
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onOpen: (fn) => ws.on('open', () => fn()),
    onMessage: (fn) => ws.on('message', (data) => fn(data.toString())),
    onError: (fn) => ws.on('error', (err) => fn(err instanceof Error ? err : new Error(String(err)))),
    onClose: (fn) => ws.on('close', () => fn()),
  };
}

/** One-line identity from the character README frontmatter/body. */
async function identityOf(
  deps: LiveSessionDeps,
  characterId: string,
  worldRoot: string,
): Promise<{ name: string; description?: string }> {
  const raw = await deps.readCharacterReadme(characterId, worldRoot);
  if (!raw) return { name: characterId };
  const { frontmatter, body } = parseFrontmatter(raw);
  const name = typeof frontmatter?.name === 'string' && frontmatter.name.trim() !== ''
    ? frontmatter.name.trim()
    : characterId;

  const declared = typeof frontmatter?.description === 'string' ? frontmatter.description.trim() : '';
  const fromBody = body.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
  const description = declared || fromBody;
  return description ? { name, description } : { name };
}

/** Last assistant text in a completed turn, mirroring `event-bridge.ts:229`. */
function lastAssistantText(events: JsonAgentSessionEvent[]): string {
  let text = '';
  for (const event of events) {
    if (event.type !== 'message_end') continue;
    const message = event.message as { role?: string } | undefined;
    if (message?.role !== 'assistant') continue;
    const value = messageText(message);
    if (value) text = value;
  }
  return text;
}

/**
 * The live-call registry. Holds at most one call per character, owns each
 * sideband, and runs delegations through the existing character agent.
 *
 * `close` never stops the character agent:
 * spawn is heavy and a hang-up is usually followed by another call.
 */
export class LiveCallRegistry {
  private readonly deps: LiveSessionDeps;
  private readonly calls = new Map<string, ActiveCall>();

  constructor(deps: LiveSessionDeps) {
    this.deps = deps;
  }

  has(characterId: string): boolean {
    return this.calls.has(characterId);
  }

  isWorldRootCurrent(worldRoot: string): boolean {
    return this.deps.lifecycle.isWorldRootCurrent(worldRoot);
  }
  captureWorldEpoch(): number {
    return this.deps.lifecycle.getWorldEpoch();
  }
  isWorldIdentityCurrent(worldRoot: string, worldEpoch: number): boolean {
    return this.deps.lifecycle.isWorldIdentityCurrent(worldRoot, worldEpoch);
  }
  /**
   * Create the Live session, attach the sideband, and register the call.
   * A second call for the same character closes the old one first (freeze 1);
   * a call left over from a different world is dropped entirely (freeze 3
   * self-heal, since world teardown may not reach us).
   */
  async open(input: {
    characterId: string;
    sdp: string;
    language: LiveLanguage;
    voice: string;
    worldRoot: string;
  }): Promise<LiveCallHandle> {
    const worldEpoch = this.captureWorldEpoch();
    const assertCurrentWorld = () => {
      if (!this.isWorldIdentityCurrent(input.worldRoot, worldEpoch)) throw new LiveCallError('world_changed', 409, 'The active world changed before the live call could be opened.');
    };
    assertCurrentWorld();
    const config = readLiveConfig();
    if (!config.available) {
      throw new LiveCallError('unsupported', 503, config.reason ?? 'Live voice is not configured');
    }
    const existing = this.calls.get(input.characterId);
    if (existing) {
      if (existing.worldRoot !== input.worldRoot) await this.closeAll();
      else await this.close(input.characterId, input.worldRoot);
    }
    assertCurrentWorld();
    const { name, description } = await identityOf(this.deps, input.characterId, input.worldRoot);
    assertCurrentWorld();
    const instructions = buildLiveInstructions({ name, description, language: input.language });
    const { sessionId, sdp } = await this.createUpstreamSession(input, instructions);
    assertCurrentWorld();
    let socket: LiveSidebandSocket;
    try {
      socket = await this.attachSideband(sessionId);
    } catch (err) {
      // An obsolete open belongs only to its HTTP caller; never broadcast its
      // sideband failure into the newly active world's character stream.
      assertCurrentWorld();
      // No half-call. There is NO HTTP close for a Live session (probed
      // 2026-09-14: DELETE/POST on `/v1/live/sessions/{id}` are 404 — the
      // sideband socket is the only close lever), and we never got a socket,
      // so we cannot close the upstream session. What we CAN guarantee is that
      // nothing local dangles: no registered call, no handle, and the browser
      // never receives the answer SDP (so it has nothing to negotiate). The
      // upstream session id is surfaced so the leak is observable, not silent.
      const failure =
        err instanceof LiveCallError
          ? err
          : new LiveCallError('sideband_failed', 502, err instanceof Error ? err.message : String(err));
      this.deps.onVisibleFailure(input.characterId, `sideband failed for ${sessionId}: ${failure.message}`, input.worldRoot);
      throw failure;
    }
    try { assertCurrentWorld(); }
    catch (error) { socket.close(); throw error; }

    const call: ActiveCall = {
      characterId: input.characterId,
      sessionId,
      voice: input.voice,
      worldRoot: input.worldRoot,
      language: input.language,
      socket,
      channel: null as unknown as DuplexCharacterChannel,
      pendingInput: '',
      outputTranscript: '',
      turnQueue: Promise.resolve(),
      closing: false,
    };
    call.channel = createLiveSidebandChannel({
      socket,
      salt: () => call.outputTranscript.length,
      onFailure: (reason) => this.deps.onVisibleFailure(call.characterId, reason, call.worldRoot),
    });
    this.wireSideband(call);
    this.calls.set(input.characterId, call);

    return { characterId: input.characterId, sessionId, voice: input.voice, sdp, worldRoot: input.worldRoot };
  }

  /** Hang up only the call captured for this world root. */
  async close(characterId: string, worldRoot: string): Promise<boolean> {
    const call = this.calls.get(characterId);
    if (!call) return false;
    if (call.worldRoot !== worldRoot) throw new LiveCallError('world_changed', 409, 'The live call belongs to a different world.');
    this.calls.delete(characterId);
    call.closing = true;
    try {
      call.socket.send(JSON.stringify({ type: 'session.close', event_id: `close_${call.sessionId}` }));
    } catch {
      /* the socket may already be gone; local teardown still completes */
    }
    try { call.socket.close(); } catch { /* already closed */ }
    return true;
  }

  /** World switch / save deletion; close only the registry's captured root. */
  async closeAll(): Promise<void> {
    for (const [characterId, call] of [...this.calls]) await this.close(characterId, call.worldRoot);
  }

  // ── upstream session ───────────────────────────────────────────────────────

  private async createUpstreamSession(
    input: { sdp: string; voice: string },
    instructions: string,
  ): Promise<{ sessionId: string; sdp: string }> {
    const key = (process.env.OPENAI_API_KEY ?? '').trim();
    const base = (process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const request = this.deps.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await request(`${base}/live/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: {
            model: LIVE_MODEL,
            instructions,
            delegation: { type: 'client' },
            audio: { output: { voice: input.voice } },
          },
          transport: { type: 'webrtc', sdp: input.sdp },
        }),
        // Without a budget a silent upstream left the browser "connecting" forever.
        signal: AbortSignal.timeout(UPSTREAM_SESSION_TIMEOUT_MS),
      });
    } catch (err) {
      console.warn(`[AIRP Live] Session request failed (${err instanceof Error ? err.name : 'Error'}).`);
      throw new LiveCallError('upstream_unreachable', 502, err instanceof Error ? err.message : String(err));
    }

    const body = (await response.json().catch(() => null)) as
      | {
          session?: { id?: string };
          transport?: { sdp?: string };
          error?: { code?: string; message?: string };
        }
      | null;

    // A non-2xx is passed through with the upstream code/status (e.g. `invalid_offer`
    // at 400, `forbidden` at 403) — never masked as a generic 500 (§2.2, §8).
    if (!response.ok) {
      const code = body?.error?.code ?? 'live_session_failed';
      const message = body?.error?.message ?? `Live session request failed (HTTP ${response.status})`;
      console.warn(`[AIRP Live] Session refused upstream (${response.status} ${code}).`);
      throw new LiveCallError(code, response.status, message);
    }
    if (!body?.session?.id || !body.transport?.sdp) {
      throw new LiveCallError('invalid_response', 502, 'Live session response had no session.id/transport.sdp');
    }
    return { sessionId: body.session.id, sdp: body.transport.sdp };
  }

  private async attachSideband(sessionId: string): Promise<LiveSidebandSocket> {
    const key = (process.env.OPENAI_API_KEY ?? '').trim();
    const base = process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;
    const url = `${sidebandOrigin(base)}/v1/live/sessions/${sessionId}/attach`;
    const connect = this.deps.connectSideband ?? defaultSideband;

    let socket: LiveSidebandSocket;
    try {
      socket = connect(url, { Authorization: `Bearer ${key}` });
    } catch (err) {
      throw new LiveCallError('sideband_failed', 502, err instanceof Error ? err.message : String(err));
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {
          /* already closing */
        }
        reject(new LiveCallError('sideband_failed', 502, 'Sideband did not open in time'));
      }, SIDEBAND_OPEN_TIMEOUT_MS);
      socket.onOpen(() => {
        clearTimeout(timer);
        resolve();
      });
      socket.onError((err) => {
        clearTimeout(timer);
        reject(new LiveCallError('sideband_failed', 502, err.message));
      });
    });

    return socket;
  }

  private wireSideband(call: ActiveCall): void {
    call.socket.onMessage((data) => this.onSidebandMessage(call, data));
    call.socket.onError((err) => this.onSidebandDrop(call, err.message));
    call.socket.onClose(() => this.onSidebandDrop(call, 'Sideband closed'));
  }

  /** A dropped sideband leaves no half-call behind; surface it (never silent). */
  private onSidebandDrop(call: ActiveCall, reason: string): void {
    if (call.closing) return;
    if (this.calls.get(call.characterId) !== call) return;
    if (!this.deps.lifecycle.isWorldRootCurrent(call.worldRoot)) {
      void this.close(call.characterId, call.worldRoot);
      return;
    }
    this.calls.delete(call.characterId);
    call.closing = true;
    this.deps.onVisibleFailure(call.characterId, `live sideband lost: ${reason}`, call.worldRoot);
  }

  private onSidebandMessage(call: ActiveCall, raw: string): void {
    if (call.closing || this.calls.get(call.characterId) !== call) return;
    if (!this.deps.lifecycle.isWorldRootCurrent(call.worldRoot)) {
      void this.close(call.characterId, call.worldRoot);
      return;
    }
    let event: { type?: string; delta?: string; delegation?: { id?: string } };
    try {
      event = JSON.parse(raw) as typeof event;
    } catch {
      return;
    }

    switch (event.type) {
      case 'session.input_transcript.delta': {
        if (typeof event.delta === 'string' && event.delta) {
          call.pendingInput = (call.pendingInput + event.delta).slice(-TRANSCRIPT_WINDOW);
        }
        break;
      }
      case 'session.output_transcript.delta': {
        if (typeof event.delta === 'string' && event.delta) {
          call.outputTranscript = (call.outputTranscript + event.delta).slice(-TRANSCRIPT_WINDOW);
        }
        break;
      }
      case 'session.delegation.created': {
        const delegationId = event.delegation?.id;
        if (!delegationId) {
          this.deps.onVisibleFailure(call.characterId, 'delegation.created without delegation.id', call.worldRoot);
          break;
        }
        this.enqueueTurn(call, delegationId);
        break;
      }
      case 'session.closed': {
        this.onSidebandDrop(call, 'session closed');
        break;
      }
      default:
        break;
    }
  }

  /**
   * Serialise turns so one character agent never receives two prompts at once.
   * The task text is read only after a short settle window, so transcript
   * fragments still in flight for this utterance are included (the design notes
   * §7.2) — `session.delegation.created` itself carries no task text.
   */
  private enqueueTurn(call: ActiveCall, delegationId: string): void {
    call.turnQueue = call.turnQueue
      .catch(() => {})
      .then(async () => {
        await new Promise((resolve) => setTimeout(resolve, DELEGATION_SETTLE_MS));
        if (this.calls.get(call.characterId) !== call || !this.deps.lifecycle.isWorldRootCurrent(call.worldRoot)) {
          void this.close(call.characterId, call.worldRoot);
          return;
        }
        const task = call.pendingInput.trim();
        call.pendingInput = '';
        await this.runDelegation(call, delegationId, task);
      });
  }

  /**
   * GPT Live's delegation: read the call's context, then run the shared
   * execution half. Thin on purpose — everything below the `deliver` call is
   * transport-independent.
   */
  private async runDelegation(call: ActiveCall, delegationId: string, task: string): Promise<void> {
    if (this.calls.get(call.characterId) !== call || !this.deps.lifecycle.isWorldRootCurrent(call.worldRoot)) return;

    // A delegation with no captured transcript means the fragments have not
    // arrived yet. Ask for a repeat, visibly.
    if (!task) {
      this.appendVisible(call, delegationId, 'Sorry — I did not catch that. Could you say it again?');
      return;
    }

    await this.deliver(call.characterId, task, {
      worldRoot: call.worldRoot,
      language: call.language,
      channel: call.channel,
      delegationId,
      isCurrent: () => this.calls.get(call.characterId) === call,
      onAgentUnavailable: async () => {
        // The agent was torn down (world switch) and cannot be respawned: this
        // call points at a dead world, so close it (freeze 3 self-heal).
        await this.close(call.characterId, call.worldRoot);
      },
    });
  }

  /**
   * Run ONE character turn and report it back through a duplex channel
   * (integration.md §6: 「抽出一个公开的 `deliver(characterId, task)` 即可，
   * 执行部分一个字都不用改」).
   *
   * This is the seam a non-GPT-Live voice backend uses. It is public and takes
   * no `ActiveCall`, so a caller with no registered call — a voice-live session,
   * a future HTTP route — can drive the same character agent, get the same
   * receipt, and phrase it in the same two languages. GPT Live's
   * `runDelegation` is now just this function plus the call's context.
   *
   * The turn goes through `submitCharacterTurn`, which is what keeps the team's
   * 「这两个是一个Agent就好」 true: the call and the dock share one process, so
   * they must share one queue or they race for pi's single turn.
   *
   * Returns what was said and what was done, for a caller that wants the answer
   * directly rather than through the channel.
   */
  async deliver(
    characterId: string,
    task: string,
    options: {
      worldRoot: string;
      language: LiveLanguage;
      /** Where the words go. Omit to collect them without speaking. */
      channel?: DuplexCharacterChannel;
      delegationId?: string;
      /** False once this delegation's owner has gone away; the turn is dropped. */
      isCurrent?: () => boolean;
      onAgentUnavailable?: () => Promise<void>;
    },
  ): Promise<DeliveryOutcome> {
    const delegationId = options.delegationId ?? `deliver_${Date.now()}`;
    const ownerIsCurrent = options.isCurrent ?? (() => true);
    const isCurrent = () => ownerIsCurrent() && this.deps.lifecycle.isWorldRootCurrent(options.worldRoot);
    const spoken: string[] = [];
    const say = (content: string): void => {
      if (!isCurrent()) return;
      spoken.push(content);
      options.channel?.speak(delegationId, content);
    };
    const note = (content: string): void => {
      if (!isCurrent()) return;
      options.channel?.notice(delegationId, content);
    };

    if (!isCurrent()) return { spoken: [], receipt: [], ok: false };

    let client = this.deps.lifecycle.getCharacter(characterId);
    if (!client) {
      try {
        client = await this.deps.lifecycle.startCharacter(characterId, options.worldRoot);
        if (!isCurrent()) return { spoken: [], receipt: [], ok: false };
      } catch (err) {
        if (!isCurrent()) return { spoken: [], receipt: [], ok: false };
        const reason = err instanceof Error ? err.message : String(err);
        this.deps.onVisibleFailure(characterId, `character agent unavailable: ${reason}`, options.worldRoot);
        await options.onAgentUnavailable?.();
        return { spoken: [], receipt: [], ok: false };
      }
    }

    const agent = client;
    let events: JsonAgentSessionEvent[];
    try {
      // One agent, one turn at a time. Queued rather than refused: a call turn
      // and a dock message are both this character speaking, and neither may be
      // dropped for arriving second.
      events = await this.deps.lifecycle.submitCharacterTurn(characterId, () =>
        agent.promptAndWait(task, undefined, TURN_TIMEOUT_MS),
      );
    } catch (err) {
      // Timeout or a dead agent: abort the turn and tell the voice front-end,
      // visibly. Never a silent stall.
      if (!isCurrent()) return { spoken: [], receipt: [], ok: false };
      await agent.abort().catch(() => {});
      if (!isCurrent()) return { spoken: [], receipt: [], ok: false };
      const reason = err instanceof Error ? err.message : String(err);
      this.deps.onVisibleFailure(characterId, `character turn failed: ${reason}`, options.worldRoot);
      note('I could not check that just now — let us try again shortly.');
      return { spoken: [], receipt: [], ok: false };
    }
    if (!isCurrent()) return { spoken: [], receipt: [], ok: false };

    let text = lastAssistantText(events);
    if (!text) {
      const fallback = await agent.getLastAssistantText().catch(() => null);
      if (!isCurrent()) return { spoken: [], receipt: [], ok: false };
      if (fallback) text = fallback;
    }

    // The return channel: the reply AND a receipt of what
    // the agent did. A turn that only acted (moved the key, wrote the scene)
    // used to come back as "I could not put that into words" — the action had
    // happened, the caller was never told.
    const receipt = receiptOf(events);
    const chunks = toCommentaryChunks(text);
    const line = receiptLine(receipt, options.language);
    if (chunks.length === 0 && line === null) {
      this.deps.onVisibleFailure(characterId, 'character turn produced no speakable text', options.worldRoot);
      note('I could not put that into words just now.');
      return { spoken: [], receipt, ok: false };
    }
    for (const chunk of chunks) say(chunk);
    if (line !== null) say(line);
    return { spoken, receipt, ok: true };
  }

  /** The character's words — the voice paraphrases them aloud (channel `speak`). */
  private appendCommentary(call: ActiveCall, delegationId: string, content: string): void {
    if (this.calls.get(call.characterId) !== call) return;
    call.channel.speak(delegationId, content);
  }

  /** The visible degradation path (channel `notice`). */
  private appendVisible(call: ActiveCall, delegationId: string | null, content: string): void {
    if (this.calls.get(call.characterId) !== call) return;
    call.channel.notice(delegationId, content);
  }
}
