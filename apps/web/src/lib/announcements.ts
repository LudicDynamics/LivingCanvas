import { useSyncExternalStore } from 'react';
import { announcePrefsChanged } from './prefs-events.js';

/**
 * 公告 (the top banners): since platform-data v5 these are 日志 with a banner (`log/<id>`, data
 * GET /v1/public/logs?platform=livingcanvas&banner=active); while data is an older deploy, the old
 * platform-wide (`platform/<id>`) and LivingCanvas (`livingcanvas/<id>`) announcements instead. Written by
 * admins in the console, read by everyone — signed in or not — through this app's server
 * (/api/account-data/announcements, which drops the ones not on now). That answer may be minutes old, so
 * the window (starts ≤ now < ends) is checked again here every time it is read, and the list re-renders
 * at the next start / end. Asked again every five minutes and when the window gets focus.
 *
 * Shown only in the launcher (a slim line on top + the 「公告」 list), never over
 * the play screen; in a world the launcher button just carries a small dot while
 * something is unread. Closing one is remembered here and, signed in, follows the
 * account (setting.dismissed, lib/account-data-app.ts).
 */

export interface Announcement {
  id: string;
  level: 'info' | 'maintenance' | 'important';
  title: Record<string, string>;
  body: Record<string, string>;
  startsAt: string;
  endsAt: string | null;
  pinned: boolean;
  /** Optional picture (https) and link (https, or world:<id> = open that world), checked again by the board. */
  imageUrl?: string;
  linkUrl?: string;
  /** log = a 日志 with a banner (shown on top whatever its level); announcement = the old kind */
  source?: 'log' | 'announcement';
  category?: string;
}
export interface AnnouncementsState { list: readonly Announcement[]; dismissed: ReadonlySet<string> }

export const DISMISSED_KEY = 'airp:announcements-dismissed';
// log/<id> = a 日志 entry marked for the lobby (platform/log, surface lobby): shown like an info line, closed on this device only
const ID = /^(platform|livingcanvas|log)\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_DISMISSED = 100;
/** The launcher refreshes every five minutes (lib/account-data-app.ts); a focus never asks more than once a minute (data caches 60 s). */
export const REFRESH_MS = 5 * 60_000;
const MIN_GAP_MS = 60_000;
const DAY_MS = 24 * 3_600_000;

/** On now: starts ≤ now < ends (no end = until it is taken down). */
export function onNow(a: Pick<Announcement, 'startsAt' | 'endsAt'>, now: number): boolean {
  const starts = Date.parse(a.startsAt);
  const ends = a.endsAt ? Date.parse(a.endsAt) : null;
  return Number.isFinite(starts) && starts <= now && !(ends !== null && (!Number.isFinite(ends) || ends <= now));
}

/**
 * The account's copy of closed ids takes only `platform|livingcanvas/<id>` (the data manifest's pattern): a banner
 * log travels as `livingcanvas/log.<id>`. A migrated log (ann-<scope>-<id>) counts as closed when its old
 * announcement (<scope>/<id>) was.
 */
const MIGRATED = /^log\/ann-(platform|livingcanvas)-(.+)$/;
export function syncIdOf(id: string): string | null {
  if (!id.startsWith('log/')) return id;
  const out = `livingcanvas/log.${id.slice(4)}`;
  return ID.test(out) ? out : null;
}
export const localIdOf = (id: string): string => (id.startsWith('livingcanvas/log.') ? `log/${id.slice('livingcanvas/log.'.length)}` : id);
export function isDismissed(dismissed: ReadonlySet<string>, id: string): boolean {
  if (dismissed.has(id)) return true;
  const m = MIGRATED.exec(id);
  return !!m && dismissed.has(`${m[1]}/${m[2]}`);
}

export interface AnnouncementsEnv { fetch: typeof fetch; storage: Pick<Storage, 'getItem' | 'setItem'> | null; now: () => number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (timer: unknown) => void }

