/**
 * The ambient-life clock (pure; the design notes).
 *
 * Decides WHEN each person on the canvas does WHAT KIND of small thing; the
 * layer decides where and with which words. No DOM, no timers: time enters as
 * `now`, chance as `rng`, so every rule here is unit-testable.
 *
 * Rules (frozen in the doc):
 *  - every actor has its own randomised clocks: cursor moves every 3–9 s
 *    (writer 4–12 s), bubbles every 6–20 s;
 *  - at most ONE speech (bark, murmur or chat) on screen at a time;
 *  - a paused gate schedules nothing and, on resume, waits 1.5–4 s first;
 *  - reduced motion: no cursor moves at all, emotes only, three times rarer;
 *  - an actor that just arrived does something soon, so walking into a scene
 *    feels like walking into something already going on.
 */
import type { Rng } from './motion.js';
import type { PauseReason } from './gate.js';

export type ActorKind = 'writer' | 'character' | 'npc';

export interface AmbientActor {
  /** `writer`, a character id, or an NPC card stem. */
  id: string;
  kind: ActorKind;
  /** Shown with a pointer (writer + the first few people). */
  cursor: boolean;
  /** Can show bubbles (characters and NPCs, never the writer). */
  speaks: boolean;
}

export type CursorMove = 'hover' | 'tap' | 'nudge' | 'point-player' | 'point-actor' | 'select' | 'edge' | 'home';
export type BubbleKind = 'emote' | 'bark' | 'murmur' | 'chat';

export type AmbientAction =
  | { kind: 'cursor'; actor: string; move: CursorMove; other?: string }
  | { kind: BubbleKind; actor: string; partner?: string };

interface Clock {
  cursorAt: number;
  bubbleAt: number;
}

export interface SchedulerState {
  clocks: Readonly<Record<string, Clock>>;
  /** Speech slot is taken until this time. */
  speechUntil: number;
  /** Was the previous tick paused (for the resume delay)? */
  paused: boolean;
}

export interface TickInput {
  now: number;
  actors: readonly AmbientActor[];
  cursorPause: PauseReason | null;
  bubblePause: PauseReason | null;
  reducedMotion: boolean;
  rng: Rng;
  /** The player's pointer position is known (desktop, inside the canvas). */
  playerKnown: boolean;
  /** Has authored barks here (else bark falls back to an emote). */
  canBark(id: string): boolean;
  /** Partners present that `id` has a scripted chat with. */
  chatPartners(id: string): readonly string[];
}

export const CURSOR_EVERY: readonly [number, number] = [3000, 9000];
export const WRITER_CURSOR_EVERY: readonly [number, number] = [4000, 12000];
export const BUBBLE_EVERY: readonly [number, number] = [6000, 20000];
export const RESUME_DELAY: readonly [number, number] = [1500, 4000];
/** Upper bounds a speech holds the slot (the layer clears earlier when done). */
export const SPEECH_SLOT_MS: Readonly<Record<'bark' | 'murmur' | 'chat', number>> = { bark: 4400, murmur: 2800, chat: 13000 };
/** Never more than this many new actions in one tick (no bursts after a pause). */
export const MAX_ACTIONS_PER_TICK = 2;

export const INITIAL_SCHEDULER: SchedulerState = { clocks: {}, speechUntil: 0, paused: false };

const between = (rng: Rng, [lo, hi]: readonly [number, number]) => lo + rng() * (hi - lo);

function weighted<T extends string>(rng: Rng, table: readonly (readonly [T, number])[]): T {
  const total = table.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [value, w] of table) {
    roll -= w;
    if (roll < 0) return value;
  }
  return table[table.length - 1][0];
}

function cursorMove(actor: AmbientActor, input: TickInput, others: number): CursorMove {
  const table: [CursorMove, number][] = actor.kind === 'writer'
    ? [['hover', 34], ['select', 18], ['tap', 12], ['nudge', 6], ['edge', 12], ['point-player', 8], ['point-actor', 10]]
    : [['hover', 26], ['home', 20], ['tap', 10], ['nudge', 5], ['select', 6], ['edge', 9], ['point-player', 10], ['point-actor', 14]];
  return weighted(input.rng, table.filter(([move]) => (move !== 'point-player' || input.playerKnown) && (move !== 'point-actor' || others > 0)));
}

