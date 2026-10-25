/**
 * voice-live's browser transport.
 *
 * The second implementation behind the one call interface. GPT Live negotiates
 * WebRTC with OpenAI and lets the browser's media stack carry the audio; this
 * one carries it itself, as PCM over a WebSocket to `/ws/voice-live` — OUR
 * origin, never voice-live's. The canvas server reverse-proxies it
 * (`voice-live-proxy.ts`), which is what makes the call work through the
 * `/airp-infini-canvas/` subpath and the seat gateway, and what keeps the
 * voice-live host private.
 *
 * Three things this file owes voice-live, all of which it will otherwise get
 * silently wrong (integration.md §3.2):
 *
 *  - **Report `played` for every real segment.** The history only records what
 *    the listener actually heard. A segment we never report leaves her
 *    believing she is still speaking, and she will not take the next turn.
 *  - **Report `interrupted` with how far playback got**, so the part she was
 *    cut off mid-way through is recorded as half-said, not as said.
 *  - **Never report a `filler`**, and never show one. It is a mouth noise
 *    played while the brain thinks, not a line she spoke.
 *
 * The frame grammar and the receipt rules are pure and live next door in
 * `voice-live-frames.ts`; this file is the part that owns resources.
 */

import { withBase } from './base-path.js';
import { openVoiceStream } from './audio.js';
import {
  PlaybackLedger,
  VoiceLiveFrameReader,
  pcm16ToFloat32,
  type VoiceLiveBotState,
  type VoiceLiveEvent,
} from './voice-live-frames.js';
import { floatToPcm16, LinearResampler } from './voice-input.js';
import { createBrainRelay, type BrainRelay } from './voice-live-brain.js';

/** voice-live listens for PCM16 LE mono at this rate (integration.md §3.2). */
export const VOICE_LIVE_INPUT_RATE = 16_000;
/** ~100ms of captured audio per frame, at the microphone's own rate. */
const CHUNK_SAMPLES = 4_800;
/** While ducked, she drops to 25% (integration.md §3.3 `duck`). */
const DUCK_GAIN = 0.25;
/** Ramp for duck / fade, short enough to feel immediate and long enough not to click. */
const GAIN_RAMP_S = 0.04;
/**
 * Scheduling cushion. Chunks are scheduled back to back off one clock, but the
 * first must start far enough ahead that a late frame does not land in the past
 * and play instantly on top of its predecessor.
 */
const SCHEDULE_LEAD_S = 0.06;

/** The microphone tap. Same worklet the STT path uses — one shape to maintain. */
const WORKLET_SOURCE = `
class AirpVoiceLiveTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('airp-voice-live-tap', AirpVoiceLiveTap);
`;

/**
 * Why a call ended or never started, specific enough to tell the player what to
 * do about it (out of minutes → upgrade; already on a call → hang up the other).
 */
export type VoiceLiveFailure =
  | 'unavailable'
  | 'connection'
  | 'network'
  | 'mic_denied'
  | 'mic_unsupported'
  | 'minutes_exhausted'
  | 'time_limit'
  | 'plan_required'
  | 'call_in_progress'
  | 'line_busy'
  | 'signed_out'
  /** The save this call was started for is no longer the open one. */
  | 'world_changed';

/** What the server said alongside a refusal; kept so the copy can link and date it. */
export interface VoiceLiveFailureDetail {
  /** Where to buy more minutes / a plan that includes calls (https only). */
  billingUrl?: string;
  /** When this month's minutes come back (ISO). */
  resetsAt?: string;
}

/** A ticket refusal's `code` → the failure the player reads. */
export function ticketFailure(code: string, status?: number): VoiceLiveFailure {
  switch (code) {
    case 'quota_exceeded':
    case 'voice_minutes_exhausted':
      return 'minutes_exhausted';
    case 'plan_required':
    case 'wallet_not_supported':
      return 'plan_required';
    case 'concurrency_limit':
      return 'call_in_progress';
    case 'voice_busy':
      return 'line_busy';
    case 'signed_out':
      return 'signed_out';
    case 'ticket_unreachable':
    case 'account_unreachable':
      return 'network';
    case 'provider_unconfigured':
      return 'unavailable';
    case 'voice_call_time_limit':
      return 'time_limit';
    default:
      return status === 401 ? 'signed_out' : 'connection';
  }
}

/**
 * A close of the call socket → the failure, or null for an ordinary hangup.
 * ai.worldlines.gg closes with 4001 (call time limit), 4002 (minutes ran out),
 * or 4000 + HTTP status with the error code as the reason (4429 quota_exceeded /
 * concurrency_limit, 4403 plan_required, 4503 voice_busy, …).
 */
