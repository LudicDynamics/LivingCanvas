/**
 * voice-live's wire protocol, as pure functions.
 *
 * Everything in this file is side-effect free: no socket, no AudioContext, no
 * timers. That is deliberate — the two rules that are easiest to get wrong and
 * hardest to notice live here, and both are fully unit-testable
 * (`apps/web/test/voice-live-frames.test.mjs`):
 *
 *  1. **An audio frame is a JSON header followed by one or more binary PCM
 *     frames** (integration.md §3.3). With `chunks: true` the binaries keep
 *     coming until `segment_end`; without it, the very next binary is the whole
 *     segment. A reader that assumes one-binary-per-header truncates every
 *     streamed line to its first chunk, and nothing about that looks like a bug
 *     — she just sounds clipped.
 *  2. **A `filler` is not something she said.** It is a mouth noise the reflex
 *     layer plays while the brain is still thinking. It must never enter the
 *     transcript or the history, and `played` must never be reported for it, or
 *     she will believe she already answered.
 *
 * `played` is not optional either: the history only records "the part the
 * listener actually heard", so a segment we never report leaves her believing
 * she is still speaking.
 */

/** Bot state as voice-live reports it (`state{bot}`). */
export type VoiceLiveBotState = 'idle' | 'thinking' | 'speaking';

/** What the reader hands the transport. One wire frame may yield one event. */
export type VoiceLiveEvent =
  | { kind: 'hello'; session: string; sampleRate: number; tts: string; brain: string }
  /** A line she is about to say. Real speech: it belongs in the transcript. */
  | { kind: 'segment'; id: number; text: string; sampleRate: number; chunks: boolean }
  /** PCM for whichever header is open. `filler` audio plays but is never reported. */
  | { kind: 'audio'; id: number; sampleRate: number; pcm: ArrayBuffer; filler: boolean }
  | { kind: 'segment-end'; id: number; ms: number }
  /** A mouth noise. NOT her words — display nothing, report nothing. */
  | { kind: 'filler'; id: number; text: string; sampleRate: number }
  | { kind: 'state'; bot: VoiceLiveBotState }
  | { kind: 'user-start' }
  | { kind: 'user-end' }
  | { kind: 'transcript'; text: string; lang: string }
  /** Something she thought in the silence. Display only; there is no audio. */
  | { kind: 'thought'; text: string }
  | { kind: 'duck'; on: boolean }
  | { kind: 'interrupt'; graceMs: number }
  | { kind: 'resume' }
  | { kind: 'yield' }
  | { kind: 'backchannel'; text: string }
  | { kind: 'unprompted'; text: string }
  /**
   * `fatal: false` is one failed turn (the brain timed out, a 429, a model
   * switch): the session lives on and the call MUST NOT be hung up. An older
   * voice-live sends no `fatal`; its only `where:'reply'` error was never fatal either.
   */
  | { kind: 'error'; where: string; message: string; fatal: boolean }
  /** Carried but not acted on (`turn` / `decision` / `span`): debug data. */
  | { kind: 'ignored'; type: string };

/** One wire frame: either parsed JSON, or raw bytes. */
export type VoiceLiveFrame =
  | { json: Record<string, unknown> }
  | { binary: ArrayBuffer };

const BOT_STATES: readonly VoiceLiveBotState[] = ['idle', 'thinking', 'speaking'];

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** The header an incoming binary frame belongs to. */
interface OpenHeader {
  id: number;
  sampleRate: number;
  filler: boolean;
  /** True while more binaries are expected; only `segment_end` closes it. */
  chunks: boolean;
}

/**
 * Turns the frame sequence into events, holding the one piece of state the
 * protocol requires: which header the next binary frame belongs to.
 *
 * Deliberately forgiving about frames it does not know — voice-live may add
 * one, and an unrecognised name must not break a call in progress.
 */
export class VoiceLiveFrameReader {
  private open: OpenHeader | null = null;
  /** Default until `hello` says otherwise (integration.md: 16 kHz mono PCM16). */
  private sampleRate = 16_000;

  /** Frames whose binary arrived with no header. Diagnostics only. */
  orphanAudioFrames = 0;

