import React, { useEffect, useRef } from 'react';
import type { LayerLink } from '../../state/useWorld.js';
import { elementBox } from '../../lib/measure.js';

/**
 * Relationship-line layer (v2 prototype §1.3). A module-level registry maps
 * link id → { endpoint elements, path element } so the drag hot path can call
 * updateAllLinks() with zero React round-tripping. The SVG lives INSIDE the
 * world transform layer (world coordinates, scales with the camera).
 *
 * Endpoint elements are looked up by `data-path` from the DOM on each registry
 * rebuild (driven by the `links` prop), which keeps mount/unmount bookkeeping
 * entirely local to this layer — CanvasObject only needs to expose data-path.
 *
 * Geometry is hand-drawn, not a smooth bezier: the straight-line midpoint is
 * pushed along the normal by a deterministic per-link offset (proto roadPath,
 * L700-705). Jitter is handwriting, not noise — the same link bends the same
 * way on every render and drag.
 */

export const LINK_SVG_CLASS = 'links-svg';

interface RegisteredLink {
  a: HTMLElement;
  b: HTMLElement;
  pathEl: SVGPathElement;
  dotA: SVGCircleElement;
  dotB: SVGCircleElement;
  /** The player's line label (clue style only). */
  labelEl: SVGTextElement | null;
  seed: number;
  link: LayerLink;
}

const registry: Map<string, RegisteredLink> = new Map();

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Stroke variable per link style; unknown styles fall back to ink. */
const LINK_STROKES: Record<string, string> = {
  solid: 'var(--ink)',
  dashed: 'var(--rust)',
  blue: 'var(--blue)',
  // The player's clue-board thread.
  clue: '#b3261e',
};

/** FNV-1a string hash — stable 32-bit seed for the hand-drawn jitter. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — deterministic 0..1 stream from a 32-bit seed. */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hand-drawn road (proto roadPath L700-705): offset the midpoint along the
 * line normal by (rand*2-1) * min(70, len*0.22), then emit a quadratic curve.
 * Deterministic for a given seed, so a link's bend never changes frame to frame.
 */
function roadPath(ax: number, ay: number, bx: number, by: number, seed: number): string {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const off = (mulberry32(seed)() * 2 - 1) * Math.min(70, len * 0.22);
  const qx = mx - (dy / len) * off;
  const qy = my + (dx / len) * off;
  return `M ${ax} ${ay} Q ${qx} ${qy} ${bx} ${by}`;
}

/**
 * Hand-drawn path for a `show_frame` thread. Exposes
 * `roadPath` so evidence_burst lines use the SAME deterministic curve language
 * as relationship lines instead of a second bespoke bezier.
 */
