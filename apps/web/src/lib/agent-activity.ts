/**
 * agent-activity.ts — pure state machine for the `agent_activity` perception
 * frame.
 *
 * No React, no DOM, no `window`: `node:test` imports this file directly through
 * jiti (same bootstrap as test/ghost.test.mjs), which is why de-dup / TTL /
 * queueing must live here instead of inside a React effect.
 *
 * The frame is a *presentation-only* channel. It never touches the world event
 * table, never drives a request and never reaches TTS (contract §5.4): a lost
 * frame costs nothing, because `world_event` remains the truth of what changed.
 */

// ---- Frozen constants (contract §3.2; 04 asserts the exact numbers) ----

/** Terminal `ok` chip lingers this long after it becomes visible (ms). */
export const ACTIVITY_COMPLETE_TTL_MS = 2400;
/** Terminal `error` chip lingers this long after it becomes visible (ms). */
export const ACTIVITY_FAILED_TTL_MS = 4500;
/** A `running` chip with no terminal within this window fails as `timeout`. */
export const ACTIVITY_STALE_TTL_MS = 90000;
/** Simultaneous visible chips per surface (terminal chips hold a slot too). */
export const MAX_VISIBLE_ACTIVITIES = 3;
/** Bounded in-memory history retained after a rail chip expires. */
export const ACTIVITY_LOG_MAX_ENTRIES = 200;

// ---- Types ----

export type ActivitySource = 'writer' | 'character' | 'functional';
/** Where a chip is allowed to appear (contract §2.2 / §7). */
export type ActivitySurface = 'rail' | 'character-modal';
export type ActivityState = 'running' | 'ok' | 'error';
export type ActivityPhase = 'started' | 'completed' | 'failed';
export type ActivityOperation =
  | 'read'
  | 'create'
  | 'write'
  | 'edit'
  | 'delete'
  | 'move'
  | 'use'
  | 'look'
  | 'roll'
  | 'choose'
  | 'initialize'
  | 'memory'
  | 'other';

/** Wire shape, verbatim from contract §3. Frontend never renames a field. */
export interface AgentActivityFrame {
  type: 'agent_activity';
  source: ActivitySource;
  agentId: string;
  turnId: string;
  activityId: string;
  phase: ActivityPhase;
  operation: ActivityOperation;
  subject?: string;
  toolName?: string;
  error?: string;
  timestamp: string;
}

/** One chip. `activityId` is the only identity — never rendered (§3.2). */
export interface AgentActivity {
  activityId: string;
  source: ActivitySource;
  agentId: string;
  turnId: string;
  operation: ActivityOperation;
  subject?: string;
  state: ActivityState;
  /** Server failure summary ('timeout' | 'cancelled' | …); text is NOT shown. */
  errorKind?: string;
  /** ms epoch of `started` (or of the frame that created the chip). */
  startedAt: number;
  /** ms epoch of the terminal transition. */
  endedAt?: number;
  /**
   * First moment this chip occupied a visible slot. A queued terminal chip has
   * no `visibleAt`, so its TTL does not start until it is actually shown.
   */
  visibleAt?: number;
}

/** Translation function shape (`useLocale().t`). */
export type TFn = (key: string, values?: Record<string, string | number>) => string;
export type ActivityLogScope = 'rail' | 'character-modal';

export interface ActivityLogQuery {
  surface: ActivityLogScope;
  /** Character logs must provide the stable `character:<id>` agent id. */
  agentId?: string;
  /** Optionally limit the projection to one engine turn. */
  turnId?: string;
  /** Exclude records from an earlier character-modal session. */
  since?: number;
  /** Defaults to true; false keeps only activities still running. */
  includeTerminal?: boolean;
}

export interface AgentActivityLogTurn {
  source: ActivitySource;
  agentId: string;
  turnId: string;
  state: ActivityState;
  entries: readonly AgentActivity[];
  startedAt: number;
  endedAt?: number;
}

// ---- Boundary guard ----