export function createAnnouncements(env: AnnouncementsEnv) {
  let dismissed: string[] = [];
  try {
    const raw = JSON.parse(env.storage?.getItem(DISMISSED_KEY) ?? '[]');
    if (Array.isArray(raw)) dismissed = raw.filter((x): x is string => typeof x === 'string' && ID.test(x)).slice(-MAX_DISMISSED);
  } catch { /* nothing remembered */ }
  let state: AnnouncementsState = { list: [], dismissed: new Set(dismissed) };
  let loadedAt = -Infinity;
  let timer: unknown = null;
  const listeners = new Set<() => void>();
  // re-render at the next start / end within a day, so a banner leaves on time even without a new answer
  const schedule = () => {
    if (timer !== null) env.clearTimer?.(timer);
    timer = null;
    if (!env.setTimer) return;
    const now = env.now();
    const next = Math.min(...state.list.flatMap((a) => [Date.parse(a.startsAt), a.endsAt ? Date.parse(a.endsAt) : NaN]).filter((t) => Number.isFinite(t) && t > now && t - now <= DAY_MS));
    if (Number.isFinite(next)) timer = env.setTimer(() => { timer = null; emit(); }, next - now + 50);
  };
  const emit = (list = state.list) => {
    state = { list, dismissed: new Set(dismissed) };
    schedule();
    for (const l of [...listeners]) l();
  };
  const save = () => {
    try { env.storage?.setItem(DISMISSED_KEY, JSON.stringify(dismissed)); } catch { /* memory only */ }
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Ask again (the launcher opened, the five-minute tick, a focus), at most once a minute unless forced. */
    async load(force = false): Promise<void> {
      if (!force && env.now() - loadedAt < MIN_GAP_MS) return;
      loadedAt = env.now();
      try {
        const res = await env.fetch('/api/account-data/announcements');
        const json = await res.json().catch(() => null);
        if (!json?.ok || !Array.isArray(json.announcements)) return; // offline / no data service: show nothing
        emit(json.announcements.filter((a: Announcement) => ID.test(a?.id)));
      } catch { /* offline */ }
    },
    dismiss(id: string): void {
      if (!ID.test(id) || dismissed.includes(id)) return;
      dismissed = [...dismissed, id].slice(-MAX_DISMISSED);
      save();
      emit();
      announcePrefsChanged();
    },
    /** This player's closed ids, for the account copy (banner logs as livingcanvas/log.<id>). */
    dismissedIds: (): string[] => dismissed.map(syncIdOf).filter((x): x is string => x !== null),
    /** Another device closed these too (union: closing is never undone by a sync). */
    mergeDismissed(ids: readonly string[]): void {
      const add = [...new Set(ids.map(localIdOf))].filter((id) => ID.test(id) && !dismissed.includes(id));
      if (!add.length) return;
      dismissed = [...dismissed, ...add].slice(-MAX_DISMISSED);
      save();
      emit();
    },
  };
}
export type Announcements = ReturnType<typeof createAnnouncements>;

/** The text in this interface language, else zh → ja → en → anything (a Korean reader gets English before zh/ja). */
export function localized(text: Record<string, string> | undefined, locale: string): string {
  if (!text) return '';
  const want = locale === 'zh-CN' ? 'zh' : locale;
  return text[want] ?? (want === 'ko' ? text.en : undefined) ?? text.zh ?? text.ja ?? text.en ?? Object.values(text)[0] ?? '';
}

/** The one line on top: a banner log whatever its level; an old announcement only when important / maintenance / pinned. */
export const topBanner = (list: readonly Announcement[]): Announcement | null => list.find((a) => a.source === 'log' || a.pinned || a.level !== 'info') ?? null;

/**
 * The board's comment thread for an entry: an old announcement's own; a banner log has none (comments attach to
 * announcements, worlds, posts) — except one migrated from an old announcement, which keeps that thread.
 */
export function threadOf(id: string): string | null {
  if (!id.startsWith('log/')) return `announcement:${id}`;
  const m = MIGRATED.exec(id);
  return m ? `announcement:${m[1]}/${m[2]}` : null;
}

/** On now (checked again here: the answer may be minutes old). */
export const current = (s: AnnouncementsState, now = Date.now()) => s.list.filter((a) => onNow(a, now));
/** Unread = on now and not closed. */
export const unread = (s: AnnouncementsState, now = Date.now()) => current(s, now).filter((a) => !isDismissed(s.dismissed, a.id));

let instance: Announcements | null = null;
export const announcements = () => instance;
export function installAnnouncements(next: Announcements | null): void { instance = next; }
const EMPTY: AnnouncementsState = { list: [], dismissed: new Set() };
const noop = () => () => {};
export function useAnnouncements(): AnnouncementsState {
  return useSyncExternalStore(instance?.subscribe ?? noop, instance?.getState ?? (() => EMPTY), () => EMPTY);
}
