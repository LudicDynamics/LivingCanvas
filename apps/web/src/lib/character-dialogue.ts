/**
 * character-dialogue.ts — the compact dialogue projection for the right rail
 *.
 *
 * Same ingress as `CharacterModal`: the shared FIFO (`character-frame-queue`),
 * drained per character, folded by the SAME turn projection
 * (`consumeCharacterFrame`) and the SAME `[emo: …]` parser (`parseEmoPages`).
 * Nothing new reaches the network and no new WS frame exists — this module only
 * chooses a different presentation of the frames the modal already consumes.
 *
 * The difference is the shape: the modal paginates one line per page and types
 * it out; the dock keeps a short scrollback, because the player is reading it
 * beside a live canvas rather than on a stage. Pagination, per-page TTS and the
 * advance gesture stay in the modal and are deliberately NOT duplicated here.
 *
 * Only ONE consumer may drain a character's lane. In `companion` the modal is
 * not mounted, so this hook is that consumer; in `classic` this hook is not
 * mounted and the modal is.
 */
import { forgetSpokenLines } from './use-spoken-lines.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Emotion } from './audio.js';
import {
  consumeCharacterFrame,
  createCharacterTurn,
  parseEmoPages,
  type CharacterTurnBuffer,
} from '../components/overlay/dialogue-pages.js';
import {
  getCharacterFrameQueue,
  type CharacterFrame,
  type CharacterFrameQueue,
} from './character-frame-queue.js';

/** One entry in the compact scrollback. `pending` marks a turn still arriving. */
export interface DialogueLine {
  id: number;
  who: 'player' | 'character';
  text: string;
  emo: Emotion;
  pending: boolean;
  /**
   * Not words the character said, but the app telling the player something
   * went wrong. `text` is then an i18n key, and the line is never read aloud.
   */
  notice?: boolean;
}

/**
 * What the player is told when a character's turn fails.
 *
 * The raw message is the model provider's error body, and it is not fit to
 * show: it is JSON, it is English whatever the world's language, and an auth
 * failure QUOTES THE KEY'S PREFIX AND LAST FOUR — shown to a player on the
 * hosted site, that is a piece of the operator's key (security audit,
 * 2026-09-25). So the common failures become one sentence each, and anything
 * else is cut to a short plain line with every key-shaped run removed.
 */
export const AGENT_ERROR_NOTICES = {
  auth: "The character's model service rejected its API key. Check the key in Settings.",
  quota: 'The model service is busy or out of quota. Try again in a moment.',
  generic: 'The character could not finish this turn.',
  noModel: 'No model is set up yet. Add a model API key in Settings to talk to the characters.',
} as const;

export function agentErrorNotice(message: string | undefined): string {
  const text = String(message ?? '');
  // The server's no-model gate (engine/model-availability.ts, NO_MODEL_MESSAGE).
  if (/^No model is configured\b/.test(text)) return AGENT_ERROR_NOTICES.noModel;
  if (/invalid_api_key|incorrect api key|\b401\b|unauthori[sz]ed|authentication/i.test(text)) return AGENT_ERROR_NOTICES.auth;
  if (/\b429\b|rate.?limit|quota|insufficient_quota|overloaded|\b529\b/i.test(text)) return AGENT_ERROR_NOTICES.quota;
  return AGENT_ERROR_NOTICES.generic;
}

/** idle → thinking (prompt sent, nothing back yet) → streaming → idle. */
export type DialoguePhase = 'idle' | 'thinking' | 'streaming';

export interface CharacterDialogue {
  /** Oldest first, capped at `limit`. */
  lines: DialogueLine[];
  phase: DialoguePhase;
  /** Mood of the most recent character text; drives the portrait. */
  emo: Emotion;
  /** Record the player's line and enter `thinking`. Sending is the caller's job. */
  pushPlayerLine(text: string): void;
}

/** Compact scrollback depth. */
export const DIALOGUE_LINE_LIMIT = 6;

/** Join a turn's pages back into one bubble; the LAST page owns the mood. */
function foldTurn(raw: string, final: boolean): { text: string; emo: Emotion } {
  const pages = parseEmoPages(raw, { final }).pages;
  if (pages.length === 0) return { text: '', emo: 'normal' };
  return {
    text: pages.map(page => page.text).join('\n').trim(),
    emo: pages[pages.length - 1].emo,
  };
}

/**
 * Each character's scrollback, kept while the page stays on this save
 *
 * Closing the stage or switching to someone else used to wipe the lines; now a
 * character reopens on what was said. `forgetDialogueScrollback()` clears it on a
 * world or save switch, where the conversation really is a different one.
 */
const scrollbackMemory = new Map<string, DialogueLine[]>();

/** Stable empty thread, so a switch render does not hand consumers a new array each time. */
const NO_LINES: DialogueLine[] = [];

