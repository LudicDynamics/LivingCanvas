/**
 * Guided experiences: the world.json pieces the first-run
 * prologue added as generic features any world can use — `opening.replies`
 * (tappable first replies) and `experience` (kind, where the ending leads, the
 * turn-end command). Pure (zod only): the page imports it as `@airp/shared/experience`.
 */
import { z } from 'zod';

/**
 * `opening.replies`: one list, or one list per interface locale. At most three replies. A reply is a line the
 * player says to the greeter (a string), or `{ text, to }`: `to: writer` makes it a move for
 * the writer's tray instead; `to: <character id>` says it to someone else.
 */
const ReplyText = z.string().trim().min(1).max(80);
const ReplyItem = z.union([ReplyText, z.object({ text: ReplyText, to: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional() }).strict()]);
const ReplyLines = z.array(ReplyItem).min(1).max(3);
export const OpeningRepliesSchema = z.union([ReplyLines, z.record(z.string(), ReplyLines)]);
export type OpeningReplies = z.infer<typeof OpeningRepliesSchema>;

/** One opening reply, routed: `to` is the greeter for a plain string. */
export interface OpeningReply { text: string; to: string }

/**
 * `prologue`: the first-run guided world. `story`: any world that only wants the turn-end command (a counted
 * beat its triggers can read, e.g. 末班车's 「4 beats in car 2 → show the way out」); none of the prologue's chrome.
 */
export const WORLD_EXPERIENCE_KINDS = ['prologue', 'story'] as const;
export const WorldExperienceSchema = z.object({
  kind: z.enum(WORLD_EXPERIENCE_KINDS),
  next: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  maxTurns: z.number().int().min(1).max(50).optional(),
  turnEnd: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/).optional(),
}).strict();
export type WorldExperience = z.infer<typeof WorldExperienceSchema>;

/**
 * The replies to show for `locale` (pure): a plain list as it is; a per-locale
 * map → that locale, else the world's own language, else English, else the first.
 */
export function openingRepliesFor(replies: unknown, locale: string, worldLocale?: string | null): string[] {
  return openingReplyItemsFor(replies, locale, worldLocale, 'greeter').filter((r) => r.to !== 'writer').map((r) => r.text);
}

/**
 * Every opening reply for `locale`, routed (pure): a plain string goes to `greeter` (pass the greeter's id);
 * an object keeps its `to` (absent → the greeter). The dock shows the greeter's; the writer's tray `to: writer`.
 */
export function openingReplyItemsFor(replies: unknown, locale: string, worldLocale: string | null | undefined, greeter: string): OpeningReply[] {
  const parsed = OpeningRepliesSchema.safeParse(replies);
  if (!parsed.success) return [];
  const map = parsed.data;
  const list = Array.isArray(map)
    ? map
    : map[locale] ?? (worldLocale ? map[worldLocale] : undefined) ?? map.en ?? Object.values(map)[0] ?? [];
  return list.map((item) => (typeof item === 'string' ? { text: item, to: greeter } : { text: item.text, to: item.to ?? greeter }));
}


/** world.json `ui`: play-screen switches. Lenient (unknown keys kept for later switches). */
export const WorldUiSchema = z.object({
  replyChips: z.boolean().optional(),
}).passthrough();
export type WorldUi = z.infer<typeof WorldUiSchema>;

/**
 * Reply chips for this world (pure): `ui.replyChips` when the world says; otherwise on for a world that wrote
 * `opening.replies` (its author thought about one-tap answers) or a prologue, off elsewhere.
 */
export function replyChipsEnabled(manifest: unknown): boolean {
  const m = manifest && typeof manifest === 'object' ? manifest as { ui?: unknown; opening?: { replies?: unknown } } : null;
  if (!m) return false;
  const ui = WorldUiSchema.safeParse(m.ui);
  if (ui.success && typeof ui.data.replyChips === 'boolean') return ui.data.replyChips;
  if (isPrologueWorld(m)) return true;
  return OpeningRepliesSchema.safeParse(m.opening?.replies).success;
}

