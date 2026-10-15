/**
 * Cached element-box measurement.
 *
 * Card roots carry an inline `left/top/width` (CanvasObject writes them from the
 * server row), but NO inline height — the shell hugs its card per the §7.5 size
 * contract. So anything needing the rendered height (`elSize` during a drag,
 * `readBox` in LinkLayer) had to read `offsetHeight`/`getBoundingClientRect`,
 * and those reads sat after the drag's own `style.left/top` writes: every
 * pointermove forced a synchronous reflow of the document. A drag profile
 * showed `get offsetHeight` as the single largest cost (~6 forced reflows per
 * move).
 *
 * This cache measures an element's box ONCE per generation and reuses it.
 * Invalidate on anything that can change a card's rendered size — a layer
 * fetch, a resize. Positions are always read from inline style (free), never
 * from `offsetLeft` while a value is available, so the steady-state drag loop
 * performs zero layout reads.
 */

export interface ElementBox {
  l: number;
  t: number;
  w: number;
  h: number;
}

/** Bumped whenever element sizes may have changed (layer refresh, resize). */
let generation = 0;

const cache = new WeakMap<HTMLElement, { gen: number; w: number; h: number }>();

/** Drop every cached measurement (call on card-set change / viewport resize). */
export function invalidateMeasures(): void {
  generation++;
}

function stylePx(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Measured box in world px: inline left/top + cached rendered width/height. */
export function elementBox(el: HTMLElement): ElementBox {
  const l = stylePx(el.style.left) ?? el.offsetLeft ?? 0;
  const t = stylePx(el.style.top) ?? el.offsetTop ?? 0;
  const styleW = stylePx(el.style.width);
  const styleH = stylePx(el.style.height);

  const hit = cache.get(el);
  if (hit && hit.gen === generation) {
    // Dimensions are cached independently: cards always carry an inline width
    // but no inline height, so a height-only cache miss must not re-read the
    // width too — and an inline dimension never needs the DOM at all.
    return {
      l,
      t,
      w: styleW ?? hit.w,
      h: styleH ?? hit.h,
    };
  }

  // First measurement this generation: ONE forced layout read, reused until
  // invalidation. offsetWidth/offsetHeight are untransformed layout px — the
  // world units this cache serves (getBoundingClientRect is zoom-scaled).
  const w = styleW ?? el.offsetWidth;
  const h = styleH ?? el.offsetHeight;
  cache.set(el, { gen: generation, w, h });
  return { l, t, w, h };
}
