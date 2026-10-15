/**
 * agent-cursor.ts — the agents' "mice" on the canvas.
 *
 * The toasts (top-right) and the activity rail (bottom) say WHAT happened; a
 * cursor says WHERE: every tool call an agent starts moves its pointer onto the
 * md card / folder gate / avatar it touches. It is a pure presentation lane
 * over the already-broadcast `tool_start` / `tool_end` / `*_idle` frames — no
 * new wire frame, no world fact, nothing persisted.
 *
 * Writer: always live. Character: live when it acts outside its dialogue (a
 * nook call). Inside its dialogue the canvas is dimmed and blurred, so steps
 * are only recorded (`deferred`) and replayed from the avatar once the dialogue
 * closes (`replay`).
 *
 * No React and no DOM in the pure half, so node:test can import it through jiti
 * (same bootstrap as test/ghost.test.mjs). The store at the bottom owns the
 * only clock.
 */

import { useSyncExternalStore } from 'react';
import type { ActivityOperation } from './agent-activity.js';

// ---- Frozen constants ----

/**
 * After the turn settles the pointer lingers, then fades; it is unmounted only
 * after that. Must be >= `--agent-cursor-hold` + `--agent-cursor-fade` in
 * components/canvas/agent-cursor.css, or the fade is cut off (ms).
 */
export const CURSOR_IDLE_HIDE_MS = 3200;
/** A live pointer with no frame for this long is treated as idle (lost terminal). */
export const CURSOR_STALE_MS = 45000;
/** One replayed step: the 620ms glide plus a beat to read the tag (ms). */
export const CURSOR_REPLAY_STEP_MS = 1100;
/** Most recent steps kept for a dialogue replay. */
export const CURSOR_TRAIL_MAX = 8;

// ---- Types ----

export type CursorState = 'running' | 'ok' | 'error';
export type CursorMode = 'live' | 'deferred' | 'replay';

/** One place a pointer visits. */
export interface CursorStep {
  toolCallId: string;
  operation: ActivityOperation;
  /** Normalised tool path (world-relative when the agent passed one). */
  path?: string;
  /** Points at the agent's own avatar (a character act with no place arg). */
  self?: boolean;
  state: CursorState;
}

export interface AgentCursor extends CursorStep {
  /** `writer` | `character:<id>`. */
  agentId: string;
  characterId?: string;
  /** true once the turn (or the replay) settled: linger, fade, then removed. */
  idle: boolean;
  updatedAt: number;
  mode: CursorMode;
  /** Steps recorded while deferred; what a replay walks through. */
  trail: readonly CursorStep[];
  replayStartedAt?: number;
}

/** What the cursor points at on the CURRENT canvas. */
export type CursorTarget =
  | { kind: 'card'; path: string }
  | { kind: 'gate'; path: string }
  | { kind: 'layer' }
  | { kind: 'elsewhere' };

export interface CursorItemRef {
  path: string;
  kind?: string;
  frontmatter?: Record<string, unknown> | null;
}

// ---- Tool → operation / path ----

/**
 * Tool name → operation for the pointer tag. Deliberately NOT a flat mirror of
 * the server table (apps/server/src/engine/agent-activity.ts); the two differ by
 * design, and both differences are load-bearing:
 *
 *  - web-only: `ls` / `find` / `grep` are pi built-ins that browse the folder
 *    structure. The activity lane (an operation chip) calls them `other`, but a
 *    pointer has a place to move to, so it calls them `look`.
 *  - server-only: `subagent` / `subagent_profiles` come from a delegated child
 *    process and `airp-init` / `scene-init` / `nook-init` are functional roots.
 *    None of them drive a canvas pointer: the former two are relayed as
 *    `agent_activity` only, and `airp-init` is a slash COMMAND relayed by the
 *    extension (extensions/toolkit/init-command.ts:223), never a `tool_start` in
 *    the writer's own stream.
 *  - `set_following` is in the server table but not here: its act is about a
 *    character, not a place, so it lands on the path-less branch (`applyToolStart`
 *    points at the avatar) and its tag reads `Working…`. Kept as-is rather than
 *    silently re-copied to `edit` copy — see the batch report.
 *
 * Memory tools: the memory copy has NO `{subject}` slot (`agent-activity.ts`
 * RUNNING/OK/ERROR_KEYS: with === without), so the tag stays a bare
 * `Remembering…` even for `forget`/`relocate`, whose `target`/`to` args are
 * generic PATH_FIELDS and DO resolve a subject — no memory URI is ever
 * interpolated into the tag.
 */
