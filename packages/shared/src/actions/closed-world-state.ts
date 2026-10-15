/**
 * Closed worlds, read side — what has ended, how much time is left, and the
 * lock every action passes. Kept free of any action
 * import: `service.ts` calls `assertNotEnded`, and the action modules register
 * themselves with `service.ts` while loading, so importing one here would be a
 * cycle. The writes (`tickClock` / `endWorld`) live in `closed-world.ts`.
 *
 * The state lives in the world's own files, not in a second ledger:
 *   - the clock is an ordinary card (`manifest.clock.path`), its
 *     `status.data[key]` the steps left;
 *   - the ending reached is `world/README.md`'s `status.data.ending`.
 * Snapshots and rollbacks already cover world files, so rolling back to before
 * an ending simply un-ends the game — nothing else has to be reset.
 */
import { parseFrontmatter } from '../schemas/frontmatter.js';
import type { WorldEnding, WorldManifest } from '../schemas/world.js';
import type { WorldStore } from '../store/world-store.js';
import { ActionError } from './errors.js';

/** Where the ending reached is recorded. */
export const ENDING_RECORD_PATH = 'world/README.md';

/**
 * What still works once a closed world has ended: reading, and talking. Every
 * other action — the player's, the writer's, a character agent's — is refused
 * with `game_ended`. Snapshots and rollbacks stay open so "back to before the
 * ending" remains possible.
 */
export const ACTIONS_AFTER_ENDING: ReadonlySet<string> = new Set([
  'lookAt',
  'viewCanvas',
  'getComponent',
  'showComponent',
  'noteCharacterTalked',
  'snapshotWorld',
  'rollbackWorld',
]);

export const GAME_ENDED_MESSAGE = 'This story has ended. You can keep talking with the characters, or play again.';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function statusData(store: WorldStore, path: string): Promise<Record<string, unknown> | null> {
  if ((await store.statKind(path)) !== 'file') return null;
  const fm = parseFrontmatter(await store.readFile(path)).frontmatter;
  const status = isPlainObject(fm?.status) ? fm.status : {};
  return isPlainObject(status.data) ? status.data : {};
}

/**
 * Whether a world has endings the engine enforces: `closed` (endings + clock)
 * and `semi` (endings, no clock — the design notes, the theme
 * registry's `modeOfTheme`). `open` never ends.
 */
export function modeHasEndings(mode: unknown): boolean {
  return mode === 'closed' || mode === 'semi';
}

/** The ending this world has reached, or null (always null for an open world). */
export async function reachedEnding(store: WorldStore, manifest?: WorldManifest): Promise<WorldEnding | null> {
  const m = manifest ?? (await store.getManifest());
  if (!modeHasEndings(m.mode)) return null;
  const data = await statusData(store, ENDING_RECORD_PATH);
  const id = data?.ending;
  if (typeof id !== 'string' || id === '') return null;
  return (m.endings ?? []).find((e) => e.id === id) ?? null;
}

/** The request (`ctx.turn`) that reached the ending, if recorded. */
export async function endingTurn(store: WorldStore): Promise<string | null> {
  const data = await statusData(store, ENDING_RECORD_PATH);
  return typeof data?.endingTurn === 'string' ? data.endingTurn : null;
}

/** Steps left on the world's clock, or null when it has none. */
export async function clockLeft(store: WorldStore, manifest?: WorldManifest): Promise<number | null> {
  const m = manifest ?? (await store.getManifest());
  if (!m.clock) return null;
  const data = await statusData(store, m.clock.path);
  if (data === null) return null;
  const raw = data[m.clock.key];
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : m.clock.start;
}

/** Throws `game_ended` when `action` is not allowed because the world has ended. */
export async function assertNotEnded(store: WorldStore, action: string, turn?: string): Promise<void> {
  if (ACTIONS_AFTER_ENDING.has(action)) return;
  // Runs before EVERY action, so it reads world.json directly instead of
  // `getManifest()` (which rescans the whole layer tree). Open worlds stop here.
  let raw: { mode?: unknown; endings?: unknown };
  try {
    raw = JSON.parse(await store.readFile('world.json'));
  } catch {
    return;
  }
  if (!modeHasEndings(raw.mode)) return;
  const manifest = { mode: raw.mode, endings: Array.isArray(raw.endings) ? raw.endings : [] } as WorldManifest;
  const ending = await reachedEnding(store, manifest);
  // The request that reached the ending may finish its own bookkeeping: a roll
  // that ends the story still writes its receipt and rewards afterwards, and
  // refusing those would turn the ending roll itself into an error.
  if (ending && turn !== undefined && (await endingTurn(store)) === turn) return;
  if (ending) {
    throw new ActionError({
      code: 'game_ended',
      message: GAME_ENDED_MESSAGE,
      details: { ending: ending.id, title: ending.title },
    });
  }
}