export function closeFailure(code: number, reason: string, opened: boolean): VoiceLiveFailure | null {
  if (code === 4001) return 'time_limit';
  if (code === 4002) return 'minutes_exhausted';
  // The reason is the code; an expired ticket (4401 invalid_ticket) is a retry, not a sign-out.
  if (code >= 4400 && code < 4600) return ticketFailure(reason);
  if (code === 1006 && opened) return 'network';
  return null;
}

/** What the call store needs back. Everything else the protocol says is dropped here. */
export interface VoiceLiveHandlers {
  /** Canonical active world root captured when this call is started. */
  savePath: string;
  /** Immediate teardown when the owner switches saves or ends this call. */
  signal: AbortSignal;
  /** False when the owner has switched saves or retired this call. */
  isCurrent(): boolean;
  /** Who is on the call — decides the voice server-side (see `voiceLiveUrl`). */
  characterId?: string;
  onReady(info: { session: string; tts: string; brain: string }): void;
  /** What the player was heard to say (`transcript`). */
  onInputText(text: string): void;
  /** A line she really said. Fillers never reach this. */
  onLine(text: string): void;
  /** `state{bot}`, for a speaking / thinking indicator. */
  onBotState(state: VoiceLiveBotState): void;
  /** `user_start`: the player began to speak (the "heard" line gives way to "listening"). */
  onUserStart?(): void;
  /** Something she thought in the silence. Display only; there is no audio. */
  onThought(text: string): void;
  /** Visible failure. The call is over by the time this is called. */
  onError(reason: VoiceLiveFailure, detail?: VoiceLiveFailureDetail): void;
  /**
   * Something went wrong for ONE turn and the call carries on (`error{fatal:false}`):
   * show a short notice, keep listening. Never hang up for this.
   */
  onNotice?(kind: 'turn_failed'): void;
  /** The ticket's allowance: seconds left this month, null when unlimited. */
  onAllowance?(remainingSeconds: number | null): void;
  /** The socket closed without an error of its own. */
  onClosed(): void;
}

export interface VoiceLiveTransport {
  /** Hang up and release the microphone, the socket and every scheduled buffer. */
  stop(): void;
}

/** Test seam, mirroring `LiveCallDeps`. Every field is optional. */
export interface VoiceLiveDeps {
  now?: () => number;
  createSocket?: (url: string, protocols?: string[]) => WebSocket;
  /** How the call gets its way in (`requestCallTicket` by default). */
  requestTicket?: (characterId: string | undefined, savePath: string) => Promise<CallTicket>;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext?: () => AudioContext;
  openOutput?: typeof openVoiceStream;
}

/**
 * `/ws/voice-live` on our own origin, through the base-path helper.
 *
 * `characterId` names who is on the call. The server reads that character's
 * README and casts the call in the SAME voice normal TTS uses for them — without
 * it voice-live speaks every character in its one configured voice (a woman's),
 * which is the "male characters sound female on a call" bug.
 * Only the id travels; the voice is resolved server-side, never trusted from here.
 */
export function voiceLiveUrl(location: { protocol: string; host: string }, characterId: string | undefined, savePath: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({ savePath });
  if (characterId) params.set('character', characterId);
  return `${protocol}//${location.host}${withBase('/ws/voice-live')}?${params.toString()}`;
}

/**
 * How a call gets in (server: voice-live-ticket.ts).
 *  - `direct`: straight to ai.worldlines.gg's voice channel with a one-use
 *    ticket in the subprotocols; the character brain is relayed by this page
 *    (voice-live-brain.ts).
 *  - `proxy`: through `/ws/voice-live` on our own origin, as before (no tickets
 *    configured); the server relays the brain.
 *  - `error`: the account was refused (signed out, out of minutes, …).
 */
export type CallTicket =
  | { mode: 'proxy' }
  | { mode: 'direct'; url: string; protocols: string[]; remainingSeconds?: number | null }
  | { mode: 'error'; code: string; status?: number; billingUrl?: string; resetsAt?: string };

