import { useSyncExternalStore } from 'react';
import type { WorldEvent } from '@airp/shared';

/** The only world-event types that may become a transient world toast. */
export const WORLD_TOAST_EVENT_TYPES = [
  'entity_created',
  'entity_moved',
  'entity_deleted',
  'entity_edited',
  'choice_selected',
  'roll_resolved',
  'use_item_on',
  'layer_entered',
  'layer_initialized',
  'layer_init_failed',
] as const;

export type WorldToastEventType = (typeof WORLD_TOAST_EVENT_TYPES)[number];

export const WORLD_TOAST_BATCH_WINDOW_MS = 900;
export const WORLD_TOAST_CHANGED_TTL_MS = 3600;
export const WORLD_TOAST_FAILED_TTL_MS = 6000;
export const WORLD_TOAST_MAX_VISIBLE = 3;
export const WORLD_TOAST_MAX_QUEUE = 12;
export const WORLD_TOAST_SEEN_LIMIT = 200;

const ENTITY_TYPES = new Set<WorldToastEventType>([
  'entity_created',
  'entity_moved',
  'entity_deleted',
  'entity_edited',
]);

const ACTOR_TYPES = new Set(['player', 'god', 'writer', 'character', 'engine']);
const ENTITY_KIND_VALUES = new Set(['chalk', 'component', 'note', 'letter', 'other']);

export interface WorldToastEntry {
  /** The event id, or the first event id when this entry is a visual batch. */
  key: string;
  readonly eventIds: readonly string[];
  latestSeq: number;
  type: WorldToastEventType | 'entity_batch';
  layer: string | null;
  status: 'changed' | 'recorded' | 'failed';
  /** English fallback, also useful to non-React consumers and tests. */
  message: string;
  detail: string | null;
  createdAt: string;
  expiresAt: number;
  /** Message key/values let the rendering adapter localize without re-reading detail. */
  readonly messageKey?: string;
  readonly messageValues?: Readonly<Record<string, string | number>>;
}

export interface WorldToastState {
  readonly visible: readonly WorldToastEntry[];
  readonly queued: readonly WorldToastEntry[];
  readonly seenIds: ReadonlySet<string>;
  readonly lastSeq: number | null;
}

export type WorldToastAction =
  | { type: 'world-event'; event: WorldEvent; now: number }
  | { type: 'tick'; now: number }
  | { type: 'dismiss'; key: string }
  | { type: 'reset'; reason: 'world-switch' | 'reconnect' | 'layer-switch' };

interface EntityBatchItem {
  eventId: string;
  seq: number;
  type: WorldToastEventType;
  name: string;
}

interface InternalToastEntry extends WorldToastEntry {
  projectId: string;
  lastIngestAt: number;
  batchItems?: readonly EntityBatchItem[];
}

