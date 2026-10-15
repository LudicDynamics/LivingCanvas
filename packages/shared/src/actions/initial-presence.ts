import type { WorldStore } from '../store/world-store.js';
import type { MoveCharacterDetails } from './move-to.js';
import { moveCharacter } from './move-to.js';
import { resolveHome } from './presence.js';

/** The result of one world-load reconciliation. This is diagnostics only. */
export interface InitialPresenceResult {
  initialized: MoveCharacterDetails[];
  skipped: string[];
}

/**
 * Fill only missing character presence rows when a world is first opened.
 *
 * `world.json.characters[].home` is an initial placement hint, not runtime
 * state. Existing rows are left untouched. The actual seat, write and
 * `character_moved` event all come from the established move action so this
 * seam cannot become a second presence write path.
 */
export function initializeMissingCharacterPresence(
  store: WorldStore,
  opts: { turn: string },
): Promise<InitialPresenceResult> {
  const running = IN_FLIGHT.get(store);
  if (running) return running;

  const promise = reconcile(store, opts);
  IN_FLIGHT.set(store, promise);
  void promise.then(
    () => { if (IN_FLIGHT.get(store) === promise) IN_FLIGHT.delete(store); },
    () => { if (IN_FLIGHT.get(store) === promise) IN_FLIGHT.delete(store); },
  );
  return promise;
}

const IN_FLIGHT = new WeakMap<WorldStore, Promise<InitialPresenceResult>>();

async function reconcile(
  store: WorldStore,
  opts: { turn: string },
): Promise<InitialPresenceResult> {
  const manifest = await store.getManifest();
  const existing = new Set(store.getPresence().map((row) => row.characterId));
  const seen = new Set(existing);
  const initialized: MoveCharacterDetails[] = [];
  const skipped: string[] = [];

  for (const character of manifest.characters) {
    if (seen.has(character.id)) {
      skipped.push(character.id);
      continue;
    }
    // Mark before awaiting the action: duplicate manifest entries are first-wins
    // and cannot move the same character to a second home.
    seen.add(character.id);
    const home = await resolveHome(store, character.id);
    try {
      const result = await moveCharacter(
        { store, actor: { type: 'engine' }, turn: opts.turn },
        { character: character.id, destination: home.layer },
      );
      if (result.details.moved) initialized.push(result.details);
      else skipped.push(character.id);
    } catch (error) {
      // moveCharacter writes canvas before history. Remove only this batch's
      // newly-created row so an event failure can be retried on the next load.
      try {
        await store.deletePresence(character.id);
      } catch (cleanupError) {
        throw new Error(
          `Initial presence for "${character.id}" failed and cleanup failed: ` +
          `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  return { initialized, skipped };
}
