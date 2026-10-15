import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, Loader2, Mic, PhoneOff } from 'lucide-react';
import { NookPortrait } from './NookPortrait.js';
import { Canvas } from '../canvas/Canvas.js';
import { WriterBar } from '../chrome/WriterBar.js';
import { StubPrompt } from '../chrome/StubPrompt.js';
import { ghostItemFor } from '../../lib/init-ghost.js';
import { portraitStatusOf, statusLineOf } from '../../lib/nook-status.js';
import type { LayerState } from '../../state/useWorld.js';
import { NookNoteComposer } from './NookNoteComposer.js';
import { UI_COPY, translate, type Locale } from '../../lib/i18n.js';
import { agentActivityStore } from '../../lib/agent-activity-store.js';
import {
  useLiveCallActions,
  useLiveCallAvailable,
  useLiveCallLines,
  useLiveCallState,
} from '../../lib/live-call.js';
import { airpGateway, type AssetMediaKind } from '../../lib/airp-gateway.js';
import { useStill } from '../../lib/motion.js';
import { whenFontsSettled } from '../../lib/fonts.js';
import { invalidateMeasures } from '../../lib/measure.js';
import {
  createFootprintScheduler,
  measureHeights,
  type FootprintScheduler,
} from '../../lib/footprint.js';
import './nook-character-media.css';
import { MarkdownText, stripLeadingTitle } from '../../lib/md.js';
import { nookIdOf, nookScenePathOf } from '@airp/shared/characters';
import { LiveCallStatus } from '../live/LiveCallStatus.js';
import { LiveCallTranscript } from '../live/LiveCallTranscript.js';
import type { FocusCoordinator } from '../../lib/focus-coordinator.js';
import type { PerformanceSettings } from '../../lib/performance-settings.js';

/**
 * NookView — a character's private space.
 *
 * It reuses the layer `<Canvas>` wholesale: same card components, same drag
 * path, same measured-footprint write-back. Only two things differ from the
 * layer view — the fetch endpoint (`GET /api/nook`) and the empty state.
 *
 * It deliberately does NOT call `useWorld()`: that would start a SECOND
 * WebSocket and a second layer footprint scheduler (00 §6 anti-pattern 3).
 * Re-fetch on world changes rides the existing `airp:world-event` forward.
 */
export interface CharacterMediaSnapshot {
  id: string;
  name?: string;
  avatar?: string;
  avatarVideo?: string;
}

export interface NookViewProps {
  /** Character id (ASCII kebab-case, supplied by the character rail's nook button). */
  characterId: string;
  /** Active world identity; used only to isolate local portrait position memory. */
  worldId: string;
  /** Metadata from the single `/api/characters` chrome request. */
  character: CharacterMediaSnapshot;
  /** Effects toggle controls character motion, never Nook data or presence. */
  effectsEnabled: boolean;
  particleDensity: PerformanceSettings['particleDensity'];
  /** Host page visibility; keeps the Canvas lifecycle in parity with layer. */
  hidden?: boolean;
  /** Host reduced-motion seam; defaults to the live media preference. */
  reducedMotion?: boolean;
  /** God-hand permission is shared with the layer Canvas. */
  allowChalkDrag?: boolean;
  /** Shared asset resolver used by Canvas presence/media seams. */
  resolveAssetUrl?: (path: string, kind: AssetMediaKind) => string | undefined;
  /** Close the nook, returning to the layer that was showing. App owns it. */
  onClose: () => void;
  locale: Locale;
  // Forwarded layer callbacks (02 §⑫-2): the nook MUST NOT build its own
  onMoveCard?: (path: string, x: number, y: number, reconcile?: () => Promise<void>) => Promise<unknown> | void;
  onSelectChoice?: (path: string, choice: string) => Promise<unknown> | void;
  onEntityAction?: (prompt: string, targetLayer?: string) => void;
  onDiceRolled?: (result: number, passed: boolean) => void;
  onOpenCharacterModal?: (characterId: string) => void;
  onItemDropOnTarget?: (itemPath: string, targetPath: string, reconcile?: () => Promise<void>) => Promise<unknown> | void;
  onDropItemToScene?: (itemPath: string, targetLayer: string | undefined, reconcile?: () => Promise<void>) => Promise<unknown> | void;
  onTakeItem?: (path: string, reconcile?: () => Promise<void>) => Promise<unknown> | void;
  /** True while a CharacterModal owns focus above this projection. */
  inactive?: boolean;
  writerLocked?: boolean;
  /**
   * Ask the engine to materialise this empty nook (the design notes: the N1
   * view owns the ENTRY, the `airp_init` kernel stays in one place). `request`
   * is the player's one-line intent, or undefined for "leave it blank".
   * Returns false when the socket is down, so the caller keeps its UI state.
   */
  onRequestInit?: (kind: 'nook', target: string, request?: string) => boolean;
  /** Sub-scene addressing within this nook: a path
   *  RELATIVE to the character root, or `null` for the root scene itself. App
   *  owns the state — this view only asks to change it via `onEnterScene`. */
  scene: string | null;
  /** Ask the host to swap the addressed scene (`null` = character root). Required:
   *  a default would turn "App forgot to wire it" into a silent dead door. */
  onEnterScene: (scene: string | null) => void;
  /**
   * Focus coordinator owned by App. The
   * nook reuses the layer `<Canvas>`, so it MUST forward the same coordinator:
   * without it the reading dialogs inside skip their `registerSurface` lease
   * (`HtmlDetailDialog.tsx:68` and siblings guard on `if (!focus) return`), so
   * `closeTopmostSurface()` finds nothing and the first Escape falls through to
   * `peek()`, tearing down the whole nook instead of just the dialog.
   */
  focus: FocusCoordinator;
}

