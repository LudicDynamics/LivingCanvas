/**
 * useAgentActivity.ts — read one surface of the activity store.
 *
 * `items` is already filtered to the surface (and optionally one agent) and
 * capped by the visible limit; `aria` is the whole-rail summary for the sr-only
 * line. Both change with locale, because the chip copy is localised.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useLocale } from '../lib/i18n.js';
import {
  selectAgentActivityLog,
  summariseActivities,
  surfaceForSource,
  SOURCE_NAME_KEYS,
  visibleActivities,
  type ActivityLogQuery,
  type ActivitySurface,
  type AgentActivity,
  type AgentActivityLogTurn,
} from '../lib/agent-activity.js';
import { agentActivityStore } from '../lib/agent-activity-store.js';

export interface AgentActivityView {
  items: readonly AgentActivity[];
  aria: string;
}

export function useAgentActivity(surface: ActivitySurface, agentId?: string): AgentActivityView {
  const snapshot = useSyncExternalStore(
    agentActivityStore.subscribe,
    agentActivityStore.getSnapshot,
    agentActivityStore.getSnapshot,
  );
  const { t } = useLocale();

  const items = useMemo(() => {
    const visible = visibleActivities(snapshot, surface);
    return agentId === undefined ? visible : visible.filter((a) => a.agentId === agentId);
  }, [snapshot, surface, agentId]);

  // Background tabs get their timers throttled, so the 90s stale sweep would
  // arrive late; coming back to the tab advances the clock immediately.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') agentActivityStore.tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const aria = useMemo(() => summariseActivities(items, t), [items, t]);

  return { items, aria };
}
export interface AgentActivityLogView {
  turns: readonly AgentActivityLogTurn[];
  entryCount: number;
  runningCount: number;
  aria: string;
}

export function useAgentActivityLog(query: ActivityLogQuery): AgentActivityLogView {
  const snapshot = useSyncExternalStore(
    agentActivityStore.subscribe,
    agentActivityStore.getLogSnapshot,
    agentActivityStore.getLogSnapshot,
  );
  const { t } = useLocale();
  const turns = useMemo(
    () => selectAgentActivityLog(snapshot, query),
    [snapshot, query.surface, query.agentId, query.turnId, query.since, query.includeTerminal],
  );
  const entryCount = useMemo(
    () => turns.reduce((total, turn) => total + turn.entries.length, 0),
    [turns],
  );
  const failedCount = turns.reduce(
    (total, turn) => total + turn.entries.filter((entry) => entry.state === 'error').length,
    0,
  );
  const runningCount = turns.reduce(
    (total, turn) => total + turn.entries.filter((entry) => entry.state === 'running').length,
    0,
  );
  const completedCount = entryCount - runningCount - failedCount;
  const agents = [...new Set(turns.map((turn) => t(SOURCE_NAME_KEYS[turn.source])))].join(', ');
  const aria = entryCount === 0
    ? ''
    : t('Activity log for {agents}: {count} activities, {running} in progress, {completed} completed, {failed} failed', {
        agents,
        count: entryCount,
        running: runningCount,
        completed: completedCount,
        failed: failedCount,
      });

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') agentActivityStore.tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return { turns, entryCount, runningCount, aria };
}
