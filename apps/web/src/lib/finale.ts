/**
 * The finale: the ending screen as a staged
 * reveal. Pure helpers only — the component (components/chrome/ClosedRun.tsx)
 * owns the timers, the DOM and the audio.
 *
 *   beat 0  title     the ending's name over a dark veil; the sting plays
 *   beat 1  picture   the veil lifts off the ending CG (slow push); the epilogue
 *   beat 2  summary   time, moves, items, secrets x/y with the clue that proved
 *                     each, the companion's closing line
 *   beat 3  remains   what this run never found, as silhouettes (no spoilers)
 *   beat 4  actions   play again / lobby / share
 *
 * Every animation is opacity / transform on its own layer (compositor-only);
 * reduced motion or effects off shows the final beat at once, as a static page.
 */
import type { ClosedRunDebrief, ClosedRunSummary, DebriefMysteryResult } from './closed-run.js';

export const FINALE_BEATS = ['title', 'picture', 'summary', 'remains', 'actions'] as const;
export type FinaleBeat = (typeof FINALE_BEATS)[number];
export const FINALE_LAST = FINALE_BEATS.length - 1;

/**
 * How long each beat holds before the next one lands (ms). The title holds
 * longest: it is the moment. The picture beat only starts once the CG has
 * decoded (or `DECODE_TIMEOUT_MS` passed), so it never pops in half-drawn.
 */
export const BEAT_HOLD_MS: Record<FinaleBeat, number> = {
  title: 1700,
  picture: 1900,
  summary: 900,
  remains: 700,
  actions: 0,
};

/** A CG that has not decoded by then is revealed anyway (the veil still lifts). */
export const DECODE_TIMEOUT_MS = 2500;

/** Whether the finale plays as a sequence, or shows its final state at once. */
export function finaleAnimated(reducedMotion: boolean, effectsEnabled: boolean): boolean {
  return !reducedMotion && effectsEnabled;
}

/** The beat to open on: the first for a sequence, the last for a static page. */
export function openingBeat(animated: boolean): number {
  return animated ? 0 : FINALE_LAST;
}

/** The next beat, clamped. */
export function nextBeat(beat: number): number {
  return Math.min(FINALE_LAST, beat + 1);
}

/** Whether a section for `section` is revealed at `beat`. */
export function beatShown(beat: number, section: FinaleBeat): boolean {
  return beat >= FINALE_BEATS.indexOf(section);
}

/** The sequence is a performance (lib/stage-performance.ts) until its last beat lands. */
export function finalePerforming(open: boolean, beat: number): boolean {
  return open && beat < FINALE_LAST;
}

/**
 * Presentations the finale waits out before its sequence runs (a scene card or
 * a CG still on stage). Not itself, not a character answering, not the writer.
 */
export function finaleWaitsFor(sources: readonly string[]): boolean {
  return sources.some((s) => s === 'milestone' || s === 'cg');
}

/** Decode an image before it is revealed; resolves (never rejects) on decode, error or timeout. */
export function decodeBeforeReveal(url: string | null, timeoutMs = DECODE_TIMEOUT_MS): Promise<'decoded' | 'failed' | 'timeout' | 'none'> {
  if (!url || typeof Image === 'undefined') return Promise.resolve('none');
  return new Promise((resolve) => {
    let settled = false;
    const done = (state: 'decoded' | 'failed' | 'timeout') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(state);
    };
    const timer = setTimeout(() => done('timeout'), timeoutMs);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    if (typeof img.decode === 'function') {
      img.decode().then(() => done('decoded'), () => done('failed'));
    } else {
      img.onload = () => done('decoded');
      img.onerror = () => done('failed');
    }
  });
}

/** The clue that proved an unlocked secret, by name: the server's name, else the bag's, else the file stem. */
export function proofLabel(m: Pick<DebriefMysteryResult, 'proof' | 'proofName' | 'verdict'>, clues: ClosedRunSummary['clues']): string | null {
  if (!m.proof || (m.verdict !== 'surface' && m.verdict !== 'hidden')) return null;
  if (m.proofName) return m.proofName;
  const file = m.proof.split('/').pop() ?? m.proof;
  const carried = clues.find((c) => c.path === m.proof || c.path.split('/').pop() === file);
  return carried?.name ?? file.replace(/\.md$/, '');
}

export interface FinaleRemains {
  /** Places never entered; their names are never sent, so only the count and silhouettes show. */
  places: number;
  /** Endings neither reached here nor ever seen in this browser. */
  endings: number;
  /** Secrets not unlocked: unanswered, wrong, or right without the evidence. `null` before the debrief. */
  secrets: number | null;
  /** Of those, the ones answered right without the evidence (a hint: the proof is still out there). */
  guessed: number;
}

/** What this run left undiscovered — counts only, nothing that names it. */
export function remainsOf(
  summary: ClosedRunSummary,
  collection: Record<string, string>,
  debrief: ClosedRunDebrief | null,
): FinaleRemains {
  const result = debrief?.result ?? null;
  const unlocked = (v: DebriefMysteryResult['verdict']) => v === 'surface' || v === 'hidden';
  return {
    places: summary.places.filter((p) => !p.visited).length,
    endings: summary.endings.filter((e) => !e.reached && !e.title && !collection[e.id]).length,
    secrets: result ? result.mysteries.filter((m) => !unlocked(m.verdict)).length : debrief ? debrief.mysteries.length : 0,
    guessed: result ? result.mysteries.filter((m) => m.verdict === 'guessed').length : 0,
  };
}

/** Whether anything at all remains (the section then says so instead of showing silhouettes). */
export function anythingRemains(r: FinaleRemains): boolean {
  return r.places > 0 || r.endings > 0 || (r.secrets ?? 0) > 0;
}

/** Silhouettes are capped so a large world doesn't print a wall of ？？？. */
export const SILHOUETTE_CAP = 6;