export function handDrawnPath(ax: number, ay: number, bx: number, by: number, seed: number): string {
  return roadPath(ax, ay, bx, by, seed);
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Edge anchors for a link: right/left edges pointing at the other card, or
 * top/bottom when the two cards are near-vertical neighbours. The proto joins
 * gate circle centres; our cards need a visible edge anchor instead.
 */
function endpoints(A: Box, B: Box): { ax: number; ay: number; bx: number; by: number } {
  const dCx = B.x + B.w / 2 - (A.x + A.w / 2);
  const dCy = B.y + B.h / 2 - (A.y + A.h / 2);

  if (Math.abs(dCx) < 80) {
    // Near-vertical alignment: attach top/bottom edges.
    return {
      ax: A.x + A.w / 2,
      ay: dCy >= 0 ? A.y + A.h : A.y,
      bx: B.x + B.w / 2,
      by: dCy >= 0 ? B.y : B.y + B.h,
    };
  }
  // Horizontal attachment: right/left edges pointing at the other card.
  return {
    ax: dCx >= 0 ? A.x + A.w : A.x,
    ay: A.y + A.h / 2,
    bx: dCx >= 0 ? B.x : B.x + B.w,
    by: B.y + B.h / 2,
  };
}

function elForPath(path: string): HTMLElement | null {
  if (!path) return null;
  // A character presence as a clue-board endpoint: `characters/<id>`.
  const character = /^characters\/([a-z0-9][a-z0-9-]*)$/.exec(path);
  if (character) {
    try {
      return document.querySelector(`[data-presence-id="${CSS.escape(character[1])}"]`);
    } catch {
      return null;
    }
  }
  try {
    return document.querySelector(`.object[data-path="${CSS.escape(path)}"]`);
  } catch {
    return null;
  }
}

/** A card's world-space box by world-relative path, or null when it is not on
 * the current layer's DOM. Pairs `elForPath` + the
 *  cached `readBox` so a performance does not force a reflow per read. */
export function cardGeometry(path: string): { x: number; y: number; w: number; h: number } | null {
  const el = elForPath(path);
  if (!el) return null;
  return readBox(el);
}

/** Presence nodes sit at a CENTRE written into `transform` (presence-node.ts). */
const PRESENCE_BOX = 64;
function presenceBox(el: HTMLElement): Box | null {
  if (!el.hasAttribute('data-presence-id')) return null;
  const m = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(el.style.transform);
  if (!m) return null;
  return { x: Number(m[1]) - PRESENCE_BOX / 2, y: Number(m[2]) - PRESENCE_BOX / 2, w: PRESENCE_BOX, h: PRESENCE_BOX };
}

function readBox(el: HTMLElement): Box {
  const presence = presenceBox(el);
  if (presence) return presence;
  // Cached measure: offsetWidth/Height here forced a reflow on every
  // updateAllLinks() — which runs on each drag move.
  const b = elementBox(el);
  return { x: b.l, y: b.t, w: b.w, h: b.h };
}

/** Recompute every registered link's hand-drawn path from live DOM layout. */
export function updateAllLinks(): void {
  for (const r of registry.values()) {
    if (!r.a.isConnected || !r.b.isConnected) continue;
    const { ax, ay, bx, by } = endpoints(readBox(r.a), readBox(r.b));
    r.pathEl.setAttribute('d', roadPath(ax, ay, bx, by, r.seed));
    r.dotA.setAttribute('cx', String(ax));
    r.dotA.setAttribute('cy', String(ay));
    r.dotB.setAttribute('cx', String(bx));
    r.dotB.setAttribute('cy', String(by));
    if (r.labelEl) {
      // Same quadratic as roadPath: the curve's midpoint is (a + 2q + b) / 4.
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const off = (mulberry32(r.seed)() * 2 - 1) * Math.min(70, len * 0.22);
      const qx = (ax + bx) / 2 - ((by - ay) / len) * off;
      const qy = (ay + by) / 2 + ((bx - ax) / len) * off;
      r.labelEl.setAttribute('x', String((ax + 2 * qx + bx) / 4));
      r.labelEl.setAttribute('y', String((ay + 2 * qy + by) / 4 - 6));
    }
  }
}

/** Toggle .thread-active on every link touching `path` (v2 L275-276). */
export function highlightLinks(path: string, on: boolean): void {
  for (const r of registry.values()) {
    if (r.link.from === path || r.link.to === path) {
      r.pathEl.classList.toggle('thread-active', on);
    }
  }
}

/**
 * The most recently arrived dashed link becomes .thread-latest; every older
 * dashed link fades out as .thread-archived (v2 L256). Registry insertion
 * order follows the `links` array, so "last" = last row in the payload.
 */
export function refreshLinkArchives(): void {
  const dashed = [...registry.values()].filter((r) => r.link.style === 'dashed');
  dashed.forEach((r, idx) => {
    r.pathEl.classList.remove('thread-archived', 'thread-latest');
    if (idx === dashed.length - 1) {
      r.pathEl.classList.add('thread-latest');
    } else {
      r.pathEl.classList.add('thread-archived');
    }
  });
}

function buildPaths(svg: SVGSVGElement, links: LayerLink[]): void {
  for (const r of registry.values()) {
    r.pathEl.remove();
    r.dotA.remove();
    r.dotB.remove();
    r.labelEl?.remove();
  }
  registry.clear();

  for (const link of links) {
    const a = elForPath(link.from);
    const b = elForPath(link.to);
    if (!a || !b) continue; // dangling link: DB row kept, nothing rendered

    // Inline style, not a presentation attribute: CSS custom properties only
    // resolve in real CSS, not in attribute values.
    const stroke = LINK_STROKES[link.style] ?? 'var(--ink)';

    const pathEl = document.createElementNS(SVG_NS, 'path');
    pathEl.setAttribute('fill', 'none');
    pathEl.style.stroke = stroke;
    pathEl.setAttribute('stroke-width', '1.6');
    pathEl.setAttribute('stroke-linecap', 'round');
    pathEl.classList.add('thread-line');
    if (link.style === 'dashed') pathEl.classList.add('thread-dashed');
    const clue = link.style === 'clue';
    if (clue) {
      pathEl.classList.add('thread-clue');
      pathEl.setAttribute('stroke-width', '2.4');
      pathEl.dataset.clueLink = link.id;
    }

    const dotA = document.createElementNS(SVG_NS, 'circle');
    const dotB = document.createElementNS(SVG_NS, 'circle');
    for (const dot of [dotA, dotB]) {
      dot.setAttribute('r', '3');
      dot.style.fill = stroke;
      dot.style.opacity = '0.45';
    }

    svg.appendChild(pathEl);
    svg.appendChild(dotA);
    svg.appendChild(dotB);
    let labelEl: SVGTextElement | null = null;
    if (clue && link.label) {
      labelEl = document.createElementNS(SVG_NS, 'text');
      labelEl.setAttribute('text-anchor', 'middle');
      labelEl.classList.add('clue-label');
      labelEl.dataset.clueLink = link.id;
      labelEl.textContent = link.label;
      svg.appendChild(labelEl);
    }
    // Seed from the link id: same link always bends at the same spot.
    registry.set(link.id, { a, b, pathEl, dotA, dotB, labelEl, seed: hash(link.id), link });
  }

  refreshLinkArchives();
  updateAllLinks();
}

export const LinkLayer: React.FC<{ links: LayerLink[] }> = ({ links }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    buildPaths(svg, links);
    return () => {
      for (const r of registry.values()) {
        r.pathEl.remove();
        r.dotA.remove();
        r.dotB.remove();
        r.labelEl?.remove();
      }
      registry.clear();
    };
  }, [links]);

  return (
    <svg
      ref={svgRef}
      className={LINK_SVG_CLASS}
      width={0}
      height={0}
      style={{ overflow: 'visible', position: 'absolute', left: 0, top: 0 }}
    />
  );
};