/** Only an https link is followed from the page. */
function httpsUrl(value: unknown): string | undefined {
  return typeof value === 'string' && /^https:\/\/[^\s"'<>]+$/.test(value) ? value : undefined;
}

export async function requestCallTicket(characterId: string | undefined, savePath: string): Promise<CallTicket> {
  try {
    const response = await fetch(withBase('/api/live/voice-live/ticket'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ characterId, savePath }),
    });
    if (response.status === 404) return { mode: 'proxy' };
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (body?.mode === 'direct' && typeof body.url === 'string' && Array.isArray(body.protocols)) {
      return {
        mode: 'direct',
        url: body.url,
        protocols: body.protocols.filter((p): p is string => typeof p === 'string'),
        ...(typeof body.remainingSeconds === 'number' || body.remainingSeconds === null
          ? { remainingSeconds: body.remainingSeconds as number | null }
          : {}),
      };
    }
    if (body?.mode === 'proxy') return { mode: 'proxy' };
    const billingUrl = httpsUrl(body?.billingUrl);
    const resetsAt = typeof body?.resetsAt === 'string' ? body.resetsAt : undefined;
    return {
      mode: 'error',
      code: typeof body?.code === 'string' ? body.code : `http_${response.status}`,
      status: response.status,
      ...(billingUrl ? { billingUrl } : {}),
      ...(resetsAt ? { resetsAt } : {}),
    };
  } catch {
    return { mode: 'error', code: 'ticket_unreachable' };
  }
}

/**
 * Schedules PCM chunks back to back on the shared voice bus and keeps the
 * played / interrupted ledger in step with what actually sounded.
 */
class SegmentPlayer {
  private readonly context: AudioContext;
  private readonly gain: GainNode;
  private readonly ledger = new PlaybackLedger();
  private readonly sources = new Set<AudioBufferSourceNode>();
  /** Context time at which the next chunk should begin. */
  private nextStart = 0;
  private ducked = false;

  constructor(
    context: AudioContext,
    destination: AudioNode,
    private readonly report: (receipt: Record<string, unknown>) => void,
  ) {
    this.context = context;
    this.gain = context.createGain();
    this.gain.gain.value = 1;
    this.gain.connect(destination);
  }

  /** Context seconds → wall-clock milliseconds, for the receipts. */
  private wallAt(contextTime: number): number {
    return Date.now() + (contextTime - this.context.currentTime) * 1000;
  }

  play(event: Extract<VoiceLiveEvent, { kind: 'audio' }>): void {
    const samples = pcm16ToFloat32(event.pcm);
    if (samples.length === 0) return;
    const buffer = this.context.createBuffer(1, samples.length, event.sampleRate);
    buffer.copyToChannel(samples, 0);

    // Back to back off one clock: reading `currentTime` per chunk and starting
    // "now" would insert a gap the length of whatever ran between frames.
    const earliest = this.context.currentTime + SCHEDULE_LEAD_S;
    const startsAt = Math.max(this.nextStart, earliest);
    const endsAt = startsAt + buffer.duration;
    this.nextStart = endsAt;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    this.sources.add(source);
    this.ledger.schedule(event.id, this.wallAt(startsAt), this.wallAt(endsAt), event.filler);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      // Owed only once the segment is complete AND this was its last chunk;
      // the ledger decides, and it returns null for a filler.
      const receipt = this.ledger.finish(event.id);
      if (receipt) this.report(receipt as unknown as Record<string, unknown>);
    };
    source.start(startsAt);
  }

  /** `segment_end`: no more chunks, so the receipt may now come due. */
  complete(seg: number): void {
    this.ledger.complete(seg);
  }

  /** `duck{on}`: she drops to a quarter while the player may be speaking. */
  duck(on: boolean): void {
    if (this.ducked === on) return;
    this.ducked = on;
    const t = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(on ? DUCK_GAIN : 1, t + GAIN_RAMP_S);
  }

  /**
   * `interrupt`: report how far she got, then stop. `grace_ms` is voice-live's
   * judgement about a sentence that can finish — it decides whether to keep
   * sending audio, so honouring it here would double-count the grace. What we
   * owe is an honest account of what sounded.
   */
  interrupt(): void {
    this.report(this.ledger.interrupt(Date.now()) as unknown as Record<string, unknown>);
    this.silence();
  }

  /** `yield`: this reply is cancelled. Nothing is owed — it was never heard. */
  cancel(): void {
    this.ledger.clear();
    this.silence();
  }

  private silence(): void {
    const t = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0, t + GAIN_RAMP_S);
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* not started yet */ }
      source.disconnect();
    }
    this.sources.clear();
    this.nextStart = 0;
    // Back to audible for whatever she says next.
    this.gain.gain.setValueAtTime(this.ducked ? DUCK_GAIN : 1, t + GAIN_RAMP_S);
  }

  close(): void {
    this.ledger.clear();
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* not started yet */ }
      source.disconnect();
    }
    this.sources.clear();
    try { this.gain.disconnect(); } catch { /* already gone */ }
  }
}

