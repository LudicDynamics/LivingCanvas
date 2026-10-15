import { PLAYER_ACT_EVENT, PLAYER_ACT_EVENTS } from '../lib/tick/beat.js';
import { asWord, track } from '../lib/analytics.js';
import { autoNewcomerGift } from '../lib/newcomer-gift.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { airpGateway, openAirpSocket, sendSocket, AirpRequestError } from '../lib/airp-gateway.js';
import { gateFeedback } from '../lib/gate-feedback.js';
import { invalidateMeasures } from '../lib/measure.js';
import { whenFontsSettled } from '../lib/fonts.js';
import {
  createFootprintScheduler,
  measureHeights,
  type FootprintScheduler,
} from '../lib/footprint.js';
import { CARD_FORMS } from '@airp/shared/forms';
import { isValidCharacterId } from '@airp/shared/characters';
import type { AppearanceResolution, WorldEvent } from '@airp/shared';
import { closeKind, REPLAY_DONE_TIMEOUT_MS } from '@airp/shared/protocol';
import { register as registerPhantom, land as landPhantom, appendInk, setInk, evict as evictPhantom, reconcileLanded, getPhantomsSnapshot } from '../lib/phantom.js';
import { cardWritingGuard } from '../lib/card-skeleton.js';
import { phantomSeatFor, publishSeatItems } from '../lib/phantom-seat.js';
import { mergeItemPatch, mergeLinkPatch } from '../lib/canvas-patch.js';
import { acceptWriterFrame, beginWriterPrompt, getWriterState, resetForReconnect as resetWriter, type WriterPromptAcceptance } from '../lib/writer-state.js';
import { agentActivityStore } from '../lib/agent-activity-store.js';
import { agentCursorStore } from '../lib/agent-cursor.js';
import { deferReveal } from '../lib/reveal-gate.js';
import { SCENE_CLAIM_MS, isItemObtainedEvent, mergeMomentToasts, sceneEnteredLayer, sceneToastClaimed, whenStageIdle } from '../lib/milestones.js';
import { worldEventToastStore, resetWorldToasts } from '../lib/world-event-toast.js';
import { playFoley, playCharge, endCharge, setAmbient } from '../lib/audio.js';
import { ghostSizeFor, stageText, GHOST_WAIT_AMBIENT } from '../lib/ghost.js';
import { getCharacterFrameQueue, type CharacterFrameQueueEvent } from '../lib/character-frame-queue.js';
import { bindCanvasSocket, publishCanvasSocketFrame } from '../lib/canvas-socket-bridge.js';
import { isBillingStop } from '../lib/model-errors.js';

import {
  DEFAULT_WORLD_SETTINGS,
  startsSceneInit,
  type WorldSettings,
} from '@airp/shared/world-settings';
import { isWorldScopedCommand } from '@airp/shared/protocol';
export type CanvasArrangeMode = 'grid' | 'circle' | 'row';

function withActiveSavePath(
  message: Record<string, unknown>,
  capturedSavePath: string | null,
): Record<string, unknown> | null {
  if (!isWorldScopedCommand(message.type)) return message;
  const activeSavePath = agentActivityStore.getActiveSavePath();
  if (!capturedSavePath || capturedSavePath !== activeSavePath || !agentActivityStore.isSaveActive(capturedSavePath)) return null;
  if (Object.hasOwn(message, 'savePath') && message.savePath !== capturedSavePath) return null;
  return { ...message, savePath: capturedSavePath };
}
const WORLD_SCOPED_SERVER_FRAME_TYPES = new Set([
  'agent_activity', 'world_event', 'file_changed', 'card_position', 'canvas_patched',
  'world_frozen', 'world_thawed', 'replay_entry', 'replay_done', 'character_stop_status',
]);
const WORLD_SCOPED_SERVER_SOURCES = new Set(['writer', 'character', 'functional']);

function isWorldScopedServerFrame(frame: Record<string, unknown>): boolean {
  return typeof frame.savePath === 'string' || WORLD_SCOPED_SERVER_FRAME_TYPES.has(String(frame.type)) ||
    WORLD_SCOPED_SERVER_SOURCES.has(String(frame.source));
}

function matchesActiveSave(frame: Record<string, unknown>): boolean {
  const activeSavePath = agentActivityStore.getActiveSavePath();
  if (frame.type === 'replay_done' && frame.savePath === null) return activeSavePath === null;
  return !!activeSavePath && frame.savePath === activeSavePath && agentActivityStore.isSaveActive(activeSavePath);
}
export interface CanvasArrangeRequest {
  worldId: string;
  layer: string;
  mode: CanvasArrangeMode;
  requestId: string;
  expectedRevision: number;
  expectedCanvasVersion: number;
  snapshotId: string;
  screenshotPolicy: 'none' | 'before' | 'after' | 'before_and_after';
}

export interface CanvasArrangeAccepted {
  ok: true;
  operationId: string;
  requestId: string;
  worldId: string;
  layer: string;
  agentId: 'canvas-arranger';
  turnId: string;
  stage: 'accepted';
}

export interface CanvasArrangeCancelAccepted {
  ok: true;
  operationId: string;
  requestId: string;
  worldId: string;
  layer: string;
  stage: 'cancel_requested' | 'already_completed' | 'already_cancelled';
}

export class CanvasArrangeRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly payload: Record<string, unknown> | null;

  constructor(message: string, code = 'unknown', status = 0, payload: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'CanvasArrangeRequestError';
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

/** Raw arrangement signals are published only after useWorld has consumed the
 * socket frame. Controls may subscribe to this bridge, but never open a socket
 * themselves. */
export type CanvasArrangeFrame = Record<string, unknown>;
const canvasArrangeFrameListeners = new Set<(frame: CanvasArrangeFrame) => void>();

export function subscribeCanvasArrangeFrames(listener: (frame: CanvasArrangeFrame) => void): () => void {
  canvasArrangeFrameListeners.add(listener);
  return () => canvasArrangeFrameListeners.delete(listener);
}

function publishCanvasArrangeFrame(frame: CanvasArrangeFrame): void {
  for (const listener of canvasArrangeFrameListeners) {
    try {
      listener(frame);
    } catch {
      // A presentation subscriber must not interrupt canonical WS ingestion.
    }
  }
}

async function canvasArrangeRequest<T>(url: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  let payload: Record<string, unknown> | null = null;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CanvasArrangeRequestError('Connection lost while arranging. Refresh to check the saved canvas, then retry.', 'connection_lost');
  }
  const text = await response.text();
  try {
    payload = text ? JSON.parse(text) as Record<string, unknown> : null;
  } catch {
    payload = null;
  }
  if (!response.ok || payload?.ok !== true) {
    const code = typeof payload?.code === 'string' ? payload.code : response.status === 404 ? 'unavailable' : 'unknown';
    const message = typeof payload?.error === 'string' ? payload.error : 'Canvas arrangement is unavailable. Nothing was changed. Try again later.';
    throw new CanvasArrangeRequestError(message, code, response.status, payload);
  }
  return payload as T;
}

async function requestCanvasArrange(input: CanvasArrangeRequest): Promise<CanvasArrangeAccepted> {
  const payload = await canvasArrangeRequest<CanvasArrangeAccepted>('/api/canvas/arrange', input as unknown as Record<string, unknown>);
  if (
    payload.stage !== 'accepted' ||
    typeof payload.operationId !== 'string' ||
    typeof payload.requestId !== 'string' ||
    typeof payload.worldId !== 'string' ||
    typeof payload.layer !== 'string' ||
    payload.agentId !== 'canvas-arranger' ||
    typeof payload.turnId !== 'string'
  ) {
    throw new CanvasArrangeRequestError('Canvas arrangement is unavailable. Nothing was changed. Try again later.', 'invalid_response');
  }
  return payload;
}

