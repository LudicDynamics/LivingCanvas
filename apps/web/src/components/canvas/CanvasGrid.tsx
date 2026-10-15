import { useEffect, useRef } from 'react';
import type { CameraApi, CamView } from '../../state/useCamera.js';
import { probeCount } from '../../lib/frame-probe.js';
import { visibleWorldBounds, Z_MAX } from '../../lib/camera.js';

/** Grid cell in world px (matches the old 80px hairline pitch). */
const CELL = 80;
/**
 * Sheet bleed in screen px. The flat-canvas sheet is a fixed viewport sheet
 * (inset: -BLEED) that never resizes; BLEED only has to exceed the largest
 * pitch the zoom range can produce (CELL * Z_MAX = 176px) so the sheet still
 * covers the viewport at the worst pan phase. Must stay in sync with the
 * `.canvas-grid--sheet` inset in index.css.
 */
const BLEED = 192;

/**
 * World-anchored 80px hairline grid.
 *
 * History: the original `.canvas-grid` was a 6000×6000 div parked in the world
 * transform layer (one giant per-frame re-raster). The second shape shrank the
 * sheet to a viewport of slack and rewrote left/top/width/height as the camera
 * moved — but on real machines the per-zoom-frame resize forced a layout pass
 * plus a full re-raster of the sheet (a ~10-megapixel layer at DPR 2.25), which
 * the frame probe measured as 20-40ms of every animated frame while the CPU
 * and GPU sat mostly idle.
 *
 * The flat canvas therefore uses a third shape: the sheet is fixed at
 * viewport + 2×BLEED and never resizes. Each frame writes ONE compositor
 * transform (the pan phase, folded to within one pitch so the sheet always
 * covers the viewport) and, only when zoom actually changes, one
 * background-size — the sole repaint signal. The hairlines stay pinned to the
 * world because the phase is derived from the same (w - cam) * z + vw/2
 * projection the world layer uses.
 *
 * The map projection cannot use that shortcut: the floor matrix warps the grid
 * plane, so it keeps the viewport-following sheet computed from
 * visibleWorldBounds, parked inside the world transform layer. `surface` picks
 * the mount point; the inactive surface renders nothing. Today only 'canvas'
 * is reachable (useCamera pins sharedProjection); the world mount keeps that
 * contract honest.
 */
export const CanvasGrid: React.FC<{ camera: CameraApi; surface: 'viewport' | 'world' }> = ({ camera, surface }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const wantsViewportSheet = surface === 'viewport';
  // Only the mount matching the live projection renders and subscribes; the
  // projection itself never flips at runtime (useCamera pins it), so a
  // non-reactive read here is exact.
  const active = wantsViewportSheet === (camera.getProjection() === 'canvas');

  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    let lastZ = Number.NaN;
    let lastTx = Number.NaN;
    let lastTy = Number.NaN;
    const paint = (view: CamView): void => {
      const style = el.style;
      if (wantsViewportSheet && view.projection === 'canvas') {
        const pitch = CELL * view.z;
        // The hairline at world x = k*CELL must land on screen at
        // (k*CELL - view.x) * z + vw/2; since k*CELL*z is a multiple of the
        // pitch, the sheet origin only has to sit at rawX modulo the pitch.
        // Folding that phase into translate3d keeps the write compositor-only.
        const rawX = view.vw / 2 - view.x * view.z + BLEED;
        const rawY = view.vh / 2 - view.y * view.z + BLEED;
        const tx = rawX - Math.floor(rawX / pitch) * pitch - pitch;
        const ty = rawY - Math.floor(rawY / pitch) * pitch - pitch;
        if (view.z !== lastZ) {
          lastZ = view.z;
          style.backgroundSize = `${pitch}px ${pitch}px`;
          probeCount('gridWrite');
        }
        if (tx !== lastTx || ty !== lastTy) {
          lastTx = tx;
          lastTy = ty;
          style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
        }
        return;
      }
      // Map projection: viewport-following sheet inside the world layer.
      // Pulled back to the enclosing grid line: left/top always land on a
      // multiple of CELL, so the hairlines stay pinned to the world (no
      // sub-pixel crawl while panning).
      const bounds = visibleWorldBounds(view.vw, view.vh, view, view.projection);
      const left = Math.floor(bounds.left / CELL) * CELL;
      const top = Math.floor(bounds.top / CELL) * CELL;
      // Style writes invalidate layout even when the value is unchanged; the
      // publisher fires while the camera eases, and pans often land on the
      // same sheet, so skip no-op writes.
      const width = (bounds.right - left) + CELL * 2;
      const height = (bounds.bottom - top) + CELL * 2;
      // Count only real writes: the probe separates "publish fired" from
      // "the sheet actually moved/resized" (a resize is the re-raster signal).
      if (style.left !== `${left}px` || style.top !== `${top}px` || style.width !== `${width}px` || style.height !== `${height}px`) probeCount('gridWrite');
      if (style.left !== `${left}px`) style.left = `${left}px`;
      if (style.top !== `${top}px`) style.top = `${top}px`;
      if (style.width !== `${width}px`) style.width = `${width}px`;
      if (style.height !== `${height}px`) style.height = `${height}px`;
    };
    return camera.subscribe(paint);
  }, [camera, wantsViewportSheet, active]);

  if (!active) return null;
  if (wantsViewportSheet) {
    // Canvas projection mount: background surface, beneath the cards.
    return (
      <div className="canvas-grid-viewport" aria-hidden="true">
        <div ref={ref} className="canvas-grid canvas-grid--sheet" />
      </div>
    );
  }
  // World-layer mount for the map projection.
  return <div ref={ref} className="canvas-grid" />;
};
