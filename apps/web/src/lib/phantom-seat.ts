/**
 * Phantom seating — the ONE adapter for provisional cards.
 *
 * Phantom seats and server seats use the same shared `flowColumns` geometry.
 * The input set differs: the front end sees the last fetched rows plus
 * currently active phantoms, while the server sees its own database view.
 * A real refetch remains authoritative during handover.
 */

import { flowColumns, type AutoLayoutRect } from '@airp/shared/layout';
import { getPhantomsSnapshot, type PhantomSeat } from './phantom.js';
import { makeBox, overlap } from './collide.js';
import { SEAT_ANCHOR, seatSpiral } from './seat.js';

/** Measure complete provisional text before paint. Only its own DOM moves;
 * real card seats remain server-owned and win when the file arrives. */
export function fitPhantom(el: HTMLElement): void {
  const siblings = el.parentElement?.querySelectorAll<HTMLElement>('.object[data-path], .object--ghost') ?? [];
  const occupied = [...siblings].filter(other => other !== el)
    .map(other => makeBox(other.offsetLeft, other.offsetTop, other.offsetWidth, other.offsetHeight));
  const box = makeBox(el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight);
  if (!occupied.some(other => overlap(box, other))) return;
  const seat = seatSpiral(SEAT_ANCHOR, occupied, box.w, box.h);
  el.style.left = `${seat.x}px`;
  el.style.top = `${seat.y}px`;
}

/** Current layer's rows, published by `useWorld` after each successful fetch. */
interface SeatItem {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

let seatLayer: string | undefined;
let seatItems: readonly SeatItem[] = [];

/**
 * `useWorld` publishes the current layer's rows after `fetchLayer` succeeds.
 * The layer is recorded: if `phantomSeatFor` is asked about a different layer,
 * stale rows are ignored rather than pushing a phantom away from its layer.
 */
export function publishSeatItems(layer: string, items: readonly SeatItem[]): void {
  seatLayer = layer;
  seatItems = items;
}

/**
 * Allocate one provisional seat from the shared column flow.
 *
 * Existing rows and every non-evicted phantom in this layer are obstacles.
 * The returned occupied snapshot is the exact obstacle set supplied to
 * `flowColumns`; callers must not use it as a second seating algorithm.
 */
export function phantomSeatFor(
  size: { w: number; h: number },
  layer: string
): { seat: PhantomSeat; occupied: AutoLayoutRect[] } {
  const items = seatLayer === layer ? seatItems : [];
  const occupied: AutoLayoutRect[] = [
    ...items.map((it) => ({ x: it.x, y: it.y, w: it.w, h: it.h })),
    ...getPhantomsSnapshot()
      .filter((p) => p.phase !== 'evicted' && (p.layer === undefined || p.layer === layer))
      .map((p) => ({
        id: p.toolCallId,
        x: p.seat.x,
        y: p.seat.y,
        w: p.seat.w,
        h: p.seat.h,
      })),
  ];
  const candidate = { id: `phantom:${layer}`, w: size.w, h: size.h };
  const result = flowColumns([candidate], occupied);
  const placement = result.placements[0];
  if (!placement) {
    throw new Error('flowColumns returned no placement for a phantom');
  }
  if (result.exhausted) {
    console.warn(`Phantom layout exhausted for layer ${layer}; using the final candidate`);
  }
  const z = 1 + items.reduce((m, it) => Math.max(m, it.z), 0);
  return {
    seat: { x: placement.x, y: placement.y, w: placement.w, h: placement.h, z },
    occupied,
  };
}
