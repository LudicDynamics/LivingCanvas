/**
 * 本机 / 云端 on the page: the badge each world and
 * save carries, and WHEN the 云端 worlds are synced — the server does the work
 * (`/api/remote/sync`); this module only decides the moments:
 *
 *   leaving a world   back to the lobby, and the page going hidden (keepalive)
 *   every 5 minutes   while the page is visible and an account is signed in
 *   on demand         「立即同步」 in the account panel
 *
 * After a pass that changed something (uploaded, downloaded, conflict) the
 * caller's `onChanged` re-reads the shelf so the badges follow.
 */
import type { SavePlace, WorldShelf, WorldSyncStatus } from './airp-gateway.js';

type GroupPlace = NonNullable<NonNullable<WorldShelf['groups']>[number]['place']>;

/** One badge: the message key (English, messages.json) and its tone for CSS. */
export interface PlaceBadge { label: string; tone: 'official' | 'cloud' | 'local' | 'pending' | 'conflict' }

/** The badge for a shelf group (a lobby tile, a shelf entry). Null on an older server. */
export function groupPlaceBadge(place: GroupPlace | undefined | null): PlaceBadge | null {
  if (!place) return null;
  return placeBadge({ location: place.kind, pending: place.pending, conflict: place.conflict });
}

/** The badge for one save. A play copy is always 本机. */
export function savePlaceBadge(place: SavePlace | undefined | null): PlaceBadge {
  return placeBadge(place ?? { location: 'local', pending: false, conflict: false });
}

function placeBadge(place: SavePlace): PlaceBadge {
  // A curated template, or an official edition its owner downloaded to edit: 官方 either way.
  if (place.location === 'official') return { label: 'Official', tone: 'official' };
  if (place.location === 'local') return { label: 'On this device', tone: 'local' };
  if (place.conflict) return { label: 'Conflict', tone: 'conflict' };
  if (place.pending) return { label: 'On this device · not synced', tone: 'pending' };
  return { label: 'Cloud', tone: 'cloud' };
}

/** Did this pass change what the shelf should show? */
export function syncChangedShelf(status: WorldSyncStatus | null): boolean {
  return Boolean(status?.worlds?.some((w) => w.state === 'pushed' || w.state === 'pulled' || w.state === 'conflict'));
}

/** The server's own sentence when it sent one, else the error's message. */
const errorText = (e: unknown) => {
  const said = (e as { payload?: { error?: unknown } } | null)?.payload?.error;
  return typeof said === 'string' ? said : e instanceof Error ? e.message : String(e);
};

export const SYNC_EVERY_MS = 5 * 60_000;

export type SyncReason = 'exit' | 'timer' | 'manual' | 'upload';

export interface WorldSyncEnv {
  api: {
    worldSync: () => Promise<WorldSyncStatus>;
    syncWorlds: (worldPath?: string, opts?: { keepalive?: boolean }) => Promise<WorldSyncStatus>;
  };
  /** Re-read the shelf (badges) after a pass that changed something. */
  onChanged: () => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** `document`-like: visibility for the timer and the hidden trigger. */
  doc?: { visibilityState: string; addEventListener: (type: string, fn: () => void) => void; removeEventListener: (type: string, fn: () => void) => void } | null;
}

export interface WorldSync {
  getStatus: () => WorldSyncStatus | null;
  subscribe: (fn: () => void) => () => void;
  /** Read the last pass (no sync). */
  refresh: () => Promise<WorldSyncStatus | null>;
  /** Run a pass now. Resolves with its status (or the previous one when the server has no sync). */
  run: (reason: SyncReason, worldPath?: string) => Promise<WorldSyncStatus | null>;
  /** Timer + hidden trigger. Returns stop. */
  start: () => () => void;
}

export function createWorldSync(env: WorldSyncEnv): WorldSync {
  let status: WorldSyncStatus | null = null;
  let running: Promise<WorldSyncStatus | null> | null = null;
  // An older server (or a hosted seat) without /api/remote/sync: stop asking.
  let unsupported = false;
  const listeners = new Set<() => void>();
  const emit = () => { for (const fn of [...listeners]) fn(); };
  const unsupportedError = (e: unknown) => {
    const s = (e as { status?: number } | null)?.status;
    return s === 404 || s === 403 || s === 405;
  };

  const refresh = async () => {
    if (unsupported) return status;
    try {
      status = await env.api.worldSync();
      emit();
    } catch (e) {
      if (unsupportedError(e)) unsupported = true;
    }
    return status;
  };

  const run = (reason: SyncReason, worldPath?: string) => {
    if (unsupported) return Promise.resolve(status);
    // Signed out (known from the last answer): the timer and the hidden trigger have nothing to do.
    if ((reason === 'timer' || reason === 'exit') && status && !status.signedIn) return Promise.resolve(status);
    if (running) return running;
    running = (async () => {
      status = status ? { ...status, running: true } : status;
      emit();
      try {
        status = await env.api.syncWorlds(worldPath, { keepalive: reason === 'exit' });
        if (syncChangedShelf(status)) env.onChanged();
      } catch (e) {
        if (unsupportedError(e)) unsupported = true;
        else if (status) status = { ...status, running: false, lastError: errorText(e) };
      } finally {
        if (status) status = { ...status, running: false };
        emit();
      }
      return status;
    })().finally(() => { running = null; });
    return running;
  };

  const start = () => {
    const set = env.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    const clear = env.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
    const doc = env.doc ?? null;
    const timer = set(() => { if (!doc || doc.visibilityState === 'visible') void run('timer'); }, SYNC_EVERY_MS);
    const onVisibility = () => { if (doc?.visibilityState === 'hidden') void run('exit'); };
    doc?.addEventListener('visibilitychange', onVisibility);
    void refresh();
    return () => { clear(timer); doc?.removeEventListener('visibilitychange', onVisibility); };
  };

  return {
    getStatus: () => status,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    refresh,
    run,
    start,
  };
}

let installed: WorldSync | null = null;
export const installWorldSync = (sync: WorldSync) => { installed = sync; };
export const worldSync = () => installed;
