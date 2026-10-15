/**
 * Web-font readiness gate.
 *
 * Font metrics decide line wrapping, and line wrapping decides a card's height
 * — the measured footprint. Probing the same paragraph before/after Caveat
 * lands showed 355px vs 291px (−18%), so anything that feeds `offsetHeight`
 * into persisted data MUST wait for the fonts to settle first.
 *
 * Two rules keep this safe to await from a render effect:
 *   - it NEVER rejects: a font failure must not block measurement, because the
 *     fallback metrics are still measurable;
 *   - it NEVER hangs: the timeout always resolves.
 */

/** Resolve when web fonts are usable for layout. Never rejects. */
export function whenFontsReady(): Promise<void> {
  try {
    const fonts = document.fonts;
    if (!fonts || !fonts.ready) return Promise.resolve();
    return Promise.resolve(fonts.ready).then(
      () => undefined,
      () => undefined
    );
  } catch {
    return Promise.resolve();
  }
}

/**
 * `whenFontsReady()` + ONE animation frame.
 *
 * The extra frame matters: `document.fonts.ready` can resolve in the same task
 * that triggers the reflow, so an `offsetHeight` read a microtask later may
 * still see pre-layout geometry. One frame guarantees layout actually ran.
 *
 * Returns `'ready'` on the happy path, `'timeout'` when the budget elapses
 * first (never throws, never hangs).
 */
export function whenFontsSettled(timeoutMs = 1500): Promise<'ready' | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  const settled = whenFontsReady()
    .then(
      () =>
        new Promise<void>((resolve) => {
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
          } else {
            setTimeout(resolve, 0);
          }
        })
    )
    .then((): 'ready' => 'ready');

  return Promise.race([settled, budget]).finally(() => clearTimeout(timer));
}
