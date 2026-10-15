/**
 * use-spoken-lines.ts — speak each character line of the companion dock's
 * scrollback as it settles
 *
 *
 * The classic modal speaks page by page because it paginates; the dock keeps a
 * short scrollback and has no pages, so the unit here is a LINE. What the two
 * share is the request itself (`lib/tts-request.ts`) — there is one `/api/tts`
 * call site in the app, not two — and the text extractor (`sanitiseTtsText`):
 * narration about the character is shown, never spoken.
 *
 * Rules this hook exists to keep:
 *  1. The SEEDED opening greeting is spoken like any other character line. It
 *     is the whole point: it is what tells the player they are being spoken to.
 *  2. The player's own lines are never spoken back at them.
 *  3. Each speaker has their own queue (`lib/speaker-voice.ts`): closing a
 *     dialogue or turning to someone else stops that speaker at once, drops
 *     what they had left to say and aborts its requests; another character
 * never "continues" their lines. The SAVE is part of
 *     the speaker's identity too: a voice requested for one save never plays
 *     after the selected save changed (late arrivals are dropped).
 *  4. The player can interrupt: `stop()` (the stop control, Esc, or sending a
 *     new line) cuts the current speaker off without closing the dialogue.
 *
 * Mute and the TTS switch are not re-implemented: `canRequestTts()`/
 * `ttsEnabled()` gate the request inside `fetchVoiceUrl`, and `playVoice`
 * already returns early while muted or while the page is hidden.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitiseTtsText } from '@airp/shared/tts-text';
import { isVoiceBusy, isVoicing, playVoice, stopVoice } from './audio.js';
import { voiceLineBegan } from './stage-performance.js';
import { fetchVoiceUrl } from './tts-request.js';
import { agentActivityStore } from './agent-activity-store.js';
import {
  SpeakerVoice,
  forgetSpokenLines as forgetSpeakerLines,
  linesToSpeak,
  type SpeakableLine,
} from './speaker-voice.js';

export type { SpeakableLine } from './speaker-voice.js';
export { linesToSpeak } from './speaker-voice.js';

export interface SpokenLinesOptions {
  /** Whose voice is speaking; null disables the hook (nothing is on stage). */
  characterId: string | null;
  /**
   * Canonical active save path; null disables playback during a world switch.
   * Omitted → the save the app has selected (agent-activity-store).
   */
  worldPath?: string | null;
  lines: readonly SpeakableLine[];
  /** The character's configured voice; undefined → the server's default. */
  voice?: string;
  /** World content language, same value the modal sends. */
  language: string;
  /** The speaker's display name, for the narration fallback. */
  names?: readonly (string | null | undefined)[];
  /** Off in `classic`, where the modal is the speaker. */
  enabled?: boolean;
  /**
   * Whether the dialogue is OPEN. A collapsed dock keeps its subject (the
   * companion stays in the world) but says nothing: closing it stops the
   * voice, and lines that land while it is closed are never read later.
   */
  open?: boolean;
  /**
   * Author-written lines to synthesise ahead of time and NEVER play here
   *.
   */
  prefetch?: readonly string[];
}

export interface SpokenLines {
  /** A line is queued, being synthesised, or sounding for this speaker. */
  speaking: boolean;
  /** Interrupt this speaker without closing the dialogue. */
  stop(): void;
}

/**
 * Decide which line is the one to speak now: the newest CHARACTER line that
 * has finished arriving. Exported for the test.
 */
export function lineToSpeak(lines: SpeakableLine[]): SpeakableLine | null {
  const queue = linesToSpeak(lines);
  return queue.length === 0 ? null : queue[queue.length - 1];
}

export function forgetSpokenLines(): void {
  forgetSpeakerLines();
}

const NO_LINES: readonly SpeakableLine[] = [];

/** Capture refs once per request while checking both UI identity and store selection. */
export function createSpokenLineValidityCheck(
  turnRef: { current: number },
  token: number,
  characterIdRef: { current: string | null },
  subject: string,
  worldPathRef: { current: string | null | undefined },
  savePath: string,
  isSaveActive: (root: string | null) => boolean = agentActivityStore.isSaveActive,
): () => boolean {
  return () =>
    token === turnRef.current &&
    characterIdRef.current === subject &&
    worldPathRef.current === savePath &&
    isSaveActive(savePath);
}

