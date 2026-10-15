/**
 * Whether the 「选择世界」 shelf opens by itself in the lobby (smoke test 2026-10-05). On a wide screen it sits beside
 * the wall and opens as before. On a phone (≤ 520px) it covered most of the lobby, the tiles' 「开始新游戏」
 * included, so there it starts collapsed — the 「存档」 pill toggles it — and the player's last open / close on a
 * phone is remembered on this device.
 */
export const NARROW_SHELF_QUERY = '(max-width: 520px)';
export const WORLD_SHELF_KEY = 'airp.worldShelf.narrow';

type Env = { matchMedia?: (query: string) => { matches: boolean }; storage?: Pick<Storage, 'getItem' | 'setItem'> | null };

function env(): Env {
  if (typeof window === 'undefined') return {};
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* blocked */ }
  return { matchMedia: window.matchMedia?.bind(window), storage };
}

export function isNarrowShelfViewport(e: Env = env()): boolean {
  return e.matchMedia?.(NARROW_SHELF_QUERY).matches ?? false;
}

/** Open the shelf on its own (no world loaded)? Wide: yes. Narrow: only if the player last left it open here. */
export function autoOpenWorldShelf(e: Env = env()): boolean {
  if (!isNarrowShelfViewport(e)) return true;
  try { return e.storage?.getItem(WORLD_SHELF_KEY) === 'open'; } catch { return false; }
}

/** The player opened / closed the shelf: remembered for phones only (a wide screen keeps opening it). */
export function rememberWorldShelf(open: boolean, e: Env = env()): void {
  if (!isNarrowShelfViewport(e)) return;
  try { e.storage?.setItem(WORLD_SHELF_KEY, open ? 'open' : 'closed'); } catch { /* blocked: not remembered */ }
}
