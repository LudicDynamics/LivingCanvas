import { z } from 'zod';
import { WORLD_CATEGORY_IDS } from '../rules/themes.js';

/**
 * The lobby's "what is this world" card: what a player
 * reads BEFORE entering a world — a hook, genres, what you do here, how long,
 * how hard, which mechanics, who you meet, how many endings, who it suits, and
 * how finished it is. Author data in `world.json` `intro`, one per edition, in
 * the edition's language. Enum ids are the machine part (identical in every
 * edition of a family, `check:worlds`); the strings are localized.
 *
 * Lenient at runtime (`WorldManifestSchema` catches a malformed block, and the
 * server derives a fallback card from the world's own data), strict in
 * `check:worlds`, where every official edition must carry a valid one.
 */
export const WORLD_INTRO_STATUSES = ['playable', 'in-development', 'experimental'] as const;
/**
 * The lobby's three world categories:
 * ids, labels and one-line explanations live in ONE table, `WORLD_CATEGORIES`
 * (rules/themes.ts), shared with the workshop's type picker. 「实验」 is a
 * separate flag (`experimental`), not a category.
 */
export const WORLD_INTRO_CATEGORIES = WORLD_CATEGORY_IDS;
export const WORLD_INTRO_GENRES = ['mystery', 'horror', 'romance', 'fantasy', 'time-travel', 'slice-of-life', 'historical', 'adventure'] as const;
export const WORLD_INTRO_DIFFICULTIES = ['intro', 'standard', 'hardcore'] as const;
/** `endings` shows as 「多结局 N 个」 from the count; `free-explore` is the honest badge of a world with no fixed end. */
export const WORLD_INTRO_MECHANICS = ['dice', 'clock', 'endings', 'sanity', 'voice', 'live-image', 'growth', 'free-explore'] as const;

export type WorldIntroStatus = (typeof WORLD_INTRO_STATUSES)[number];
export type WorldIntroCategory = (typeof WORLD_INTRO_CATEGORIES)[number];
export type WorldIntroGenre = (typeof WORLD_INTRO_GENRES)[number];
export type WorldIntroDifficulty = (typeof WORLD_INTRO_DIFFICULTIES)[number];
export type WorldIntroMechanic = (typeof WORLD_INTRO_MECHANICS)[number];

const line = (max: number) => z.string().trim().min(1).max(max);

export const WorldIntroCharacterSchema = z.object({
  /** A `characters[]` id — name and avatar come from there. */
  id: z.string().optional(),
  /** For someone who is not an agent (an NPC card): name and portrait given here. */
  name: line(60).optional(),
  avatar: z.string().optional(),
  line: line(110),
}).strict().refine((c) => Boolean(c.id) || Boolean(c.name), { message: 'a character needs an id or a name' });

export const WorldIntroSchema = z.object({
  status: z.enum(WORLD_INTRO_STATUSES),
  /** 跑团世界 / 剧情世界 / 自由世界: the lobby's filter and badge. Optional here, required for official worlds. */
  category: z.enum(WORLD_INTRO_CATEGORIES).optional(),
  /** The 「实验」 badge: a world trying a new kind of play. */
  experimental: z.boolean().optional(),
  /**
   * Not a tile of its own in the lobby: a world reached another way —
   * the first-run prologue opens only from the first-run experience.
   */
  hidden: z.boolean().optional(),
  /** 「新手推荐」 ribbon; recommended worlds lead their status group in the lobby. */
  recommended: z.boolean().optional(),
  /** Lobby order inside a status group, ascending. */
  rank: z.number().int().min(0).max(999).optional(),
  hook: line(170),
  genres: z.array(z.enum(WORLD_INTRO_GENRES)).min(1).max(3),
  /** 「你在这里做什么」: exactly three short lines — the core loop. */
  loop: z.array(line(90)).length(3),
  /** Play time estimate in minutes, [from, to]. */
  minutes: z.tuple([z.number().int().min(5).max(600), z.number().int().min(5).max(600)]).refine(([a, b]) => a <= b, { message: 'minutes: from ≤ to' }),
  difficulty: z.enum(WORLD_INTRO_DIFFICULTIES),
  mechanics: z.array(z.enum(WORLD_INTRO_MECHANICS)).min(1).max(6),
  /** Number of endings; 0 = no fixed ending. Must equal `endings[]` when the world declares them. */
  endings: z.number().int().min(0).max(20),
  characters: z.array(WorldIntroCharacterSchema).min(1).max(4),
  /** 「适合：…」 */
  for: z.array(line(48)).min(1).max(3),
  /** What is not there yet — required for 开发中 / 实验, so expectations are right. */
  unfinished: line(170).optional(),
}).strict();