/** The speaker key: one queue and one spoken-set per (save, character). */
function speakerKey(savePath: string, characterId: string): string {
  return JSON.stringify([savePath, characterId]);
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function useSpokenLines({
  characterId,
  worldPath: worldPathOption,
  lines,
  voice,
  language,
  names,
  enabled = true,
  open = true,
  prefetch,
}: SpokenLinesOptions): SpokenLines {
  const voiceRef = useRef<SpeakerVoice | null>(null);
  voiceRef.current ??= new SpeakerVoice({
    fetchVoice: fetchVoiceUrl,
    play: playVoice,
    stop: stopVoice,
    isVoicing,
    wait,
    now: () => Date.now(),
    performance: voiceLineBegan,
    isBusy: isVoiceBusy,
  });
  const speaker = voiceRef.current;
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => speaker.subscribe(() => setSpeaking(speaker.speaking)), [speaker]);

  /** Texts already warmed for the CURRENT character; warming twice is wasted money. */
  const warmedRef = useRef<Set<string>>(new Set());
  /** Bumped by every character switch; a warm whose token is stale is dropped. */
  const turnRef = useRef(0);
  // The lines on screen, for marking them on a stop or close. Updated after
  // commit, not during render: when the speaker changes, the cleanup below must
  // still see the lines that were on screen for the OLD one.
  const linesRef = useRef<readonly SpeakableLine[]>(NO_LINES);
  useEffect(() => { linesRef.current = lines; }, [lines]);

  const worldPath = worldPathOption === undefined ? agentActivityStore.getActiveSavePath() : worldPathOption;
  const characterIdRef = useRef(characterId);
  characterIdRef.current = characterId;
  const worldPathRef = useRef<string | null>(worldPath ?? null);
  worldPathRef.current = worldPath ?? null;
  // No save attached (a world switch in flight): nobody speaks.
  const live = enabled && open && worldPath != null ? characterId : null;
  const liveKey = live !== null && worldPath != null ? speakerKey(worldPath, live) : null;
  useEffect(() => {
    turnRef.current += 1;
    warmedRef.current = new Set();
    speaker.setSpeaker(liveKey);
    // The commit that changes the speaker can still carry the PREVIOUS
    // speaker's scrollback: the dock resets its lines in an effect, one render
    // later. Voicing that render as the new speaker is how one companion read
    // another's last lines, so whatever is on screen at the
    // switch is never spoken by the new speaker. Their own new lines come after.
    if (liveKey !== null) speaker.markSpoken(liveKey, lines);
    return () => {
      turnRef.current += 1;
      // Leaving a speaker (close, switch, unmount) cuts them off, and what was
      // on screen for them is never read later — not by them, not by anyone.
      if (liveKey !== null) speaker.markSpoken(liveKey, linesRef.current);
      speaker.setSpeaker(null);
    };
  // `lines` is deliberately not a dependency: it is read for the switch commit only.
  // A save switch changes `liveKey`: the old save's speaker is cut off.
  }, [liveKey, speaker]);

  // Warm the author-written lines. Serial, so two warms never race the line the
  // player is actually waiting to hear; a failed warm costs nothing.
  useEffect(() => {
    if (live === null || worldPath == null || !prefetch || prefetch.length === 0) return;
    const token = turnRef.current;
    const subject = live;
    const savePath = worldPath;
    const valid = createSpokenLineValidityCheck(turnRef, token, characterIdRef, subject, worldPathRef, savePath);
    void (async () => {
      for (const raw of prefetch) {
        if (!valid()) return;
        const text = sanitiseTtsText(raw, { names });
        if (text === '' || warmedRef.current.has(text)) continue;
        warmedRef.current.add(text);
        // `normal` matches how these lines are spoken, so the warm and the ask
        // are the same cache entry rather than two.
        await fetchVoiceUrl({ text, voice, language, savePath, characterId: subject, emotion: 'normal' }, valid);
      }
    })();
  }, [live, worldPath, prefetch, voice, language, names]);

  useEffect(() => {
    if (characterId === null || worldPath == null) return;
    const key = speakerKey(worldPath, characterId);
    // Closed (or classic): whatever lands now is shown, never read on reopen.
    if (live === null || liveKey === null) { speaker.markSpoken(key, lines); return; }
    const savePath = worldPath;
    speaker.speak(liveKey, lines, {
      voice, language, names, savePath, characterId: live,
      isCurrent: () => worldPathRef.current === savePath && agentActivityStore.isSaveActive(savePath),
    });
  }, [live, liveKey, characterId, worldPath, lines, voice, language, names, speaker]);

  const stop = useCallback(() => speaker.stop(linesRef.current), [speaker]);
  return { speaking, stop };
}