async function cancelCanvasArrange(
  operationId: string,
  input: Pick<CanvasArrangeRequest, 'worldId' | 'layer' | 'requestId'>,
): Promise<CanvasArrangeCancelAccepted> {
  const payload = await canvasArrangeRequest<CanvasArrangeCancelAccepted>(
    `/api/canvas/arrange/${encodeURIComponent(operationId)}/cancel`,
    input,
  );
  if (
    typeof payload.operationId !== 'string' ||
    typeof payload.requestId !== 'string' ||
    typeof payload.worldId !== 'string' ||
    typeof payload.layer !== 'string' ||
    !['cancel_requested', 'already_completed', 'already_cancelled'].includes(payload.stage)
  ) {
    throw new CanvasArrangeRequestError('Canvas arrangement is unavailable. Nothing was changed. Try again later.', 'invalid_response');
  }
  return payload;
}

export interface LayerItem {
  path: string;
  filename: string;
  kind: string;
  frontmatter: Record<string, any> | null;
  body: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  rot: number;
  /** Verified appearance from the server resolver. Optional:
   *  an old server / old payload omits it, and the card then falls back to its kind
   *  default. The frontend MUST NOT compute this from raw frontmatter. */
  appearance?: AppearanceResolution;
}

export interface LayerLink {
  id: string;
  from: string;
  to: string;
  style: string;
  label: string | null;
}

export interface PresenceEntry {
  characterId: string;
  x: number;
  y: number;
  following: boolean;
}

/** What enterLayer resolves with after the HTTP action and target fetch. */
export interface EnterLayerResult {
  layer: string;
  name: string;
  first: boolean;
  event?: Record<string, unknown>;
  followers: {
    moved: PresenceEntry[];
    failures: Array<{ character: string; reason: string }>;
  };
}

export type EnterLayerOutcome =
  | { kind: 'same-layer'; layer: string; reconciled: boolean }
  | { kind: 'accepted'; layer: string; details: EnterLayerResult; reconciled: boolean }
  | { kind: 'conflict' | 'failed'; layer: string; code?: string; message: string };

export interface LayerState {
  layer: string;
  scene: LayerItem | null;
  bg: { src: string | null; video?: string; tone: string; grain: string };
  /** `quiet`: the place declared `bgm: silence` — no music, the world theme rests too (rules/music.ts). */
  audio: { ambient: string | null; bgm: string | null; quiet?: boolean };
  items: LayerItem[];
  links: LayerLink[];
  presence: PresenceEntry[];
  worldFrozen: boolean;
  /** Which options are done / used in this save, by card path; absent from an older server. */
  optionStates?: Record<string, { done: string[]; used: string[] }>;
  /** Server-issued identity for arrangement fences. Never derived client-side. */
  revision?: number;
  canvasVersion?: number;
  canvasRevision?: string;
  snapshotId?: string;
}

export interface UseWorldApi {
  /** Open, and past the replay window: a frame sent now will land (see `socketOpen`). */
  socketLive: boolean;
  /** Latest layer payload; null until the first fetch lands. */
  state: LayerState | null;
  /** True while a layer fetch is in flight. */
  loading: boolean;
  /** The layer currently being shown (reactive; src of truth for layer). */
  layer: string;
  /** Layer whose scene initializer is in flight; null when no ghost is needed. */
  initializingLayer: string | null;
  /** Switch layer + fetch it; outcome distinguishes same-layer, accepted, conflict and failed. */
  enterLayer(next: string): Promise<EnterLayerOutcome>;
  /** Sync read of the live layer payload, without triggering a render
   * (the design notes — cross-layer navigation needs the NEW layer's
   *  coordinates right after `enterLayer` resolves, before React flushes). */
  readLayerState(): LayerState | null;
  reloadSettings(): Promise<void>;
  /** Per-world auto-write preference; defaults to `off`. */
  settings: WorldSettings;
  /** Persist a new auto-write preference; updates local state on success. */
  saveSettings(next: WorldSettings): Promise<void>;
  /** Re-fetch the current layer. */
  refresh(): Promise<void>;
  /**
   * Optimistic position update for a card path → POST /api/card/position.
   * On failure the previous items snapshot is restored and a warning logged.
   */
  requestArrange(input: CanvasArrangeRequest): Promise<CanvasArrangeAccepted>;
  cancelArrange(operationId: string, input: Pick<CanvasArrangeRequest, 'worldId' | 'layer' | 'requestId'>): Promise<CanvasArrangeCancelAccepted>;
  moveCard(path: string, x: number, y: number, signal?: AbortSignal): Promise<Record<string, unknown>>;
  sendToWriter(text: string, layerOverride?: string): WriterPromptAcceptance;
  /** Raw WS send (character_prompt etc.). false = socket not OPEN. */
  sendMessage(payload: Record<string, unknown>): boolean;
  /** Debug/test seam: force a footprint flush (gates still apply). */
  flushFootprints(): void;
}


const INITIAL_LAYER = 'map';
const WRITER_ABORT_TYPE = ['writer', 'abort'].join('_');
const LEGACY_ABORT_TYPE = ['a', 'bort'].join('');

/** 去重窗口（the design notes）：上限 200、FIFO 淘汰。 */
const SEEN_EVENT_LIMIT = 200;

/** world_event 帧载荷（the design notes / packages/shared/src/schemas/events.ts 逐字）。 */
interface WorldEventFrame {
  type: 'world_event';
  event: {
    seq: number;
    id: string;
    projectId: string;
    type: string;
    actor: { type: string; id?: string };
    layer: string | null;
    subject: string | null;
    turn: string | null;
    detail: unknown;
    createdAt: string;
  };
  timestamp: string;
}