export type WorldLobbyIntro = z.infer<typeof WorldIntroSchema>;
export type WorldLobbyIntroCharacter = z.infer<typeof WorldIntroCharacterSchema>;

/**
 * What a world's `intro` promises that its own data does not deliver (the
 * honesty half of the gate): a clock badge without a clock, dice without a rule
 * system, an ending count that is not the declared endings, a character id
 * nobody has, an unfinished world that does not say what is unfinished.
 */
export function worldIntroProblems(manifest: Record<string, unknown>): string[] {
  const parsed = WorldIntroSchema.safeParse(manifest.intro);
  if (!parsed.success) return parsed.error.issues.map((i) => `intro.${i.path.join('.')}: ${i.message}`);
  const intro = parsed.data;
  const problems: string[] = [];
  const has = (m: WorldIntroMechanic) => intro.mechanics.includes(m);
  const endings = Array.isArray(manifest.endings) ? manifest.endings.length : 0;
  const rules = manifest.rules && typeof manifest.rules === 'object' ? manifest.rules as { system?: unknown; sanity?: unknown } : null;
  if (endings && intro.endings !== endings) problems.push(`intro.endings is ${intro.endings} but world.json declares ${endings} endings`);
  if (has('endings') && intro.endings < 2) problems.push('intro.mechanics "endings" needs at least 2 endings');
  if (has('free-explore') && intro.endings > 0 && endings > 0) problems.push('intro.mechanics "free-explore" is for a world without declared endings');
  if (has('clock') && !manifest.clock) problems.push('intro.mechanics "clock" but world.json has no clock');
  if (has('sanity') && rules?.sanity !== true) problems.push('intro.mechanics "sanity" but rules.sanity is not on');
  if (has('dice') && !rules?.system) problems.push('intro.mechanics "dice" but world.json declares no rules');
  if (!intro.category) problems.push(`intro.category is required: ${WORLD_INTRO_CATEGORIES.join(', ')}`);
  if (intro.status !== 'playable' && !intro.unfinished) problems.push(`intro.unfinished is required for a ${intro.status} world`);
  if (intro.recommended && intro.status !== 'playable') problems.push('only a playable world can be recommended');
  const characters = Array.isArray(manifest.characters) ? manifest.characters as { id?: unknown }[] : [];
  for (const c of intro.characters) {
    if (c.id && !characters.some((x) => x.id === c.id)) problems.push(`intro.characters: no character "${c.id}"`);
    if (!c.id && !c.avatar) problems.push(`intro.characters: "${c.name}" needs an avatar`);
  }
  return problems;
}

/** The machine part of an intro: what must be identical in every edition of a family. */
export function worldIntroMachine(intro: unknown): unknown {
  const parsed = WorldIntroSchema.safeParse(intro);
  if (!parsed.success) return null;
  const i = parsed.data;
  return {
    status: i.status, category: i.category ?? null, experimental: i.experimental ?? false, hidden: i.hidden ?? false, recommended: i.recommended ?? false, rank: i.rank ?? null, genres: i.genres, minutes: i.minutes,
    difficulty: i.difficulty, mechanics: i.mechanics, endings: i.endings,
    characters: i.characters.map((c) => [c.id ?? null, c.avatar ?? null]), loop: i.loop.length, for: i.for.length, unfinished: Boolean(i.unfinished),
  };
}
