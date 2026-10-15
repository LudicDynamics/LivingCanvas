import { useEffect, useRef } from 'react';
import { accountData, worldKeyOf } from './account-data.js';
import type { ClosedRunState } from './closed-run.js';
import type { WorldShelf } from './airp-gateway.js';
import { worldTitle } from './world-launcher.js';

/**
 * The 个人页面's own records on this device:
 * what the saves themselves cannot keep, because a replay or a deleted save
 * forgets it —
 *
 *   endings  every ending this device saw (save, world, title, when, run time, turns),
 *            also sent to chronicle (POST /api/profile/ending) so it follows the account;
 *   play     active play time per save, from the turns lib/account-data.ts notes
 *            (gaps over PLAY_GAP_MS count as a fresh start, not as time played);
 *   earned   when each achievement was first seen earned (badges are never taken back);
 *   seen     achievements the page already announced in its 「你获得了…」 line.
 *
 * localStorage only; blocked storage = memory only, nothing breaks.
 */

export const JOURNAL_KEY = 'airp:profile-journal';
/** The pre-existing per-world collection ClosedRun keeps (`airp.endings.<edition>` → { id: title }). */
export const ENDING_COLLECTION_PREFIX = 'airp.endings.';
export const PLAY_GAP_MS = 10 * 60_000;
/** One turn on its own (or after a long break) counts as this much play. */
export const TURN_MS = 2 * 60_000;
const MAX_ENDINGS = 400;
const MAX_PLAY = 300;

export interface JournalEnding {
  saveId: string;
  /** The edition id (chronicle's world ref) and the world key (editions folded). */
  worldRef: string;
  worldKey: string;
  worldName: string | null;
  endingId: string;
  title: string;
  at: string;
  /** The run's first event (closed-run summary), when known. */
  startedAt: string | null;
  turns: number | null;
  /** Sent to chronicle (signed in at the time); unsent ones are retried when the page opens. */
  reported: boolean;
}
export interface JournalPlay { first: number; last: number; ms: number; turns: number }
export interface ProfileJournal {
  endings: JournalEnding[];
  play: Record<string, JournalPlay>;
  earned: Record<string, string>;
  seen: string[];
}

export interface JournalEnv { storage: Pick<Storage, 'getItem' | 'setItem'> | null; now: () => number }
const defaultEnv = (): JournalEnv => {
  let storage: Storage | null = null;
  try { storage = typeof window !== 'undefined' ? window.localStorage : null; } catch { /* blocked */ }
  return { storage, now: () => Date.now() };
};

const empty = (): ProfileJournal => ({ endings: [], play: {}, earned: {}, seen: [] });
let memory: ProfileJournal | null = null;

export function readJournal(env: JournalEnv = defaultEnv()): ProfileJournal {
  try {
    const raw = env.storage?.getItem(JOURNAL_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (!p || typeof p !== 'object') return memory ?? empty();
    return {
      endings: Array.isArray(p.endings) ? p.endings.filter((e: any) => e && typeof e.saveId === 'string' && typeof e.endingId === 'string') : [],
      play: p.play && typeof p.play === 'object' ? p.play : {},
      earned: p.earned && typeof p.earned === 'object' ? p.earned : {},
      seen: Array.isArray(p.seen) ? p.seen.filter((x: unknown) => typeof x === 'string') : [],
    };
  } catch {
    return memory ?? empty();
  }
}

export function writeJournal(next: ProfileJournal, env: JournalEnv = defaultEnv()): void {
  memory = next;
  try { env.storage?.setItem(JOURNAL_KEY, JSON.stringify(next)); } catch { /* full or blocked: memory only */ }
}

/** A turn finished in this save at `at`: the active time grows by the gap, or by one turn after a break. */
export function addTurn(journal: ProfileJournal, saveId: string, at: number): ProfileJournal {
  const had = journal.play[saveId];
  const gap = had ? at - had.last : Infinity;
  const add = gap >= 0 && gap <= PLAY_GAP_MS ? gap : TURN_MS;
  const play = { ...journal.play, [saveId]: { first: had?.first ?? at, last: Math.max(at, had?.last ?? at), ms: (had?.ms ?? 0) + add, turns: (had?.turns ?? 0) + 1 } };
  const ids = Object.keys(play);
  if (ids.length > MAX_PLAY) {
    for (const id of ids.sort((a, b) => play[a].last - play[b].last).slice(0, ids.length - MAX_PLAY)) delete play[id];
  }
  return { ...journal, play };
}

/** An ending seen in a save. The same run's ending (save + ending + start) is kept once. → [journal, added] */
export function addEnding(journal: ProfileJournal, e: Omit<JournalEnding, 'reported'>): [ProfileJournal, JournalEnding | null] {
  if (journal.endings.some((x) => x.saveId === e.saveId && x.endingId === e.endingId && (x.startedAt ?? '') === (e.startedAt ?? ''))) return [journal, null];
  const entry: JournalEnding = { ...e, reported: false };
  return [{ ...journal, endings: [...journal.endings, entry].slice(-MAX_ENDINGS) }, entry];
}

/** The endings ClosedRun's older collection remembers (`airp.endings.<edition>`): titles, no dates. */
export function readEndingCollections(storage: Pick<Storage, 'length' | 'key' | 'getItem'> | null = (() => { try { return window.localStorage; } catch { return null; } })()): { worldRef: string; endingId: string; title: string }[] {
  const out: { worldRef: string; endingId: string; title: string }[] = [];
  if (!storage) return out;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(ENDING_COLLECTION_PREFIX)) continue;
      const worldRef = key.slice(ENDING_COLLECTION_PREFIX.length);
      let parsed: unknown = null;
      try { parsed = JSON.parse(storage.getItem(key) ?? '{}'); } catch { continue; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      for (const [endingId, title] of Object.entries(parsed)) if (typeof title === 'string') out.push({ worldRef, endingId, title });
    }
  } catch { /* storage blocked */ }
  return out;
}