export function useWorld(): UseWorldApi {
  const [state, setState] = useState<LayerState | null>(null);
  const [activeSavePath, setActiveSavePath] = useState<string | null>(() => agentActivityStore.getActiveSavePath());
  const [layer, setLayer] = useState<string>(INITIAL_LAYER);
  const [loading, setLoading] = useState<boolean>(true);
  // The layer whose I1 initialiser is in flight. Drives the
  // provisional "taking shape" ghost; cleared ONLY by the `layer_initialized` /
  // `layer_init_failed` event — events are the single change source, so no timer.
  const [initializingLayer, setInitializingLayer] = useState<string | null>(null);
  // Server replay window: set on socket open, cleared
  // by the `replay_done` boundary frame. Gates writer input and the two
  // content-frame sounds so a reconnect does not let the player submit into the
  // replay, nor replay the charge/land foley twice.
  //
  // State + mirror ref, both written together: the WS effect (`onopen`,
  // `onMessage`) is mounted ONCE and closes over its first render, so it can
  // never read a fresh `replaying` — it must read the ref. The ref is also the
  // value that must be correct on the very first replayed frame, i.e. before
  // React could flush an effect that derived it from the state. The state is the
  // render-facing copy of the same boolean (same family as `initializingLayer`).
  const [replaying, setReplaying] = useState<boolean>(false);
  /**
   * The socket is open. With `replaying` this answers "can a frame sent now be
   * trusted to land?" — entering a world REPLACES the socket, and a frame sent
   * into the old one in that instant is simply lost (the companion's first line
   * was, on 2026-09-25). Anything the app sends on its own initiative, rather
   * than in answer to a click, should wait for `socketLive`.
   */
  const [socketOpen, setSocketOpen] = useState<boolean>(false);
  const replayingRef = useRef<boolean>(false);
  const writerSavePathRef = useRef<string | null>(agentActivityStore.getActiveSavePath());
  useEffect(() => agentActivityStore.subscribe(() => {
    const nextSavePath = agentActivityStore.getActiveSavePath();
    if (nextSavePath === writerSavePathRef.current) return;
    writerSavePathRef.current = nextSavePath;
    setActiveSavePath(nextSavePath);
    ++reqSeqRef.current;
    layerReadRef.current.clear();
    layerReadLatestRef.current.clear();
    resetWriter('world_change');
    getCharacterFrameQueue().clear('world-change');
    resetWorldToasts('world-switch');
    replayingRef.current = false;
    setReplaying(false);
  }), []);

  const layerRef = useRef<string>(INITIAL_LAYER);
  const stateRef = useRef<LayerState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // World-change epoch: bumped when the active world is detached, so reads in
  // flight across a world switch are discarded.
  const reqSeqRef = useRef(0);
  // Per-layer latest-read token. A newer read of the SAME layer carries the
  // same truth, so it is not a failure — only navigation away or a world
  // switch invalidates a read (see `fetchLayer`).
  const layerReadRef = useRef(new Map<string, number>());
  // The newest read of each layer, so a superseded read can wait for it (see `fetchLayer`).
  const layerReadLatestRef = useRef(new Map<string, { seq: number; read: Promise<boolean> }>());
  // One token per path lets concurrent optimistic moves fail independently:
  // a late rollback must not restore a snapshot that already includes another
  // drag (the visible "card jumps back" failure).
  const moveAttemptRef = useRef(new Map<string, number>());
  useEffect(() => {
    const unavailable = () => {
      ++reqSeqRef.current;
      resetWriter('world_change');
      stateRef.current = null;
      seenEventIdsRef.current.clear();
      worldEventToastStore.reset('world-switch');
      worldEventToastStore.setProjectId(null);
      seenEventOrderRef.current = [];
      setState(null);
      setLoading(false);
    };
    window.addEventListener('airp:world-unavailable', unavailable);
    return () => window.removeEventListener('airp:world-unavailable', unavailable);
  }, []);
  // world_event 去重（the design notes）：集合与 FIFO 队列同进同出。
  // credit-ready: ONE billing notice per turn (the writer and every character it calls may each hit the same 402);
  // reset when the player sends the next action.
  const billingNoticeRef = useRef<string | null>(null);
  const billingNotice = (stop: string) => {
    if (billingNoticeRef.current) return;
    billingNoticeRef.current = stop;
    window.dispatchEvent(new CustomEvent('airp:notice', { detail: stop }));
  };
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const seenEventOrderRef = useRef<string[]>([]);
  // The queue is the character presentation owner after App has assigned
  // identity. Consume its diagnostics here so a sequence gap or legacy
  // unsequenced frame is visible through the existing notice lane. Character
  // terminal/message frames never enter writer-state or advance its cursor.
  useEffect(() => {
    const unsubscribe = getCharacterFrameQueue().subscribe((event?: CharacterFrameQueueEvent) => {
      if (!event) return;
      window.dispatchEvent(new CustomEvent('airp:notice', {
        detail: event.message,
      }));
    });
    return unsubscribe;
  }, []);


  const fpRef = useRef<FootprintScheduler | null>(null);
  // Footprint reads the canonical writer projection; tool count is not a second
  // writer busy fact.
  const fontsSettledRef = useRef(false);
  // Per-world auto-write preference. Kept in a ref as well as
  // state: `enterLayer` reads it synchronously (a fresh fetch may not have
  // landed when a gate is clicked) and the ref is what the callback closes over.
  const [settings, setSettings] = useState<WorldSettings>(DEFAULT_WORLD_SETTINGS);
  const settingsRef = useRef<WorldSettings>(DEFAULT_WORLD_SETTINGS);

  const readLayer = useCallback(async (target: string, seq: number): Promise<boolean> => {
    const epoch = reqSeqRef.current;
    setLoading(true);
    try {
      const data = await airpGateway.layer<any>(target);
      if (epoch !== reqSeqRef.current) return false; // world switched meanwhile
      // Superseded by a newer read of the same layer: it holds the same truth
      // and has already written state, so this response is valid but its body
      // must not overwrite the fresher one. Reporting `false` here used to turn
      // a concurrent refresh (footprint write / `world_event`) into a spurious
      // `reconcile_failed` on every scene entry.
      // …and it must not answer before that newer read has written state either: a caller that checks the layer
      // right after (enterLayer's reconcile) would still see the previous scene — the phone's occasional
      // 「已进入，但场景没能同步」 when the socket's reconnect read raced the prologue's first scene entry.
      if (layerReadRef.current.get(target) !== seq) {
        const newer = layerReadLatestRef.current.get(target);
        return newer && newer.seq !== seq ? newer.read : true;
      }
      if (layerRef.current !== target) return false; // navigated away
      const identity = data.identity && typeof data.identity === 'object'
        ? data.identity as Record<string, unknown>
        : null;
      const numberField = (value: unknown): number | undefined =>
        typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
      const stringField = (value: unknown): string | undefined =>
        typeof value === 'string' && value.length > 0 ? value : undefined;
      const next: LayerState = {
        layer: data.layer,
        scene: data.scene ?? null,
        bg: data.bg ?? { src: null, tone: 'warm', grain: 'parchment' },
        audio: data.audio ?? { ambient: null, bgm: null },
        items: Array.isArray(data.items) ? data.items : [],
        links: Array.isArray(data.links) ? data.links : [],
        presence: Array.isArray(data.presence) ? data.presence : [],
        worldFrozen: data.worldFrozen === true,
        ...(data.optionStates && typeof data.optionStates === 'object' && !Array.isArray(data.optionStates) ? { optionStates: data.optionStates } : {}),
        revision: numberField(data.revision),
        canvasVersion: numberField(data.canvasVersion) ?? numberField(identity?.canvasVersion),
        canvasRevision: stringField(data.canvasRevision) ?? stringField(identity?.canvasRevision),
        snapshotId: stringField(data.snapshotId) ?? stringField(identity?.snapshotId),
      };
      stateRef.current = next;
      setState(next);
      // 幻影排座镜像 + 真实卡一到就把对应幻影撤掉（the design notes）。
      publishSeatItems(next.layer, next.items);
      // 真实卡一到就撤掉对应幻影。**MUST NOT 删这条调用**：它曾被 257fa65
      // 的 `return true` 重构顺带删除，导致 component 骨架 land 后永不回收
      // （phantom.ts 的 component 车道无 dwell 计时器），F-8/F-10 的泄漏复活。
      reconcileLanded(new Set(next.items.map((it) => it.path)));
      return true;
    } catch (err) {
      console.warn('Could not fetch layer:', err);
      return false;
    } finally {
      if (epoch === reqSeqRef.current && layerReadRef.current.get(target) === seq) setLoading(false);
    }
  }, []);

  const fetchLayer = useCallback((target: string): Promise<boolean> => {
    const seq = (layerReadRef.current.get(target) ?? 0) + 1;
    layerReadRef.current.set(target, seq);
    const read = readLayer(target, seq);
    layerReadLatestRef.current.set(target, { seq, read });
    return read;
  }, [readLayer]);

  const refresh = useCallback(async () => {
    await fetchLayer(layerRef.current);
  }, [fetchLayer]);

  const enterLayer = useCallback(
    async (next: string): Promise<EnterLayerOutcome> => {
      const commandSavePath = activeSavePath;
      window.dispatchEvent(new CustomEvent('airp:gate-feedback', { detail: null }));
      if (next === layerRef.current) {
        // Same-layer navigation is a read/reconcile, not a second
        // layer_entered fact and not a transition presentation.
        const reconciled = await fetchLayer(next);
        return reconciled && readLayerState()?.layer === next
          ? { kind: 'same-layer', layer: next, reconciled: true }
          : { kind: 'failed', layer: next, code: 'reconcile_failed', message: 'The current scene could not be synchronized.' };
      }
      try {
        const response = await airpGateway.enterLayer(next);
        const details = response as unknown as EnterLayerResult & { ok?: boolean };
        if (
          response.ok !== true
          || typeof details.layer !== 'string'
          || typeof details.name !== 'string'
          || typeof details.first !== 'boolean'
          || !details.event
          || !details.followers
        ) {
          window.dispatchEvent(new CustomEvent('airp:notice', { detail: 'The scene entry result was invalid. Refresh and try again.' }));
          return { kind: 'failed', layer: next, code: 'invalid_response', message: 'The scene entry result was invalid. Refresh and try again.' };
        }
        layerRef.current = next;
        setLayer(next);
        fpRef.current?.reset(next);
        // `first` ⟺ the target had no README ⟺ it is a stub.
        // When auto-write allows it, ask the engine to materialise the scene;
        // its eventual outcome remains a world event owned by this hook.
        if (details.first === true && startsSceneInit(settingsRef.current.autoWrite)) {
          let sent = false;
          try {
            const scopedMessage = withActiveSavePath({ type: 'airp_init', kind: 'scene', target: next, by: 'player' }, commandSavePath);
            sent = scopedMessage !== null && sendSocket(wsRef.current, scopedMessage);
          } catch {
            sent = false;
          }
          if (sent) {
            setInitializingLayer(next);
          } else {
            window.dispatchEvent(new CustomEvent('airp:notice', { detail: 'Connection lost. The scene could not start yet.' }));
          }
        }
        const reconciled = await fetchLayer(next);
        if (!reconciled || readLayerState()?.layer !== next) {
          return { kind: 'failed', layer: next, code: 'reconcile_failed', message: 'The scene entry was accepted, but the scene could not be synchronized.' };
        }
        return { kind: 'accepted', layer: next, details, reconciled: true };
      } catch (error) {
        const code = error instanceof AirpRequestError && typeof error.payload?.code === 'string'
          ? error.payload.code
          : undefined;
        const conflict = code === 'requirements_not_met' || code === 'invalid_gate' || code === 'stale' || code === 'conflict';
        const message = error instanceof Error ? error.message : 'The scene could not be entered.';
        const feedback = gateFeedback(error, next, stateRef.current?.items ?? []);
        if (feedback) window.dispatchEvent(new CustomEvent('airp:gate-feedback', { detail: feedback }));
        // The world itself is gone: the page says so once and reopens it (App.tsx), no raw 409 on top.
        else if (code !== 'no_active_world') window.dispatchEvent(new CustomEvent('airp:notice', { detail: message }));
        return { kind: conflict ? 'conflict' : 'failed', layer: next, code, message };
      }
    },
    [fetchLayer, activeSavePath]
  );

  /**
   * 同步读取当前层状态（`the design notes`）。
   *
   * 跨层导航需要「`enterLayer` 解析后」的坐标，但 React state 此刻未必已 flush；
   * 这里返回内部 `stateRef` 的当前值——只读，不触发渲染、不写状态。
   */
  const readLayerState = useCallback((): LayerState | null => stateRef.current, []);

  const moveCard = useCallback(async (path: string, x: number, y: number, signal?: AbortSignal): Promise<Record<string, unknown>> => {
    const previous = stateRef.current;
    if (!previous) return { ok: false, code: 'not_ready', error: 'The canvas is not ready.' };
    const previousItem = previous.items.find((it) => it.path === path);
    if (!previousItem) return { ok: false, code: 'not_found', error: 'The card is no longer on this canvas.' };
    const token = (moveAttemptRef.current.get(path) ?? 0) + 1;
    moveAttemptRef.current.set(path, token);
    // Keep the synchronous mirror in lockstep with the optimistic React state.
    // Drag settling can submit several cards before React flushes; reading an
    // old ref here used to make each request capture the same rollback snapshot.
    const optimistic = {
      ...previous,
      items: previous.items.map((it) => (it.path === path ? { ...it, x, y } : it)),
    };
    stateRef.current = optimistic;
    setState(optimistic);
    try {
      const result = await airpGateway.moveCard(path, x, y, signal);
      if (moveAttemptRef.current.get(path) === token) moveAttemptRef.current.delete(path);
      return result;
    } catch (err) {
      console.warn('moveCard failed, rolling back:', err);
      // Only the latest attempt for this path may roll itself back, and only
      // while its optimistic coordinates are still the visible coordinates.
      const current = stateRef.current;
      const currentItem = current?.items.find((it) => it.path === path);
      if (moveAttemptRef.current.get(path) === token && current && currentItem
        && currentItem.x === x && currentItem.y === y) {
        const rollback = {
          ...current,
          items: current.items.map((it) => (it.path === path ? previousItem : it)),
        };
        stateRef.current = rollback;
        setState(rollback);
      }
      throw err;
    }
  }, []);

  const sendToWriter = useCallback((text: string, layerOverride?: string): WriterPromptAcceptance => {
    const normalized = typeof text === 'string' ? text.trim() : '';
    if (!normalized) {
      return { accepted: false, reason: 'invalid', message: 'Enter an action before sending.' };
    }
    if (getWriterState().phase === 'writing') {
      return { accepted: false, reason: 'busy', message: 'The writer is already working.' };
    }
    // Still catching up: a prompt sent now would interleave
    // with the replayed frames and let the historical `writer_idle` open the input
    // lock early. Reject until `replay_done` clears the flag.
    if (replayingRef.current) {
      return { accepted: false, reason: 'busy', message: 'Catching up…' };
    }
    // 新手礼包 (lib/newcomer-gift.ts): the first action asks for the one-time gift if the scene entry did not (fire and
    // forget; the writer's first model call comes after its prompt is built; ai re-asks a cached refusal).
    void autoNewcomerGift();
    billingNoticeRef.current = null; // a new turn may show its own billing notice
    const targetLayer = typeof layerOverride === 'string' && layerOverride.trim()
      ? layerOverride.trim()
      : layerRef.current;
    const scopedMessage = withActiveSavePath({ type: 'writer_prompt', message: normalized, layer: targetLayer }, activeSavePath);
    if (!scopedMessage) {
      return { accepted: false, reason: 'transport-closed', message: 'The active world changed. Reopen it before sending.' };
    }
    let sent = false;
    try {
      sent = sendSocket(wsRef.current, scopedMessage);
    } catch {
      sent = false;
    }
    if (!sent) {
      return { accepted: false, reason: 'transport-closed', message: 'Connection lost. Please try again.' };
    }
    // There is no server domain-ack frame: transport acceptance is the seam.
    if (!beginWriterPrompt(normalized)) {
      return { accepted: false, reason: 'busy', message: 'The writer is already working.' };
    }
    return { accepted: true };
  }, [activeSavePath]);

  // Returns false when the socket is not OPEN (the design notes §⑫-4 ruling: the
  // `airp_init` caller must know a request was actually sent before showing a
  // ghost for it). Existing callers ignore the value.
  const sendMessage = useCallback((payload: Record<string, unknown>): boolean => {
    const scopedMessage = withActiveSavePath(payload, activeSavePath);
    let sent = false;
    try {
      sent = scopedMessage !== null && sendSocket(wsRef.current, scopedMessage);
    } catch {
      sent = false;
    }
    if (scopedMessage !== null && !sent && (payload.type === WRITER_ABORT_TYPE || payload.type === LEGACY_ABORT_TYPE)) {
      acceptWriterFrame({
        type: 'error',
        source: 'writer',
        message: 'Connection lost. Please try again.',
      });
      window.dispatchEvent(new CustomEvent('airp:notice', { detail: 'Connection lost. Please try again.' }));
    }
    return sent;
  }, [activeSavePath]);

  const flushFootprints = useCallback(() => {
    fpRef.current?.flushNow();
  }, []);

  /** world_event 去重：首次见到返回 true 并登记，重复返回 false。
   *  纪律「谁消费、谁登记」——本批只有 world_event 一处调用者（02 §3.3.1-(b)）。 */
  const noteWorldEvent = useCallback((id: string): boolean => {
    const seen = seenEventIdsRef.current;
    if (seen.has(id)) return false;
    seen.add(id);
    const order = seenEventOrderRef.current;
    order.push(id);
    if (order.length > SEEN_EVENT_LIMIT) {
      const oldest = order.shift();
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  }, []);

  /**
   * 命中转发集合才派发 airp:world-event（00 §5 / the design notes）：
   * `entity_*` 让背包/角色视图同步；`following_changed` / `character_moved` 让
   * App 重新取 chrome 数据（右侧角色栏的跨层事实来自 /api/characters，
   * 见 the design notes）。
   *
   * ⚠️ 这里的 `.includes()` 形态是 `check:ws` 的约定（见 :444-446）：若改写成对
   * `ev.type` 的等值比较，`consumedFrom` 会把**事件 type** 读成**帧名**并报 GHOST。
   */
  const forwardWorldEvent = useCallback((msg: Record<string, unknown>): void => {
    const ev = msg.event as { type?: string } | undefined;
    if (
      [
        'entity_created',
        'entity_edited',
        'entity_deleted',
        'entity_moved',
        'following_changed',
        'character_moved',
        // set_music: a new world theme lives in the
        // manifest App re-fetches; a place's own music arrives with the layer
        // refetch below. The audio engine crossfades either way, no reload.
        'music_changed',
        // A loop reset put items back where they were:
        // the bag and the character rail re-read.
        'loop_reset',
      ].includes(ev?.type ?? '')
    ) {
      window.dispatchEvent(new CustomEvent('airp:world-event', { detail: msg }));
    }
  }, []);

  // The reporter is created ONCE and lives off refs: it needs the live layer and
  // the live items, not the ones captured at mount (03 §8.2).
  useEffect(() => {
    const scheduler = createFootprintScheduler({
      layer: () => layerRef.current,
      widths: () => new Map((stateRef.current?.items ?? []).map((it) => [it.path, it.w])),
      measure: () => measureHeights(),
      post: async (l, boxes) => {
        const res = await fetch('/api/card/footprint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layer: l, boxes }),
        });
        if (!res.ok) {
          throw new Error(`POST /api/card/footprint -> ${res.status} ${await res.text()}`);
        }
        const data = (await res.json()) as { updated?: unknown; unchanged?: unknown };
        // The stored box is now the measured one: drop the local cache so the
        // drag collision sees the same value this cycle (contract §5.4).
        invalidateMeasures();
        return { updated: Number(data.updated) || 0, unchanged: Number(data.unchanged) || 0 };
      },
      // Raw count only: the scheduler owns the stale-counter (30s) guard and
      // its single warning, so there is exactly one place that decides.
      isBusy: () => getWriterState().toolCount > 0,
      isDragging: () => document.querySelector('.object.dragging-item') !== null,
      onResult: ({ layer: measuredLayer, updated }) => {
        // Seat against the new dimensions immediately, not a platform-specific
        // SQLite watcher notification. The server remains placement authority.
        if (updated > 0 && measuredLayer === layerRef.current) void fetchLayer(measuredLayer);
      },
    });
    fpRef.current = scheduler;
    return () => {
      scheduler.dispose();
      fpRef.current = null;
    };
  }, [fetchLayer]);

  // Per-card ResizeObserver: a card's height changes when its CONTENT does —
  // dragging only writes left/top, so it never fires here (03 F2). Remounted
  // per payload so newly added shells are observed and detached ones dropped.
  useEffect(() => {
    let disposed = false;
    let frame = 0;
    // Gate ① covers this path too: an initial observe callback still fires
    // while the fallback font is in place, so nothing is armed until the fonts
    // settle (`fontsSettledRef` below flips it and arms the first pass).
    const observer = new ResizeObserver(() => {
      if (fontsSettledRef.current) fpRef.current?.notify();
    });
    frame = requestAnimationFrame(() => {
      if (disposed) return;
      for (const el of document.querySelectorAll('.object[data-path]')) observer.observe(el);
      // First measurement waits for web fonts: font metrics decide wrapping
      // (355px → 291px on the same paragraph, contract §3.5).
      if (fontsSettledRef.current) {
        fpRef.current?.notify();
        return;
      }
      void whenFontsSettled().then((outcome) => {
        if (outcome === 'timeout') {
          console.warn('[footprint] fonts did not settle in time; heights may be off');
        }
        fontsSettledRef.current = true;
        if (!disposed) fpRef.current?.notify();
      });
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [state?.items]);

  // WebSocket: world event → refresh; freeze flag → state; card_position → merge.
  useEffect(() => {
    let stopped = false;
    let retryTimer: number | null = null;
    // Local failsafe for the replay window: armed on open,
    // disarmed by `replay_done` / `onclose`. `replayTo` is synchronous, so a
    // missing boundary frame means an exception path — and the writer input must
    // not stay locked forever in silence.
    let replayDoneTimer: number | null = null;

    const onMessage = (msg: Record<string, unknown>) => {
      // Every writer presentation frame enters the canonical writer snapshot;
      if (isWorldScopedServerFrame(msg) && !matchesActiveSave(msg)) return;
      const frameSavePath = typeof msg.savePath === 'string' ? msg.savePath : null;
      const isFrameCurrent = () => frameSavePath !== null && agentActivityStore.isSaveActive(frameSavePath);
      // UI components never reconstruct this lifecycle from a raw event.
      if (msg.source === 'writer') acceptWriterFrame(msg);
      if (msg.type === 'file_changed' || msg.type === 'card_position') {
        // App listens for this to keep its backpack/character views in sync.
        window.dispatchEvent(new CustomEvent('airp:world-event', { detail: msg }));
      }
      switch (msg.type) {
        case 'file_changed':
          // A command's writes land in the same HTTP request that rolled the
          // dice, so this frame arrives at ~150ms — long before the ceremony
          // settles. Hold the refetch, or the reward
          // cards it created appear while the dice are still tumbling.
          deferReveal(() => {
            if (isFrameCurrent()) void fetchLayer(layerRef.current);
          });
          break;
        case 'world_event':
          // 世界事件（the design notes）：先判重，再转发，最后整层重取。
          {
            const ev = msg.event as
              | { id?: string; type?: string; layer?: string | null; detail?: { layer?: string } }
              | undefined;
            if (!ev || typeof ev.id !== 'string') break; // 畸形帧不污染去重集合
            if (!noteWorldEvent(ev.id)) break; // 同一行的重复副本到此为止
            forwardWorldEvent(msg); // 转发集合命中才通知 App（:342）
            // The message drawer maps every event itself (`streamItemsOfEvent`, the design notes): it keeps what is said.
            window.dispatchEvent(new CustomEvent('airp:stream-event', { detail: ev }));
            // Character tick: the player's own move is part of a beat.
            // (`.includes()` form: EVENT types nested in `world_event`, not frame names — check:ws.)
            if (PLAYER_ACT_EVENTS.includes(ev.type ?? '') && (ev as { actor?: { type?: string } }).actor?.type === 'player') {
              window.dispatchEvent(new CustomEvent(PLAYER_ACT_EVENT, { detail: ev }));
            }
            // The two presentations carry their own line:
            // with the merge switch on, an item obtained is not toasted at all, and a scene
            // entered waits a moment — if its title card claims it, it is not toasted either.
            {
              const merge = mergeMomentToasts();
              const entered = merge ? sceneEnteredLayer(ev) : null;
              if (merge && isItemObtainedEvent(ev)) {
                // the item card says it
              } else if (entered !== null) {
                window.setTimeout(() => {
                  if (!isFrameCurrent()) return;
                  if (!sceneToastClaimed(entered)) {
                    whenStageIdle(() => {
                      if (isFrameCurrent()) worldEventToastStore.ingest(ev as WorldEvent);
                    });
                  }
                }, SCENE_CLAIM_MS);
              } else {
                // A scene card / animation on screen: the toast waits and its clock starts after (§3.3).
                whenStageIdle(() => {
                  if (isFrameCurrent()) worldEventToastStore.ingest(ev as WorldEvent);
                });
              }
            }
            // Story events (actions/story-event.ts) get their own card, not a
            // transient toast: they are narration the player should read.
            // (`.includes()` form: an EVENT type nested in `world_event`, not a frame name — check:ws.)
            if (['story_event'].includes(ev.type ?? '')) window.dispatchEvent(new CustomEvent('airp:story-event', { detail: ev }));
            // A CG (`show_cg`, the design notes) waits for the dice ceremony
            // like the refetch below, so a roll's picture follows its verdict. A
            // `background_swapped` needs nothing here: the layer refetch reads the new `bg`.
            if (['cg_shown'].includes(ev.type ?? '')) deferReveal(() => {
              if (isFrameCurrent()) window.dispatchEvent(new CustomEvent('airp:cg-shown', { detail: ev }));
            });
            // A loop reset: 「第 N 轮」, after the world's own CG.
            if (['loop_reset'].includes(ev.type ?? '')) deferReveal(() => {
              if (isFrameCurrent()) window.dispatchEvent(new CustomEvent('airp:loop-reset', { detail: ev }));
            });
            // The I1 initialiser's outcome: clear the ghost.
            // `layer_initialized` -> the refetched product replaces it (handover);
            // `layer_init_failed` must ALSO be visible (contract §8 anti-pattern 8),
            // but the toast copy is localised in App — this hook has no `t()`.
            // `ev.type` is an EVENT type nested in `world_event`, NOT a frame name —
            // the `.includes()` form keeps `check:ws` from reading them as frames
            // (same convention as `forwardWorldEvent` above).
            if (['layer_initialized', 'layer_init_failed'].includes(ev.type ?? '')) {
              const done = ev.detail?.layer ?? ev.layer ?? null;
              setInitializingLayer((cur) => (cur !== null && (done === null || done === cur) ? null : cur));
              window.dispatchEvent(new CustomEvent('airp:layer-init', { detail: msg }));
            }
            // The layer refetch goes through the gate for the same reason as
            // `file_changed` above, and for every other effect too: a command
            // that only `link`ed writes canvas rows and lands no event, so this
            // is the second of two independent consumption paths (06 §8.3).
            deferReveal(() => {
              if (isFrameCurrent()) void fetchLayer(layerRef.current);
            });
          }
          break;
        case 'player_board':
          // The player's clue board changed (another tab, or this one's echo).
          // `usePlayerBoard` owns the board; this is only the relay.
          window.dispatchEvent(new CustomEvent('airp:player-board', { detail: msg }));
          break;
        case 'world_frozen':
          setState((s) => (s ? { ...s, worldFrozen: true } : s));
          break;
        case 'world_thawed':
          setState((s) => (s ? { ...s, worldFrozen: false } : s));
          break;
        case 'card_position':
          if (
            typeof msg.path === 'string' &&
            typeof msg.x === 'number' &&
            typeof msg.y === 'number'
          ) {
            setState((s) => {
              if (!s) return s;
              const items = mergeItemPatch(s.items, { path: msg.path as string, x: msg.x as number, y: msg.y as number });
              if (items === s.items) return s;
              const out = { ...s, items: items as LayerItem[] };
              stateRef.current = out; // footprint/moveCard read stateRef as truth
              return out;
            });
          }
          break;
        case 'agent_progress':
          // Lifecycle state was accepted at the ingress above. Keep an
          // explicit consumer case for the websocket contract checker.
          break;
        case 'agent_activity': {
          // A frame already sent by save A may reach this socket after save B
          // is selected. Keep its source identity; never infer ownership from
          // the currently loaded world.
          const savePath = typeof msg.savePath === 'string' ? msg.savePath : null;
          if (!agentActivityStore.isSaveActive(savePath)) break;
          publishCanvasArrangeFrame(msg);
          agentActivityStore.ingest(msg, Date.now(), savePath);
          break;
        }
        case 'tool_start':
          // The writer's pointer moves onto the md / folder this call touches.
          agentCursorStore.toolStart(msg);
          break;
        case 'tool_end': {
          agentCursorStore.toolEnd(msg);
          const failedToolCallId = msg.isError === true && typeof msg.toolCallId === 'string'
            ? msg.toolCallId
            : undefined;
          // Failed tools of either source must release their phantom.
          if (failedToolCallId !== undefined) evictPhantom(failedToolCallId);
          // An image refused for billing: the same notice (+ claim / redeem entry) as TTS / STT.
          if (isBillingStop(msg.billing)) billingNotice(msg.billing);
          // 改进产品 (lib/analytics.ts): an image that failed, with the reason code only.
          if (msg.isError === true && msg.toolName === 'generate_image') track('image_failed', { reason: asWord(msg.billing) ?? 'tool_error' });
          // `image_generation_progress` took the sound bed for either source: a failed
          // character image hands it back too (unless another image is still drawing).
          const imageFailed = msg.source === 'character' && msg.toolName === 'generate_image'
            && !getPhantomsSnapshot().some((entry) => entry.kind === 'image' && (entry.phase === 'pending' || entry.phase === 'writing'));
          if (failedToolCallId !== undefined && (msg.source === 'writer' || imageFailed)) {
            setAmbient(stateRef.current?.audio.ambient ?? null);
          }
          break;
        }
        case 'character_delta':
        case 'character_message':
        case 'character_idle': {
          // Character frames have one identity owner. Never repair a missing
          // id from the open modal: an unowned delta is unsafe to render.
          if (msg.source === 'character' && !agentActivityStore.isSaveActive(
            typeof msg.savePath === 'string' ? msg.savePath : null,
          )) break;
          if (
            msg.source !== 'character' ||
            typeof msg.characterId !== 'string' ||
            !isValidCharacterId(msg.characterId)
          ) {
            if (msg.source === 'character') {
              window.dispatchEvent(new CustomEvent('airp:notice', {
                detail: 'Character frame dropped: missing or invalid character id.',
              }));
            }
            break;
          }
          if (
            (msg.type === 'character_delta' && typeof msg.delta !== 'string') ||
            (msg.type === 'character_message' && typeof msg.text !== 'string')
          ) {
            window.dispatchEvent(new CustomEvent('airp:notice', {
              detail: 'Character frame dropped: malformed text payload.',
            }));
            break;
          }
          window.dispatchEvent(new CustomEvent('airp:character-frame', { detail: msg }));
          if (msg.type === 'character_idle') agentCursorStore.idle(`character:${msg.characterId}`);
          break;
        }
        case 'character_stop_status':
          if (
            msg.source !== undefined ||
            typeof msg.savePath !== 'string' ||
            !agentActivityStore.isSaveActive(msg.savePath) ||
            typeof msg.characterId !== 'string' ||
            !isValidCharacterId(msg.characterId) ||
            !['deferred', 'completed', 'superseded', 'error'].includes(String(msg.status))
          ) break;
          if (msg.status === 'deferred') {
            window.dispatchEvent(new CustomEvent('airp:notice', { detail: { id: 'character_close_deferred' } }));
          } else if (msg.status === 'superseded') {
            window.dispatchEvent(new CustomEvent('airp:notice', { detail: { id: 'character_close_world_changed' } }));
          } else if (msg.status === 'error') {
            window.dispatchEvent(new CustomEvent('airp:notice', { detail: { id: 'character_close_error' } }));
          }
          break;
        case 'error':
          // No model on this computer (server gate): the settings notice with its button (TtsSettings).
          if (msg.code === 'no_model_configured') window.dispatchEvent(new CustomEvent('airp:model-unavailable'));
          // A character error follows the same typed lane as its text. Writer
          // errors remain global notices; malformed character errors are not
          // allowed to enter the lane.
          if (msg.source === 'character') {
            if (!agentActivityStore.isSaveActive(typeof msg.savePath === 'string' ? msg.savePath : null)) break;
            if (
              typeof msg.characterId === 'string' &&
              isValidCharacterId(msg.characterId) &&
              typeof msg.message === 'string'
            ) {
              agentCursorStore.idle(`character:${msg.characterId}`);
              window.dispatchEvent(new CustomEvent('airp:character-frame', { detail: msg }));
              // a character refused for billing mid-turn: the same single notice + card as the writer
              if (isBillingStop(msg.billing)) billingNotice(msg.billing);
            } else {
              window.dispatchEvent(new CustomEvent('airp:notice', {
                detail: 'Character error dropped: missing or invalid character id.',
              }));
            }
          } else {
            agentCursorStore.idle('writer');
            // a billing stop ends the turn with ONE notice naming it (ClaimPrompt: claim button or account card)
            if (isBillingStop(msg.billing)) billingNotice(msg.billing);
            else window.dispatchEvent(new CustomEvent('airp:notice', { detail: msg.message ?? 'The writer could not finish this turn.' }));
          }
          break;
        case 'replay_done':
          // Boundary frame: the server finished re-sending
          // the last N complete turns. Clears the "still catching up" flag so the
          // writer input is not held hostage by a replay that already ended, and
          // disarms the local failsafe.
          replayingRef.current = false;
          setReplaying(false);
          if (replayDoneTimer !== null) {
            window.clearTimeout(replayDoneTimer);
            replayDoneTimer = null;
          }
          break;
        case 'turn_aborted':
          if (msg.source === 'character') {
            if (!agentActivityStore.isSaveActive(typeof msg.savePath === 'string' ? msg.savePath : null)) break;
            if (typeof msg.characterId === 'string' && isValidCharacterId(msg.characterId)) {
              agentCursorStore.idle(`character:${msg.characterId}`);
              window.dispatchEvent(new CustomEvent('airp:character-frame', { detail: msg }));
            } else {
              window.dispatchEvent(new CustomEvent('airp:notice', {
                detail: 'Character frame dropped: missing or invalid character id.',
              }));
            }
          } else {
            agentCursorStore.idle('writer');
            window.dispatchEvent(new CustomEvent('airp:notice', { detail: msg.message ?? 'The writer could not finish this turn.' }));
          }
          break;
        // ---- 演出通道（the design notes）----
        case 'chalk_writing': {
          if (msg.source !== 'writer' || typeof msg.toolCallId !== 'string') break;
          const seat = phantomSeatFor(CARD_FORMS.chalk, layerRef.current).seat;
          registerPhantom(msg.toolCallId, {
            kind: 'chalk',
            source: 'writer',
            seat,
            layer: layerRef.current,
          });
          // 回放闸门（the design notes 裁决 D 附带项）：内容帧会被回放，但音效
          // 不该跟着重放（「刷新会响两声」）。
          if (!replayingRef.current) playCharge(0);
          break;
        }
        // 组件骨架屏（the design notes）：作家 write 一张组件卡时，服务端在
        // tool_execution_start 发 card_writing；这里注册 component 幻影，由
        // CardSkeleton 画结构化骨架，落地后经既有 reconcileLanded 按 path 删除。
        case 'card_writing': {
          if (msg.source !== 'writer' || typeof msg.toolCallId !== 'string') break;
          const kind = typeof msg.kind === 'string' ? msg.kind : undefined;
          const form = kind !== undefined ? CARD_FORMS[kind] : undefined;
          const layer = typeof msg.layer === 'string' ? msg.layer : undefined;
          // 白名单（不回退 layerRef.current）：层推不出 = 该 path 永不进 items →
          // reconcileLanded 永不删 → 骨架永挂且挤座（the design notes F-10 裁决 O）。
          if (!cardWritingGuard(form, kind, layer)) break;
          const seat = phantomSeatFor({ w: form!.w, h: form!.h }, layer!).seat;
          registerPhantom(msg.toolCallId, {
            kind: 'component',
            source: 'writer',
            seat,
            layer,
            cardKind: kind,
            cardTitle: typeof msg.title === 'string' ? msg.title : undefined,
          });
          break;
        }
        case 'writer_delta': {
          if (msg.source !== 'writer' || typeof msg.toolCallId !== 'string' || typeof msg.delta !== 'string') break;
          if (msg.mode === 'replace') setInk(msg.toolCallId, msg.delta);
          else appendInk(msg.toolCallId, msg.delta);
          break;
        }
        case 'chalk_landed': {
          if (msg.source !== 'writer' || typeof msg.toolCallId !== 'string') break;
          landPhantom(msg.toolCallId, typeof msg.path === 'string' ? { path: msg.path } : {});
          endCharge();
          if (!replayingRef.current) playFoley('paper-slide');
          break;
        }
        case 'writer_idle': {
          if (msg.source !== 'writer') break;
          agentCursorStore.idle('writer');
          break;
        }
        case 'dice_result': {
          // 与玩家点击的 /api/dice 同形；交给 App 的仪式层演出。
          window.dispatchEvent(new CustomEvent('airp:dice-frame', { detail: msg }));
          break;
        }
        case 'image_generation_progress': {
          const source = msg.source === 'character' || msg.source === 'writer' ? msg.source : undefined;
          if (typeof msg.toolCallId !== 'string' || source === undefined) break;
          const size = ghostSizeFor(msg.width as number, msg.height as number);
          registerPhantom(msg.toolCallId, {
            kind: 'image',
            source,
            seat: getPhantomsSnapshot().find((entry) => entry.toolCallId === msg.toolCallId)?.seat
              ?? phantomSeatFor(size, layerRef.current).seat,
            layer: layerRef.current,
            label: stageText(msg.stage as string, msg.elapsedMs as number),
            elapsedMs: typeof msg.elapsedMs === 'number' ? msg.elapsedMs : undefined,
          });
          setAmbient(GHOST_WAIT_AMBIENT);
          break;
        }
        case 'image_landed': {
          if (typeof msg.toolCallId !== 'string') break;
          landPhantom(msg.toolCallId, {
            asset: typeof msg.asset === 'string' ? msg.asset : undefined,
            reused: msg.reused === true,
          });
          playFoley('crit-chime');
          // Hand the sound bed back to the layer's authority (the design notes
          // §3.1 step 9): `image_generation_progress` took it with a wait bed.
          setAmbient(stateRef.current?.audio.ambient ?? null);
          break;
        }
        case 'canvas_patched': {
          // 帧带 layer：不匹配（或缺失）整帧忽略 —— 作家在别的层摆位不该让当前页抖一下。
          if (typeof msg.layer !== 'string' || msg.layer !== layerRef.current) break;
          if (msg.kind === 'links') {
            if (!Array.isArray(msg.links)) break;
            setState((s) => {
              if (!s) return s;
              const links = mergeLinkPatch(s.links, msg.links as never, msg.action as never);
              if (links === s.links) return s;
              const out = { ...s, links: links as LayerLink[] };
              stateRef.current = out;
              return out;
            });
          } else if (msg.kind === 'cards') {
            if (!Array.isArray(msg.cards)) break;
            publishCanvasArrangeFrame(msg);
            setState((s) => {
              if (!s) return s;
              let items: readonly LayerItem[] = s.items;
              for (const c of msg.cards as { path: string; x: number; y: number; z?: number }[]) {
                if (!c || typeof c.path !== 'string') continue;
                items = mergeItemPatch(items, c);
              }
              if (items === s.items) return s;
              const out = { ...s, items: items as LayerItem[] };
              stateRef.current = out;
              return out;
            });
          } else {
            // 未知 kind 是契约漂移信号 —— 必须看得见（the design notes）。
            console.warn('[canvas_patched] unknown kind', msg.kind);
          }
          break;
        }
        case 'show_frame':
          // 演出库（the design notes PerformanceLayer 的分发器。
          window.dispatchEvent(new CustomEvent('airp:show-frame', { detail: msg }));
          break;
        default:
          // agent_event / roll_resolved 等仍在此忽略（the design notes）。
          break;
      }
    };

    // Reconnect (the team): a dropped socket would otherwise leave the writer input
    // disabled and the tool counter stuck. Reconnect resets both guards on open.
    let socketGeneration = 0;
    const connect = () => {
      if (stopped) return;
      const generation = ++socketGeneration;
      let ws: WebSocket;
      ws = openAirpSocket((msg) => {
        if (generation !== socketGeneration || wsRef.current !== ws) return;
        // Snapshot first: a frame handled during the replay window is history,
        // even the `replay_done` that closes it.
        const live = !replayingRef.current;
        onMessage(msg);
        if (live) publishCanvasSocketFrame(msg);
      });
      wsRef.current = ws;
      bindCanvasSocket(ws);
      ws.onopen = () => {
        if (generation !== socketGeneration || wsRef.current !== ws) return;
        setSocketOpen(true);
        resetWriter('socket_open');
        // Expect a replay window before the socket is live;
        // `replay_done` clears it. Arm the local failsafe in the same tick: a
        // synchronous `replayTo` that threw would otherwise leave the flag set
        // with nothing coming.
        replayingRef.current = true;
        setReplaying(true);
        // The save this replay is for. None yet (the page is still in the lobby / opening a world): the server's
        // `replay_done` names a save this page does not hold, so it is filtered out and nothing was missed.
        const replayFor = agentActivityStore.getActiveSavePath();
        if (replayDoneTimer !== null) window.clearTimeout(replayDoneTimer);
        replayDoneTimer = window.setTimeout(() => {
          replayDoneTimer = null;
          if (generation !== socketGeneration || wsRef.current !== ws) return;
          if (!replayingRef.current) return;
          // Fail loud: say the catch-up did not finish,
          // then release the input so the player is never locked out silently.
          replayingRef.current = false;
          setReplaying(false);
          // …but only when there was something to catch up on: a socket opened before any save was active (the
          // first-run language screen, the lobby) has no history here — no notice over the next world's first scene.
          if (!replayFor || replayFor !== agentActivityStore.getActiveSavePath()) return;
          window.dispatchEvent(new CustomEvent('airp:notice', {
            detail: 'Could not catch up on the last moments. You can keep playing.',
          }));
        }, REPLAY_DONE_TIMEOUT_MS);
        // No world open yet (the first-run language screen, the lobby): nothing to re-read — it was a 409 no_active_world.
        if (agentActivityStore.getActiveSavePath() || stateRef.current) void fetchLayer(layerRef.current);
      };
      ws.onclose = (ev: CloseEvent) => {
        if (generation !== socketGeneration || wsRef.current !== ws) return;
        wsRef.current = null;
        setSocketOpen(false);
        bindCanvasSocket(null);
        resetWriter('socket_close');
        // A dropped socket never sends `replay_done`: disarm the failsafe and
        // clear the flag, or the reconnect would inherit a stale lock.
        if (replayDoneTimer !== null) {
          window.clearTimeout(replayDoneTimer);
          replayDoneTimer = null;
        }
        replayingRef.current = false;
        setReplaying(false);
        // A dropped socket never delivers terminal frames, so clear activity
        // immediately rather than waiting for its stale sweep.
        agentActivityStore.clearAll();
        agentCursorStore.clearAll();
        // `closeKind` is the ONLY classifier. A protocol
        // verdict means retrying with the same build fails forever — say so
        // instead of hammering the server every 1.2s.
        if (closeKind(ev.code) === 'protocol') {
          window.dispatchEvent(new CustomEvent('airp:notice', {
            detail: 'This page is out of date with the server. Reload to continue.',
          }));
          return;
        }
        if (!stopped) retryTimer = window.setTimeout(connect, 1200);
      };
    };

    connect();

    return () => {
      stopped = true;
      socketGeneration++;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (replayDoneTimer !== null) window.clearTimeout(replayDoneTimer);
      wsRef.current?.close();
      wsRef.current = null;
      bindCanvasSocket(null);
    };
  }, [fetchLayer, noteWorldEvent, forwardWorldEvent]);

  // Active world's auto-write preference. Loaded on mount and after any world
  // load (`App` calls `reloadSettings` once the new save is active, since the
  // value is per-world and the file lives under that save's `.airpworld/`).
  const reloadSettings = useCallback(async () => {
    try {
      const next = await airpGateway.worldSettings();
      // Keep the WHOLE object the server returned, not just `autoWrite`: the
      // POST is a patch, so dropping fields here would
      // re-introduce the very silent reset the patch semantics exists to stop.
      settingsRef.current = next;
      setSettings(settingsRef.current);
    } catch {
      // Fail-soft: an unreachable settings route keeps the `off` default, which
      // is the safe (contract-preserving) state.
    }
  }, []);

  const saveSettings = useCallback(async (next: WorldSettings) => {
    const saved = await airpGateway.saveWorldSettings(next);
    settingsRef.current = saved;
    setSettings(settingsRef.current);
  }, []);

  // Initial load of the default layer + the active world's settings. Settings are world-scoped: ask only once
  // the layer read proved a world is active, so the lobby never logs a 409 「Load a world first.」 (a world loaded
  // later gets its settings from App's `reloadSettings`).
  useEffect(() => {
    void fetchLayer(layerRef.current).then((ok) => { if (ok) void reloadSettings(); });
  }, [fetchLayer, reloadSettings]);

  return {
    state,
    loading,
    layer,
    initializingLayer,
    enterLayer,
    refresh,
    readLayerState,
    moveCard,
    requestArrange: requestCanvasArrange,
    cancelArrange: cancelCanvasArrange,
    sendToWriter,
    sendMessage,
    socketLive: socketOpen && !replaying,
    settings,
    saveSettings,
    reloadSettings,
    flushFootprints,
  };
}