const SOURCES: readonly ActivitySource[] = ['writer', 'character', 'functional'];
const PHASES: readonly ActivityPhase[] = ['started', 'completed', 'failed'];
const OPERATIONS: readonly ActivityOperation[] = [
  'read', 'create', 'write', 'edit', 'delete', 'move',
  'use', 'look', 'roll', 'choose', 'initialize', 'memory', 'other',
];

function isSource(value: unknown): value is ActivitySource {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value);
}
function isPhase(value: unknown): value is ActivityPhase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value);
}
function isOperation(value: unknown): value is ActivityOperation {
  return typeof value === 'string' && (OPERATIONS as readonly string[]).includes(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** ISO timestamp → ms epoch; an unparsable value falls back to the injected `now`. */
function parseTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'string') {
    const at = Date.parse(value);
    if (Number.isFinite(at)) return at;
  }
  return fallback;
}

/**
 * Boundary guard + field mapping (contract §3). A malformed frame (missing
 * `activityId`, illegal `source`/`phase`, wrong frame type) returns `null` —
 * the whole frame is dropped, never half-rendered. An unknown `operation` is
 * coerced to `'other'` so a future server tool can never break rendering.
 */
export function normalizeAgentActivityFrame(raw: unknown, now: number = Date.now()): AgentActivity | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (o.type !== 'agent_activity') return null;
  if (!isSource(o.source)) return null;
  if (!isPhase(o.phase)) return null;
  if (!nonEmpty(o.activityId)) return null;

  // `agentId` / `turnId` are free-form strings, but an empty one cannot route
  // to a surface or de-dup, so it is as malformed as a missing field.
  const agentId = nonEmpty(o.agentId) ? o.agentId.trim() : '';
  const turnId = nonEmpty(o.turnId) ? o.turnId.trim() : '';
  const activityId = o.activityId.trim();
  if (agentId === '' || turnId === '' || activityId === '') return null;

  const at = parseTimestamp(o.timestamp, now);
  const state: ActivityState =
    o.phase === 'started' ? 'running' : o.phase === 'completed' ? 'ok' : 'error';

  const act: AgentActivity = {
    activityId,
    source: o.source,
    agentId,
    turnId,
    operation: isOperation(o.operation) ? o.operation : 'other',
    subject: nonEmpty(o.subject) ? o.subject.trim() : undefined,
    state,
    startedAt: at,
  };
  // `toolName` is deliberately not carried over: it must never reach the UI.
  if (state !== 'running') {
    act.endedAt = at;
    act.errorKind = nonEmpty(o.error) ? o.error.trim() : undefined;
  }
  return act;
}

// ---- Merge / queue / expiry ----

function byIdOrder(a: AgentActivity, b: AgentActivity): number {
  if (a.activityId < b.activityId) return -1;
  if (a.activityId > b.activityId) return 1;
  return 0;
}

/**
 * Idempotent merge by `activityId` (contract §3.2, state machine §4).
 *
 * - unknown id → appended;
 * - a duplicate `started` on a running chip is swallowed (no second chip, and
 *   `startedAt` is not refreshed);
 * - a terminal chip absorbs every later frame, including an out-of-order
 *   `started` — the frozen frame has no `seq`, so "terminal never regresses"
 *   replaces last-write-wins (03 §4).
 */
export function upsertActivity(list: readonly AgentActivity[], next: AgentActivity): readonly AgentActivity[] {
  const index = list.findIndex((a) => a.activityId === next.activityId);
  if (index === -1) return [...list, next];

  const cur = list[index];
  if (cur.state !== 'running') return list; // absorbing terminal
  if (next.state === 'running') return list; // duplicate started: keep the original

  const merged: AgentActivity = {
    ...cur,
    state: next.state,
    operation: next.operation,
    subject: next.subject ?? cur.subject,
    errorKind: next.errorKind,
    endedAt: next.endedAt ?? next.startedAt,
  };
  const out = list.slice();
  out[index] = merged;
  return out;
}

/** `writer` / `functional` share the global rail; `character` has its own. */
export function surfaceForSource(source: ActivitySource): ActivitySurface {
  return source === 'character' ? 'character-modal' : 'rail';
}

/**
 * Promote queued chips into free visible slots, oldest `startedAt` first. A
 * promoted chip gets `visibleAt = now`, which is what starts a terminal TTL —
 * so a queued terminal is never dropped before the player ever saw it (§7.3).
 */