const HEADERS = { 'content-type': 'application/json', 'x-airp-settings': '1' };

/** Send the endings chronicle has not heard of yet (best effort). Signed out: kept for later. */
export async function reportPendingEndings(fetcher: typeof fetch = fetch, env: JournalEnv = defaultEnv()): Promise<void> {
  const pending = readJournal(env).endings.filter((e) => !e.reported).slice(0, 10);
  for (const e of pending) {
    try {
      const res = await fetcher('/api/profile/ending', { method: 'POST', headers: HEADERS, body: JSON.stringify({ saveId: e.saveId, worldRef: e.worldRef, worldName: e.worldName, endingId: e.endingId, title: e.title }) });
      const json = await res.json().catch(() => null);
      if (json?.available === false) return; // signed out / offline: try again next time
      if (!json?.ok && res.status !== 400) continue;
      // reported, or refused for good (bad ids): either way not sent again
      const now = readJournal(env);
      writeJournal({ ...now, endings: now.endings.map((x) => (x === e || (x.saveId === e.saveId && x.endingId === e.endingId && x.startedAt === e.startedAt) ? { ...x, reported: true } : x)) }, env);
    } catch {
      return;
    }
  }
}

type Groups = NonNullable<WorldShelf['groups']>;

/**
 * App's one hook for the journal: counts play time from the turns account-data
 * notes, and records an ending the moment the closed run shows one (then tells
 * chronicle). Renders nothing, owns no UI.
 */
export function useProfileRecorder(run: ClosedRunState, shelf: WorldShelf): void {
  const shelfRef = useRef(shelf);
  shelfRef.current = shelf;

  // play time: a turn noted on THIS device (its summary's time is fresh) adds to the save's active time
  useEffect(() => {
    let data = accountData();
    if (!data) return;
    const turns = new Map(data.getState().saves.map((s) => [s.saveId, s.turns]));
    return data.subscribe(() => {
      data = accountData();
      if (!data) return;
      const now = Date.now();
      let journal: ProfileJournal | null = null;
      for (const s of data.getState().saves) {
        const before = turns.get(s.saveId) ?? 0;
        turns.set(s.saveId, s.turns);
        if (s.turns > before && now - Date.parse(s.updatedAt) < 5_000) journal = addTurn(journal ?? readJournal(), s.saveId, now);
      }
      if (journal) writeJournal(journal);
    });
  }, []);

  // an ending: once per save + ending + run
  const endingKey = run.ending ? `${run.ending.id}#${run.summary?.startedAt ?? ''}` : '';
  // the shelf may arrive after the run: the active save is part of the key, so the ending is recorded then
  const activeSave = (shelf.groups ?? []).flatMap((g) => g.saves).find((s) => s.active)?.id ?? '';
  useEffect(() => {
    if (!run.ending) return;
    const groups: Groups = shelfRef.current.groups ?? [];
    const group = groups.find((g) => g.saves.some((s) => s.active));
    const save = group?.saves.find((s) => s.active);
    if (!group || !save) return;
    const turns = accountData()?.getState().saves.find((s) => s.saveId === save.id)?.turns ?? null;
    const [next, added] = addEnding(readJournal(), {
      saveId: save.id,
      worldRef: group.id,
      worldKey: worldKeyOf(group),
      worldName: worldTitle(group.name),
      endingId: run.ending.id,
      title: run.ending.title,
      at: run.summary?.endedAt ?? new Date().toISOString(),
      startedAt: run.summary?.startedAt ?? null,
      turns,
    });
    if (!added) return;
    writeJournal(next);
    void reportPendingEndings();
  }, [endingKey, activeSave]); // eslint-disable-line react-hooks/exhaustive-deps
}
