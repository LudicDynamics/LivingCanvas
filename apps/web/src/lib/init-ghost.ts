import type { LayerItem } from '../state/useWorld.js';
import { CARD_FORMS } from '@airp/shared/forms';
import { phantomSeatFor } from './phantom-seat.js';

/**
 * The provisional card shown while an I1 initialiser is materialising a stub
 * layer. "Taking shape…" fills the 45–60s
 * wait that would otherwise read as a frozen canvas.
 *
 * Purely client-side: the returned item is rendered OUTSIDE `items`, is never
 * persisted, never measured, and never a collision input. Its `path` is a
 * synthetic id that MUST NOT look like a real file:
 *   - it is not under any layer's md scan, and
 *   - it is never `.md`-terminated (layers.ts scans `endsWith('.md')`).
 *
 * Seat comes from `phantomSeatFor`, the ONE seater for provisional cards
 * (contract the design notes). It is the required seam:
 * a second seater — including an ad-hoc anchor placement — MUST NOT appear here.
 * Today `phantomSeatFor` spirals from `SEAT_ANCHOR`, which on an empty stub layer
 * yields the anchor cell; when the layout batch replaces its internals with
 * `flowColumns`, this ghost follows with no change.
 */
export function ghostItemFor(layer: string, label: string): LayerItem {
  const { w, h } = CARD_FORMS.gate;
  const { seat } = phantomSeatFor({ w, h }, layer);
  return {
    path: `__init__/${layer}`,
    filename: 'README.md',
    kind: 'gate',
    frontmatter: { type: 'readme', stub: true, name: layer.split('/').pop() || layer },
    body: label,
    x: seat.x,
    y: seat.y,
    w: seat.w,
    h: seat.h,
    z: seat.z,
    rot: 0,
  };
}