const MESSAGE_KEYS = {
  created: 'Created "{name}". The object is now in {layer}. Next step: open it to view its contents.',
  moved: '"{name}" moved to {to}. Its position is updated. Next step: view it in its new location.',
  movedDangling: '"{name}" moved to {to}. Its position is updated; {dangling} references need checking. Next step: view it in its new location.',
  deleted: 'Deleted "{name}". The object is no longer at its original location. Next step: review the current scene.',
  edited: '"{name}" updated. The object change is recorded. Next step: open it again to review.',
  choice: 'Choice "{choice}" recorded for {name}. Next step: review the scene or wait for a response.',
  rollPassed: 'The roll for "{name}" is settled: {result}, passed. Next step: review the scene according to the result.',
  rollFailed: 'The roll for "{name}" is settled: {result}, not passed. Next step: review the scene according to the result.',
  useItem: 'Recorded using "{itemName}" on "{targetName}". Next step: check whether the target shows a clear change.',
  entered: 'Entered "{name}". The current scene has changed. Next step: review this layer for clues.',
  initialized: '"{name}" finished initializing. Scene content is in place. Next step: open the scene to review it.',
  initFailedTemplate: '"{layerName}" is not initialized yet. Reason: {reason}. Next step: view the template and retry.',
  initFailedNone: '"{layerName}" is not initialized yet. Reason: {reason}. Next step: return to the previous layer or retry later.',
  batchSame: '{count} {verb} objects. Objects: {objects}. Next step: open the scene to review them.',
  batchMixed: 'Scene updated {count} items. Objects: {objects}. Next step: review the current layer.',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteNow(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function interpolate(key: string, values: Record<string, string | number>): string {
  return key.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

function basename(value: string): string {
  const clean = value.replace(/\\/g, '/').replace(/\/$/, '');
  const last = clean.slice(clean.lastIndexOf('/') + 1);
  return last || clean || 'the current scene';
}

function layerLabel(event: WorldEvent): string {
  return event.layer ? basename(event.layer) : 'the current scene';
}

function safeReason(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/]+/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'the server did not provide a reason';
}

function objectNames(items: readonly EntityBatchItem[]): string {
  const names = items.map((item) => item.name);
  if (names.length <= 2) return names.join(', ');
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more`;
}

function actorLabel(event: WorldEvent): string {
  return event.actor?.type ?? 'unknown';
}

function detailFor(event: WorldEvent, items?: readonly EntityBatchItem[]): string {
  const base = `event ${event.id} · seq ${event.seq} · type ${event.type} · actor ${actorLabel(event)}`;
  const layer = event.layer ? ` · layer ${event.layer}` : '';
  if (items && items.length > 1) {
    return `${base}${layer} · events ${items.map((item) => item.eventId).join(', ')}`;
  }
  const detail = event.detail as Record<string, unknown>;
  const fields = ['path', 'from', 'to', 'choice', 'dice', 'desc', 'expect', 'item', 'target', 'by', 'fallback']
    .filter((key) => nonEmptyString(detail[key]))
    .map((key) => `${key} ${String(detail[key])}`);
  if (typeof detail.result === 'number') fields.push(`result ${detail.result}`);
  if (typeof detail.passed === 'boolean') fields.push(`passed ${detail.passed}`);
  if (typeof detail.index === 'number') fields.push(`index ${detail.index}`);
  return `${base}${layer}${fields.length ? ` · ${fields.join(' · ')}` : ''}`;
}

function validBaseEvent(event: unknown): event is WorldEvent {
  if (!isRecord(event)) return false;
  if (!Number.isInteger(event.seq) || Number(event.seq) < 1) return false;
  if (!nonEmptyString(event.id) || !nonEmptyString(event.projectId)) return false;
  if (!nonEmptyString(event.type) || !isRecord(event.actor) || !ACTOR_TYPES.has(String(event.actor.type))) return false;
  if (!(event.layer === null || typeof event.layer === 'string')) return false;
  if (!(event.subject === null || typeof event.subject === 'string')) return false;
  if (!(event.turn === null || typeof event.turn === 'string')) return false;
  if (!isRecord(event.detail) || !nonEmptyString(event.createdAt)) return false;
  return (WORLD_TOAST_EVENT_TYPES as readonly string[]).includes(event.type);
}

function validDetail(event: WorldEvent): boolean {
  const detail = event.detail as Record<string, unknown>;
  const stringFields = (fields: readonly string[]) => fields.every((key) => nonEmptyString(detail[key]));
  switch (event.type) {
    case 'entity_created':
      return stringFields(['path', 'name', 'kind']) && ENTITY_KIND_VALUES.has(String(detail.kind));
    case 'entity_edited':
      return stringFields(['path', 'name', 'kind']);
    case 'entity_deleted':
      return stringFields(['path', 'name']);
    case 'entity_moved':
      return stringFields(['from', 'to', 'name'])
        && Number.isInteger(detail.rewrote) && Number(detail.rewrote) >= 0
        && Number.isInteger(detail.dangling) && Number(detail.dangling) >= 0;
    case 'choice_selected':
      return stringFields(['path', 'name', 'choice']) && Number.isInteger(detail.index) && Number(detail.index) >= 1;
    case 'roll_resolved':
      return stringFields(['path', 'name', 'dice', 'desc', 'expect'])
        && typeof detail.result === 'number' && Number.isFinite(detail.result)
        && typeof detail.passed === 'boolean';
    case 'use_item_on':
      return stringFields(['item', 'itemName', 'target', 'targetName']);
    case 'layer_entered':
      return stringFields(['layer', 'name']) && typeof detail.first === 'boolean';
    case 'layer_initialized':
      return stringFields(['layer', 'name']) && ['writer', 'player', 'engine'].includes(String(detail.by))
        && Array.isArray(detail.files) && detail.files.every((file) => typeof file === 'string');
    case 'layer_init_failed':
      return stringFields(['layer', 'reason']) && ['template', 'none'].includes(String(detail.fallback));
    default:
      return false;
  }
}

/** The player's own sticky notes: they just did it; no toast. */
function isPlayerNoteEvent(event: WorldEvent): boolean {
  return (event.detail as Record<string, unknown> | undefined)?.playerNote === true;
}

function makeEntry(event: WorldEvent, now: number): InternalToastEntry | null {
  if (!validBaseEvent(event) || !validDetail(event) || isPlayerNoteEvent(event)) return null;
  const detail = event.detail as Record<string, unknown>;
  const failed = event.type === 'layer_init_failed';
  let messageKey: string;
  let values: Record<string, string | number>;
  let layer = event.layer;
  switch (event.type) {
    case 'entity_created':
      messageKey = MESSAGE_KEYS.created;
      values = { name: String(detail.name), layer: layerLabel(event) };
      break;
    case 'entity_moved': {
      const dangling = Number(detail.dangling);
      messageKey = dangling > 0 ? MESSAGE_KEYS.movedDangling : MESSAGE_KEYS.moved;
      values = { name: String(detail.name), to: basename(String(detail.to)), dangling };
      break;
    }
    case 'entity_deleted':
      messageKey = MESSAGE_KEYS.deleted;
      values = { name: String(detail.name) };
      break;
    case 'entity_edited':
      messageKey = MESSAGE_KEYS.edited;
      values = { name: String(detail.name) };
      break;
    case 'choice_selected':
      messageKey = MESSAGE_KEYS.choice;
      values = { choice: String(detail.choice), name: String(detail.name) };
      break;
    case 'roll_resolved':
      messageKey = detail.passed ? MESSAGE_KEYS.rollPassed : MESSAGE_KEYS.rollFailed;
      values = { name: String(detail.name), result: Number(detail.result) };
      break;
    case 'use_item_on':
      messageKey = MESSAGE_KEYS.useItem;
      values = { itemName: String(detail.itemName), targetName: String(detail.targetName) };
      break;
    case 'layer_entered':
      messageKey = MESSAGE_KEYS.entered;
      values = { name: String(detail.name) };
      layer = String(detail.layer);
      break;
    case 'layer_initialized':
      messageKey = MESSAGE_KEYS.initialized;
      values = { name: String(detail.name) };
      layer = String(detail.layer);
      break;
    case 'layer_init_failed':
      messageKey = detail.fallback === 'template' ? MESSAGE_KEYS.initFailedTemplate : MESSAGE_KEYS.initFailedNone;
      values = { layerName: basename(String(detail.layer)), reason: safeReason(String(detail.reason)) };
      layer = String(detail.layer);
      break;
    default:
      return null;
  }
  const item: EntityBatchItem | undefined = ENTITY_TYPES.has(event.type)
    ? { eventId: event.id, seq: event.seq, type: event.type, name: String(detail.name) }
    : undefined;
  return {
    key: event.id,
    eventIds: [event.id],
    latestSeq: event.seq,
    type: event.type,
    layer: layer ?? null,
    status: failed ? 'failed' : (event.type === 'choice_selected' || event.type === 'roll_resolved' || event.type === 'use_item_on' ? 'recorded' : 'changed'),
    message: interpolate(messageKey, values),
    detail: detailFor(event),
    createdAt: event.createdAt,
    expiresAt: now + (failed ? WORLD_TOAST_FAILED_TTL_MS : WORLD_TOAST_CHANGED_TTL_MS),
    messageKey,
    messageValues: values,
    projectId: event.projectId,
    lastIngestAt: now,
    ...(item ? { batchItems: [item] } : {}),
  };
}

export function createWorldToastState(): WorldToastState {
  return { visible: [], queued: [], seenIds: new Set<string>(), lastSeq: null };
}

function prune(state: WorldToastState, now: number): WorldToastState {
  const visible = state.visible.filter((entry) => entry.expiresAt > now);
  const queued = state.queued.filter((entry) => entry.expiresAt > now);
  if (visible.length === state.visible.length && queued.length === state.queued.length) return state;
  return { ...state, visible, queued };
}

function queueOrder(a: WorldToastEntry, b: WorldToastEntry): number {
  if (a.status === 'failed' && b.status !== 'failed') return -1;
  if (a.status !== 'failed' && b.status === 'failed') return 1;
  return a.latestSeq - b.latestSeq;
}

function trimQueue(queue: readonly WorldToastEntry[]): readonly WorldToastEntry[] {
  const next = [...queue];
  while (next.length > WORLD_TOAST_MAX_QUEUE) {
    const changedIndex = next
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.status !== 'failed')
      .sort((a, b) => a.entry.latestSeq - b.entry.latestSeq)[0]?.index;
    next.splice(changedIndex ?? 0, 1);
  }
  return next;
}

function promote(state: WorldToastState): WorldToastState {
  if (state.visible.length >= WORLD_TOAST_MAX_VISIBLE || state.queued.length === 0) return state;
  const queue = [...state.queued].sort(queueOrder);
  const visible = [...state.visible];
  while (visible.length < WORLD_TOAST_MAX_VISIBLE && queue.length > 0) {
    visible.push(queue.shift()!);
  }
  return { ...state, visible, queued: queue };
}

function latestEntry(state: WorldToastState): InternalToastEntry | null {
  const all = [...state.visible, ...state.queued] as InternalToastEntry[];
  return all.reduce<InternalToastEntry | null>((latest, entry) => !latest || entry.latestSeq > latest.latestSeq ? entry : latest, null);
}

function mergedEntry(previous: InternalToastEntry, event: WorldEvent, now: number): InternalToastEntry | null {
  const eventType = event.type as WorldToastEventType;
  if (!ENTITY_TYPES.has(eventType) || !validDetail(event) || isPlayerNoteEvent(event)) return null;
  if (previous.batchItems?.some((item) => item.type === 'entity_deleted')) return null;
  if (previous.projectId !== event.projectId || previous.layer !== event.layer || event.seq <= previous.latestSeq) return null;
  const detail = event.detail as Record<string, unknown>;
  const items = [...(previous.batchItems ?? []), { eventId: event.id, seq: event.seq, type: eventType, name: String(detail.name) }];
  const sameType = items.every((item) => item.type === items[0].type);
  const latestIsDelete = eventType === 'entity_deleted';
  let messageKey: string;
  let values: Record<string, string | number>;
  let type: WorldToastEntry['type'] = 'entity_batch';
  if (latestIsDelete && items.length > 1) {
    messageKey = MESSAGE_KEYS.deleted;
    values = { name: String(detail.name) };
    type = 'entity_batch';
  } else {
    messageKey = sameType ? MESSAGE_KEYS.batchSame : MESSAGE_KEYS.batchMixed;
    const verbs: Record<WorldToastEventType, string> = {
      entity_created: 'created', entity_edited: 'updated', entity_moved: 'moved', entity_deleted: 'deleted',
      choice_selected: 'recorded', roll_resolved: 'settled', use_item_on: 'used', layer_entered: 'entered',
      layer_initialized: 'initialized', layer_init_failed: 'failed',
    };
    values = { count: items.length, verb: verbs[items[0].type], objects: objectNames(items) };
  }
  const merged: InternalToastEntry = {
    ...previous,
    eventIds: [...previous.eventIds, event.id],
    latestSeq: event.seq,
    type,
    status: 'changed',
    message: interpolate(messageKey, values),
    detail: detailFor(event, items),
    createdAt: event.createdAt,
    expiresAt: now + WORLD_TOAST_CHANGED_TTL_MS,
    messageKey,
    messageValues: values,
    lastIngestAt: now,
    batchItems: items,
  };
  return merged;
}

function replaceEntry(state: WorldToastState, entry: InternalToastEntry): WorldToastState {
  const visibleIndex = state.visible.findIndex((candidate) => candidate.key === entry.key);
  if (visibleIndex >= 0) {
    const visible = [...state.visible];
    visible[visibleIndex] = entry;
    return { ...state, visible };
  }
  const queuedIndex = state.queued.findIndex((candidate) => candidate.key === entry.key);
  if (queuedIndex >= 0) {
    const queued = [...state.queued];
    queued[queuedIndex] = entry;
    return { ...state, queued };
  }
  return state;
}

function addEntry(state: WorldToastState, entry: InternalToastEntry): WorldToastState {
  if (state.visible.length < WORLD_TOAST_MAX_VISIBLE) return { ...state, visible: [...state.visible, entry] };
  if (entry.status === 'failed') {
    const replaceIndex = state.visible.findIndex((candidate) => candidate.status !== 'failed');
    if (replaceIndex >= 0) {
      const visible = [...state.visible];
      const evicted = visible.splice(replaceIndex, 1, entry)[0];
      return { ...state, visible, queued: trimQueue([...state.queued, evicted]) };
    }
  }
  return { ...state, queued: trimQueue([...state.queued, entry]) };
}

export function reduceWorldToast(state: WorldToastState, action: WorldToastAction): WorldToastState {
  if (action.type === 'reset') {
    if (action.reason === 'world-switch') return createWorldToastState();
    if (action.reason === 'reconnect') return { ...state, visible: [], queued: [] };
    return state.queued.length ? { ...state, queued: [] } : state;
  }
  if (action.type === 'dismiss') {
    const visible = state.visible.filter((entry) => entry.key !== action.key);
    const queued = state.queued.filter((entry) => entry.key !== action.key);
    if (visible.length === state.visible.length && queued.length === state.queued.length) return state;
    return { ...state, visible, queued };
  }
  const now = finiteNow(action.now);
  if (action.type === 'tick') return promote(prune(state, now));

  const clocked = promote(prune(state, now));
  if (!validBaseEvent(action.event) || !validDetail(action.event)) return clocked;
  if (clocked.seenIds.has(action.event.id)) return clocked;
  const seenIds = new Set(clocked.seenIds);
  seenIds.add(action.event.id);
  while (seenIds.size > WORLD_TOAST_SEEN_LIMIT) seenIds.delete(seenIds.values().next().value!);
  const entry = makeEntry(action.event, now);
  if (!entry) return { ...clocked, seenIds };
  const latest = latestEntry(clocked);
  const merged = latest ? mergedEntry(latest, action.event, now) : null;
  let next = merged ? replaceEntry(clocked, merged) : addEntry(clocked, entry);
  next = { ...next, seenIds, lastSeq: next.lastSeq === null ? action.event.seq : Math.max(next.lastSeq, action.event.seq) };
  return next;
}


export type WorldToastResetReason = 'world-switch' | 'reconnect' | 'layer-switch';

export interface WorldEventToastStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): WorldToastState;
  ingest(event: WorldEvent, now?: number): boolean;
  tick(now?: number): void;
  dismiss(key: string): void;
  reset(reason: WorldToastResetReason): void;
  /** Set by the active-world owner; mismatched project events are ignored. */
  setProjectId(projectId: string | null): void;
  /**
   * While a scene card / scene animation is on screen the toasts are hidden and
   * their clocks stop; on release they come back with their remaining time
   *.
   */
  hold(on: boolean, now?: number): void;
  isHeld(): boolean;
}

const NO_TOASTS: readonly WorldToastEntry[] = [];

const STORE_TICK_MS = 250;

export function createWorldEventToastStore(): WorldEventToastStore {
  let snapshot = createWorldToastState();
  let activeProjectId: string | null = null;
  let heldSince: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach((listener) => listener());
  const arm = () => {
    if (timer === null && (snapshot.visible.length > 0 || snapshot.queued.length > 0)) timer = setInterval(() => tick(), STORE_TICK_MS);
  };
  const disarm = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const publish = (next: WorldToastState) => {
    if (next === snapshot) return false;
    snapshot = next;
    if (snapshot.visible.length > 0 || snapshot.queued.length > 0) arm(); else disarm();
    notify();
    return true;
  };
  const tick = (now = Date.now()) => {
    if (heldSince !== null) return false;
    return publish(reduceWorldToast(snapshot, { type: 'tick', now }));
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      arm();
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    ingest(event, now = Date.now()) {
      if (activeProjectId !== null && event?.projectId !== activeProjectId) return false;
      return publish(reduceWorldToast(snapshot, { type: 'world-event', event, now }));
    },
    tick,
    dismiss(key) { publish(reduceWorldToast(snapshot, { type: 'dismiss', key })); },
    reset(reason) { publish(reduceWorldToast(snapshot, { type: 'reset', reason })); },
    setProjectId(projectId) {
      if (activeProjectId === projectId) return;
      activeProjectId = projectId;
      publish(reduceWorldToast(snapshot, { type: 'reset', reason: 'world-switch' }));
    },
    hold(on, now = Date.now()) {
      if (on === (heldSince !== null)) return;
      if (on) {
        heldSince = now;
        notify();
        return;
      }
      const paused = Math.max(0, now - heldSince!);
      heldSince = null;
      const shift = <T extends WorldToastEntry>(entries: readonly T[]): T[] => entries.map((e) => ({ ...e, expiresAt: e.expiresAt + paused }));
      if (paused > 0 && (snapshot.visible.length > 0 || snapshot.queued.length > 0)) {
        publish({ ...snapshot, visible: shift(snapshot.visible), queued: shift(snapshot.queued) });
      } else {
        notify();
      }
    },
    isHeld: () => heldSince !== null,
  };
}

export const worldEventToastStore = createWorldEventToastStore();

export function selectWorldToastSnapshot(): WorldToastState {
  return worldEventToastStore.getSnapshot();
}

export function useWorldToasts(): readonly WorldToastEntry[] {
  return useSyncExternalStore(
    worldEventToastStore.subscribe,
    () => (worldEventToastStore.isHeld() ? NO_TOASTS : worldEventToastStore.getSnapshot().visible),
    () => NO_TOASTS,
  );
}

export function resetWorldToasts(reason: WorldToastResetReason): void {
  worldEventToastStore.reset(reason);
}
