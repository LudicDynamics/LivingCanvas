/**
 * agent-activity-store.ts — module store for the `agent_activity` chips
 *. `useSyncExternalStore`-compatible, same shape
 * as lib/dice-ceremony.ts / lib/writer-state.ts.
 *
 * The store owns the canonical snapshots, partitioned by the active save path.
 * Components never listen on `airp:agent-frame` themselves (03 §9.3): `useWorld`'s
 * `agent_activity` case is the single ingest point, and the timer below is the
 * only clock. Each list reference changes only when its content changes, which
 * is what `useSyncExternalStore`'s `Object.is` check needs — and what keeps the
 * 250ms tick from re-rendering an idle rail.
 * tick from re-rendering an idle rail.
 */

import {
  ACTIVITY_LOG_MAX_ENTRIES,
  ACTIVITY_STALE_TTL_MS,
  MAX_VISIBLE_ACTIVITIES,
  normalizeAgentActivityFrame,
  promoteActivities,
  pruneActivities,
  surfaceForSource,
  upsertActivity,
  type ActivitySurface,
  type AgentActivity,
} from './agent-activity.js';

export interface AgentActivityStore {
  subscribe(cb: () => void): () => void;
  /** Select the snapshot for the currently active save; null detaches during a load. */
  selectSave(savePath: string | null): void;
  /** Current exact save root; used to tag commands and fence incoming frames. */
  getActiveSavePath(): string | null;
  /** Check whether a source frame belongs to the active save. */
  isSaveActive(savePath: string | null): boolean;
  getSnapshot(): readonly AgentActivity[];
  /** Bounded terminal-inclusive projection for the complete activity log. */
  getLogSnapshot(): readonly AgentActivity[];
  /** Only entry point: normalize + upsert + prune; sourceSavePath fences late frames. */
  ingest(raw: unknown, now?: number, sourceSavePath?: string | null): boolean;
  /** running → error('cancelled'); used when the character / nook closes. */
  clearSurface(surface: ActivitySurface, now?: number): void;
  /** Hard clear, no fade tail: disconnect. */
  clearAll(): void;
  /** Lazy clock advance (250ms); tests call it directly with an explicit now. */
  tick(now?: number): void;
}

interface AgentActivitySnapshot {
  list: readonly AgentActivity[];
  logList: readonly AgentActivity[];
}

const EMPTY_ACTIVITY_SNAPSHOT: AgentActivitySnapshot = { list: [], logList: [] };

const TICK_MS = 250;

