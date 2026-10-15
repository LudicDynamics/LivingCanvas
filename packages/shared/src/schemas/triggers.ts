/**
 * World triggers — `world.json` `triggers[]`.
 *
 * One trigger = 条件 → 后果 → 兜底:
 *   - `kind` + `when` — the condition (five kinds, below);
 *   - `do` (a `command/<id>.yaml`) and/or `ending` (shorthand for the `end` effect) — the consequence;
 *   - `fallback` — words that guarantee a non-empty outcome when nothing else is narrated.
 *
 * Kinds and their `when`:
 *   - `clock`   — `"clock <= 3"` (the same grammar as `endings[].when`);
 *   - `state`   — the command condition algebra over `has("…")`, `clues.held`,
 *                 `clock.left`, `player.<id>`, `world.<id>`, `<characterId>.<id>`;
 *   - `keyword` — `{ intent, scope?, layers? }`: judged BY MEANING by the writer,
 *                 which calls `trigger_keyword({ id })`; the engine never sees text;
 *   - `place`   — `{ layer }`: the player's first entry into that layer;
 *   - `dice`    — `{ card?, layer?, band?, passed?, fumble?, crit? }`: a resolved roll.
 *
 * Pure schema + static parse; the engine is `commands/world-triggers.ts`.
 */
import { z } from 'zod';
import { CLOCK_WHEN_RE } from './world.js';

export const TRIGGER_KINDS = ['clock', 'state', 'keyword', 'place', 'dice'] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const TRIGGER_ID_RE = /^[a-z][a-z0-9-]{0,47}$/;
const COMMAND_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ENDING_ID = /^[a-z][a-z0-9-]*$/;
const LAYER = /^(map|world(\/[A-Za-z0-9_.-]+)*)$/;
const WORLD_PATH = /^(world|player|characters)\/[A-Za-z0-9_./-]+$/;
const ASSET_PATH = /^assets\/[A-Za-z0-9_./-]+\.(webp|png|jpg|jpeg|gif|webm|mp4)$/;

export const TRIGGER_DICE_BANDS = ['failure', 'setback', 'success', 'great'] as const;
export type TriggerDiceBand = (typeof TRIGGER_DICE_BANDS)[number];

export const KeywordWhenSchema = z
  .object({
    /** What the player must MEAN — natural language, shown to the writer as-is. */
    intent: z.string().min(2).max(200),
    /** `player`: only the player's own words/actions count. `any`: a character's too. */
    scope: z.enum(['player', 'any']).default('player'),
    /** Only while the player is in one of these layers. Absent: anywhere. */
    layers: z.array(z.string().regex(LAYER)).min(1).max(12).optional(),
  })
  .strict();

export const PlaceWhenSchema = z.object({ layer: z.string().regex(LAYER) }).strict();

export const DiceWhenSchema = z
  .object({
    /** A card path, or a directory prefix ending in `/` (every card under it). */
    card: z.string().regex(WORLD_PATH).optional(),
    /** Any roll made in this layer. */
    layer: z.string().regex(LAYER).optional(),
    /** The four-grade band of the world's dice convention. */
    band: z.enum(TRIGGER_DICE_BANDS).optional(),
    passed: z.boolean().optional(),
    fumble: z.boolean().optional(),
    crit: z.boolean().optional(),
  })
  .strict()
  .refine((w) => Object.keys(w).length > 0, 'a dice trigger needs at least one of card, layer, band, passed, fumble, crit');

export const TriggerAssetSchema = z
  .object({
    kind: z.enum(['cg', 'background', 'item', 'portrait']),
    /** World-relative, under `assets/`; must exist when the world is published (check:worlds). */
    path: z.string().regex(ASSET_PATH).refine((p) => !p.includes('..'), 'no ".." in an asset path'),
    /** The generation prompt, kept so the asset can be regenerated. */
    prompt: z.string().min(1).max(2000),
  })
  .strict();
export type TriggerAsset = z.infer<typeof TriggerAssetSchema>;

const TriggerBase = {
  id: z.string().regex(TRIGGER_ID_RE),
  /** Author-facing name (the authoring panel, receipts). */
  label: z.string().min(1).max(80).optional(),
  /** Default true: fires at most once per save. false: re-arms once its condition stops holding. */
  once: z.boolean().default(true),
  /** A `command/<id>.yaml` to run — the consequence, through the ordinary command runner. */
  do: z.string().regex(COMMAND_ID).optional(),
  /** Shorthand for a one-step `end` command: reach this `world.json` ending. */
  ending: z.string().regex(ENDING_ID).optional(),
  assets: z.array(TriggerAssetSchema).max(8).optional(),
  /** Always-available words: landed as a story event when the consequence narrates nothing. */
  fallback: z.string().min(1).max(2000).optional(),
};

export const TriggerSchema = z
  .discriminatedUnion('kind', [
    z.object({ ...TriggerBase, kind: z.literal('clock'), when: z.string().regex(CLOCK_WHEN_RE, 'a clock trigger is "clock <op> <integer>"') }).strict(),
    z.object({ ...TriggerBase, kind: z.literal('state'), when: z.string().min(1).max(200), clues: z.array(z.string().regex(/^(world|player)\/[A-Za-z0-9_./-]+\.md$/)).max(24).optional() }).strict(),
    z.object({ ...TriggerBase, kind: z.literal('keyword'), when: KeywordWhenSchema }).strict(),
    z.object({ ...TriggerBase, kind: z.literal('place'), when: PlaceWhenSchema }).strict(),
    z.object({ ...TriggerBase, kind: z.literal('dice'), when: DiceWhenSchema }).strict(),
  ])
  .superRefine((t, ctx) => {
    // A cg / background asset is a consequence too: without `do`, the engine shows it (触发器.md §8.1).
    const shows = (t.assets ?? []).some((a) => a.kind === 'cg' || a.kind === 'background');
    if (t.do === undefined && t.ending === undefined && t.fallback === undefined && !shows) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['do'], message: 'a trigger needs a consequence: do, ending, fallback, or a cg / background asset' });
    }
  });
export type WorldTrigger = z.infer<typeof TriggerSchema>;
export type KeywordTrigger = Extract<WorldTrigger, { kind: 'keyword' }>;

export interface TriggerParse {
  triggers: WorldTrigger[];
  errors: string[];
}

/** Read `world.json` `triggers` fail-soft: a bad entry is dropped with a message, the rest still work. */
export function parseWorldTriggers(raw: unknown): TriggerParse {
  if (raw === undefined || raw === null) return { triggers: [], errors: [] };
  if (!Array.isArray(raw)) return { triggers: [], errors: ['triggers must be a list'] };
  const triggers: WorldTrigger[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    const r = TriggerSchema.safeParse(entry);
    if (!r.success) {
      const id = typeof (entry as { id?: unknown })?.id === 'string' ? ` "${(entry as { id: string }).id}"` : '';
      errors.push(`triggers[${i}]${id}: ${r.error.issues.map((x) => `${x.path.join('.') || '(entry)'} ${x.message}`).join('; ')}`);
      return;
    }
    if (seen.has(r.data.id)) {
      errors.push(`triggers[${i}]: duplicate trigger id "${r.data.id}"`);
      return;
    }
    seen.add(r.data.id);
    triggers.push(r.data);
  });
  return { triggers, errors };
}
