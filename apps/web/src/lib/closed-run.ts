/**
 * Closed worlds on the page: the clock, and the
 * ending once it is reached. The server is the only judge — this hook just
 * reads `GET /api/world/run`, on load and after every world event.
 */
import { useEffect, useState } from 'react';
import { normalizeMoments, type RunMoments } from './milestones.js';

export interface ClosedRunSummary {
  startedAt: string | null;
  endedAt: string | null;
  steps: { used: number; start: number } | null;
  /** The player's own moves this run; absent from an older server. */
  turns?: number;
  /** Story time passed, when the clock has a `time` span. */
  minutesPassed?: number | null;
  /** `outcome` / `consequence`: the four tiers; absent on an older server. */
  rolls: { name: string; result: number | null; passed: boolean | null; outcome?: string | null; consequence?: { direction: 'cost' | 'bonus'; what: string } | null }[];
  /** Unvisited places come without a name and show as ？？？. */
  places: { layer: string; name: string | null; visited: boolean }[];
  clues: { path: string; name: string }[];
  /** The player's sticky notes / clue-board lines / marks this save (absent on an old server). */
  deductions?: { notes: number; lines: number; marks: number };
  endings: { id: string; title: string | null; reached: boolean }[];
}

export interface ClosedRunState {
  mode: 'open' | 'semi' | 'closed';
  /** `now` / `deadline` / `remainingMinutes`: the clock as story time, when the world gives one. */
  clock: { label: string; left: number; start: number; now?: string; deadline?: string; remainingMinutes?: number } | null;
  ending: { id: string; title: string; body: string; bg: string | null } | null;
  /** The settlement, once an ending is reached. */
  summary: ClosedRunSummary | null;
  /** The 复盘 / debrief: after an ending, in a world with mysteries. */
  debrief?: ClosedRunDebrief | null;
  /** CGs this save has shown, once an ending is reached: the epilogue's gallery. */
  cgs?: { path: string; caption?: string }[];
  /** Facts the two presentations compare; null until read, or from an older server. */
  moments?: RunMoments | null;
}

export type DebriefVerdict = 'surface' | 'hidden' | 'guessed' | 'wrong' | 'unanswered';

export interface DebriefMysteryResult {
  id: string;
  question: string;
  choice: string | null;
  label: string | null;
  verdict: DebriefVerdict;
  epilogue?: string;
  title?: string;
  /** Unlocked answers only: the save path of the clue that proved it, and its name. */
  proof?: string;
  proofName?: string;
}

export interface DebriefResult {
  total: number;
  surface: number;
  hidden: number;
  unlocked: number;
  tier: 'all' | 'most' | 'few';
  epilogue: string | null;
  mysteries: DebriefMysteryResult[];
}

export interface ClosedRunDebrief {
  mysteries: { id: string; question: string; hint?: string; options: { id: string; label: string }[] }[];
  result: DebriefResult | null;
}

