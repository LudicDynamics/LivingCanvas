/**
 * CG reveal — the page side of the `show_cg` effect.
 *
 * `useWorld` turns a `world_event` whose `event.type` is `cg_shown` into the DOM
 * event `airp:cg-shown` (after the dice ceremony settles); `CgReveal` queues
 * and shows them one at a time. The epilogue's gallery replays a seen CG by
 * dispatching the same DOM event with `replay: true`.
 *
 * Pure helpers only; the component is `components/chrome/CgReveal.tsx`.
 */
import type { PerformanceSettings } from './performance-settings.js';

export const CG_SHOWN_DOM = 'airp:cg-shown';

/** A replayed `world_event` older than this is history, not a moment: not re-shown on reconnect. */
export const CG_FRESH_MS = 60_000;
/** More CGs than this waiting at once means something is looping; keep the newest few. */
export const CG_QUEUE_MAX = 6;
export const CG_FADE_MS = 700;
export const CG_FADE_MS_LIGHT = 250;

export interface CgItem {
  /** The world event id, or `replay:<path>` for a gallery replay. */
  id: string;
  path: string;
  caption: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A `cg_shown` world event (or a gallery replay) → the item to show, or null
 * for a malformed, foreign or stale one. `now` is injectable for tests.
 */
export function cgOf(detail: unknown, now: number = Date.now()): CgItem | null {
  if (!isRecord(detail)) return null;
  const d = isRecord(detail.detail) ? detail.detail : null;
  if (!d || typeof d.path !== 'string' || d.path === '') return null;
  const replay = detail.replay === true;
  if (!replay) {
    if (typeof detail.id !== 'string' || detail.type !== 'cg_shown') return null;
    if (typeof detail.createdAt === 'string') {
      const at = Date.parse(detail.createdAt);
      if (Number.isFinite(at) && now - at > CG_FRESH_MS) return null;
    }
  }
  const caption = typeof d.caption === 'string' && d.caption.trim() ? d.caption.trim() : null;
  return { id: replay ? `replay:${d.path}` : (detail.id as string), path: d.path, caption };
}

/** The DOM detail a gallery thumbnail dispatches to show a seen CG again. */
export function cgReplayDetail(path: string, caption?: string | null): Record<string, unknown> {
  return { replay: true, detail: { path, ...(caption ? { caption } : {}) } };
}

/** Add one item: duplicates (same id, or the picture already waiting) are dropped; the queue is bounded. */
export function enqueueCg(queue: readonly CgItem[], item: CgItem): CgItem[] {
  if (queue.some((q) => q.id === item.id || q.path === item.path)) return [...queue];
  const next = [...queue, item];
  return next.length > CG_QUEUE_MAX ? next.slice(next.length - CG_QUEUE_MAX) : next;
}

export interface CgPresentation {
  /** 0 = appear at once (reduced motion). */
  fadeMs: number;
  /** How much the scene behind is blurred: follows the performance setting. */
  blur: 'full' | 'reduced' | 'off';
}

/**
 * How the reveal plays under the viewer's preferences: reduced motion never
 * fades; the performance preset (no backdrop blur) keeps the fade short and
 * the backdrop a plain dim.
 */
export function cgPresentation(reducedMotion: boolean, settings: Pick<PerformanceSettings, 'backdropBlur'>): CgPresentation {
  const blur = settings.backdropBlur;
  if (reducedMotion) return { fadeMs: 0, blur };
  return { fadeMs: blur === 'off' ? CG_FADE_MS_LIGHT : CG_FADE_MS, blur };
}
