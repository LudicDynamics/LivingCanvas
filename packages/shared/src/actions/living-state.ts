/**
 * A living world's running clock: the
 * frontmatter key `living` of `world/README.md`. Engine bookkeeping like
 * `trigger_log` / `cg_log` — no event of its own, reserved from command,
 * writer and character edits — and inside the save's own world file, so a
 * snapshot / rollback carries the clock with everything else.
 *
 *   minute   world minutes since day 1, 00:00 (the one number time is)
 *   settled  the minute the world was last brought up to date (residents
 *            moved, overnight changes applied, pictures swapped, triggers run)
 *   seed     every off-screen roll's seed, fixed for the save's life
 *   real_at  the last real moment the save was in play (between-session catch-up)
 *   away     the last absence's facts and how its digest was delivered
 *
 * This module only reads and writes the record; the engine is `living.ts`.
 */
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { parseLivingWorld, type LivingWorld } from '../schemas/living.js';
import type { WorldStore } from '../store/world-store.js';

export const LIVING_KEY = 'living';
export const LIVING_PATH = 'world/README.md';

export interface LivingAway {
  /** World minutes the absence covered. */
  from: number;
  to: number;
  /** Real milliseconds the player was away (before the cap). */
  realMs: number;
  /** One line per remembered off-screen fact, in the edition's words. */
  facts: string[];
  /** How the digest reached the player: once, by the writer or by the engine's own words. */
  delivered: 'writer' | 'template' | null;
}

export interface LivingState {
  minute: number;
  settled: number;
  seed: number;
  real_at: string;
  away?: LivingAway;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : null);

/** Parse a raw `living` record; null when absent or unusable (the engine then starts the clock afresh). */
export function parseLivingState(raw: unknown): LivingState | null {
  if (!isPlainObject(raw)) return null;
  const minute = int(raw.minute);
  const seed = int(raw.seed);
  if (minute === null || minute < 0 || seed === null) return null;
  const settled = int(raw.settled);
  const state: LivingState = {
    minute,
    settled: settled === null || settled < 0 ? minute : settled,
    seed,
    real_at: typeof raw.real_at === 'string' ? raw.real_at : '',
  };
  const a = raw.away;
  if (isPlainObject(a) && int(a.from) !== null && int(a.to) !== null) {
    state.away = {
      from: int(a.from)!,
      to: int(a.to)!,
      realMs: int(a.realMs) ?? 0,
      facts: Array.isArray(a.facts) ? a.facts.filter((f): f is string => typeof f === 'string').slice(0, 24) : [],
      delivered: a.delivered === 'writer' || a.delivered === 'template' ? a.delivered : null,
    };
  }
  return state;
}

export async function readLivingState(store: WorldStore): Promise<LivingState | null> {
  if ((await store.statKind(LIVING_PATH)) !== 'file') return null;
  return parseLivingState(parseFrontmatter(await store.readFile(LIVING_PATH)).frontmatter?.[LIVING_KEY]);
}

/** Bookkeeping write, like `trigger_log`: no event (time passing is not itself a story fact). */
export async function writeLivingState(store: WorldStore, state: LivingState): Promise<void> {
  const exists = (await store.statKind(LIVING_PATH)) === 'file';
  const parsed = exists ? parseFrontmatter(await store.readFile(LIVING_PATH)) : { frontmatter: {}, body: '' };
  const record: Record<string, unknown> = { minute: state.minute, settled: state.settled, seed: state.seed, real_at: state.real_at };
  if (state.away) record.away = { ...state.away };
  await store.writeFileAtomic(LIVING_PATH, stringifyFrontmatter({ ...(parsed.frontmatter ?? {}), [LIVING_KEY]: record }, parsed.body));
}

export interface LivingCharacter {
  id: string;
  name: string;
  home: string;
}

/** The parts of world.json a living world reads, straight from the file (this runs after actions). */
export interface LivingWorldFile {
  id: string;
  living: LivingWorld;
  characters: LivingCharacter[];
}

/** Null when the world has no (valid) `living` block — every other world is untouched. */
export async function loadLivingWorld(store: WorldStore): Promise<LivingWorldFile | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await store.readFile('world.json'));
  } catch {
    return null;
  }
  if (!isPlainObject(raw) || raw.living === undefined) return null;
  const { living } = parseLivingWorld(raw.living);
  if (!living) return null;
  const characters = (Array.isArray(raw.characters) ? raw.characters : []).flatMap((c): LivingCharacter[] => {
    if (!isPlainObject(c) || typeof c.id !== 'string') return [];
    return [{ id: c.id, name: typeof c.name === 'string' ? c.name : c.id, home: typeof c.home === 'string' ? c.home : 'map' }];
  });
  return { id: typeof raw.id === 'string' ? raw.id : '', living, characters };
}