  read(frame: VoiceLiveFrame): VoiceLiveEvent | null {
    if ('binary' in frame) return this.readBinary(frame.binary);
    return this.readJson(frame.json);
  }

  private readBinary(pcm: ArrayBuffer): VoiceLiveEvent | null {
    const header = this.open;
    if (!header) {
      // Audio with nothing to attach it to. Dropping is right: playing bytes at
      // a guessed rate under a guessed id would corrupt the played/interrupted
      // ledger, which is worse than a moment of silence.
      this.orphanAudioFrames += 1;
      return null;
    }
    // A single-shot header is closed by its one and only binary. A chunked one
    // stays open until `segment_end` — that is what `chunks: true` means.
    if (!header.chunks) this.open = null;
    return {
      kind: 'audio',
      id: header.id,
      sampleRate: header.sampleRate,
      pcm,
      filler: header.filler,
    };
  }

  private readJson(message: Record<string, unknown>): VoiceLiveEvent | null {
    const type = str(message.type);
    switch (type) {
      case 'hello': {
        this.sampleRate = num(message.sample_rate, this.sampleRate);
        return {
          kind: 'hello',
          session: str(message.session),
          sampleRate: this.sampleRate,
          tts: str(message.tts),
          brain: str(message.brain),
        };
      }
      case 'segment': {
        const id = num(message.id, -1);
        const sampleRate = num(message.sr, this.sampleRate);
        const chunks = message.chunks === true;
        this.open = { id, sampleRate, filler: false, chunks };
        return { kind: 'segment', id, text: str(message.text), sampleRate, chunks };
      }
      case 'segment_end': {
        const id = num(message.id, -1);
        if (this.open?.id === id && !this.open.filler) this.open = null;
        return { kind: 'segment-end', id, ms: num(message.ms, 0) };
      }
      case 'filler': {
        const id = num(message.id, -1);
        const sampleRate = num(message.sr, this.sampleRate);
        // Fillers are never chunked, and the flag is what keeps this audio out
        // of the transcript and out of the `played` receipts.
        this.open = { id, sampleRate, filler: true, chunks: false };
        return { kind: 'filler', id, text: str(message.text), sampleRate };
      }
      case 'state': {
        const bot = str(message.bot);
        return BOT_STATES.includes(bot as VoiceLiveBotState)
          ? { kind: 'state', bot: bot as VoiceLiveBotState }
          : null;
      }
      case 'user_start':
        return { kind: 'user-start' };
      case 'user_end':
        return { kind: 'user-end' };
      case 'transcript':
        return { kind: 'transcript', text: str(message.text), lang: str(message.lang) };
      case 'thought':
        return { kind: 'thought', text: str(message.text) };
      case 'duck':
        return { kind: 'duck', on: message.on === true };
      case 'interrupt':
        return { kind: 'interrupt', graceMs: num(message.grace_ms, 0) };
      case 'resume':
        return { kind: 'resume' };
      case 'yield':
        return { kind: 'yield' };
      case 'backchannel':
        return { kind: 'backchannel', text: str(message.text) };
      case 'unprompted':
        // The `segment` that carries the words follows; this is only the notice.
        return { kind: 'unprompted', text: str(message.text) };
      case 'error': {
        const where = str(message.where, 'upstream');
        const fatal = message.fatal === true || (message.fatal !== false && where !== 'reply');
        return { kind: 'error', where, message: str(message.message), fatal };
      }
      case 'turn':
      case 'decision':
      case 'span':
        return { kind: 'ignored', type };
      default:
        return type ? { kind: 'ignored', type } : null;
    }
  }
}

/** The receipt the client owes voice-live once a segment has been heard. */
export interface PlayedReceipt {
  type: 'played';
  seg: number;
  started_at: number;
  ended_at: number;
}

/** What the client owes after an `interrupt`: how far playback actually got. */
export interface InterruptedReceipt {
  type: 'interrupted';
  seg: number | null;
  played_ms: number;
  started_at: number;
}

