/**
 * Canvas state shapes (doc-09). Links and card seating live ONLY in
 * `canvas.db` — there is no markdown body for a line and no event row for a
 * link, so these types are the whole contract of the canvas domain.
 *
 * Lives in `schemas/` (next to `events.ts`), not `actions/`: `store/` imports
 * `LinkRecord`, and `store/` must never import from `actions/` (same rule as
 * `DanglingRef` in 01 §6.2).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * `lnk-` + sha1(layer|from|to)[0:8]. Deterministic on purpose: the same
 * endpoint pair in the same layer has ONE identity, so `link({op:'create'})`
 * is idempotent and two agent processes racing on it compute the same PK
 * (doc-09 §3.1). Direction is part of the identity; `style` is not — a
 * restyle must not change a line's id, or `update` could never find it.
 *
 * Also the front end's hand-drawn jitter seed (`LinkLayer` hashes the id), so
 * one line must always hash to one id.
 *
 * Deviates from doc-09 §8.1, which lists this among `actions/canvas.ts`'s pure
 * functions: `store/local-store.ts` needs it for the default id, and `store/`
 * may not import from `actions/`. Same reason `LinkRecord` lives here.
 */
export function linkIdOf(layer: string, from: string, to: string): string {
  const digest = createHash('sha1').update(`${layer}|${from}|${to}`).digest('hex');
  return `lnk-${digest.slice(0, 8)}`;
}

/** Tool-facing style presets (doc-09 §2.2) — the words the model writes. */
export const LINK_STYLE_TOKENS = [
  'solid',
  'dashed',
  'arrow',
  'bold',
  'red',
  'hand',
  'thread',
  'road',
] as const;
export type LinkStyle = (typeof LINK_STYLE_TOKENS)[number];

/** Override stroke colours (doc-09 §2.2); `null` = the style's own default. */
export const LINK_COLORS = ['ink', 'rust', 'blue', 'sage'] as const;
export type LinkColor = (typeof LINK_COLORS)[number];

/**
 * What actually lands in `links.style` (doc-09 §2.4): the renderer's smaller
 * primitive set. `arrow` and `red` are tool-facing sugar that normalize into
 * `(ink, directed)` / `(ink, rust)` and never reach the table.
 */
export const LINK_PRIMITIVE_STYLES = [
  'ink',
  'dashed',
  'bold',
  'hand',
  'thread',
  'road',
] as const;
export type LinkPrimitiveStyle = (typeof LINK_PRIMITIVE_STYLES)[number];

/** One normalized `links` row, snake_case columns already mapped. */
export interface LinkRecord {
  id: string;
  layer: string;
  from: string;
  to: string;
  style: LinkPrimitiveStyle;
  color: LinkColor | null;
  directed: boolean;
  z: number;
  label: string | null;
}

/** Action-layer input of `linkCards` (doc-09 §2.7). */
export interface LinkInput {
  op: 'create' | 'update' | 'delete';
  from?: string;
  to?: string;
  id?: string;
  style?: LinkStyle;
  color?: LinkColor;
  directed?: boolean;
  label?: string;
}

/** The three relative re-flow modes (01 §5 row 13; object form per doc-09 §2.7). */
export const LAYOUT_MODES = ['grid', 'circle', 'row'] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

/**
 * Action-layer input of `arrangeCards` (doc-09 §2.7).
 * `place` and `layout` are mutually exclusive and the action layer — not the
 * typebox shell — enforces it: `POST /api/card/position` bypasses the schema.
 */
export interface ArrangeInput {
  /** Absolute write. Shared with the player drag route. */
  place?: { path: string; x?: number; y?: number; z?: number };
  /** Relative re-flow. Mutually exclusive with `place`. */
  layout?: { mode: LayoutMode; layer?: string; paths?: string[] };
  /** Frozen in plan §4 for compatibility; B1 rejects with `unsupported` (§11 冲突 1). */
  w?: number;
  h?: number;
}

export const LinkRecordSchema = z.object({
  id: z.string(),
  layer: z.string(),
  from: z.string(),
  to: z.string(),
  style: z.enum(LINK_PRIMITIVE_STYLES),
  color: z.enum(LINK_COLORS).nullable(),
  directed: z.boolean(),
  z: z.number(),
  label: z.string().nullable(),
});

export const LinkInputSchema = z.object({
  op: z.enum(['create', 'update', 'delete']),
  from: z.string().optional(),
  to: z.string().optional(),
  id: z.string().optional(),
  style: z.enum(LINK_STYLE_TOKENS).optional(),
  color: z.enum(LINK_COLORS).optional(),
  directed: z.boolean().optional(),
  label: z.string().optional(),
});

export const ArrangeInputSchema = z.object({
  place: z
    .object({
      path: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      z: z.number().optional(),
    })
    .optional(),
  layout: z
    .object({
      mode: z.enum(LAYOUT_MODES),
      layer: z.string().optional(),
      paths: z.array(z.string()).optional(),
    })
    .optional(),
  w: z.number().optional(),
  h: z.number().optional(),
});
