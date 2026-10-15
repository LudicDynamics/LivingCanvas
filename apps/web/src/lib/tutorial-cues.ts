/**
 * Teach-once cues, page side.
 *
 * The engine marks the first-time moments (`cue` on an action's result:
 * first-inspiration / first-passive / first-follow / first-skill); this module
 * remembers, per browser, which ones were already taught and announces a new
 * one as `airp:tutorial-cue` ({ id, title, body } in the page language). Nothing
 * renders it yet — the card lands with the canvas / message-stream rework
 * (feat/canvas-stream). Storage is fail-soft: no storage → every cue is new
 * once per page load.
 */
import { cueToTeach, tutorialCueText, type TutorialCueId } from '@airp/shared/tutorial-cues';

const KEY = 'airp.tutorial.taught.v1';
const memory = new Set<string>();

export function taughtCues(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? [...new Set([...list.filter((x: unknown) => typeof x === 'string'), ...memory])] : [...memory];
  } catch {
    return [...memory];
  }
}

export function markTaught(id: TutorialCueId): void {
  memory.add(id);
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...new Set([...taughtCues(), id])]));
  } catch {
    // private window: remembered for this page load only
  }
}

/**
 * An action result's `cue`: when it was not taught yet, announce it (once) and return its id; else null.
 * The listener that shows the card calls `markTaught` when the player has seen it.
 */
export function noteCue(raw: unknown, locale: string): TutorialCueId | null {
  const id = cueToTeach(raw, taughtCues());
  if (!id || memory.has(`announced:${id}`)) return null;
  memory.add(`announced:${id}`);
  try {
    window.dispatchEvent(new CustomEvent('airp:tutorial-cue', { detail: { id, ...tutorialCueText(id, locale) } }));
  } catch {
    // no window (tests)
  }
  return id;
}
