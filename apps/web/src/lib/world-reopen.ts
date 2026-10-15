// The page shows a world but the server answers `no_active_world`: the in-tab
// server lost it (a restarted runtime, a swap that failed half way). Reopen the
// SAME save — its resolved path, so a template is not started afresh — instead
// of dropping the player on the shelf. At most one try per save per minute: a
// world that is gone again right after its reopen goes to the shelf, no loop.

export interface WorldReopener {
  /** A world opened: `path` is the server's resolved save path (`/api/worlds/load` → `path`). */
  opened(path: string | null | undefined): void;
  /** The save to reopen now, or null (nothing open, or already tried for this save). */
  take(): string | null;
  /** The player left the world on purpose (lobby, delete): nothing to reopen. */
  forget(): void;
}

export const REOPEN_COOLDOWN_MS = 60_000;

export function createWorldReopener(now: () => number = () => Date.now()): WorldReopener {
  let path: string | null = null;
  let triedAt: number | null = null;
  return {
    opened(next) {
      if (typeof next !== 'string' || !next.trim()) return;
      // Another save starts with a fresh try; a reopen that landed keeps its
      // cooldown, so a world that keeps vanishing cannot reload in a loop.
      if (next !== path) triedAt = null;
      path = next;
    },
    take() {
      if (!path) return null;
      if (triedAt !== null && now() - triedAt < REOPEN_COOLDOWN_MS) return null;
      triedAt = now();
      return path;
    },
    forget() {
      path = null;
      triedAt = null;
    },
  };
}

/**
 * 「继续这个故事」 (the launcher's way back into the world on screen). The page shows the world the server has
 * open (`/api/manifest` at start-up), but only a load SELECTS its save — and every command the page sends (to the
 * writer, to a character) is scoped to the selected save. After a reload nothing is selected: closing the
 * launcher left a world on screen whose characters could not be spoken to. And another tab may have opened
 * another save meanwhile: then the manifest and the map on screen are the previous world's.
 *
 * `page`: the save this page selected (null after a reload); `server`: the save the server has open
 * (`GET /api/worlds/active`; null = none, undefined = could not ask).
 *   - `close`: the same save, or nothing to go on — close the launcher, as before;
 *   - `adopt`: the page selected nothing — select the server's save and re-read the world (no reload: the player
 *     stays where they are, nobody is restarted);
 *   - `enter`: the page selected ANOTHER save — enter the server's save the way a shelf pick does.
 */
export type ContinueStory = { kind: 'close' } | { kind: 'adopt'; path: string } | { kind: 'enter'; path: string };

export function continueStoryAction(page: string | null, server: string | null | undefined): ContinueStory {
  if (typeof server !== 'string' || !server || server === page) return { kind: 'close' };
  return page === null ? { kind: 'adopt', path: server } : { kind: 'enter', path: server };
}
