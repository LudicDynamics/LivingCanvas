/**
 * speaker-voice.ts — one speaker's spoken queue, and how it is cut off.
 *
 * Every carrier that reads character lines aloud (the companion dock, the NPC
 * dialogue) owns one of these. It holds the queue of lines to say for the ONE
 * speaker currently on stage, tagged with that speaker's id and an epoch:
 *
 *   - `setSpeaker(other)` (a different character, or null when the dialogue
 *     closes) cancels the old speaker on the spot: the clip stops, its queued
 *     lines are dropped, its in-flight requests are aborted, and anything that
 *     still arrives for it is discarded because the tag no longer matches. The
 *     next speaker never "continues" the previous one's lines
 *
 *   - `stop()` is the player's explicit interrupt (the stop control, Esc, or
 *     sending a new line): same cancellation, the dialogue stays open, and the
 *     lines that were cut off are never read later.
 *
 * Pure apart from the injected `deps`, so the behaviour is tested without a DOM
 * or an AudioContext (apps/web/test/speaker-voice.test.mjs).
 */
import { sanitiseTtsText } from '@airp/shared/tts-text';
import type { Emotion } from './audio.js';
import type { VoiceOutcome, VoiceRequest } from './tts-request.js';

/** The shape the queue needs from a scrollback entry. */
export interface SpeakableLine {
  id: number;
  who: 'player' | 'character';
  text: string;
  emo: Emotion;
  pending: boolean;
  /** An app notice, not the character's words: never read aloud. */
  notice?: boolean;
}

export interface SpeakerVoiceDeps {
  fetchVoice(request: VoiceRequest, stillValid: () => boolean, signal: AbortSignal): Promise<VoiceOutcome>;
  play(url: string): void;
  stop(): void;
  isVoicing(): boolean;
  wait(ms: number): Promise<void>;
  now(): number;
  /**
   * Report a drain as a stage performance (lib/stage-performance `voice`) so the
   * forced tutorial waits until the line has been heard; returns the end call.
   */
  performance?(): () => void;
  /** Loading OR sounding (audio.ts `isVoiceBusy`): the drain is heard only when this is false. */
  isBusy?(): boolean;
}

export interface SpeakOptions {
  voice?: string;
  language: string;
  /** The speaker's display name(s), for the narration fallback in `sanitiseTtsText`. */
  names?: readonly (string | null | undefined)[];
  /** The save these lines belong to (`/api/tts` `savePath`, a scope check on the server). */
  savePath: string;
  /** The character the server voices; defaults to the speaker key. */
  characterId?: string;
  /** Still the selected save? Re-asked with the speaker check after every await. */
  isCurrent?: () => boolean;
}

/**
 * How often to look at whether the previous line has finished playing.
 * `playVoice` reports completion through `isVoicing()` and offers no callback,
 * so this is a poll; a fifth of a second is inaudible between two lines.
 */
export const VOICE_IDLE_POLL_MS = 200;

/**
 * How long to wait for the previous line before giving up and speaking anyway.
 * A line that never ends (a stalled decode, a tab hidden mid-clip) must not
 * silence everything after it.
 */
export const VOICE_IDLE_TIMEOUT_MS = 30_000;

interface Item {
  speaker: string;
  epoch: number;
  line: SpeakableLine;
  options: SpeakOptions;
}

/**
 * Line ids already spoken (or cut off), per speaker, for as long as the page
 * stays on this save. A character reopened later must not read their old
 * lines again, and a line cut off by a stop or a close is
 * "spoken" too — it is never resumed.
 */
const spokenBySpeaker = new Map<string, Set<number>>();

export function forgetSpokenLines(): void {
  spokenBySpeaker.clear();
}

function spokenSet(speaker: string): Set<number> {
  let set = spokenBySpeaker.get(speaker);
  if (!set) spokenBySpeaker.set(speaker, (set = new Set()));
  return set;
}

/**
 * Every settled CHARACTER line said since the player last spoke, oldest first.
 * A settled player line stops the search: anything above it has already been
 * spoken or been overtaken. Notices are never read.
 */
export function linesToSpeak(lines: readonly SpeakableLine[]): SpeakableLine[] {
  const queue: SpeakableLine[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.pending) continue;
    if (line.who === 'player') break;
    if (line.notice) continue;
    queue.push(line);
  }
  return queue.reverse();
}