export function promoteActivities(
  list: readonly AgentActivity[],
  surface: ActivitySurface,
  now: number,
  limit: number = MAX_VISIBLE_ACTIVITIES,
): readonly AgentActivity[] {
  const mine = list.filter((a) => surfaceForSource(a.source) === surface);
  const visibleCount = mine.filter((a) => a.visibleAt !== undefined).length;
  const slots = limit - visibleCount;
  if (slots <= 0) return list;

  const queued = mine
    .filter((a) => a.visibleAt === undefined)
    .sort((a, b) => a.startedAt - b.startedAt || byIdOrder(a, b));
  if (queued.length === 0) return list;

  const promoted = new Set(queued.slice(0, slots).map((a) => a.activityId));
  return list.map((a) => (promoted.has(a.activityId) ? { ...a, visibleAt: now } : a));
}

/**
 * Expiry sweep (contract §3.2): a `running` chip older than the stale window
 * becomes `error('timeout')`; a *visible* terminal chip is removed once its own
 * TTL has elapsed since `visibleAt`. A queued terminal has no `visibleAt` and
 * is therefore never expired while it waits.
 */
export function pruneActivities(list: readonly AgentActivity[], now: number = Date.now()): readonly AgentActivity[] {
  let changed = false;
  const out: AgentActivity[] = [];

  for (const a of list) {
    if (a.state === 'running') {
      if (now - a.startedAt >= ACTIVITY_STALE_TTL_MS) {
        changed = true;
        out.push({ ...a, state: 'error', errorKind: 'timeout', endedAt: now });
      } else {
        out.push(a);
      }
      continue;
    }
    if (a.visibleAt === undefined) {
      out.push(a); // still queued: TTL has not started
      continue;
    }
    // TTL runs from the later of "became terminal" and "became visible": the
    // terminal chip stays 2.4s/4.5s *after the tool finished* (03 §7.1), while a
    // chip that finished while queued still gets its full TTL once promoted,
    // because `visibleAt` is then the later moment (§7.3).
    const anchor = Math.max(a.visibleAt, a.endedAt ?? a.visibleAt);
    const ttl = a.state === 'error' ? ACTIVITY_FAILED_TTL_MS : ACTIVITY_COMPLETE_TTL_MS;
    if (now - anchor >= ttl) {
      changed = true;
      continue; // drop
    }
    out.push(a);
  }

  return changed ? out : list;
}

/**
 * Visible chips for one surface, oldest first. Only entries that already hold
 * a `visibleAt` are returned; `startedAt`/`visibleAt` ascending is the order,
 * with `activityId` as the stable tie-break.
 */
export function visibleActivities(
  list: readonly AgentActivity[],
  surface: ActivitySurface,
  limit: number = MAX_VISIBLE_ACTIVITIES,
): readonly AgentActivity[] {
  return list
    .filter((a) => surfaceForSource(a.source) === surface && a.visibleAt !== undefined)
    .sort(
      (a, b) =>
        (a.visibleAt as number) - (b.visibleAt as number) ||
        a.startedAt - b.startedAt ||
        byIdOrder(a, b),
    )
    .slice(0, limit);
}

/**
 * Return the bounded, safe activity records visible on one log surface.
 *
 * This is deliberately a projection over normalized records. It never reads
 * wire frames and never uses `toolName`, `errorKind`, or any other internal
 * detail to create copy.
 */
export function selectAgentActivityLogEntries(
  records: readonly AgentActivity[],
  query: ActivityLogQuery,
): readonly AgentActivity[] {
  if (
    query.surface === 'character-modal' &&
    (!query.agentId || !query.agentId.startsWith('character:') || query.agentId.length <= 'character:'.length)
  ) {
    return [];
  }
  let seen: readonly AgentActivity[] = [];
  for (const record of records) {
    if (surfaceForSource(record.source) !== query.surface) continue;
    if (query.surface === 'character-modal' && record.agentId !== query.agentId) continue;
    if (query.surface === 'rail' && query.agentId !== undefined && record.agentId !== query.agentId) continue;
    if (query.turnId !== undefined && record.turnId !== query.turnId) continue;
    if (query.since !== undefined && record.startedAt < query.since) continue;
    if (query.includeTerminal === false && record.state !== 'running') continue;
    seen = upsertActivity(seen, record);
  }

  return [...seen].sort((a, b) => a.startedAt - b.startedAt || byIdOrder(a, b));
}