interface NookError {
  /** 0 = network/parse failure (never a 4xx). */
  status: number;
  /** `null` when the server body has no `code` (the "No active world" shape). */
  code: string | null;
  message: string;
}

type FetchResult = { ok: true; data: LayerState } | { ok: false; error: NookError };

/**
 * Nook avatars are image-lane media. Legacy `/api/asset?path=` values are
 * normalised in place so every request still declares `kind=image`.
 */
export function assetUrl(value: unknown, mediaKind: AssetMediaKind = 'image'): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (value.startsWith('/api/asset')) {
    const url = new URL(value, 'http://airp.local');
    const assetPath = url.searchParams.get('path');
    return assetPath ? airpGateway.assetUrl(assetPath, undefined, mediaKind) : null;
  }
  return airpGateway.assetUrl(value.replace(/^\/+/, ''), undefined, mediaKind);
}


async function fetchNook(characterId: string, scene: string | null): Promise<FetchResult> {
  try {
    // `null`/`''` mean the character root: omit the param rather than send an
    // empty `scene=` (contract §4.2 — a missing `scene` IS the root).
    const sceneParam = scene === null || scene === '' ? '' : `&scene=${encodeURIComponent(scene)}`;
    const res = await fetch(`/api/nook?character=${encodeURIComponent(characterId)}${sceneParam}`);
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      return {
        ok: false,
        error: {
          status: res.status,
          code: typeof body.code === 'string' ? body.code : null,
          message: typeof body.error === 'string' ? body.error : `HTTP ${res.status}`,
        },
      };
    }
    const data: LayerState = {
      layer: body.layer,
      scene: body.scene ?? null,
      bg: body.bg ?? { src: null, tone: 'warm', grain: 'parchment' },
      audio: body.audio ?? { ambient: null, bgm: null },
      items: Array.isArray(body.items) ? body.items : [],
      links: Array.isArray(body.links) ? body.links : [],
      presence: Array.isArray(body.presence) ? body.presence : [],
      worldFrozen: body.worldFrozen === true,
    };
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: { status: 0, code: null, message: err instanceof Error ? err.message : String(err) },
    };
  }
}
export const NookView: React.FC<NookViewProps> = ({
  worldId,
  characterId,
  character,
  effectsEnabled,
  particleDensity,
  hidden = false,
  reducedMotion,
  allowChalkDrag = false,
  resolveAssetUrl,
  onClose,
  locale,
  onMoveCard,
  onSelectChoice,
  onEntityAction,
  onDiceRolled,
  onOpenCharacterModal,
  onItemDropOnTarget,
  onDropItemToScene,
  onTakeItem,
  inactive = false,
  writerLocked = false,
  onRequestInit,
  scene,
  onEnterScene,
  focus,
}) => {
  const [state, setState] = useState<LayerState | null>(null);
  const [error, setError] = useState<NookError | null>(null);
  const [loading, setLoading] = useState(true);
  /** Fold state for the scene-intro band. Session-only on purpose: persisting it
   *  would greet a returning player with a folded introduction (04 §③ step 13). */
  const [introOpen, setIntroOpen] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const copy = Object.fromEntries(Object.entries(UI_COPY.en).map(([key, value]) => [key, locale === 'ja' ? UI_COPY.ja[key as keyof typeof UI_COPY.ja] : translate(locale, value)])) as typeof UI_COPY.en;

  // The call's state, lines and resources live in the module store shared with
  // the character dialogue: two entries, one
  // call. This component holds no call state of its own.
  const callLines = useLiveCallLines();
  const call = useLiveCallState();
  const callAvailable = useLiveCallAvailable();
  const { start: startCall, stop: stopCall } = useLiveCallActions();
  /**
   * The RAW global phase (contract 30 §2.2 冻结 1): answers "is a call up at all",
   * never "is it this nook's". Kept un-narrowed AND under its original name so the
   * L2 guard below stays byte-identical.
   */
  const callInProgress = call.phase === 'connecting' || call.phase === 'live';
  /** Ownership: the ONLY correct answer to "is this call mine" (30 §2.2 冻结 1). */
  const callMine = call.characterId === characterId;
  /**
   * What every RENDER site reads. Includes `error` on purpose: the store keeps the
   * transport alive through a character error (contract 30 §5.3 冻结 9), so error
   * must stay on the call lane with a working hang-up. Mirrors the dialogue paper.
   */
  const callVisible = callMine && (callInProgress || call.phase === 'error');
  /**
   * The transcript lane's gate. Ownership-scoped like the call lane, but WITHOUT
   * the error phase: the lane carries no hang-up, so error has nothing to add
   * here, and mounting it would print "Listening…" beside the call lane's error
   * alert (31 §4.2 Step N-2). The raw global flag alone would leak a foreign
   * call's subtitles into this nook (34 §3.1 S-3), so the conjunction is required.
   */
  const callTranscript = callMine && callInProgress;
  const callConnecting = callVisible && call.phase === 'connecting';
  // Mutual exclusion: a call never opens the
  // dialogue overlay, which would drive the same character agent twice. The
  // guard is PER CHARACTER — `call` is a global snapshot now, so keying off
  // `callInProgress` alone would block every other character's dialogue too.
  const handleOpenCharacterModal = useCallback(
    (id: string) => {
      const sameCharacterOnCall = callInProgress && call.characterId === id;
      if (sameCharacterOnCall) {
        setNotice(copy.liveCallModalBlocked);
        return;
      }
      onOpenCharacterModal?.(id);
    },
    [callInProgress, call.characterId, copy.liveCallModalBlocked, onOpenCharacterModal],
  );
  // Leaving the projection hangs up the call THIS entry opened and nothing
  // else: a call started in the dialogue survives a nook unmount (10 §5.1).
  useEffect(() => () => void stopCall(`nook:${characterId}`), [characterId, stopCall]);

  const nookIdRef = useRef('');
  const stateRef = useRef<LayerState | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reqSeqRef = useRef(0);
  const mountedRef = useRef(false);
  const fpRef = useRef<FootprintScheduler | null>(null);
  const fontsSettledRef = useRef(false);
  const liveReducedMotion = useStill();
  const effectiveReducedMotion = reducedMotion ?? liveReducedMotion;

  // A projection can disappear while /api/nook, a move write, or an
  // initialiser refresh is in flight. Invalidate those continuations at the
  // boundary so an unmounted Nook never animates or writes a stale footprint.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ++reqSeqRef.current;
    };
  }, []);

  // Every `load` call site reads the CURRENT scene through this ref, so the five
  // callbacks below keep a stable identity (a `scene` dep would re-register each
  // listener on every door, firing one extra request per step — 04 §⑥).
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const load = useCallback(async (id: string, scene_arg: string | null) => {
    const seq = ++reqSeqRef.current;
    if (mountedRef.current) setLoading(true);
    const result = await fetchNook(id, scene_arg);
    if (!mountedRef.current || seq !== reqSeqRef.current) return; // last request wins (02 §⑦)
    if (result.ok) {
      // The nook id comes FROM the response (00 §5.1); never re-derived here.
      if (nookIdRef.current !== result.data.layer) {
        nookIdRef.current = result.data.layer;
        fpRef.current?.reset(result.data.layer);
      }
      stateRef.current = result.data;
      setState(result.data);
      setError(null);
    } else {
      // Keep the old payload on failure: flashing back to blank is worse (§3.2).
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(characterId, scene);
  }, [characterId, scene, load]);

  // The initialiser's outcome: clear the ghost. A failure
  // must ALSO be visible — never a silent blank room (contract §8 anti-pattern 8).
  // Scope by layer: `airp:layer-init` also fires for scene inits.
  useEffect(() => {
    const onLayerInit = (event: Event) => {
      const msg = (event as CustomEvent).detail as { event?: { type?: string; layer?: string } } | undefined;
      const ev = msg?.event;
      if (!ev || ev.layer !== nookIdRef.current || !mountedRef.current) return;
      setInitializing(false);
      if (['layer_init_failed'].includes(ev.type ?? '')) setNotice(copy.nookInitFailed);
      else void load(characterId, sceneRef.current); // success: the refetched furnishing replaces the ghost
    };
    window.addEventListener('airp:layer-init', onLayerInit);
    return () => window.removeEventListener('airp:layer-init', onLayerInit);
  }, [characterId, load, copy.nookInitFailed]);
  const reconcileNook = useCallback(async () => {
    if (!mountedRef.current) return;
    await load(characterId, sceneRef.current);
  }, [characterId, load]);
  const handleMoveCard = useCallback(
    async (path: string, x: number, y: number) => {
      const previous = stateRef.current;
      if (!mountedRef.current || !previous) return;
      const next = {
        ...previous,
        items: previous.items.map(item => item.path === path ? { ...item, x, y } : item),
      };
      stateRef.current = next;
      setState(next);
      if (!onMoveCard) return;
      try {
        await onMoveCard(path, x, y, reconcileNook);
      } catch {
        if (!mountedRef.current) return;
        stateRef.current = previous;
        setState(previous);
      }
    },
    [onMoveCard, reconcileNook],
  );
  const handleSelectChoice = useCallback(
    async (path: string, choice: string) => {
      try {
        await onSelectChoice?.(path, choice);
      } catch (error) {
        if (mountedRef.current) setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [onSelectChoice],
  );
  const handleItemDropOnTarget = useCallback(
    async (itemPath: string, targetPath: string) => {
      try {
        await onItemDropOnTarget?.(itemPath, targetPath, reconcileNook);
      } catch (error) {
        if (mountedRef.current) setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [onItemDropOnTarget, reconcileNook],
  );
  const handleDropItemToScene = useCallback(
    async (path: string) => {
      try {
        await onDropItemToScene?.(path, stateRef.current?.layer, reconcileNook);
      } catch (error) {
        if (mountedRef.current) setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [onDropItemToScene, reconcileNook],
  );
  const handleTakeItem = useCallback(
    async (path: string) => {
      try {
        await onTakeItem?.(path, reconcileNook);
      } catch (error) {
        if (mountedRef.current) setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [onTakeItem, reconcileNook],
  );
  const handleEntityAction = useCallback(
    (prompt: string) => onEntityAction?.(prompt, stateRef.current?.layer),
    [onEntityAction],
  );

  /**
   * A door hands us the FULL world-relative target (`CanvasObject.gateTarget`:
   * `characters/elias/office`). The state keeps the segment relative to THIS
   * character, so the conversion goes through the one shared implementation —
   * never a local `split('/')`.
   *
   * `nookScenePathOf` is THREE-valued: `'office'` (a sub-scene), `''` (this
   * character's root) and `null` (not this character's subtree). `''` and `null`
   * are both falsy and mean opposite things, so the checks below compare
   * explicitly — `if (!result) return` would silently swallow a walk back to root.
   */
  const handleEnterGate = useCallback((target: string) => {
    const nook = nookIdOf(characterId);
    if (nook === null) return;
    const path = nookScenePathOf(target, nook);
    if (path === null) return; // a door outside this character's subtree opens nothing
    onEnterScene(path === '' ? null : path);
  }, [characterId, onEnterScene]);

  /** Up ONE level, not back to the root: `'a/b'` → `'a'`, `'office'` → root.
   *  `scene` is a relative segment path, so its parent is its own prefix. */
  const handleBackScene = useCallback(() => {
    if (scene === null) return;
    const slash = scene.lastIndexOf('/');
    onEnterScene(slash === -1 ? null : scene.slice(0, slash));
  }, [scene, onEnterScene]);

  /**
   * The one exit of the empty-state prompt: Submit and
   * Skip are the same call; `''` means "leave it blank". `onRequestInit` returns
   * false when the socket is down — then keep the prompt up rather than showing a
   * ghost for a request that was never sent.
   */
  const resolveInit = useCallback(
    (text: string) => {
      if (!onRequestInit) return;
      const req = text.trim();
      if (onRequestInit('nook', characterId, req === '' ? undefined : req)) {
        setNotice(null);
        setInitializing(true);
      }
    },
    [onRequestInit, characterId]
  );

  // World changes (writer edits, entity lifecycle, and authoritative card
  // positions) are the Nook's refresh seam; no second WS is created here.
  useEffect(() => {
    const onWorldEvent = (e: Event) => {
      const msg = (e as CustomEvent).detail as {
        type?: string;
        path?: string;
        x?: number;
        y?: number;
        event?: { type?: string };
      } | undefined;
      const eventType = msg?.event?.type ?? msg?.type;
      if (
        eventType === 'file_changed' ||
        ['entity_created', 'entity_edited', 'entity_deleted', 'entity_moved'].includes(eventType ?? '')
      ) {
        void load(characterId, sceneRef.current);
        return;
      }
      if (
        eventType === 'card_position' &&
        typeof msg?.path === 'string' &&
        typeof msg.x === 'number' &&
        typeof msg.y === 'number'
      ) {
        const current = stateRef.current;
        if (!current || !current.items.some(item => item.path === msg.path)) return;
        const next = {
          ...current,
          items: current.items.map(item => item.path === msg.path ? { ...item, x: msg.x!, y: msg.y! } : item),
        };
        stateRef.current = next;
        setState(next);
      }
    };
    window.addEventListener('airp:world-event', onWorldEvent);
    return () => window.removeEventListener('airp:world-event', onWorldEvent);
  }, [characterId, load]);

  // Footprint channel (02 §3.6): the layer scheduler only knows layer items,
  // so nook cards would never have their measured height written back. This
  // scheduler submits only Nook paths and measures inside this active root;
  // the layer projection is unmounted while Nook is active.
  useEffect(() => {
    const scheduler = createFootprintScheduler({
      layer: () => nookIdRef.current,
      widths: () => new Map((stateRef.current?.items ?? []).map((it) => [it.path, it.w])),
      measure: () => measureHeights(rootRef.current ?? document),
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
        invalidateMeasures();
        return { updated: Number(data.updated) || 0, unchanged: Number(data.unchanged) || 0 };
      },
      // The nook consumes no writer tool_start/tool_end frames this batch.
      isBusy: () => false,
      isDragging: () => rootRef.current?.querySelector('.object.dragging-item') !== null,
      onResult: ({ layer: measuredLayer, updated }) => {
        if (updated > 0 && measuredLayer === nookIdRef.current) {
          void load(characterId, sceneRef.current);
        }
      },
    });
    fpRef.current = scheduler;
    return () => {
      scheduler.dispose();
      fpRef.current = null;
    };
  }, []);

  // Per-card ResizeObserver + the fonts gate (02 §3.6 conditions ①②): the
  // first measurement MUST wait for web fonts (wrapping decides height) and
  // re-arm whenever a card's content box changes.
  useEffect(() => {
    let disposed = false;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (fontsSettledRef.current) fpRef.current?.notify();
    });
    frame = requestAnimationFrame(() => {
      if (disposed) return;
      for (const el of rootRef.current?.querySelectorAll<HTMLElement>('.object[data-path]') ?? []) {
        observer.observe(el);
      }
      if (fontsSettledRef.current) {
        fpRef.current?.notify();
        return;
      }
      void whenFontsSettled().then((outcome) => {
        if (outcome === 'timeout') {
          console.warn('[nook footprint] fonts did not settle in time; heights may be off');
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

  const sceneFrontmatter: Record<string, any> | null = state?.scene?.frontmatter ?? null;
  // Character identity media comes from the `/api/characters` snapshot. The
  // Nook README remains the facade/status source, not a second media authority.
  const avatar = assetUrl(character.avatar, 'image');
  const avatarVideo = assetUrl(character.avatarVideo, 'video');
  const displayName = character.name?.trim() || character.id || characterId;
  // The composited card and the portrait name the character the same way, so a
  // player who hears one recognises the other.
  const portraitActivateLabel = translate(locale, 'Talk to {name}', { name: displayName });
  const statusLine = statusLineOf(sceneFrontmatter);
  // The nameplate already prints the display name, so it takes only the real
  // status — never the README-title fallback that would repeat the identity.
  const portraitStatus = portraitStatusOf(sceneFrontmatter);
  const isEmpty = state !== null && state.items.length === 0 && state.scene === null;
  const canRetry = error !== null && (error.status === 0 || error.status >= 500);

  // "Is the addressed scene the character root?" — a SCENE-identity predicate and
  // the scope fence around initialisation: `airp_init` can only target the root
  // (04 §③ step 7.1), so a prompt inside a sub-scene would furnish the wrong room.
  const isRootScene = scene === null;
  const showInitPrompt = onRequestInit !== undefined && isRootScene;
  // The breadcrumb reads the FACT (`state.layer`), never the intent (`nookScene`):
  // after a 404 the two disagree and showing the intent would be a lie (04 §③ step
  // 12). Two args are required — a one-arg form cannot tell whether `state.layer`
  // even belongs to THIS character, so a stale reply would print a foreign name.
  const sceneTrail = state !== null ? nookScenePathOf(state.layer, nookIdOf(characterId) ?? '') : null;
  const sceneSegments = sceneTrail ? sceneTrail.split('/') : [];
  // The current segment's readable label: the author's `name` for the scene we are
  // IN, else the raw directory name (no humanising — `labelOf` is App-private).
  const sceneLabel = sceneSegments.length > 0
    ? (sceneFrontmatter?.name || sceneFrontmatter?.title || sceneSegments[sceneSegments.length - 1])
    : (sceneFrontmatter?.name || sceneFrontmatter?.title || copy.nook);
  const sceneBody = state?.scene?.body ?? '';

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full overflow-hidden"
      data-nook={characterId}
      data-airp-projection={`nook:${characterId}`}
      data-airp-projection-active="true"
      aria-hidden={inactive || undefined}
      inert={inactive || undefined}
      aria-label={`Nook projection for ${displayName}`}
    >
      <header
        data-nook-zone="topbar"
        className="depth-surface--writer pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3"
        style={{
          paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
        }}
      >
        {/* Character existence core — always visible, read-only (00 §4.2). */}
        <div
          role="group"
          aria-label={copy.nookCoreStatus}
          className="pointer-events-auto flex min-w-0 items-center gap-3 rounded-2xl border border-ink/10 bg-paper-card/90 py-2 pl-2 pr-4 shadow-soft backdrop-blur-md"
        >
          {avatar ? (
            <img
              src={avatar}
              alt={displayName}
              className="h-10 w-10 shrink-0 rounded-full border border-rust/30 object-cover shadow-sm"
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-paper-wall font-serif text-sm text-ink/60">
              {displayName.slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate font-serif text-sm font-bold text-ink">{displayName}</div>
            {statusLine && <div className="truncate font-mono text-[10px] text-ink/50">{statusLine}</div>}
          </div>
        </div>
        {/* The scene trail: `‹` + the path inside
            this ikigai, ONE focusable control ("up one scene"). The segments are
            text, not buttons — two controls doing the same thing is reachability
            noise. Rendered only in a sub-scene, so the ROOT topbar is unchanged.
            `min-w-0` + `truncate` keep "Leave ikigai" inside a 390px viewport. */}
        {scene !== null && (
          <nav
            data-nook-zone="scene-trail"
            aria-label={copy.nookSceneTrail}
            className="pointer-events-auto flex min-w-0 shrink items-center overflow-hidden rounded-xl border border-ink/10 bg-paper-card/80 px-2 py-1.5 shadow-soft backdrop-blur-md"
          >
            <button
              type="button"
              onClick={handleBackScene}
              title={copy.nookSceneUp}
              aria-label={`${copy.nookSceneUp}: ${sceneLabel}`}
              className="flex shrink-0 items-center gap-1 rounded-lg text-xs text-ink/70 transition-all hover:text-ink"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span className="font-mono text-[10px] text-ink/50">{copy.nook}</span>
            </button>
            {sceneSegments.map((segment, index) => {
              const last = index === sceneSegments.length - 1;
              return (
                <React.Fragment key={`${segment}-${index}`}>
                  <span className="shrink-0 px-1 text-ink/30">/</span>
                  {/* Only the scene we are IN has a README to name it; the
                      ancestors show their directory names as-is. */}
                  <span className={`truncate text-xs ${last ? 'text-ink/80' : 'text-ink/50'}`}>
                    {last ? sceneLabel : segment}
                  </span>
                </React.Fragment>
              );
            })}
          </nav>
        )}


        {/* Back to the layer the player came from. */}
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-xl border border-ink/10 bg-paper-card/90 px-3 py-1.5 text-xs text-ink/70 shadow-soft backdrop-blur-md transition-all hover:bg-ink hover:text-white"
          title={copy.nookBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{copy.nookBack}</span>
        </button>
      </header>

      {/* Canvas is the only content on the world stage. Every other nook
          surface is an anchored lane above it and cannot move its origin. */}
      <main data-nook-zone="canvas" className="absolute inset-0" aria-label={`${displayName} canvas`}>
        <div
          data-nook-zone="character-media"
          className="contents"
          aria-label={`${displayName} portrait`}
        >
          <NookPortrait
            worldId={worldId}
            characterId={characterId}
            displayName={displayName}
            statusLine={portraitStatus}
            video={avatarVideo ?? undefined}
            poster={avatar ?? undefined}
            enabled={effectsEnabled}
            hidden={hidden}
            onActivate={onOpenCharacterModal ? () => handleOpenCharacterModal(characterId) : undefined}
            activateLabel={portraitActivateLabel}
            fallback={
              <div className="nook-character-media__fallback" role="img" aria-label={displayName}>
                {displayName.slice(0, 1)}
              </div>
            }
          />
        </div>
        {loading && state === null && !error && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-ink/40">
            …
          </div>
        )}

        {isEmpty ? (
          /* Empty rooms still own one Canvas viewport; the prompt is a lane
             above that stage rather than a second projection. */
          <div className="h-full w-full">
            <Canvas
              hidden={hidden}
              particleDensity={particleDensity}
              effectsEnabled={effectsEnabled}
              reducedMotion={effectiveReducedMotion}
              allowChalkDrag={allowChalkDrag}
              currentLayer={state.layer}
              focus={focus}
              items={[]}
              links={[]}
              bg={state.bg}
              ghost={initializing ? ghostItemFor(state.layer, copy.nookGenerating) : null}
              ghostLabel={copy.nookGenerating}
              ghostCopy={{
                reused: copy.ghostReused,
                failed: copy.ghostFailed,
                unreachable: copy.ghostUnreachable,
              }}
              stillPortraits={effectiveReducedMotion}
              assetUrl={resolveAssetUrl}
              onEnterGate={handleEnterGate}
            />
            {!initializing && (
              <>
                <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 px-8 text-center">
                  <div className="font-serif text-lg text-ink/70">{copy.nookEmptyTitle}</div>
                  <div className="font-mono text-xs text-ink/50">{copy.nookEmptyBody}</div>
                </div>
                {/* The prompt can only ever furnish the CHARACTER ROOT (04 §③ step
                    7.1): `airp_init` carries `characterId` alone. Offering it inside
                    a sub-scene would furnish the wrong room, silently — so the gate
                    sits on the submittable control only, never on the empty copy. */}
                {showInitPrompt ? (
                  <StubPrompt
                    kind="nook"
                    copy={{
                      label: copy.nookEmptyPrompt,
                      placeholder: copy.nookEmptyHint,
                      skip: copy.nookInitSkip,
                    }}
                    onResolve={resolveInit}
                  />
                ) : isRootScene ? (
                  /* The host never wired init: say so with a disabled bar rather
                     than render a control that silently does nothing. Only the
                     ROOT can be initialised, so a sub-scene gets neither. */
                  <WriterBar disabled onSend={() => {}} placeholder={copy.nookEmptyPrompt} sendLabel="⏎" />
                ) : null}
              </>
            )}
          </div>
        ) : state ? (
          <>
            <Canvas
              hidden={hidden}
              particleDensity={particleDensity}
              effectsEnabled={effectsEnabled}
              reducedMotion={effectiveReducedMotion}
              allowChalkDrag={allowChalkDrag}
              currentLayer={state.layer}
              focus={focus}
              items={state.items}
              stillPortraits={true}
              links={[]}
              bg={state.bg}
              ghostCopy={{
                reused: copy.ghostReused,
                failed: copy.ghostFailed,
                unreachable: copy.ghostUnreachable,
              }}
              onMoveCard={handleMoveCard}
              onSelectChoice={handleSelectChoice}
              onEntityAction={handleEntityAction}
              onDiceRolled={onDiceRolled}
              onOpenCharacterModal={handleOpenCharacterModal}
              onItemDropOnTarget={handleItemDropOnTarget}
              onDropItemToScene={handleDropItemToScene}
              onTakeItem={handleTakeItem}
              onEnterGate={handleEnterGate}
            />
            {/* A sub-scene's README is its facade: without this band, walking into a
                scene the author DID write shows an empty canvas — strictly less than
                the door's hover sheet already showed (04 §③ step 13). Not a card: it
                carries no `data-path`, so the footprint scheduler never measures it. */}
            {scene !== null && sceneBody.trim() !== '' && (
              <div
                data-nook-zone="scene-intro"
                className="pointer-events-auto absolute inset-x-3 top-16 mx-auto max-w-2xl rounded-xl border border-ink/10 bg-paper-card/85 p-2 text-xs text-ink/80 shadow-soft backdrop-blur-md"
              >
                <button
                  type="button"
                  onClick={() => setIntroOpen(open => !open)}
                  aria-expanded={introOpen}
                  title={introOpen ? copy.collapseScene : copy.expandScene}
                  className="flex w-full items-center gap-1.5 text-left font-mono text-[10px] text-ink/60"
                >
                  <ChevronLeft className={`h-3 w-3 shrink-0 transition-transform ${introOpen ? '-rotate-90' : ''}`} />
                  <span className="truncate">{sceneLabel}</span>
                </button>
                {introOpen && (
                  <div className="mt-1.5 max-h-40 overflow-y-auto">
                    <MarkdownText text={stripLeadingTitle(sceneBody)} />
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}
      </main>

      {/* One lower-left lane owns every transient/error surface. Keeping these
          in one column prevents notices, call controls, and transcript from
          competing for the same bottom coordinates. */}
      <div
        data-nook-zone="left-lane"
        className="pointer-events-none depth-surface--writer absolute bottom-0 left-0 flex max-w-[min(30rem,calc(100%_-_1.5rem))] flex-col items-start gap-2"
        style={{
          paddingBottom: 'max(1.25rem, calc(env(safe-area-inset-bottom) + 0.5rem))',
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
        }}
      >
        {error && (
          <div
            data-nook-zone="notice"
            role="alert"
            className="pointer-events-auto order-1 max-w-full rounded-xl border border-rust/40 bg-rust/10 p-3 text-xs text-ink shadow-soft"
          >
            {/* A 404 while addressing a sub-scene means THAT SCENE is gone, not
                the ikigai: naming the wrong thing sends the player looking for a
                problem that is not there (04 §③ step 12). */}
            <div className="font-semibold text-rust">
              {scene !== null && error.status === 404 ? copy.nookSceneMissing : copy.nookError}
            </div>
            <div className="mt-1 font-mono text-[10px] text-ink/60">
              {error.code ? `${error.code} · ` : ''}
              {error.status > 0 ? `${error.status} · ` : ''}
              {error.message}
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer text-[10px] text-ink/50">response</summary>
              <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-ink/60">
                {JSON.stringify(error, null, 2)}
              </pre>
            </details>
            {canRetry && (
              <button
                type="button"
                onClick={() => void load(characterId, sceneRef.current)}
                className="mt-2 rounded-lg bg-rust px-3 py-1 text-white transition-all hover:bg-rust-light"
              >
                {copy.nookRetry}
              </button>
            )}
          </div>
        )}

        {notice && (
          <div
            data-nook-zone="notice"
            role="alert"
            className="pointer-events-auto order-2 max-w-full rounded-lg border border-rust/40 bg-rust/10 px-3 py-2 font-mono text-[11px] text-ink shadow-soft"
          >
            {notice}
          </div>
        )}

        {callAvailable && (
          <div data-nook-zone="call" className="pointer-events-auto order-4 flex max-w-full flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                // Owner-scoped (30 §2.2 冻结 1 / §4.1 冻结 6): a FOREIGN call is
                // neither depicted nor hangable from here. `start()` preempts it
                // (live-call-store.ts:531-534 先挂后开) — that is 10 §4.1's rule.
                // Capture the exact root when this UI action begins; start()
                // rejects it if the selected save has already changed.
                if (callVisible) {
                  void stopCall(`nook:${characterId}`);
                } else {
                  const savePath = agentActivityStore.getActiveSavePath();
                  if (savePath && agentActivityStore.isSaveActive(savePath)) {
                    void startCall({
                      characterId,
                      locale: locale === 'ja' || locale === 'ko' ? locale : 'en',
                      uiLocale: locale,
                      owner: `nook:${characterId}`,
                      savePath,
                    });
                  }
                }
              }}
              disabled={inactive}
              aria-label={callVisible ? copy.liveCallStop : copy.liveCallStart}
              title={callVisible ? copy.liveCallStop : copy.liveCallStart}
              className={
                callVisible
                  ? 'flex items-center gap-1.5 rounded-xl border border-rust bg-rust/90 px-3 py-2 text-xs text-white shadow-soft backdrop-blur-md transition-all hover:bg-rust'
                  : 'flex items-center gap-1.5 rounded-xl border border-ink/10 bg-paper-card/95 px-3 py-2 text-xs text-ink/80 shadow-soft backdrop-blur-md transition-all hover:bg-ink hover:text-white'
              }
            >
              {callConnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : callVisible ? (
                <PhoneOff className="h-3.5 w-3.5" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
              <span>
                {callConnecting
                  ? copy.liveCallConnecting
                  : callVisible
                    ? copy.liveCallStop
                    : copy.liveCallStart}
              </span>
            </button>
            {callVisible && call.phase === 'live' && (
              <span
                role="status"
                className="flex items-center gap-1.5 rounded-lg border border-rust/30 bg-rust/10 px-2 py-1 font-mono text-[10px] text-rust"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rust" />
                {copy.liveCallLive}
              </span>
            )}
            {callVisible && call.phase === 'error' && call.error && (
              <span
                role="alert"
                className="max-w-full rounded-lg border border-rust/40 bg-rust/10 px-2 py-1 font-mono text-[10px] text-ink"
              >
                {call.error}
              </span>
            )}
            {callVisible && call.phase === 'error' && <LiveCallStatus call={call} />}
          </div>
        )}

        {/* Subtitles are sourced from the existing live-call transcript; this
            is a presentation lane only and never a second transport. */}
        {callTranscript && (
          <div
            data-nook-zone="transcript"
            className="pointer-events-auto order-3 w-80 max-w-full rounded-xl border border-ink/10 bg-paper-card/90 p-3 shadow-soft backdrop-blur-md"
          >
            <LiveCallTranscript
              lines={callLines}
              call={{ outputText: call.outputText, inputText: call.inputText, phase: call.phase }}
              className="max-h-32 space-y-1.5 overflow-y-auto"
            />
            <LiveCallStatus call={call} className="mt-1.5" />
          </div>
        )}
      </div>

      {/* The host owns this lane's placement. Composer itself is a normal
          panel, so ShellIntegration can reserve space around activity, Bag,
          toast, dock, and the mobile keyboard without fighting fixed offsets. */}
      <div
        data-nook-zone="note"
        className="pointer-events-none depth-surface--writer absolute inset-x-3 bottom-2 flex justify-end sm:inset-x-4 sm:bottom-4"
        style={{
          paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))',
          paddingRight: 'max(0.25rem, env(safe-area-inset-right))',
        }}
      >
        <div
          data-nook-note="composer"
          className="pointer-events-auto max-h-[min(42dvh,300px)] w-fit max-w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto"
        >
          <NookNoteComposer
            characterId={characterId}
            disabled={inactive || writerLocked || state?.worldFrozen === true}
            lockMessage={writerLocked ? 'The writer is working.' : undefined}
          />
        </div>
      </div>
    </div>
  );
};