/** Answer the debrief. The server scores it (evidence rule) and returns the new run state. */
export async function submitDebrief(answers: Record<string, string>): Promise<ClosedRunState> {
  const res = await fetch('/api/world/debrief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<ClosedRunState> & { ok?: boolean; error?: string };
  if (!res.ok || body.ok === false) throw new Error(body.error ?? `debrief failed (${res.status})`);
  return normalizeRun(body);
}

/** The settlement's mark for one mystery: ✓ unlocked (★ hidden), ✗ wrong, ？ right but no evidence, ？？？ unanswered. */
export function verdictMark(verdict: DebriefVerdict): string {
  switch (verdict) {
    case 'hidden': return '★';
    case 'surface': return '✓';
    case 'wrong': return '✗';
    case 'guessed': return '？';
    default: return '？？？';
  }
}

/** Every mystery answered? The confirm step lists what is still open, but skipping one is allowed. */
export function unansweredIds(mysteries: ClosedRunDebrief['mysteries'], answers: Record<string, string>): string[] {
  return mysteries.filter((m) => !answers[m.id]).map((m) => m.id);
}

/** Whether a world with endings shows the ending chrome (closed = endings + clock, semi = endings only). */
export function hasEndingChrome(mode: ClosedRunState['mode']): boolean {
  return mode === 'closed' || mode === 'semi';
}

/**
 * The DOM event `useWorld` fires for the world events App refreshes on. A tick
 * edits the clock card and an ending edits `world/README.md`, so both arrive
 * here as `entity_edited` — no closed-world-specific channel is needed.
 */
export const WORLD_EVENT_DOM = 'airp:world-event';

/**
 * Re-read the run without a world event: App fires it when the player's layer
 * changes, because `layer_entered` is not in the `airp:world-event` forward
 * set and a first scene entry is one of the two presentation moments.
 */
export const RUN_REFRESH_DOM = 'airp:run-refresh';

const OPEN: ClosedRunState = { mode: 'open', clock: null, ending: null, summary: null };

function normalizeRun(body: Partial<ClosedRunState>): ClosedRunState {
  return {
    mode: body.mode ?? 'open',
    clock: body.clock ?? null,
    ending: body.ending ?? null,
    summary: body.summary ?? null,
    debrief: body.debrief ?? null,
    cgs: Array.isArray(body.cgs) ? body.cgs.filter((c) => c && typeof c.path === 'string') : [],
    moments: normalizeMoments(body.moments),
  };
}

export async function fetchClosedRun(): Promise<ClosedRunState> {
  const res = await fetch('/api/world/run');
  if (!res.ok) return OPEN;
  return normalizeRun((await res.json()) as Partial<ClosedRunState> & { ok?: boolean });
}

/** `worldKey` changes on every world load, so a new save starts from a fresh read. */
export function useClosedRun(worldKey: string): ClosedRunState {
  const [state, setState] = useState<ClosedRunState>(OPEN);
  useEffect(() => {
    let live = true;
    // Bursts of events overlap reads; only a newer request's answer may land,
    // so an older snapshot never replaces a newer one (the clock would step back
    // and forth, and the presentations compare consecutive snapshots).
    let issued = 0;
    let landed = 0;
    const refresh = () => {
      const seq = ++issued;
      void fetchClosedRun().then((next) => {
        if (!live || seq < landed) return;
        landed = seq;
        setState(next);
      }).catch(() => undefined);
    };
    setState(OPEN);
    // No world (the lobby): `/api/world/run` is world-scoped and would only answer 404 — don't ask, not even on
    // the DOM events (smoke test 2026-10-05: ~7 404s in the lobby console).
    if (!worldKey) return () => { live = false; };
    refresh();
    window.addEventListener(WORLD_EVENT_DOM, refresh);
    window.addEventListener(RUN_REFRESH_DOM, refresh);
    return () => {
      live = false;
      window.removeEventListener(WORLD_EVENT_DOM, refresh);
      window.removeEventListener(RUN_REFRESH_DOM, refresh);
    };
  }, [worldKey]);
  return state;
}

/**
 * The ending collection, per world, in this browser: which endings this player
 * has seen across every run, with their titles. The server only ever names the
 * ending reached in the CURRENT save, so the others stay unspoiled until seen.
 */
const COLLECTION_KEY = (worldId: string) => `airp.endings.${worldId}`;

export function readEndingCollection(worldId: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(COLLECTION_KEY(worldId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function recordEnding(worldId: string, id: string, title: string): Record<string, string> {
  const next = { ...readEndingCollection(worldId), [id]: title };
  try {
    window.localStorage.setItem(COLLECTION_KEY(worldId), JSON.stringify(next));
  } catch {
    /* Private mode / storage blocked: the collection just isn't remembered. */
  }
  return next;
}

/** Minutes between two ISO stamps, rounded up; null when either is missing. */
export function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? Math.max(1, Math.ceil(ms / 60000)) : null;
}

/** "3 小时 25 分" / "40 分" — hours and minutes, for a story-time span. */
export function spanParts(minutes: number): { h: number; m: number } {
  const total = Math.max(0, Math.round(minutes));
  return { h: Math.floor(total / 60), m: total % 60 };
}