/** A world.json's experience block, or null (lenient: a malformed block is none). */
export function worldExperienceOf(manifest: unknown): WorldExperience | null {
  const raw = manifest && typeof manifest === 'object' ? (manifest as { experience?: unknown }).experience : undefined;
  const parsed = WorldExperienceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Is this world the first-run prologue (any edition)? */
export const isPrologueWorld = (manifest: unknown): boolean => worldExperienceOf(manifest)?.kind === 'prologue';

/** The edition id of family `base` for an interface / world locale (`last-train` + `zh-CN` → `last-train-zh`). */
export function editionIdFor(base: string, locale: string | null | undefined): string {
  const suffix = locale === 'zh-CN' || locale?.startsWith('zh') ? '-zh' : locale === 'ja' ? '-jp' : locale === 'ko' ? '-ko' : '';
  return `${base}${suffix}`;
}

// ── world.json `models`: which model a world would like each agent on ─────────────────────────

/**
 * A world's model hint per agent role: candidates in order, the first one this player may use wins; none →
 * the usual default. A player's own pick for the save (Agents → Model) always beats the hint.
 *
 *   "models": { "character": [{ "model": "deepseek-v4-pro", "thinking": "off" }, { "model": "deepseek-v4-flash", "thinking": "off" }] }
 *
 * `provider` defaults to `deepseek` (the bundled provider, config/deepseek-models.example.json); a bare string is
 * `{ model }` with `thinking: low`.
 */
const ModelCandidateSchema = z.union([
  z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/).transform((model) => ({ model })),
  z.object({
    provider: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
    model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/),
    thinking: z.enum(['off', 'low', 'medium', 'high']).optional(),
  }).strict(),
]);
const ModelCandidatesSchema = z.union([ModelCandidateSchema.transform((c) => [c]), z.array(ModelCandidateSchema).min(1).max(4)]);
export const WorldModelHintsSchema = z.object({
  writer: ModelCandidatesSchema.optional(),
  character: ModelCandidatesSchema.optional(),
}).strict();
export type WorldModelHints = z.infer<typeof WorldModelHintsSchema>;

/**
 * Chat models the Worldlines AI service sells to paid plans only (ai.worldlines.gg catalog rows with
 * `paid_only`, the Worldlines platform services/ai src/seed.mjs — keep in step). A free plan / a guest gets 403
 * plan_required for them.
 */
export const GATEWAY_PAID_ONLY_MODELS: readonly string[] = ['deepseek-v4-pro', 'deepseek-reasoner'];

export interface WorldModelChoice { provider: string; model: string; thinking: 'off' | 'low' | 'medium' | 'high' }
export interface WorldModelContext {
  /** How this agent's calls are paid: through the Worldlines AI service (`gateway`) or the player's own key / none. */
  route: 'gateway' | 'own';
  /** The account's plan on the service (`free`, `story`, `vivid`, …); null = unknown or a guest (treated as free). */
  plan: string | null;
  /** Models the agent's provider config lists (a hint for a model it does not know is skipped). */
  known?: (provider: string, model: string) => boolean;
}

/** The world's model for `role` this player may use, or null (→ the default) — pure. */
export function worldModelFor(role: 'writer' | 'character', hints: unknown, ctx: WorldModelContext): WorldModelChoice | null {
  const parsed = WorldModelHintsSchema.safeParse(hints);
  if (!parsed.success) return null;
  const paid = !!ctx.plan && ctx.plan !== 'free';
  for (const c of parsed.data[role] ?? []) {
    const provider = 'provider' in c && c.provider ? c.provider : 'deepseek';
    const thinking = 'thinking' in c && c.thinking ? c.thinking : 'low';
    if (ctx.route === 'gateway' && !paid && GATEWAY_PAID_ONLY_MODELS.includes(c.model)) continue;
    if (ctx.known && !ctx.known(provider, c.model)) continue;
    return { provider, model: c.model, thinking };
  }
  return null;
}