/**
 * Open one voice-live call. Resolves once the microphone and the socket are
 * up; every later failure arrives through `handlers.onError`.
 *
 * MUST be called inside a user gesture — `getUserMedia` and the AudioContext
 * unlock both require one.
 */
export async function startVoiceLiveCall(
  handlers: VoiceLiveHandlers,
  deps: VoiceLiveDeps = {},
): Promise<VoiceLiveTransport> {
  const openOutput = deps.openOutput ?? openVoiceStream;
  const getUserMedia =
    deps.getUserMedia ??
    (typeof navigator !== 'undefined'
      ? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
      : undefined);

  let stopped = false;
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let socket: WebSocket | null = null;
  let player: SegmentPlayer | null = null;
  let brain: BrainRelay | null = null;
  if (handlers.signal.aborted || !handlers.isCurrent()) {
    throw new Error('world_changed');
  }
  // Ask for the way in while the microphone prompt is up: the two waits overlap.
  const ticket = (deps.requestTicket ?? requestCallTicket)(handlers.characterId, handlers.savePath);

  const release = (): void => {
    stopped = true;
    handlers.signal.removeEventListener('abort', release);
    brain?.close();
    brain = null;
    node?.port.close();
    node?.disconnect();
    node = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    player?.close();
    player = null;
    if (context && context.state !== 'closed') void context.close();
    context = null;
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      if (socket.readyState <= WebSocket.OPEN) socket.close();
      socket = null;
    }
  };
  handlers.signal.addEventListener('abort', release, { once: true });
  if (handlers.signal.aborted) {
    release();
    throw new Error('world_changed');
  }

  const fail = (reason: VoiceLiveFailure, detail?: VoiceLiveFailureDetail): void => {
    if (stopped) return;
    release();
    if (handlers.isCurrent()) handlers.onError(reason, detail);
  };

  if (!getUserMedia || typeof AudioWorkletNode === 'undefined') {
    handlers.onError('mic_unsupported');
    throw new Error('mic_unsupported');
  }

  try {
    const media = await getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    if (!handlers.isCurrent()) {
      for (const track of media.getTracks()) track.stop();
      throw new Error('world_changed');
    }
    stream = media;
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    const reason = name === 'NotAllowedError' || name === 'SecurityError' ? 'mic_denied' : 'mic_unsupported';
    if (handlers.isCurrent()) handlers.onError(reason);
    throw new Error(handlers.isCurrent() ? reason : 'world_changed');
  }

  // Output rides the app's shared graph, so the voice slider, the mute and the
  // autoplay unlock all keep working. No output is survivable — subtitles still
  // carry the call — so it does not fail the connection.
  const output = openOutput();

  // Capture at the microphone's native rate and resample here. Forcing the
  // context to 16kHz is what silently fed Chrome silence on a 48kHz mic
  // (voice-input.ts:218); the same trap applies at this rate.
  const capture = deps.createAudioContext ? deps.createAudioContext() : new AudioContext();
  context = capture;
  const resampler = new LinearResampler(capture.sampleRate, VOICE_LIVE_INPUT_RATE);

  const way = await ticket;
  if (!handlers.isCurrent()) {
    release();
    throw new Error('world_changed');
  }
  if (way.mode === 'error') {
    console.warn(`[AIRP VoiceLive] No call ticket (${way.code}).`);
    const reason = ticketFailure(way.code, way.status);
    fail(reason, {
      ...(way.billingUrl ? { billingUrl: way.billingUrl } : {}),
      ...(way.resetsAt ? { resetsAt: way.resetsAt } : {}),
    });
    throw new Error(reason);
  }
  if (way.mode === 'direct' && way.remainingSeconds !== undefined) handlers.onAllowance?.(way.remainingSeconds);
  if (stopped) return { stop: release };
  const url = way.mode === 'direct' ? way.url : voiceLiveUrl(window.location, handlers.characterId, handlers.savePath);
  const protocols = way.mode === 'direct' ? way.protocols : undefined;
  const ws = deps.createSocket ? deps.createSocket(url, protocols) : new WebSocket(url, protocols);
  ws.binaryType = 'arraybuffer';
  socket = ws;
  // Direct: nobody between us and voice-live answers for the character, so we do.
  if (way.mode === 'direct' && handlers.characterId) {
    brain = createBrainRelay(handlers.characterId, handlers.savePath, (message) => {
      if (handlers.isCurrent() && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    });
  }

  const reader = new VoiceLiveFrameReader();
  if (output) player = new SegmentPlayer(output.context, output.destination, (receipt) => {
    if (handlers.isCurrent() && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(receipt));
  });

  const onEvent = (event: VoiceLiveEvent): void => {
    if (!handlers.isCurrent()) return;
    switch (event.kind) {
      case 'hello':
        handlers.onReady({ session: event.session, tts: event.tts, brain: event.brain });
        break;
      case 'segment':
        // Her words, and the only place a line enters the history.
        if (event.text) handlers.onLine(event.text);
        break;
      case 'audio':
        player?.play(event);
        break;
      case 'segment-end':
        player?.complete(event.id);
        break;
      case 'filler':
        // Deliberately nothing: not a line, not a receipt. Its audio still
        // plays, carried by the `audio` events that follow with `filler: true`.
        break;
      case 'state':
        handlers.onBotState(event.bot);
        break;
      case 'user-start':
        handlers.onUserStart?.();
        break;
      case 'transcript':
        handlers.onInputText(event.text);
        break;
      case 'thought':
        handlers.onThought(event.text);
        break;
      case 'duck':
        player?.duck(event.on);
        break;
      case 'interrupt':
        player?.interrupt();
        break;
      case 'resume':
        // A misfire: she keeps talking, and the audio is already on its way.
        player?.duck(false);
        break;
      case 'yield':
        player?.cancel();
        break;
      case 'unprompted':
        // The notice only; the `segment` that follows carries the words.
        break;
      case 'error':
        // One failed turn is not a failed call: voice-live keeps the session
        // and asks the caller to say it again. Only a fatal error hangs up.
        if (event.fatal) fail('connection');
        else handlers.onNotice?.('turn_failed');
        break;
      default:
        break;
    }
  };

  ws.onmessage = (message: MessageEvent) => {
    if (stopped) return;
    if (!handlers.isCurrent()) {
      release();
      return;
    }
    if (typeof message.data === 'string') {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(message.data) as Record<string, unknown>;
      } catch {
        return; // Not ours to guess at.
      }
      if (brain?.take(parsed)) return;
      const event = reader.read({ json: parsed });
      if (event) onEvent(event);
      return;
    }
    if (message.data instanceof ArrayBuffer) {
      const event = reader.read({ binary: message.data });
      if (event) onEvent(event);
    }
  };
  // `error` is always followed by `close`, which carries the code that says
  // why — so the verdict waits for it rather than reporting a bare "failed".
  let opened = false;
  ws.onerror = () => {};
  ws.onclose = (event: CloseEvent) => {
    if (stopped) return;
    const reason = closeFailure(event.code, event.reason ?? '', opened);
    if (reason) {
      fail(reason);
      return;
    }
    if (!opened) {
      fail('connection');
      return;
    }
    release();
    if (handlers.isCurrent()) handlers.onClosed();
  };

  // The socket may still be connecting while the mic is already producing.
  // Queue rather than drop: the opening words are the ones worth keeping.
  const early: ArrayBuffer[] = [];
  ws.onopen = () => {
    if (!handlers.isCurrent()) {
      release();
      return;
    }
    opened = true;
    for (const frame of early.splice(0)) ws.send(frame);
  };

  try {
    const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
    try {
      await capture.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    if (stopped || !handlers.isCurrent()) {
      release();
      return { stop: release };
    }
    const source = capture.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(capture, 'airp-voice-live-tap');
    node = tap;
    let pending: Float32Array[] = [];
    let pendingLength = 0;
    tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (!handlers.isCurrent()) {
        release();
        return;
      }
      pending.push(event.data);
      pendingLength += event.data.length;
      if (pendingLength < CHUNK_SAMPLES) return;
      const merged = new Float32Array(pendingLength);
      let offset = 0;
      for (const part of pending) {
        merged.set(part, offset);
        offset += part.length;
      }
      pending = [];
      pendingLength = 0;
      const frame = floatToPcm16(resampler.process(merged)).buffer as ArrayBuffer;
      if (handlers.isCurrent() && ws.readyState === WebSocket.OPEN) ws.send(frame);
      else if (handlers.isCurrent() && ws.readyState === WebSocket.CONNECTING) early.push(frame);
    };
    // A silent sink keeps the worklet pulled by the graph without echoing the mic.
    const sink = capture.createGain();
    sink.gain.value = 0;
    source.connect(tap).connect(sink).connect(capture.destination);
    if (capture.state === 'suspended') await capture.resume();
    if (!handlers.isCurrent()) {
      release();
      return { stop: release };
    }
  } catch {
    fail('connection');
    throw new Error('connection');
  }

  return { stop: release };
}