export class SpeakerVoice {
  private speaker: string | null = null;
  private epoch = 0;
  private queue: Item[] = [];
  private pumpEpoch: number | null = null;
  private controller: AbortController | null = null;
  private speakingNow = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: SpeakerVoiceDeps) {}

  /** Whose lines this queue speaks. Changing it cancels the previous speaker. */
  setSpeaker(speaker: string | null): void {
    if (speaker === this.speaker) return;
    this.cancel();
    this.speaker = speaker;
  }

  get currentSpeaker(): string | null {
    return this.speaker;
  }

  /** True from the moment a line is queued until its audio ends (or is stopped). */
  get speaking(): boolean {
    return this.speakingNow;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Lines that must never be read for `speaker` (already said, cut off, or arrived while closed). */
  markSpoken(speaker: string, lines: readonly Pick<SpeakableLine, 'id'>[]): void {
    const set = spokenSet(speaker);
    for (const line of lines) set.add(line.id);
  }

  /**
   * Queue `speaker`'s settled, unspoken character lines. Ignored unless
   * `speaker` is the one on stage: a carrier handing over lines it still holds
   * for the previous character must not make the new one read them.
   */
  speak(speaker: string, lines: readonly SpeakableLine[], options: SpeakOptions): void {
    if (speaker !== this.speaker) return;
    const set = spokenSet(speaker);
    const pending = linesToSpeak(lines).filter(line => !set.has(line.id));
    if (pending.length === 0) return;
    // Mark before awaiting anything: a re-render with the same lines must not
    // queue any of them twice.
    for (const line of pending) set.add(line.id);
    for (const line of pending) this.queue.push({ speaker, epoch: this.epoch, line, options });
    this.setSpeaking(true);
    void this.pump();
  }

  /**
   * The explicit interrupt: stop the clip, drop the queue, abort requests.
   * `lines` (the scrollback on screen) are marked spoken so nothing cut off
   * here is read later.
   */
  stop(lines: readonly Pick<SpeakableLine, 'id'>[] = []): void {
    if (this.speaker !== null) this.markSpoken(this.speaker, lines);
    this.cancel();
  }

  private cancel(): void {
    this.epoch += 1;
    this.queue = [];
    this.controller?.abort();
    this.controller = null;
    const wasSpeaking = this.speakingNow;
    this.setSpeaking(false);
    // Only cut the shared channel when THIS queue was the one using it: another
    // carrier's line (or a live call) must not be silenced by our close.
    if (wasSpeaking) this.deps.stop();
  }

  private setSpeaking(next: boolean): void {
    if (this.speakingNow === next) return;
    this.speakingNow = next;
    for (const listener of this.listeners) listener();
  }

  /** Is this item still the one to say — same speaker on stage, no stop since? */
  private current(item: Pick<Item, 'speaker' | 'epoch'>): boolean {
    return item.epoch === this.epoch && item.speaker === this.speaker;
  }

  private async waitForSilence(stillValid: () => boolean): Promise<void> {
    const deadline = this.deps.now() + VOICE_IDLE_TIMEOUT_MS;
    while (this.deps.isVoicing() && stillValid() && this.deps.now() < deadline) {
      await this.deps.wait(VOICE_IDLE_POLL_MS);
    }
  }

  /** A line still loading counts as being said (the forced tutorial waits for it). */
  private async waitUntilHeard(stillValid: () => boolean): Promise<void> {
    if (!this.deps.isBusy) return;
    const deadline = this.deps.now() + VOICE_IDLE_TIMEOUT_MS;
    while (this.deps.isBusy() && stillValid() && this.deps.now() < deadline) {
      await this.deps.wait(VOICE_IDLE_POLL_MS);
    }
  }

  private async pump(): Promise<void> {
    const epoch = this.epoch;
    if (this.pumpEpoch === epoch) return; // already draining this epoch
    this.pumpEpoch = epoch;
    const controller = new AbortController();
    this.controller = controller;
    const epochValid = (): boolean => epoch === this.epoch;
    const heard = this.deps.performance?.() ?? ((): void => {});
    try {
      while (epochValid() && this.queue.length > 0) {
        const item = this.queue.shift()!;
        const valid = (): boolean => this.current(item) && (item.options.isCurrent?.() ?? true);
        if (!valid()) continue;
        const text = sanitiseTtsText(item.line.text, { names: item.options.names });
        if (text === '') continue; // all narration: shown, not spoken
        const outcome = await this.deps.fetchVoice(
          {
            text,
            voice: item.options.voice,
            language: item.options.language,
            savePath: item.options.savePath,
            characterId: item.options.characterId ?? item.speaker,
            emotion: item.line.emo,
          },
          valid,
          controller.signal,
        );
        if (outcome.status !== 'ready' || !valid()) continue; // late audio for a stopped speaker is dropped
        // Take turns rather than interrupt: two lines in the
        // same breath are said one after the other.
        await this.waitForSilence(valid);
        if (!valid()) continue;
        this.deps.stop();
        this.deps.play(outcome.url);
      }
      if (!epochValid()) return;
      // Let the last line finish before the stop control goes away.
      await this.deps.wait(VOICE_IDLE_POLL_MS);
      await this.waitForSilence(epochValid);
      await this.waitUntilHeard(epochValid);
      if (epochValid() && this.queue.length === 0) this.setSpeaking(false);
    } finally {
      heard();
      if (this.pumpEpoch === epoch) this.pumpEpoch = null;
      if (this.controller === controller && !epochValid()) this.controller = null;
      // Lines queued while the tail was waiting get their own drain.
      if (epochValid() && this.queue.length > 0) void this.pump();
    }
  }
}