/** One step of the clock. Pure: returns the next state and what to start now. */
export function planTick(state: SchedulerState, input: TickInput): { state: SchedulerState; actions: AmbientAction[] } {
  const { now, rng } = input;
  const clocks: Record<string, Clock> = {};
  const bubbleEvery = input.reducedMotion ? ([BUBBLE_EVERY[0] * 3, BUBBLE_EVERY[1] * 3] as const) : BUBBLE_EVERY;
  // Keep known clocks; give newcomers a soon-ish first beat.
  for (const actor of input.actors) {
    clocks[actor.id] = state.clocks[actor.id] ?? {
      cursorAt: now + between(rng, [800, 4000]),
      bubbleAt: now + between(rng, input.reducedMotion ? [8000, 20000] : [2500, 9000]),
    };
  }
  const fullyPaused = input.cursorPause !== null && input.bubblePause !== null;
  if (fullyPaused) {
    return { state: { clocks, speechUntil: state.speechUntil, paused: true }, actions: [] };
  }
  // Coming back from a pause: wait a beat before anyone moves again.
  if (state.paused) {
    for (const id of Object.keys(clocks)) {
      const resume = now + between(rng, RESUME_DELAY);
      clocks[id] = { cursorAt: Math.max(clocks[id].cursorAt, resume), bubbleAt: Math.max(clocks[id].bubbleAt, resume) };
    }
    return { state: { clocks, speechUntil: state.speechUntil, paused: false }, actions: [] };
  }

  const actions: AmbientAction[] = [];
  let speechUntil = state.speechUntil;
  const cursorActors = input.actors.filter((a) => a.cursor);
  for (const actor of input.actors) {
    if (actions.length >= MAX_ACTIONS_PER_TICK) break;
    const clock = clocks[actor.id];
    // Cursor beat.
    if (actor.cursor && now >= clock.cursorAt) {
      if (input.cursorPause === null && !input.reducedMotion) {
        const others = cursorActors.length - 1;
        const move = cursorMove(actor, input, others);
        const action: AmbientAction = { kind: 'cursor', actor: actor.id, move };
        if (move === 'point-actor') {
          const pool = cursorActors.filter((a) => a.id !== actor.id);
          action.other = pool[Math.floor(rng() * pool.length) % pool.length].id;
        }
        actions.push(action);
      }
      clocks[actor.id] = { ...clocks[actor.id], cursorAt: now + between(rng, actor.kind === 'writer' ? WRITER_CURSOR_EVERY : CURSOR_EVERY) };
    }
    if (actions.length >= MAX_ACTIONS_PER_TICK) break;
    // Bubble beat.
    if (actor.speaks && now >= clock.bubbleAt) {
      if (input.bubblePause === null) {
        const slotFree = now >= speechUntil;
        let kind: BubbleKind = 'emote';
        let partner: string | undefined;
        if (!input.reducedMotion && slotFree) {
          const partners = input.chatPartners(actor.id);
          const roll = rng();
          if (partners.length && roll < 0.2) {
            kind = 'chat';
            partner = partners[Math.floor(rng() * partners.length) % partners.length];
          } else if (input.canBark(actor.id) && roll < 0.62) kind = 'bark';
          else if (roll < 0.76) kind = 'murmur';
        } else if (!input.reducedMotion && rng() < 0.5) {
          // Someone else is talking: wait for them instead of a second voice.
          clocks[actor.id] = { ...clocks[actor.id], bubbleAt: Math.max(speechUntil, now) + between(rng, [1200, 4000]) };
          continue;
        }
        actions.push(partner ? { kind, actor: actor.id, partner } : { kind, actor: actor.id });
        if (kind !== 'emote') speechUntil = now + SPEECH_SLOT_MS[kind];
      }
      clocks[actor.id] = { ...clocks[actor.id], bubbleAt: now + between(rng, bubbleEvery) };
    }
  }
  return { state: { clocks, speechUntil, paused: false }, actions };
}

/** The layer finished a speech early (or it was cut): free the slot. */
export function releaseSpeech(state: SchedulerState, now: number): SchedulerState {
  return state.speechUntil > now ? { ...state, speechUntil: now } : state;
}