/**
 * The last thing a character finished saying on this save, or null: the
 * finale quotes the companion's closing line (components/chrome/ClosedRun.tsx).
 * Read-only; a turn still arriving and app notices never count.
 */
export function lastCharacterLine(characterId: string | null | undefined): string | null {
  if (!characterId) return null;
  // Memory is keyed by [save, character] (scopeKey); a save switch clears it, so
  // the entries for this character are this save's.
  let lines: DialogueLine[] = [];
  for (const [key, value] of scrollbackMemory) {
    try { if ((JSON.parse(key) as unknown[])[1] === characterId) lines = value; } catch { /* not a scope key */ }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.who === 'character' && !line.pending && !line.notice && line.text.trim()) return line.text.trim();
  }
  return null;
}

export function forgetDialogueScrollback(): void {
  scrollbackMemory.clear();
  forgetSpokenLines();
}

export function useCharacterDialogue(
  characterId: string | null,
  frameQueue: CharacterFrameQueue = getCharacterFrameQueue(),
  /**
   * The author-written opening line, seeded as this character's
   * first bubble. It is SEEDED rather than sent: no agent has started, nothing
   * was streamed, and the scrollback is exactly where the player expects the
   * words they just read. When they answer, `character_start` carries the same
   * line as context, so the agent and the screen agree on what was said.
   */
  seed?: string | null,
  /** Canonical active save path; `null` means no save is currently attached. */
  worldPath?: string | null,
): CharacterDialogue {
  const [lines, setLines] = useState<DialogueLine[]>([]);
  /**
   * Whose thread `lines` holds. Set in the SAME batch as the reset below, so
   * for exactly one render after a switch (characterId already B, `lines` still
   * A's) the two disagree. That render used to leak A into B twice over
   *: the remember effect filed A's lines under B — reopening
   * B showed A's conversation — and the dock's speaker read A's last lines
   * aloud in B's voice. Lines are only shown, remembered or spoken while
   * `linesOwner === characterId`.
   */
  const [linesOwner, setLinesOwner] = useState<string | null>(null);
  const [phase, setPhase] = useState<DialoguePhase>('idle');
  const [emo, setEmo] = useState<Emotion>('normal');
  const [version, setVersion] = useState(0);
  const scopeKey = JSON.stringify([worldPath ?? null, characterId]);
  const [renderScope, setRenderScope] = useState(scopeKey);
  /** Turn truth, mirroring the modal's `turnBufferRef`. */
  const bufferRef = useRef<CharacterTurnBuffer>(createCharacterTurn());
  /** Id of the character line this turn is writing into; null between turns. */
  const openLineRef = useRef<number | null>(null);
  const nextIdRef = useRef(1);

  // A new character or save is a new conversation: neither its scrollback nor
  // a half-open turn may bleed into the new scope. A seeded greeting is planted
  // in this same save-scoped projection and nowhere else.
  const seedLine = seed?.trim() || null;
  const lastSeedRef = useRef<{
    characterId: string | null;
    worldPath: string | null | undefined;
    seed: string | null;
  }>({
    characterId: null,
    worldPath,
    seed: null,
  });
  useEffect(() => {
    const previous = lastSeedRef.current;
    lastSeedRef.current = { characterId, worldPath, seed: seedLine };
    if (
      previous.characterId === characterId &&
      previous.worldPath === worldPath &&
      (seedLine === null || seedLine === previous.seed)
    ) return;
    setRenderScope(scopeKey);
    bufferRef.current = createCharacterTurn();
    openLineRef.current = null;
    // Returning to a character in the same save restores its scrollback. A
    // save switch starts from that save's own memory (or its own greeting).
    const remembered = characterId !== null ? scrollbackMemory.get(scopeKey) : undefined;
    if (remembered && remembered.length > 0
      && (previous.characterId !== characterId || previous.worldPath !== worldPath)) {
      nextIdRef.current = Math.max(nextIdRef.current, ...remembered.map(line => line.id + 1));
      setLines(remembered.map(line => (line.pending ? { ...line, pending: false } : line)));
      setLinesOwner(characterId);
      setPhase('idle');
      setEmo('normal');
      return;
    }
    setLines(seedLine
      ? [{ id: nextIdRef.current++, who: 'character', text: seedLine, emo: 'normal', pending: false }]
      : []);
    setLinesOwner(characterId);
    setPhase('idle');
    setEmo('normal');
  }, [characterId, seedLine, scopeKey, worldPath]);

  // Remember what this character's scrollback holds, for the next time they open.
  // Only their OWN lines: on the switch render `lines` is still the previous
  // character's thread (see `linesOwner`). Nor a previous save's render while
  // the identity reset effect is waiting to commit: memory is save-scoped.
  const ownLines = linesOwner === characterId;
  useEffect(() => {
    if (renderScope === scopeKey && ownLines && characterId !== null && lines.length > 0) {
      scrollbackMemory.set(scopeKey, lines);
    }
  }, [characterId, lines, ownLines, renderScope, scopeKey]);

  useEffect(() => frameQueue.subscribe(() => setVersion(v => v + 1)), [frameQueue]);

  /**
   * Allocate the id for this turn's line. OUTSIDE the `setLines` updater on
   * purpose, and this is not a style preference
   *
   *
   * React StrictMode double-invokes state updaters in development. The old code
   * claimed the id by assigning `openLineRef.current` INSIDE the updater, so the
   * second invocation saw a ref that was no longer null, took the `map` branch
   * instead, found no line with that id in `prev` — and returned `prev`
   * unchanged. React keeps the SECOND result, so every character line was
   * dropped while the player's lines (a pure updater) rendered fine. The turn
   * still ended, so the portrait's mood and the first act's invitation both
   * moved on; only the words were missing, which is why it read as "the agent
   * acts but never answers".
   */
  const openLineId = useCallback((): number => {
    if (openLineRef.current === null) openLineRef.current = nextIdRef.current++;
    return openLineRef.current;
  }, []);

  const writeTurn = useCallback((raw: string, final: boolean) => {
    const folded = foldTurn(raw, final);
    if (folded.text === '') return;
    setEmo(folded.emo);
    const id = openLineId();
    // Idempotent by construction: the updater decides from `prev` alone, so
    // running it twice with the same input yields the same array either way.
    setLines(prev => (prev.some(line => line.id === id)
      ? prev.map(line =>
        line.id === id ? { ...line, text: folded.text, emo: folded.emo, pending: !final } : line,
      )
      : [...prev, { id, who: 'character' as const, text: folded.text, emo: folded.emo, pending: !final }]));
  }, [openLineId]);

  const consume = useCallback((frame: CharacterFrame) => {
    // `error` / `turn_aborted` end the turn with a truthful line rather than a
    // silent stall — the same honesty rule the modal follows.
    if (frame.type === 'error' || frame.type === 'turn_aborted') {
      const message = agentErrorNotice(typeof frame.message === 'string' ? frame.message : undefined);
      bufferRef.current = createCharacterTurn();
      openLineRef.current = null;
      // Id allocated outside the updater, for the same reason `writeTurn` does.
      const id = nextIdRef.current++;
      // One failure often arrives as two frames (`error`, then `turn_aborted`
      // with the same text). Saying it twice reads as two failures.
      setLines(prev => {
        const last = prev[prev.length - 1];
        if (last && last.who === 'character' && !last.pending && last.text === message) return prev;
        return [...prev, { id, who: 'character', text: message, emo: 'normal', pending: false, notice: true }];
      });
      setEmo('normal');
      setPhase('idle');
      return;
    }
    const projection = consumeCharacterFrame(
      bufferRef.current,
      frame.type === 'character_delta'
        ? { type: 'character_delta', delta: frame.delta }
        : frame.type === 'character_message'
          ? { type: 'character_message', text: frame.text }
          : { type: 'character_idle' },
    );
    bufferRef.current = projection.buffer;
    if (frame.type === 'character_idle') {
      writeTurn(projection.rawText, true);
      bufferRef.current = createCharacterTurn();
      openLineRef.current = null;
      setPhase('idle');
      return;
    }
    setPhase('streaming');
    writeTurn(projection.rawText, frame.type === 'character_message');
  }, [writeTurn]);

  useEffect(() => {
    if (characterId === null || worldPath === null || renderScope !== scopeKey) return;
    for (const frame of frameQueue.drainUntil(characterId)) {
      if (worldPath !== undefined && frame.savePath !== worldPath) continue;
      consume(frame);
    }
  }, [characterId, consume, frameQueue, renderScope, scopeKey, version, worldPath]);

  // Oldest lines fall off the top; the state array stays bounded.
  // Never another character's thread, not even for the one render a switch takes;
  // never another save's either (consumers see an empty projection for that render).
  const visible = ownLines ? lines : NO_LINES;
  const trimmed = visible.length > DIALOGUE_LINE_LIMIT ? visible.slice(visible.length - DIALOGUE_LINE_LIMIT) : visible;
  const scopeMatches = renderScope === scopeKey;

  const pushPlayerLine = useCallback((text: string) => {
    if (renderScope !== scopeKey || worldPath === null) return;
    const trimmedText = text.trim();
    if (trimmedText === '') return;
    bufferRef.current = createCharacterTurn();
    openLineRef.current = null;
    const id = nextIdRef.current++;
    setLines(prev => [...prev, { id, who: 'player', text: trimmedText, emo: 'normal', pending: false }]);
    setPhase('thinking');
  }, [renderScope, scopeKey, worldPath]);

  return {
    lines: scopeMatches ? trimmed : [],
    phase: scopeMatches ? phase : 'idle',
    emo: scopeMatches ? emo : 'normal',
    pushPlayerLine,
  };
}
