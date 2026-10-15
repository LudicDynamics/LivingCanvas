/// <reference types="vite/client" />
/**
 * The result card's renderer, if this build has one.
 *
 * `lib/share-card.ts` (`renderInviteCard` / `renderResultCard`) is the shared
 * share-card renderer. The finale must not break while it is absent, so it is
 * found through `import.meta.glob`: Vite resolves the pattern at build time to
 * an empty map when the file does not exist, and to a lazy chunk when it does —
 * no static import, no type dependency, nothing loaded until 「分享结果」.
 *
 * Contract expected of the renderer: `renderResultCard(input: ResultCardInput)`
 * returning (a promise of) a Blob, a canvas, a data: URL or `{ blob }`.
 * Kept out of `lib/result-share.ts` so node tests import that without Vite.
 */
import type { ResultCardInput } from './result-share.js';

type ResultRenderer = (input: ResultCardInput) => unknown;

const modules = import.meta.glob('./share-card.ts');

export async function loadResultCardRenderer(): Promise<ResultRenderer | null> {
  const load = modules['./share-card.ts'];
  if (!load) return null;
  try {
    const mod = (await load()) as { renderResultCard?: unknown };
    return typeof mod.renderResultCard === 'function' ? (mod.renderResultCard as ResultRenderer) : null;
  } catch {
    return null;
  }
}
