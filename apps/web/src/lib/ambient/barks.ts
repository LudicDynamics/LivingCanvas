/**
 * Which bark / emote / chat an idle person shows (pure; the design notes).
 *
 * Input is the sanitised `ambient/<id>.json` data from `GET /api/ambient`
 * (shape owner: packages/shared/src/rules/ambient.ts). Nothing chosen here is
 * logged, stored or sent anywhere: a bark is a bubble on screen and gone.
 */
import type { Rng } from './motion.js';

export type AmbientLocale = 'en' | 'zh-CN' | 'ja' | 'ko';
export type AmbientEmote = 'dots' | 'question' | 'exclaim' | 'music' | 'heart' | 'sigh';
export type AmbientTime = 'morning' | 'day' | 'evening' | 'night';
export type AmbientBarks = string[] | Partial<Record<AmbientLocale, string[]>>;

export interface AmbientEntry {
  barks?: AmbientBarks;
  emotes?: AmbientEmote[];
  when?: { layer?: string; time?: AmbientTime; card?: string; barks: AmbientBarks }[];
  chats?: { with: string; barks: AmbientBarks }[];
}

export type AmbientEntries = Readonly<Record<string, AmbientEntry>>;

export interface BarkContext {
  /** Interface language: picks the list when a world ships one per locale. */
  locale: AmbientLocale;
  /** Player's current layer id. */
  layer: string;
  /** Player's local hour, 0–23. */
  hour: number;
  /** Card paths on the current canvas. */
  cardPaths: ReadonlySet<string>;
}

export const ALL_EMOTES: readonly AmbientEmote[] = ['dots', 'question', 'exclaim', 'music', 'heart', 'sigh'];
/** The fallback set every world gets with zero authoring — wordless, so it suits any language. */
export const FALLBACK_EMOTES: readonly AmbientEmote[] = ['dots', 'dots', 'question', 'music', 'sigh', 'exclaim', 'heart'];
export const EMOTE_GLYPH: Readonly<Record<AmbientEmote, string>> = {
  dots: '…', question: '?', exclaim: '!', music: '♪', heart: '♥', sigh: '～',
};

/** How long a bark stays up: 2–4 s, longer lines a little longer. */
export function barkDurationMs(text: string): number {
  return Math.min(4000, Math.max(2000, 1600 + [...text].length * 80));
}

export function timeOfDay(hour: number): AmbientTime {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'day';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/** A bark list for the interface locale: the edition's own list, or the locale's, else English, else any. */
export function barkList(barks: AmbientBarks | undefined, locale: AmbientLocale): string[] {
  if (!barks) return [];
  if (Array.isArray(barks)) return barks;
  return barks[locale] ?? barks.en ?? Object.values(barks).find((list) => Array.isArray(list) && list.length) ?? [];
}

/** `world/cab` matches itself and anything under it; `map` and `world` match the root layer only / everything. */
export function layerMatches(condition: string, layer: string): boolean {
  if (condition === 'world') return true;
  if (condition === 'map') return layer === 'map';
  return layer === condition || layer.startsWith(`${condition}/`);
}

/** Conditional lists whose conditions all hold, then the plain list. */
export function eligibleBarks(entry: AmbientEntry | undefined, ctx: BarkContext): { conditional: string[]; general: string[] } {
  const conditional: string[] = [];
  for (const cond of entry?.when ?? []) {
    if (cond.layer && !layerMatches(cond.layer, ctx.layer)) continue;
    if (cond.time && cond.time !== timeOfDay(ctx.hour)) continue;
    if (cond.card && !ctx.cardPaths.has(cond.card)) continue;
    conditional.push(...barkList(cond.barks, ctx.locale));
  }
  return { conditional, general: barkList(entry?.barks, ctx.locale) };
}

/**
 * One bark, or null when this person has none here. A matching condition wins
 * two times in three (the place should colour what they say); the last few
 * lines shown are avoided while anything else is left.
 */
export function pickBark(entry: AmbientEntry | undefined, ctx: BarkContext, rng: Rng, recent: readonly string[] = []): string | null {
  const { conditional, general } = eligibleBarks(entry, ctx);
  const pools = conditional.length && (rng() < 0.67 || !general.length) ? [conditional, general] : [general, conditional];
  for (const pool of pools) {
    if (!pool.length) continue;
    const fresh = pool.filter((line) => !recent.includes(line));
    const from = fresh.length ? fresh : pool;
    return from[Math.floor(rng() * from.length) % from.length];
  }
  return null;
}

export function pickEmote(entry: AmbientEntry | undefined, rng: Rng): AmbientEmote {
  const pool = entry?.emotes?.length ? entry.emotes : FALLBACK_EMOTES;
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

export interface ChatLine {
  by: string;
  text: string;
}

/**
 * A short exchange between `a` and `b` that `a` starts, from `a`'s `chats`
 * (lines alternate a, b, a…). Null when `a` has nothing scripted with `b`.
 */
export function chatLines(aId: string, a: AmbientEntry | undefined, bId: string, ctx: BarkContext, rng: Rng): ChatLine[] | null {
  const scripts = (a?.chats ?? []).filter((chat) => chat.with === bId);
  if (!scripts.length) return null;
  const lines = barkList(scripts[Math.floor(rng() * scripts.length) % scripts.length].barks, ctx.locale);
  if (lines.length < 2) return null;
  return lines.slice(0, 4).map((text, i) => ({ by: i % 2 === 0 ? aId : bId, text }));
}

/** Ids that have a scripted chat partner among `present`. */
export function chatPairs(entries: AmbientEntries, present: readonly string[]): [string, string][] {
  const here = new Set(present);
  const pairs: [string, string][] = [];
  for (const id of present) {
    for (const chat of entries[id]?.chats ?? []) {
      if (chat.with !== id && here.has(chat.with)) pairs.push([id, chat.with]);
    }
  }
  return pairs;
}