const TOOL_OPERATION: Record<string, ActivityOperation> = {
  read: 'read', ls: 'look', find: 'look', grep: 'look', look_at: 'look', view_canvas: 'look',
  write: 'write', chalk: 'write', create_file: 'write', edit: 'edit',
  delete: 'delete', move: 'move', move_to: 'move', rename: 'move',
  link: 'edit', arrange: 'edit', generate_image: 'create',
  choose: 'choose', choose_option: 'choose', roll_dice: 'roll',
  use_item: 'use', use_item_on: 'use', show: 'use', get_component: 'use',
  // vendor/pi-rp/packages/memory/src/module.ts:158-170 — single value for all 12.
  recall: 'memory', retrieve: 'memory', memorize: 'memory', revise: 'memory',
  forget: 'memory', relocate: 'memory', associate: 'memory', trigger: 'memory',
  consolidate: 'memory', retrace: 'memory', set_time: 'memory', awaken: 'memory',
};

/** Arg fields that name a place, in the order a pointer should prefer. */
const PATH_FIELDS = ['path', 'append_to', 'from', 'to', 'target', 'near', 'link_to', 'file', 'item'];
/** Tools whose meaningful place is not the first generic field. */
const TOOL_PATH_FIELDS: Record<string, string[]> = {
  // The target is where the act lands; the item usually sits in the bag.
  use_item_on: ['target', 'item'],
  // Walk up to the card named by `near`, else the destination scene.
  move_to: ['near'],
};
/** Arg fields holding a layer id (`map`, `world/harbor`), pointed at as a folder. */
const LAYER_FIELDS = ['destination', 'layer'];

export function operationForTool(toolName: unknown): ActivityOperation {
  return typeof toolName === 'string' ? TOOL_OPERATION[toolName] ?? 'other' : 'other';
}