/**
 * Group safe activity records by source, agent and engine turn. The key is
 * intentionally never exposed by the UI; it only preserves turn boundaries.
 */
export function selectAgentActivityLog(
  records: readonly AgentActivity[],
  query: ActivityLogQuery,
): readonly AgentActivityLogTurn[] {
  const entries = selectAgentActivityLogEntries(records, query);
  const groups = new Map<string, AgentActivity[]>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.source, entry.agentId, entry.turnId]);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const turns: AgentActivityLogTurn[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.startedAt - b.startedAt || byIdOrder(a, b));
    const running = group.some((entry) => entry.state === 'running');
    const hasError = group.some((entry) => entry.state === 'error');
    const lastEndedAt = group.reduce<number | undefined>(
      (latest, entry) => entry.endedAt === undefined ? latest : Math.max(latest ?? entry.endedAt, entry.endedAt),
      undefined,
    );
    turns.push({
      source: group[0].source,
      agentId: group[0].agentId,
      turnId: group[0].turnId,
      state: running ? 'running' : hasError ? 'error' : 'ok',
      entries: group,
      startedAt: group[0].startedAt,
      endedAt: running ? undefined : lastEndedAt,
    });
  }

  return turns.sort((a, b) =>
    b.startedAt - a.startedAt ||
    a.entries[0].activityId.localeCompare(b.entries[0].activityId) ||
    a.source.localeCompare(b.source) ||
    a.agentId.localeCompare(b.agentId) ||
    a.turnId.localeCompare(b.turnId),
  );
}

// ---- Chips copy ----

/**
 * `{with}` is the sentence with `{subject}`; `{without}` is the same sentence
 * with the whole object slot removed. `activityLabel` picks one — it never
 * rewrites the sentence at runtime, and neither table may be a template glued
 * from fragments (LC10 asserts the two key sets line up operation by operation).
 *
 * Keys are the English copy itself (i18n.ts: `key = en`), so every entry here
 * must exist in messages.json with a non-empty `zh-CN` and `ja`.
 */
interface LabelPair {
  with: string;
  without: string;
}

export const RUNNING_KEYS: Readonly<Record<ActivityOperation, LabelPair>> = {
  read: { with: 'Reading {subject}…', without: 'Reading…' },
  look: { with: 'Reading {subject}…', without: 'Reading…' },
  create: { with: 'Creating {subject}…', without: 'Creating…' },
  write: { with: 'Writing {subject}…', without: 'Writing…' },
  edit: { with: 'Editing {subject}…', without: 'Editing…' },
  delete: { with: 'Deleting {subject}…', without: 'Deleting…' },
  move: { with: 'Moving {subject}…', without: 'Moving…' },
  use: { with: 'Using {subject}…', without: 'Using…' },
  roll: { with: 'Rolling the dice…', without: 'Rolling the dice…' },
  choose: { with: 'Making a choice…', without: 'Making a choice…' },
  initialize: { with: 'Preparing the scene…', without: 'Preparing the scene…' },
  memory: { with: 'Remembering…', without: 'Remembering…' },
  other: { with: 'Working…', without: 'Working…' },
};

export const OK_KEYS: Readonly<Record<ActivityOperation, LabelPair>> = {
  read: { with: 'Read {subject}', without: 'Read' },
  look: { with: 'Read {subject}', without: 'Read' },
  create: { with: 'Created {subject}', without: 'Created' },
  write: { with: 'Wrote {subject}', without: 'Wrote' },
  edit: { with: 'Edited {subject}', without: 'Edited' },
  delete: { with: 'Deleted {subject}', without: 'Deleted' },
  move: { with: 'Moved {subject}', without: 'Moved' },
  use: { with: 'Used {subject}', without: 'Used' },
  roll: { with: 'Rolled the dice', without: 'Rolled the dice' },
  choose: { with: 'Chose an option', without: 'Chose an option' },
  initialize: { with: 'Scene is ready', without: 'Scene is ready' },
  memory: { with: 'Remembered', without: 'Remembered' },
  other: { with: 'Done', without: 'Done' },
};

