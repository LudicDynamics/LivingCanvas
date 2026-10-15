/**
 * 「分享结果」 from the finale (components/chrome/ClosedRun.tsx).
 *
 * The picture card itself is drawn by the shared share-card renderer
 * (`lib/share-card.ts` → `renderResultCard`, owned by the invite work). This
 * module only builds what the card shows — facts read back from the server,
 * nothing that would spoil an ending or a secret the player has not seen — and
 * the plain-text line used when no renderer is present (or the browser cannot
 * share files). The renderer is loaded through `lib/share-card-loader.ts`, which
 * degrades to `null` when the module is not in this build.
 */
import { minutesBetween, type ClosedRunState } from './closed-run.js';

/** What a result card shows. Stable field names: the renderer reads these. */
export interface ResultCardInput {
  kind: 'result';
  locale: string;
  worldId: string;
  worldName: string;
  endingId: string;
  endingTitle: string;
  /** Absolute URL of the ending CG, or null. */
  picture: string | null;
  /** Real minutes played; null when unknown. */
  minutes: number | null;
  turns: number | null;
  items: number;
  /** Secrets unlocked / total; null when the world has no debrief or it was not answered. */
  secrets: { unlocked: number; total: number; hidden: number } | null;
  endings: { seen: number; total: number };
  places: { visited: number; total: number };
}

export function buildResultCard(
  run: ClosedRunState,
  opts: { locale: string; worldId: string; worldName: string; picture: string | null; collection: Record<string, string> },
): ResultCardInput | null {
  if (!run.ending) return null;
  const s = run.summary;
  const result = run.debrief?.result ?? null;
  return {
    kind: 'result',
    locale: opts.locale,
    worldId: opts.worldId,
    worldName: opts.worldName,
    endingId: run.ending.id,
    endingTitle: run.ending.title,
    picture: opts.picture,
    minutes: s ? minutesBetween(s.startedAt, s.endedAt) : null,
    turns: typeof s?.turns === 'number' ? s.turns : null,
    items: s?.clues.length ?? 0,
    secrets: result ? { unlocked: result.unlocked, total: result.total, hidden: result.hidden } : null,
    endings: {
      seen: s ? s.endings.filter((e) => e.reached || opts.collection[e.id]).length : 1,
      total: s?.endings.length ?? 1,
    },
    places: {
      visited: s ? s.places.filter((p) => p.visited).length : 0,
      total: s?.places.length ?? 0,
    },
  };
}

type T = (key: string, vars?: Record<string, string | number>) => string;

/** One line for the clipboard / a text share: "《world》 · Ending「title」 · 42 min · secrets 3 / 4". */
export function resultShareText(card: ResultCardInput, t: T): string {
  const parts = [`${card.worldName} · ${t('Ending')}「${card.endingTitle}」`];
  if (card.minutes !== null) parts.push(t('{n} min', { n: card.minutes }));
  if (card.secrets) parts.push(t('Secrets solved {n} / {total}', { n: card.secrets.unlocked, total: card.secrets.total }));
  parts.push(t('Endings {seen} / {total}', { seen: card.endings.seen, total: card.endings.total }));
  return parts.join(' · ');
}

/** Whatever the renderer hands back, as a Blob (a canvas, a data URL or a Blob). */
export async function cardBlob(rendered: unknown): Promise<Blob | null> {
  if (typeof Blob !== 'undefined' && rendered instanceof Blob) return rendered;
  if (rendered && typeof (rendered as HTMLCanvasElement).toBlob === 'function') {
    return new Promise((resolve) => (rendered as HTMLCanvasElement).toBlob((b) => resolve(b), 'image/png'));
  }
  if (typeof rendered === 'string' && rendered.startsWith('data:')) {
    const res = await fetch(rendered);
    return res.blob();
  }
  if (rendered && typeof rendered === 'object' && 'blob' in rendered) return cardBlob((rendered as { blob: unknown }).blob);
  return null;
}