/** `./world\foo//bar.md/` → `world/foo/bar.md`; empty / `.` → undefined. */
export function normalizeToolPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const p = raw
    .trim()
    .replaceAll('\\', '/')
    .replace(/[?#].*$/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '');
  return p === '' || p === '.' ? undefined : p;
}

/** Directory a layer id lives in (`map` is the `world/` folder, see
 *  packages/shared/src/store/layers.ts `dirOfLayer`). */
export function layerDir(layer: string): string {
  return layer === 'map' ? 'world' : layer;
}

export function cursorPathFromArgs(args: unknown, toolName?: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const o = args as Record<string, unknown>;
  const fields = (typeof toolName === 'string' && TOOL_PATH_FIELDS[toolName]) || PATH_FIELDS;
  for (const field of fields) {
    const p = normalizeToolPath(Array.isArray(o[field]) ? (o[field] as unknown[])[0] : o[field]);
    if (p) return p;
  }
  // `move_to` / `link` / `arrange` act on a whole scene: point at that folder.
  for (const field of LAYER_FIELDS) {
    const layer = normalizeToolPath(o[field]);
    if (layer) return layerDir(layer);
  }
  return undefined;
}

// ---- Path → target on the current canvas ----

/** `p` names `candidate` exactly, via an absolute prefix, or without `.md`. */
function names(p: string, candidate: string): boolean {
  if (p === candidate || p.endsWith(`/${candidate}`)) return true;
  const bare = candidate.replace(/\.md$/i, '');
  return bare !== candidate && (p === bare || p.endsWith(`/${bare}`));
}

/** `p` is the folder `dir` itself or anything inside it. */
function within(p: string, dir: string): boolean {
  return p === dir || p.startsWith(`${dir}/`) || p.endsWith(`/${dir}`) || p.includes(`/${dir}/`);
}

function parentOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

/** Same gate test as CanvasObject (`isGate` / `gateTarget`). */
export function gateTargetOf(item: CursorItemRef): string | null {
  const fm = item.frontmatter ?? null;
  const isGate = item.kind === 'gate' || fm?.type === 'gate' || item.path.endsWith('/README.md');
  if (!isGate) return null;
  const target = typeof fm?.target === 'string' && fm.target.trim() ? fm.target.trim() : '';
  return normalizeToolPath(target || item.path.replace(/\/README\.md$/, '')) ?? null;
}

/**
 * Resolve one tool path against the cards of the layer on screen:
 *  1. a card on this canvas            → that card;
 *  2. something under a child folder   → the gate that leads there (deepest wins);
 *  3. this layer's folder / a new file → the canvas itself;
 *  4. anything else (characters/, another scene) → elsewhere.
 */
export function resolveCursorTarget(
  p: string,
  items: readonly CursorItemRef[],
  currentLayer: string,
): CursorTarget {
  for (const item of items) {
    if (names(p, item.path)) return { kind: 'card', path: item.path };
  }
  const dir = layerDir(currentLayer);
  let best: { path: string; len: number } | null = null;
  for (const item of items) {
    const target = gateTargetOf(item);
    if (!target || target === dir) continue;
    if (within(p, target) && (!best || target.length > best.len)) {
      best = { path: item.path, len: target.length };
    }
  }
  if (best) return { kind: 'gate', path: best.path };
  // The folder itself, or a direct child file that has not landed as a card yet.
  if (names(p, dir) || names(parentOf(p), dir) || p === currentLayer) return { kind: 'layer' };
  return { kind: 'elsewhere' };
}

/** Human subject for the pointer tag: file name without `.md`, a README is its folder. */
export function cursorSubject(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const parts = p.split('/').filter(Boolean);
  let leaf = parts.at(-1);
  if (leaf && /^readme\.md$/i.test(leaf)) leaf = parts.at(-2) ?? leaf;
  const bare = leaf?.replace(/\.(?:md|markdown)$/i, '');
  return bare ? bare : undefined;
}

// ---- Pure reducers ----

export type CursorMap = ReadonlyMap<string, AgentCursor>;

const CHARACTER_ID = /^[^:\s/]{1,100}$/;

/** Frame → pointer identity. An unowned character frame drives nothing. */
function agentOf(f: Record<string, unknown>): { agentId: string; characterId?: string } | null {
  if (f.source === 'writer') return { agentId: 'writer' };
  if (f.source === 'character' && typeof f.characterId === 'string' && CHARACTER_ID.test(f.characterId)) {
    return { agentId: `character:${f.characterId}`, characterId: f.characterId };
  }
  return null;
}

/** A replay visits the avatar, every step, then the avatar again. */
export function replayDurationMs(cursor: Pick<AgentCursor, 'trail'>): number {
  return (cursor.trail.length + 2) * CURSOR_REPLAY_STEP_MS;
}

/**
 * Which replay step is on screen `elapsed` ms in: -1 = leaving the avatar,
 * 0..n-1 = trail steps, n = back at the avatar.
 */
export function replayIndexAt(cursor: Pick<AgentCursor, 'trail'>, elapsed: number): number {
  return Math.min(cursor.trail.length, Math.floor(Math.max(0, elapsed) / CURSOR_REPLAY_STEP_MS) - 1);
}

export function applyToolStart(
  map: CursorMap,
  frame: unknown,
  now: number,
  dialogueCharacterId: string | null = null,
): CursorMap {
  if (!frame || typeof frame !== 'object') return map;
  const f = frame as Record<string, unknown>;
  const who = agentOf(f);
  if (!who || typeof f.toolCallId !== 'string' || f.toolCallId === '') return map;
  const prev = map.get(who.agentId);
  if (prev?.toolCallId === f.toolCallId && prev.state === 'running') return map;

  const step: CursorStep = { toolCallId: f.toolCallId, operation: operationForTool(f.toolName), state: 'running' };
  const path = cursorPathFromArgs(f.args, f.toolName);
  if (path) step.path = path;
  // A character act with no place (`set_following`, `show`) is about itself.
  else if (who.characterId) step.self = true;
  // A path-less browse (`ls`, `grep`) keeps the writer pointing where it was.
  else if (prev && !prev.idle && prev.path) step.path = prev.path;

  const deferred = who.characterId !== undefined && who.characterId === dialogueCharacterId;
  const trail = deferred
    ? [...(prev?.mode === 'deferred' ? prev.trail : []), step].slice(-CURSOR_TRAIL_MAX)
    : [];
  const next = new Map(map);
  next.set(who.agentId, {
    ...step,
    agentId: who.agentId,
    characterId: who.characterId,
    idle: false,
    updatedAt: now,
    mode: deferred ? 'deferred' : 'live',
    trail,
  });
  return next;
}

export function applyToolEnd(map: CursorMap, frame: unknown, now: number): CursorMap {
  if (!frame || typeof frame !== 'object') return map;
  const f = frame as Record<string, unknown>;
  const who = agentOf(f);
  if (!who) return map;
  const prev = map.get(who.agentId);
  // A late terminal for an older call must not repaint the current one.
  if (!prev || prev.toolCallId !== f.toolCallId || prev.state !== 'running') return map;
  const state: CursorState = f.isError === true ? 'error' : 'ok';
  const trail = prev.trail.map((s) => (s.toolCallId === prev.toolCallId ? { ...s, state } : s));
  const next = new Map(map);
  next.set(who.agentId, { ...prev, state, trail, updatedAt: now });
  return next;
}

export function applyIdle(map: CursorMap, agentId: string, now: number): CursorMap {
  const prev = map.get(agentId);
  // A deferred pointer waits for its replay, however the turn ended.
  if (!prev || prev.idle || prev.mode === 'deferred') return map;
  const next = new Map(map);
  next.set(agentId, { ...prev, idle: true, updatedAt: now });
  return next;
}

/**
 * The character dialogue that is open now (`null` = none). Its character's
 * pointer goes deferred; every other deferred pointer starts its replay, or
 * is dropped when it recorded nothing.
 */
export function applyDialogue(map: CursorMap, openCharacterId: string | null, now: number): CursorMap {
  let next: Map<string, AgentCursor> | null = null;
  for (const [id, cursor] of map) {
    if (!cursor.characterId) continue;
    if (cursor.characterId === openCharacterId) {
      if (cursor.mode === 'deferred') continue;
      next ??= new Map(map);
      next.set(id, { ...cursor, mode: 'deferred', trail: [], idle: false, updatedAt: now });
    } else if (cursor.mode === 'deferred') {
      next ??= new Map(map);
      if (cursor.trail.length === 0) next.delete(id);
      else next.set(id, { ...cursor, mode: 'replay', replayStartedAt: now, idle: false, updatedAt: now });
    }
  }
  return next ?? map;
}

export function applyDismiss(map: CursorMap, agentId: string): CursorMap {
  if (!map.has(agentId)) return map;
  const next = new Map(map);
  next.delete(agentId);
  return next;
}

/** Drop faded pointers; finish replays; idle-out live pointers that went silent. */
export function pruneCursors(map: CursorMap, now: number): CursorMap {
  let next: Map<string, AgentCursor> | null = null;
  for (const [id, cursor] of map) {
    if (cursor.mode === 'deferred') continue;
    if (cursor.idle) {
      if (now - cursor.updatedAt >= CURSOR_IDLE_HIDE_MS) {
        next ??= new Map(map);
        next.delete(id);
      }
    } else if (cursor.mode === 'replay') {
      if (now - (cursor.replayStartedAt ?? cursor.updatedAt) >= replayDurationMs(cursor)) {
        next ??= new Map(map);
        next.set(id, { ...cursor, idle: true, updatedAt: now });
      }
    } else if (now - cursor.updatedAt >= CURSOR_STALE_MS) {
      next ??= new Map(map);
      next.set(id, { ...cursor, idle: true, updatedAt: now });
    }
  }
  return next ?? map;
}

// ---- Store (useSyncExternalStore) ----

export interface AgentCursorStore {
  subscribe(cb: () => void): () => void;
  getSnapshot(): readonly AgentCursor[];
  toolStart(frame: unknown, now?: number): void;
  toolEnd(frame: unknown, now?: number): void;
  idle(agentId: string, now?: number): void;
  /** App reports which character dialogue is open (`null` = none). */
  setDialogue(characterId: string | null, now?: number): void;
  /** Drop one pointer at once (a replay with nothing to show on this canvas). */
  dismiss(agentId: string): void;
  clearAll(): void;
}

const TICK_MS = 250;

export function createAgentCursorStore(): AgentCursorStore {
  let map: CursorMap = new Map();
  let snapshot: readonly AgentCursor[] = [];
  let dialogue: string | null = null;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function commit(next: CursorMap): void {
    if (next === map) return;
    map = next;
    snapshot = [...map.values()];
    if (map.size > 0 && timer === null) timer = setInterval(() => commit(pruneCursors(map, Date.now())), TICK_MS);
    if (map.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    for (const cb of listeners) cb();
  }

  return {
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSnapshot: () => snapshot,
    toolStart: (frame, now = Date.now()) => commit(applyToolStart(map, frame, now, dialogue)),
    toolEnd: (frame, now = Date.now()) => commit(applyToolEnd(map, frame, now)),
    idle: (agentId, now = Date.now()) => commit(applyIdle(map, agentId, now)),
    setDialogue: (characterId, now = Date.now()) => {
      dialogue = characterId;
      commit(applyDialogue(map, characterId, now));
    },
    dismiss: (agentId) => commit(applyDismiss(map, agentId)),
    clearAll: () => commit(new Map()),
  };
}

/** Singleton fed by `useWorld` (frames) and `App` (dialogue), read by `AgentCursorLayer`. */
export const agentCursorStore: AgentCursorStore = createAgentCursorStore();

export function useAgentCursors(): readonly AgentCursor[] {
  return useSyncExternalStore(agentCursorStore.subscribe, agentCursorStore.getSnapshot);
}
