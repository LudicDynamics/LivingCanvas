import { useSyncExternalStore } from 'react';

/**
 * The lobby's 「日志」 tab (platform/log v5): entries with platform livingcanvas and surface lobby, newest first,
 * ten a page, read through this app's server (/api/account-data/logs — data GET /v1/public/logs, ETag / 304 on the
 * server side). Signed out works; offline / no data service / an older data without logs = an empty list, so the
 * tab stays hidden and nothing is reported. Asked again with the banners (every five minutes, on focus) and when
 * the board opens; a newer first page replaces the list but keeps the older pages already read below it.
 */
export interface LogItem {
  id: string;
  scope: string;
  category: string;
  title: Record<string, string>;
  body: Record<string, string>;
  publishedAt: string;
  links: Array<{ url: string; label?: string }>;
  tags: string[];
  imageUrl?: string;
}
export interface LobbyLogsState { list: readonly LogItem[]; nextBefore: string | null; loadingMore: boolean }

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MIN_GAP_MS = 60_000;
const MAX_ITEMS = 200;

export interface LobbyLogsEnv { fetch: typeof fetch; now: () => number }

const itemsOf = (raw: unknown): LogItem[] => (Array.isArray(raw) ? raw : []).filter((l): l is LogItem =>
  !!l && typeof l === 'object' && ID.test((l as LogItem).id) && typeof (l as LogItem).publishedAt === 'string' && !!(l as LogItem).title && typeof (l as LogItem).title === 'object');

export function createLobbyLogs(env: LobbyLogsEnv) {
  let state: LobbyLogsState = { list: [], nextBefore: null, loadingMore: false };
  let loadedAt = -Infinity;
  const listeners = new Set<() => void>();
  const set = (next: Partial<LobbyLogsState>) => {
    state = { ...state, ...next };
    for (const l of [...listeners]) l();
  };
  const ask = async (before: string | null): Promise<{ logs: LogItem[]; nextBefore: string | null } | null> => {
    try {
      const res = await env.fetch(`/api/account-data/logs${before ? `?before=${encodeURIComponent(before)}` : ''}`);
      const json = await res.json().catch(() => null);
      if (!json?.ok) return null; // offline / signed-out data off / no logs here: keep what is shown
      return { logs: itemsOf(json.logs), nextBefore: typeof json.nextBefore === 'string' ? json.nextBefore : null };
    } catch {
      return null;
    }
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** The first page again (at most once a minute unless forced). */
    async load(force = false): Promise<void> {
      if (!force && env.now() - loadedAt < MIN_GAP_MS) return;
      loadedAt = env.now();
      const page = await ask(null);
      if (!page) return;
      const ids = new Set(page.logs.map((l) => l.id));
      // pages already read below the first stay (and their cursor), unless the first page is all there is now
      const lastNew = page.logs.at(-1)?.publishedAt ?? '';
      const older = page.nextBefore ? state.list.filter((l) => !ids.has(l.id) && l.publishedAt < lastNew) : [];
      set({ list: [...page.logs, ...older].slice(0, MAX_ITEMS), nextBefore: older.length ? state.nextBefore : page.nextBefore });
    },
    /** The next older page (the 「More」 button). */
    async more(): Promise<void> {
      if (!state.nextBefore || state.loadingMore) return;
      set({ loadingMore: true });
      const page = await ask(state.nextBefore);
      if (!page) { set({ loadingMore: false }); return; }
      const ids = new Set(state.list.map((l) => l.id));
      set({ list: [...state.list, ...page.logs.filter((l) => !ids.has(l.id))].slice(0, MAX_ITEMS), nextBefore: page.nextBefore, loadingMore: false });
    },
  };
}
export type LobbyLogs = ReturnType<typeof createLobbyLogs>;

let instance: LobbyLogs | null = null;
export const lobbyLogs = () => instance;
export function installLobbyLogs(next: LobbyLogs | null): void { instance = next; }
const EMPTY: LobbyLogsState = { list: [], nextBefore: null, loadingMore: false };
const noop = () => () => {};
export function useLobbyLogs(): LobbyLogsState {
  return useSyncExternalStore(instance?.subscribe ?? noop, instance?.getState ?? (() => EMPTY), () => EMPTY);
}
