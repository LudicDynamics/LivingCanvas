import fs from 'node:fs/promises';
import path from 'node:path';
import { WorldIntroSchema, type WorldIntroStatus } from '@airp/shared';

/**
 * The lobby's "what is this world" card, as the shelf
 * sends it. Written by the author in `world.json` `intro`; when a world has
 * none (an older or a workshop world) a plainer card is DERIVED from its own
 * data — the description, the declared endings, clock and rules, and its
 * characters — so every brick can still say what it is.
 */
export interface ShelfIntroCharacter { name: string; line: string; avatar: string | null }
export interface ShelfIntro {
  status: WorldIntroStatus | null;
  /** The 「实验」 badge (intro.experimental; an older world's `exp: true`). The category itself is on the shelf group. */
  experimental: boolean;
  /** Not a lobby tile of its own (intro.hidden): the first-run prologue. */
  hidden?: boolean;
  recommended: boolean;
  rank: number | null;
  hook: string;
  genres: string[];
  loop: string[];
  minutes: [number, number] | null;
  difficulty: string | null;
  mechanics: string[];
  endings: number;
  /** The rule system badge: `coc`, `dnd`, or null for a world without rules. */
  rules: 'coc' | 'dnd' | null;
  characters: ShelfIntroCharacter[];
  for: string[];
  unfinished: string | null;
  /** No authored `intro`: everything above was read off the world's data. */
  derived: boolean;
  /** The world declares a character tick; `wip` = 「制作中」. */
  characterTick?: { wip: boolean };
}

/** world.json `tick` → the card's line about it (the block itself is checked by check:worlds). */
function characterTickOf(manifest: Record<string, unknown>): { characterTick?: { wip: boolean } } {
  const tick = obj(manifest.tick);
  return tick ? { characterTick: { wip: tick.wip === true } } : {};
}

const IMAGE_FILE = /\.(webp|png|jpe?g|avif)$/i;
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const obj = (value: unknown) => (value && typeof value === 'object' ? value as Record<string, unknown> : null);

/** Who the card shows, with each portrait's world-relative path (null: none). */
export function introCast(manifest: Record<string, unknown>): { name: string; line: string; avatar: string | null }[] {
  const characters = (Array.isArray(manifest.characters) ? manifest.characters : []).map(obj).filter((c): c is Record<string, unknown> => c !== null);
  const parsed = WorldIntroSchema.safeParse(manifest.intro);
  const portrait = (rel: unknown) => (typeof rel === 'string' && IMAGE_FILE.test(rel) && !rel.includes('..') ? rel.replace(/^\/+/, '') : null);
  if (parsed.success) {
    return parsed.data.characters.map((c) => {
      const agent = c.id ? characters.find((x) => x.id === c.id) : undefined;
      return { name: c.name ?? (text(agent?.name) || c.id || ''), line: c.line, avatar: portrait(c.avatar ?? agent?.avatar) };
    });
  }
  return characters.slice(0, 3).map((c) => ({ name: text(c.name) || text(c.id), line: text(c.description), avatar: portrait(c.avatar) }));
}

/** The card for one world. `avatarUrl(i, rel)` turns cast member i's portrait into a URL the page can load. */
export async function shelfIntroOf(manifest: Record<string, unknown>, avatarUrl: (index: number, rel: string) => Promise<string | null>): Promise<ShelfIntro> {
  const rules = obj(manifest.rules);
  const system = rules?.system === 'coc' || rules?.system === 'dnd' ? rules.system : null;
  const declaredEndings = Array.isArray(manifest.endings) ? manifest.endings.length : 0;
  const cast = await Promise.all(introCast(manifest).map(async (c, i) => ({ ...c, avatar: c.avatar ? await avatarUrl(i, c.avatar) : null })));
  const parsed = WorldIntroSchema.safeParse(manifest.intro);
  if (parsed.success) {
    const i = parsed.data;
    return {
      status: i.status, experimental: i.experimental === true, ...(i.hidden === true ? { hidden: true } : {}), recommended: i.recommended === true, rank: i.rank ?? null, hook: i.hook, genres: i.genres, loop: i.loop,
      minutes: i.minutes, difficulty: i.difficulty, mechanics: i.mechanics, endings: i.endings, rules: system,
      characters: cast, for: i.for, unfinished: i.unfinished ?? null, derived: false, ...characterTickOf(manifest),
    };
  }
  const mechanics: string[] = [];
  if (system) mechanics.push('dice');
  if (manifest.clock) mechanics.push('clock');
  if (rules?.sanity === true) mechanics.push('sanity');
  if (declaredEndings >= 2) mechanics.push('endings');
  if (!declaredEndings) mechanics.push('free-explore');
  return {
    status: manifest.exp === true ? 'experimental' : null, experimental: manifest.exp === true, recommended: false, rank: null, hook: text(manifest.description),
    genres: [], loop: [], minutes: null, difficulty: null, mechanics, endings: declaredEndings, rules: system,
    characters: cast, for: [], unfinished: null, derived: true, ...characterTickOf(manifest),
  };
}

/** Absolute path of cast member `index`'s portrait inside `dir`, or null. Never leaves `dir`. */
export async function introAvatarFile(dir: string, index: number): Promise<string | null> {
  const manifest = await fs.readFile(path.join(dir, 'world.json'), 'utf8').then(JSON.parse, () => null);
  if (!obj(manifest) || !Number.isInteger(index) || index < 0) return null;
  const rel = introCast(manifest)[index]?.avatar;
  if (!rel) return null;
  const root = await fs.realpath(dir).catch(() => null);
  const file = root ? await fs.realpath(path.join(root, rel)).catch(() => null) : null;
  return file && root && file.startsWith(root + path.sep) && IMAGE_FILE.test(file) ? file : null;
}