/** One segment's playback progress, in wall-clock milliseconds. */
interface LedgerEntry {
  /** When its first chunk began sounding. */
  startedAt: number;
  /** When its last scheduled chunk will have finished. */
  endsAt: number;
  /** True once `segment_end` says no more chunks are coming. */
  complete: boolean;
  /** True once a receipt has been produced, so none is ever sent twice. */
  reported: boolean;
  filler: boolean;
}

/**
 * Decides WHEN a `played` is owed and WHAT an `interrupted` should say. Pure:
 * every time comes in as a wall-clock millisecond argument, so the whole
 * reporting contract is testable with no audio hardware.
 *
 * The rules it enforces, both from integration.md §3.2:
 *  - a real segment is reported exactly once, after its last chunk has played;
 *  - a filler is never reported at all.
 */
export class PlaybackLedger {
  private readonly entries = new Map<number, LedgerEntry>();

  /** A chunk has been scheduled: `[startsAt, endsAt]` in wall-clock ms. */
  schedule(seg: number, startsAt: number, endsAt: number, filler: boolean): void {
    const entry = this.entries.get(seg);
    if (!entry) {
      this.entries.set(seg, { startedAt: startsAt, endsAt, complete: false, reported: false, filler });
      return;
    }
    // Chunks of one segment are contiguous; the segment ends when its last does.
    entry.startedAt = Math.min(entry.startedAt, startsAt);
    entry.endsAt = Math.max(entry.endsAt, endsAt);
  }

  /** `segment_end`: no more chunks. The receipt may now be owed. */
  complete(seg: number): void {
    const entry = this.entries.get(seg);
    if (entry) entry.complete = true;
  }

  /** True while this segment still has chunks or has not finished sounding. */
  isPending(seg: number): boolean {
    const entry = this.entries.get(seg);
    return entry !== undefined && !entry.reported;
  }

  /**
   * The receipt for a segment that has finished sounding, or null when one is
   * not owed — because it is a filler, because `segment_end` has not arrived,
   * or because it was already reported.
   */
  finish(seg: number): PlayedReceipt | null {
    const entry = this.entries.get(seg);
    if (!entry || entry.reported || !entry.complete) return null;
    entry.reported = true;
    this.entries.delete(seg);
    // A filler is NOT her speech: playing it is fine, reporting it is not.
    if (entry.filler) return null;
    return { type: 'played', seg, started_at: Math.round(entry.startedAt), ended_at: Math.round(entry.endsAt) };
  }

  /**
   * An `interrupt` landed at `now`. Reports how far the segment that was
   * sounding actually got, and forgets every pending segment — none of them
   * will finish now, so none can still owe a `played`.
   */
  interrupt(now: number): InterruptedReceipt {
    let sounding: { seg: number; entry: LedgerEntry } | null = null;
    for (const [seg, entry] of this.entries) {
      if (entry.reported || entry.filler) continue;
      // The one that had begun and had not yet finished. Ties go to the later
      // segment: chunks are scheduled in order, so that is the live one.
      if (entry.startedAt <= now && (!sounding || entry.startedAt > sounding.entry.startedAt)) {
        sounding = { seg, entry };
      }
    }
    const receipt: InterruptedReceipt = sounding
      ? {
          type: 'interrupted',
          seg: sounding.seg,
          played_ms: Math.max(0, Math.round(Math.min(now, sounding.entry.endsAt) - sounding.entry.startedAt)),
          started_at: Math.round(sounding.entry.startedAt),
        }
      : { type: 'interrupted', seg: null, played_ms: 0, started_at: Math.round(now) };
    this.entries.clear();
    return receipt;
  }

  /** Hang-up: nothing can still be owed. */
  clear(): void {
    this.entries.clear();
  }
}

/**
 * PCM16 LE bytes → the `[-1, 1)` floats Web Audio wants. A `DataView` read
 * keeps this correct on a big-endian machine and on an ArrayBuffer whose byte
 * offset is not 2-aligned, which is exactly what a WebSocket frame can hand us.
 */
export function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array<ArrayBuffer> {
  const view = new DataView(buffer);
  const samples = Math.floor(view.byteLength / 2);
  const out = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i += 1) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}
