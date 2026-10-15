/**
 * Character tick v2 — the person's own「tick 提示词」.
 *
 * It lives ON the person, so a run variant can give the culprit and the innocent different goals:
 *
 *   - an NPC card (`type: npc`): frontmatter key `tick:`;
 *   - a registered character: `characters/<id>/tick.md` — the frontmatter holds the fields, the body
 *     is the free `prompt`.
 *
 *   tick:
 *     goal: 别让账本上的窟窿变成杀人的理由          # one line: what they want this run
 *     temper: 热络、爱打岔；紧张就擦汗               # one line: how they go about it
 *     prefer: [visit-study]                         # their own move ids, picked more often
 *     avoid: [plant-note]                           # unless nothing else is left
 *     may: [say, invite]                            # what they may write (default: say)
 *     voice: [哎呀，这屋里怎么这么闷。]               # 1–3 sample lines
 *     never_say: [账本, 四千法郎]                     # machine-checked deny words
 *     prompt: |-                                    # ≤ 600 characters
 *       …
 *
 * A self-made single-edition world may give any text field as `{ en, zh-CN, ja, ko }` (picked by the
 * page's language, `en` as the fallback) — the same rule as `ambient`. The official editions each
 * write their own language.
 *
 * Fenced (rules/character-view.ts): no character process ever reads it — not even its owner.
 * Pure zod, browser-safe.
 */
import { z } from 'zod';
import { parseFrontmatter } from './frontmatter.js';

export const TICK_MAY = ['say', 'note', 'invite'] as const;
export type TickMay = (typeof TICK_MAY)[number];

const LOCALES = ['en', 'zh-CN', 'ja', 'ko'] as const;
const localized = (max: number) =>
  z.union([
    z.string().min(1).max(max),
    z
      .object({
        en: z.string().min(1).max(max).optional(),
        'zh-CN': z.string().min(1).max(max).optional(),
        ja: z.string().min(1).max(max).optional(),
        ko: z.string().min(1).max(max).optional(),
      })
      .strict(),
  ]);
const MOVE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const TICK_PROMPT_MAX = 600;

export const TickPromptSchema = z
  .object({
    goal: localized(160),
    temper: localized(160),
    prefer: z.array(z.string().regex(MOVE_ID)).max(12).optional(),
    avoid: z.array(z.string().regex(MOVE_ID)).max(12).optional(),
    may: z.array(z.enum(TICK_MAY)).max(3).optional(),
    voice: z.array(localized(80)).min(1).max(3).optional(),
    never_say: z.array(z.string().min(1).max(40)).max(40).optional(),
    prompt: localized(TICK_PROMPT_MAX).optional(),
  })
  .strict();
export type TickPromptRaw = z.infer<typeof TickPromptSchema>;

/** The block resolved for one language. */
export interface TickPrompt {
  goal: string;
  temper: string;
  prefer: string[];
  avoid: string[];
  may: TickMay[];
  voice: string[];
  neverSay: string[];
  prompt: string;
}

type Localized = string | Partial<Record<(typeof LOCALES)[number], string>>;

export function pickLocalized(value: Localized | undefined, locale: string): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  const want = LOCALES.find((l) => l === locale) ?? (locale.startsWith('zh') ? 'zh-CN' : locale.startsWith('ja') ? 'ja' : locale.startsWith('ko') ? 'ko' : 'en');
  return value[want] ?? value.en ?? Object.values(value).find((v) => typeof v === 'string') ?? '';
}

export function resolveTickPrompt(raw: TickPromptRaw, locale: string): TickPrompt {
  return {
    goal: pickLocalized(raw.goal, locale),
    temper: pickLocalized(raw.temper, locale),
    prefer: raw.prefer ?? [],
    avoid: raw.avoid ?? [],
    may: raw.may && raw.may.length > 0 ? [...new Set(raw.may)] : ['say'],
    voice: (raw.voice ?? []).map((v) => pickLocalized(v, locale)).filter(Boolean),
    neverSay: raw.never_say ?? [],
    prompt: pickLocalized(raw.prompt, locale).slice(0, TICK_PROMPT_MAX),
  };
}

/** Parse an NPC card's `tick:` value. `prompt: null` when absent; errors say why it was refused. */
export function parseTickPromptBlock(raw: unknown): { prompt: TickPromptRaw | null; errors: string[] } {
  if (raw === undefined || raw === null) return { prompt: null, errors: [] };
  const parsed = TickPromptSchema.safeParse(raw);
  if (!parsed.success) return { prompt: null, errors: parsed.error.issues.map((i) => `tick.${i.path.join('.')}: ${i.message}`) };
  return { prompt: parsed.data, errors: [] };
}

/** `characters/<id>/tick.md`: frontmatter fields + the body as `prompt` (the body wins over a `prompt` key). */
export function parseTickPromptFile(text: string): { prompt: TickPromptRaw | null; errors: string[] } {
  const parsed = parseFrontmatter(text);
  const fm = (parsed.frontmatter ?? {}) as Record<string, unknown>;
  const body = parsed.body.trim();
  return parseTickPromptBlock({ ...fm, ...(body ? { prompt: body } : {}) });
}

/** Where a registered character's tick prompt lives. */
export const tickPromptPathOf = (characterId: string): string => `characters/${characterId}/tick.md`;