export function createAgentActivityStore(): AgentActivityStore {
  let activeSavePath: string | null = null;
  const savedSnapshots = new Map<string, AgentActivitySnapshot>();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function currentSnapshot(): AgentActivitySnapshot {
    return activeSavePath === null
      ? EMPTY_ACTIVITY_SNAPSHOT
      : savedSnapshots.get(activeSavePath) ?? EMPTY_ACTIVITY_SNAPSHOT;
  }

  function updateSnapshot(snapshot: AgentActivitySnapshot): void {
    if (activeSavePath !== null) savedSnapshots.set(activeSavePath, snapshot);
  }

  function notify(): void {
    for (const cb of listeners) cb();
  }

  function hasClockWork(): boolean {
    const { list, logList } = currentSnapshot();
    return list.length > 0 || logList.some((activity) => activity.state === 'running');
  }

  function armTimer(): void {
    if (timer !== null || !hasClockWork()) return;
    timer = setInterval(() => tick(), TICK_MS);
  }

  function disarmTimer(): void {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  function withPromotions(next: readonly AgentActivity[], now: number): readonly AgentActivity[] {
    let out = promoteActivities(next, 'rail', now, MAX_VISIBLE_ACTIVITIES);
    out = promoteActivities(out, 'character-modal', now, MAX_VISIBLE_ACTIVITIES);
    return out;
  }

  function pruneLogRunning(next: readonly AgentActivity[], now: number): readonly AgentActivity[] {
    let changed = false;
    const out = next.map((activity) => {
      if (activity.state !== 'running' || now - activity.startedAt < ACTIVITY_STALE_TTL_MS) return activity;
      changed = true;
      return { ...activity, state: 'error' as const, errorKind: 'timeout', endedAt: now };
    });
    return changed ? out : next;
  }

  function boundLog(next: readonly AgentActivity[]): readonly AgentActivity[] {
    if (next.length <= ACTIVITY_LOG_MAX_ENTRIES) return next;
    const terminals = next
      .filter((activity) => activity.state !== 'running')
      .sort((a, b) =>
        (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt) ||
        a.activityId.localeCompare(b.activityId),
      );
    const removeCount = Math.min(terminals.length, next.length - ACTIVITY_LOG_MAX_ENTRIES);
    if (removeCount === 0) return next;
    const removed = new Set(terminals.slice(0, removeCount).map((activity) => activity.activityId));
    return next.filter((activity) => !removed.has(activity.activityId));
  }

  function tick(now: number = Date.now()): void {
    const current = currentSnapshot();
    const nextList = withPromotions(pruneActivities(current.list, now), now);
    const nextLog = boundLog(pruneLogRunning(current.logList, now));
    const listChanged = nextList !== current.list;
    const logChanged = nextLog !== current.logList;
    if (listChanged || logChanged) {
      updateSnapshot({
        list: listChanged ? nextList : current.list,
        logList: logChanged ? nextLog : current.logList,
      });
      notify();
    }
    if (!hasClockWork()) disarmTimer();
  }

  function ingest(raw: unknown, now: number = Date.now(), sourceSavePath?: string | null): boolean {
    if (
      activeSavePath === null ||
      (sourceSavePath !== undefined && sourceSavePath !== activeSavePath)
    ) return false;
    const current = currentSnapshot();
    const act = normalizeAgentActivityFrame(raw, now);
    if (act === null) return false;

    const at = act.state === 'running' ? act.startedAt : (act.endedAt ?? act.startedAt);
    const prunedList = pruneActivities(current.list, at);
    const prunedLog = boundLog(pruneLogRunning(current.logList, at));
    const existingLog = prunedLog.find((entry) => entry.activityId === act.activityId);
    const nextLog = boundLog(upsertActivity(prunedLog, act));

    const nextList = existingLog === undefined || existingLog.state === 'running'
      ? withPromotions(upsertActivity(prunedList, act), at)
      : withPromotions(prunedList, at);
    const listChanged = nextList !== current.list;
    const logChanged = nextLog !== current.logList;
    if (!listChanged && !logChanged) return false;
    updateSnapshot({ list: nextList, logList: nextLog });
    armTimer();
    notify();
    return true;
  }

  function clearSurface(surface: ActivitySurface, now: number = Date.now()): void {
    const current = currentSnapshot();
    let changed = false;
    const cancel = (activity: AgentActivity): AgentActivity => {
      changed = true;
      return {
        ...activity,
        state: 'error',
        errorKind: 'cancelled',
        endedAt: now,
        visibleAt: activity.visibleAt ?? now,
      };
    };
    const nextList = current.list.map((activity) =>
      activity.state === 'running' && surfaceForSource(activity.source) === surface
        ? cancel(activity)
        : activity,
    );
    const nextLog = current.logList.map((activity) =>
      activity.state === 'running' && surfaceForSource(activity.source) === surface
        ? cancel(activity)
        : activity,
    );
    if (!changed) return;
    updateSnapshot({ list: nextList, logList: nextLog });
    armTimer();
    notify();
  }

  function selectSave(savePath: string | null): void {
    if (savePath === activeSavePath) return;
    disarmTimer();
    const current = currentSnapshot();
    if (activeSavePath !== null) {
      const now = Date.now();
      const cancelRunning = (activity: AgentActivity): AgentActivity => {
        if (activity.state !== 'running') return activity;
        return {
          ...activity,
          state: 'error',
          errorKind: 'cancelled',
          endedAt: now,
          visibleAt: activity.visibleAt ?? now,
        };
      };
      if (current.logList.some((activity) => activity.state === 'running')) {
        savedSnapshots.set(activeSavePath, {
          list: current.list.map(cancelRunning),
          logList: current.logList.map(cancelRunning),
        });
      } else {
        savedSnapshots.set(activeSavePath, current);
      }
    }
    activeSavePath = savePath;
    armTimer();
    notify();
  }

  function getActiveSavePath(): string | null {
    return activeSavePath;
  }
  function isSaveActive(savePath: string | null): boolean {
    return savePath !== null && savePath === activeSavePath;
  }

  function clearAll(): void {
    disarmTimer();
    const current = currentSnapshot();
    savedSnapshots.clear();
    if (current.list.length === 0 && current.logList.length === 0) return;
    notify();
  }

  function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    if (hasClockWork()) armTimer();
    return () => listeners.delete(cb);
  }

  return {
    subscribe,
    selectSave,
    getActiveSavePath,
    isSaveActive,
    getSnapshot: () => currentSnapshot().list,
    getLogSnapshot: () => currentSnapshot().logList,
    ingest,
    clearSurface,
    clearAll,
    tick,
  };
}

/** Singleton wired into `useWorld` / `App` / the rails. */
export const agentActivityStore: AgentActivityStore = createAgentActivityStore();

/** Test seam: reset the singleton between cases (mirrors resetSeenForTest). */
export function resetAgentActivityForTest(): void {
  agentActivityStore.clearAll();
}