export const ERROR_KEYS: Readonly<Record<ActivityOperation, LabelPair>> = {
  read: { with: 'Could not read {subject}', without: 'Could not read' },
  look: { with: 'Could not read {subject}', without: 'Could not read' },
  create: { with: 'Could not create {subject}', without: 'Could not create' },
  write: { with: 'Could not write {subject}', without: 'Could not write' },
  edit: { with: 'Could not edit {subject}', without: 'Could not edit' },
  delete: { with: 'Could not delete {subject}', without: 'Could not delete' },
  move: { with: 'Could not move {subject}', without: 'Could not move' },
  use: { with: 'Could not use {subject}', without: 'Could not use' },
  roll: { with: 'Could not roll the dice', without: 'Could not roll the dice' },
  choose: { with: 'Could not make that choice', without: 'Could not make that choice' },
  initialize: { with: 'Could not prepare the scene', without: 'Could not prepare the scene' },
  memory: { with: 'Could not remember', without: 'Could not remember' },
  other: { with: 'That action failed', without: 'That action failed' },
};

/** `{name}` defaults per source; a raw internal id (`scene-init`) is never shown. */
export const SOURCE_NAME_KEYS: Readonly<Record<ActivitySource, string>> = {
  writer: 'Writer',
  character: 'Character',
  functional: 'Background task',
};

/**
 * Chip copy. Only `operation` / `state` / `subject` participate — there is no
 * parameter for `toolName`, args or paths, so none of them can leak (§8.1).
 */
export function activityLabel(act: AgentActivity, t: TFn): string {
  if (act.state === 'error') {
    // Timeout / cancel are not tool failures: showing "Could not read …" would
    // read as a broken file, so these two override the per-operation copy.
    if (act.errorKind === 'timeout') return t('Took too long');
    if (act.errorKind === 'cancelled') return t('Stopped');
    const key = ERROR_KEYS[act.operation] ?? ERROR_KEYS.other;
    return act.subject ? t(key.with, { subject: act.subject }) : t(key.without);
  }
  if (act.state === 'ok') {
    const key = OK_KEYS[act.operation] ?? OK_KEYS.other;
    return act.subject ? t(key.with, { subject: act.subject }) : t(key.without);
  }
  const key = RUNNING_KEYS[act.operation] ?? RUNNING_KEYS.other;
  return act.subject ? t(key.with, { subject: act.subject }) : t(key.without);
}

/**
 * Screen-reader sentence: names the agent, because two agents can be running
 * at once in the global rail. Never includes `errorKind` text either.
 */
export function activityAriaText(act: AgentActivity, t: TFn): string {
  const name = t(SOURCE_NAME_KEYS[act.source] ?? SOURCE_NAME_KEYS.functional);
  if (act.state === 'error') {
    if (act.errorKind === 'timeout') return t('{name} took too long', { name });
    if (act.errorKind === 'cancelled') return t('{name} stopped', { name });
    return act.subject
      ? t('{name} could not use {subject}', { name, subject: act.subject })
      : t('{name} could not act', { name });
  }
  if (act.state === 'ok') {
    return act.subject
      ? t('{name} finished {subject}', { name, subject: act.subject })
      : t('{name} is done', { name });
  }
  return act.subject
    ? t('{name} is reading {subject}…', { name, subject: act.subject })
    : t('{name} is working…', { name });
}

/** Whole-rail summary for the sr-only line; empty when nothing is visible. */
export function summariseActivities(list: readonly AgentActivity[], t: TFn): string {
  if (list.length === 0) return '';
  const running = list.filter((a) => a.state === 'running').length;
  if (running > 0) {
    return running === 1
      ? t('{count} action in progress', { count: running })
      : t('{count} actions in progress', { count: running });
  }
  return list.length === 1
    ? t('{count} action finished', { count: list.length })
    : t('{count} actions finished', { count: list.length });
}
