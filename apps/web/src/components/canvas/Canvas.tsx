import React, { useEffect, useMemo, useRef } from 'react';
import { CanvasObject, clearAllLifts, pruneLifts, raiseObject } from './CanvasObject.js';
import { LinkLayer, highlightLinks, updateAllLinks } from './LinkLayer.js';
import { CanvasGrid } from './CanvasGrid.js';
import { SceneBackdrop } from './SceneBackdrop.js';
import { PhantomLayer } from './PhantomLayer.js';
import type { GhostCopy } from '../narrative/GhostCard.js';
import { ParticleLayer } from './ParticleLayer.js';
import { useCamera } from '../../state/useCamera.js';
import { useSceneTone } from '../../lib/scene-tone.js';
import { airpGateway } from '../../lib/airp-gateway.js';
import { clampZ, zoomAt, screenToWorld, screenDeltaToWorld, projectOffset, unprojectOffset } from '../../lib/camera.js';
import { probeCount } from '../../lib/frame-probe.js';
import { makeBox, pushFrom, relaxAll } from '../../lib/collide.js';
import { unlock, playFoley } from '../../lib/audio.js';
import { whenFontsSettled } from '../../lib/fonts.js';
import { elementBox, invalidateMeasures } from '../../lib/measure.js';
import { setParallax } from '../../lib/parallax.js';
import { portraitPlayStateOf } from '../../lib/motion.js';
import { PresenceLayer } from './PresenceLayer.js';
import { AgentCursorLayer } from './AgentCursorLayer.js';
import { AmbientLayer } from './AmbientLayer.js';
import { CanvasTickLayer } from './TickIntentLayer.js';
import { PRESENCE_NODE_ATTR } from '../../lib/presence-node.js';
import { depthClassFor } from '../../lib/depth-surface.js';
import { useStill } from '../../lib/motion.js';
import type { CharacterPresenceView } from '../../lib/presence.js';
import type { LayerItem, LayerLink } from '../../state/useWorld.js';
import type { AssetMediaKind } from '../../lib/airp-gateway.js';
import { movedBeyondCardThreshold } from '../../lib/card-interaction.js';
import type { FocusCoordinator } from '../../lib/focus-coordinator.js';
import { usePerformanceSettings, type PerformanceSettings } from '../../lib/performance-settings.js';
import type { PlayerTagValue } from '../../lib/airp-gateway.js';
import { boardEndpointAt, LONG_PRESS_MS } from '../../lib/player-board-gestures.js';
// The same 5px gate, named apart so the card/viewport seams keep their own call sites.
import { movedBeyondCardThreshold as pastTapThreshold } from '../../lib/card-interaction.js';
/** Stable identity for the no-presence path (nook never passes one) so the memo
 *  deps in PresenceLayer do not churn on every Canvas render. */
const NO_PRESENCE: CharacterPresenceView[] = [];

const DEPTH_KIND = {
  background: 'background',
  world: 'world',
  entity: 'entity',
  overlay: 'overlay',
  writer: 'writer',
  modal: 'modal',
  ui: 'ui',
} as const;
type CanvasDepthKind = keyof typeof DEPTH_KIND;
const DEPTH_MARKER = (kind: CanvasDepthKind): string => depthClassFor(DEPTH_KIND[kind]);

interface CanvasProps {
  effectsEnabled?: boolean;
  particleDensity?: PerformanceSettings['particleDensity'];
  /** Optional host visibility seam; ParticleLayer also observes document.hidden. */
  hidden?: boolean;
  /** Optional host reduced-motion seam; defaults to the live media preference. */
  reducedMotion?: boolean;
  allowChalkDrag?: boolean;
  currentLayer: string;
  items: LayerItem[];
  /** Same-scene avatars (contract §3.1/§4.1). Only `state === 'in-scene'` characters
   *  reach here; absent / elsewhere are already filtered by the projection. Absent
   *  value = no avatars (nook path), matching `/api/nook`'s `presence: []`. */
  presence?: CharacterPresenceView[];
  /** World-root-relative asset path → URL, injected from App (contract P-18):
   *  both existing helpers of this shape are module-private, so the canvas must
   *  not reach for one itself. Without it, presence avatars fall back to the raw
   *  `avatar` value (an initial-letter plate) instead of a 404 image. */
  assetUrl?: (path: string, kind: AssetMediaKind) => string | undefined;
  /** true = no portrait on this canvas may play (global motion preference, nook 03 §③-6). */
  stillPortraits?: boolean;
  links: LayerLink[];
  bg: { src: string | null; video?: string; tone: string; grain: string };
  /** Provisional "taking shape" card while an I1 init runs.
   *  Purely client-side: never in `items`, never measured, never persisted. */
  ghost?: LayerItem | null;
  /** Copy for the ghost card face (i18n). */
  ghostLabel?: string;
  /** Required only when a ghost is shown; perception pages render no ghost. */
  ghostCopy?: GhostCopy;
  onMoveCard?: (path: string, x: number, y: number, reconcile?: () => Promise<void>) => Promise<unknown> | void;
  onSelectChoice?: (path: string, choice: string) => void;
  onEntityAction?: (prompt: string) => void;
  onDiceRolled?: (result: number, passed: boolean) => void;
  onEnterGate?: (targetLayer: string) => void;
  onOpenCharacterModal?: (charId: string) => void;
  onItemDropOnTarget?: (itemPath: string, targetPath: string) => void;
  onDropItemToScene?: (itemPath: string) => void;
  onTakeItem?: (path: string) => void;
  /** What the player carries, by path: a gate asking for something else is marked locked. */
  carried?: ReadonlySet<string>;
  onOpenRadialMenu?: (x: number, y: number, worldX: number, worldY: number) => void;
  focus?: FocusCoordinator;
  /** The player's marks by card path. */
  playerTags?: ReadonlyMap<string, PlayerTagValue>;
  /** Clue-board mode: a drag from a card draws a line, a tap picks the card. */
  boardMode?: boolean;
  onBoardLink?: (from: string, to: string, clientX: number, clientY: number) => void;
  onBoardPick?: (endpoint: string, clientX: number, clientY: number) => void;
  /** Touch long-press on blank canvas (mobile's right-click). */
  onLongPress?: (x: number, y: number, worldX: number, worldY: number) => void;
  /** Ambient life: idle pointers, emotes and barks.
   *  Only the play canvas turns it on; nook and perception never do. */
  ambient?: boolean;
  /** Older chalks fading on their way into the message drawer. */
  retiringPaths?: ReadonlySet<string>;
  /** A chalk's 「在消息里看」 tab; absent = no tab (nook, perception). */
  onChalkToStream?: (path: string) => void;
}

/** A clue-board line being drawn from one card toward another. */
interface BoardSession {
  pointerId: number;
  from: string;
  sx: number;
  sy: number;
  moved: boolean;
  rubber: HTMLElement | null;
}


/** Viewport blank-space pan/pinch session (cards never start one). */
interface PanDragState {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  moved: number;
  objectHit: boolean;
}

/**
 * Card drag session — the viewport's pointer handlers drive this state machine
 * (plan §6.2: all pointer logic in the single viewport handler; CanvasObject
 * roots never attach their own listeners). Capture is taken only after the
 * 5px gate passes, so a bare click on a card (choice/dice/gate) is never
 * retargeted away from its interactive child.
 */
interface CardDragSession {
  pointerId: number;
  el: HTMLElement;
  path: string;
  sx: number;
  sy: number;
  ix: number;
  iy: number;
  moved: boolean;
  captured: boolean;
  pushed: Set<HTMLElement>;
}

function readLeft(el: HTMLElement): number {
  const raw = el.style.left ? parseFloat(el.style.left) : NaN;
  return Number.isFinite(raw) ? raw : el.offsetLeft || 0;
}

function readTop(el: HTMLElement): number {
  const raw = el.style.top ? parseFloat(el.style.top) : NaN;
  return Number.isFinite(raw) ? raw : el.offsetTop || 0;
}


export const Canvas: React.FC<CanvasProps> = ({
  allowChalkDrag = false,
  effectsEnabled = false,
  particleDensity = 'full',
  hidden = false,
  reducedMotion,
  focus,
  assetUrl,
  currentLayer,
  ghost = null,
  ghostLabel,
  items,
  presence = NO_PRESENCE,
  stillPortraits = false,
  links,
  bg,
  ghostCopy,
  onMoveCard,
  onSelectChoice,
  onEntityAction,
  onDiceRolled,
  onEnterGate,
  onOpenCharacterModal,
  onItemDropOnTarget,
  onDropItemToScene,
  onTakeItem,
  onOpenRadialMenu,
  carried,
  playerTags,
  boardMode = false,
  onBoardLink,
  onBoardPick,
  onLongPress,
  ambient = false,
  retiringPaths,
  onChalkToStream,
}) => {
  const camera = useCamera();
  // The camera's projection. Always the flat canvas today — map mode replaces
  // this component with a board rather than tilting it — but
  // every pointer path still asks the camera, so there is one answer to "where
  // did that click land" if a projection is ever added. A ref because the
  // handlers are registered once.
  const viewMode = camera.getProjection();
  const viewRef = useRef(viewMode);
  viewRef.current = viewMode;
  // Declared `bgStyle.tone` wins; otherwise the poster image is sampled once.
  const sceneTone = useSceneTone(
    bg.tone,
    bg.src && !/\.(mp4|webm)$/i.test(bg.src) ? airpGateway.assetUrl(bg.src, undefined, 'image') : null,
  );
  const prefersReducedMotion = useStill();
  const particleReducedMotion = reducedMotion ?? prefersReducedMotion;


  // Device profile detail (Balanced is lighter than Quality — the design notes).
  const { parallax, avatarMotion } = usePerformanceSettings();
  const parallaxOn = effectsEnabled && parallax;
  useEffect(() => { if (!parallaxOn) setParallax(0, 0); }, [parallaxOn]);

  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ d: number; z: number } | null>(null);
  const dragRef = useRef<PanDragState | null>(null);
  const cardDragRef = useRef<CardDragSession | null>(null);
  const boardRef = useRef<BoardSession | null>(null);
  const longPressRef = useRef<{ timer: number; sx: number; sy: number } | null>(null);
  const paperSlideRef = useRef<{ t: number; x: number; y: number } | null>(null);
  // Viewport client rect, cached across pointermoves (it only changes on
  // resize). See handlePointerMove.
  const viewportRectRef = useRef<{ vp: HTMLElement; r: DOMRect } | null>(null);
  const prevLayerRef = useRef<string | null>(null);
  const framedLayers = useRef(new Set<string>());
  const itemsByPath = useMemo(() => new Map(items.map((it) => [it.path, it])), [items]);
  // Ordinal seal number per gate (01, 02, …) — the scene's position among the
  // gates of THIS layer, derived from server order so it is stable across
  // refreshes. CardRenderer falls back to this when frontmatter has no order/n.
  const gateOrdinal = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const it of items) if (it.kind === 'gate') map.set(it.path, ++n);
    return map;
  }, [items]);
  // A fresh layer is first painted with the server's declared footprint. Keep
  // that provisional geometry off-screen until the real DOM footprint has
  // converged through the existing scheduler/re-fetch path; otherwise the
  // player sees one overlapping frame followed by a visible reseat.
  const readyLayoutLayersRef = useRef(new Set<string>());
  const [, rerenderLayout] = React.useState(0);
  const layoutPending = items.length > 0 && !readyLayoutLayersRef.current.has(currentLayer);

  // At most ONE portrait plays per canvas (AGENTS §7.6). `items` is in server
  // row order (z ascending), so the last portrait is the visual focus unless
  // the pointer has hovered another one.
  const [focusedPortrait, setFocusedPortrait] = React.useState<string | null>(null);
  const playingPortrait = useMemo(
    () => {
      if (stillPortraits || reducedMotion || !effectsEnabled) return null;
      const candidates = items.filter(item => item.kind === 'portrait' || (item.kind === 'sprite' && item.frontmatter?.avatarVideo));
      const focused = candidates.find(item => item.path === focusedPortrait)?.path ?? null;
      // `focused`: only the portrait the pointer rested on plays; the rest stay still.
      if (avatarMotion === 'focused') return focused;
      return focused ?? candidates.at(-1)?.path ?? null;
    },
    [items, stillPortraits, effectsEnabled, focusedPortrait, reducedMotion, avatarMotion]
  );


  // Camera follows the layer: remember where we leave one, return to the other.
  useEffect(() => {
    const prev = prevLayerRef.current;
    prevLayerRef.current = currentLayer;
    if (prev !== null) {
      camera.save(prev);
      camera.restore(currentLayer);
    }
  }, [currentLayer, camera]);

  // Frame the camera on the cards' real rendered bounds, once per scene.
  // MUST NOT rewrite or persist card left/top: collision/position authority is
  // the server's seated rows, and a second
  // collision pass here (separateBounds) laid cards out on a grid the drag
  // relaxer then had to violently undo — the "first drag snaps" bug.
  useEffect(() => {
    if (!items.length || framedLayers.current.has(currentLayer)) return;
    let cancelled = false;
    const frame = () => {
      if (cancelled) return;
      const viewport = camera.viewportRef.current;
      const objects = [...(viewport?.querySelectorAll<HTMLElement>('.object') || [])];
      if (!viewport || !objects.length) return;
      framedLayers.current.add(currentLayer);
      const left = Math.min(...objects.map(el => el.offsetLeft));
      const top = Math.min(...objects.map(el => el.offsetTop));
      const right = Math.max(...objects.map(el => el.offsetLeft + el.offsetWidth));
      const bottom = Math.max(...objects.map(el => el.offsetTop + Math.max(el.offsetHeight, el.scrollHeight)));
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      const topSpace = width < 700 ? 175 : 110;
      const bottomSpace = width < 700 ? 170 : 130;
      // Fit what the cards will OCCUPY ON SCREEN, which on the map is the
      // projected footprint, not the world rectangle: a layer laid out wide on
      // the floor becomes a diamond wider and flatter than its world box.
      const view = viewRef.current;
      const corners = [[left, top], [right, top], [right, bottom], [left, bottom]]
        .map(([x, y]) => projectOffset(x, y, view));
      const spanX = Math.max(...corners.map(point => point.x)) - Math.min(...corners.map(point => point.x));
      const spanY = Math.max(...corners.map(point => point.y)) - Math.min(...corners.map(point => point.y));
      const z = Math.min(.95, (width - (width < 700 ? 95 : 220)) / Math.max(1, spanX), (height - topSpace - bottomSpace) / Math.max(1, spanY));
      // The chrome leaves more room at one edge than the other, so the frame is
      // nudged on SCREEN; turn that screen nudge back into a world one.
      const nudge = unprojectOffset(0, (bottomSpace - topSpace) / (2 * z), view);
      camera.flyTo((left + right) / 2 + nudge.x, (top + bottom) / 2 + nudge.y, z);
    };
    // Font-dependent heights must settle before measuring:
    // a bare document.fonts.ready can read pre-swap metrics.
    void whenFontsSettled().then(() => requestAnimationFrame(frame));
    return () => { cancelled = true; };
  }, [currentLayer, items, camera]);

  // Do not expose the first declared-footprint pass. The DOM remains mounted
  // and measurable, while the server's existing footprint round-trip can
  // reseat cards without showing the temporary overlap to the player.
  useEffect(() => {
    if (!items.length || readyLayoutLayersRef.current.has(currentLayer)) return;
    let cancelled = false;
    void whenFontsSettled().then(() => requestAnimationFrame(() => {
      if (cancelled) return;
      const viewport = camera.viewportRef.current;
      if (!viewport) return;
      const objects = [...viewport.querySelectorAll<HTMLElement>('.object[data-path]')];
      if (objects.length < items.length) return;
      const stable = items.every((item) => {
        const el = objects.find((candidate) => candidate.dataset.path === item.path);
        return el !== undefined
          && !el.matches(':hover')
          && !el.hasAttribute('data-reading')
          && Math.abs(el.offsetHeight - item.h) <= 1;
      });
      if (stable) {
        readyLayoutLayersRef.current.add(currentLayer);
        rerenderLayout((value) => value + 1);
      }
    }));
    return () => { cancelled = true; };
  }, [currentLayer, items, camera]);

  // Session z-lifts die with the payload that carries the server order: the
  // `links` array reference only changes on fetchLayer-driven refreshes and on
  // a `canvas_patched` kind:'links' frame (never on optimistic moveCard merges,
  // the design notes), so it is the "server order restored" signal.
  useEffect(() => {
    clearAllLifts();
  }, [links]);

  // Card rendered sizes are cached during a drag; a layer refresh can change
  // them, so drop the cache whenever the payload (or viewport) changes.
  useEffect(() => {
    invalidateMeasures();
  }, [items, links]);

  // `arrange` / `canvas_patched` kind:'cards' change card coordinates WITHOUT
  // touching the `links` reference, so LinkLayer's [links] rebuild never runs.
  // Recompute the hand-drawn geometry here, after React has written the new
  // left/top — otherwise the lines stay anchored to the
  // cards' old positions until the next fetchLayer.
  useEffect(() => {
    updateAllLinks();
  }, [items]);

  // Cards that left the layer can no longer hold a lift.
  useEffect(() => {
    pruneLifts(new Set(items.map((it) => it.path)));
  }, [items]);

  // Any viewport resize changes both card layout and the cached client rect.
  useEffect(() => {
    const onResize = () => {
      invalidateMeasures();
      viewportRectRef.current = null;
    };
    window.addEventListener('resize', onResize);
    // The viewport also changes size WITHOUT a window resize: the header
    // expanding, the companion column opening, the writer sheet. A stale rect
    // then aims wheel-zoom and parallax at the old box, so watch the element too.
    const vp = camera.viewportRef.current;
    const observer = vp && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { viewportRectRef.current = null; })
      : null;
    if (vp && observer) observer.observe(vp);
    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, []);

  // Wheel zoom anchored at the cursor.
  // NOTE: React's synthetic onWheel attaches passively at the root since React 17,
  // so preventDefault() there is silently ignored by the browser. Attach a real
  // non-passive listener instead (same pattern as the v3 prototype).
  useEffect(() => {
    const el = camera.viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-reading]')) return;
      e.preventDefault();
      probeCount('wheelZoom');
      // Wheel arrives at device frequency (a trackpad can exceed 120Hz). Read
      // the viewport rect through the same cache the drag loop uses: the
      // camera's rAF just wrote a fresh transform, so a bare
      // getBoundingClientRect here forced a style/layout pass per event that
      // grew with card count (same seam as the handlePointerMove fix).
      let cached = viewportRectRef.current;
      if (!cached || cached.vp !== el) {
        cached = { vp: el, r: el.getBoundingClientRect() };
        viewportRectRef.current = cached;
      }
      const rect = cached.r;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { w, h } = camera.getViewport();
      // Anchor off the commanded target (not the displayed current): Chrome may
      // deliver one wheel gesture as several events, and target-anchored steps
      // compose exactly with zero drift regardless of how the gesture is split.
      const next = zoomAt(sx, sy, w, h, camera.getTarget(), e.deltaY, viewRef.current);
      camera.flyTo(next.x, next.y, next.z);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [camera]);

  /** Screen point → world point through the camera maths (one answer everywhere). */
  const worldAt = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const vp = camera.viewportRef.current;
    if (!vp) return null;
    let cached = viewportRectRef.current;
    if (!cached || cached.vp !== vp) {
      cached = { vp, r: vp.getBoundingClientRect() };
      viewportRectRef.current = cached;
    }
    const sx = clientX - cached.r.left;
    const sy = clientY - cached.r.top;
    const { w, h } = camera.getViewport();
    const cam = camera.getCam();
    return screenToWorld(sx, sy, w, h, cam, viewRef.current);
  };

  const cancelLongPress = () => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  };

  const endBoardSession = (e: React.PointerEvent, commit: boolean): boolean => {
    const b = boardRef.current;
    if (!b || b.pointerId !== e.pointerId) return false;
    boardRef.current = null;
    b.rubber?.remove();
    if (!commit) return true;
    if (b.moved) {
      const to = boardEndpointAt(document.elementFromPoint(e.clientX, e.clientY));
      if (to && to !== b.from) onBoardLink?.(b.from, to, e.clientX, e.clientY);
    } else {
      onBoardPick?.(b.from, e.clientX, e.clientY);
    }
    return true;
  };

  // ---- Card drag (T0.3) ----
  const handlePointerDown = (e: React.PointerEvent) => {
    void unlock(); // idempotent: any interaction start resumes the audio context
    const target = e.target as HTMLElement;
    cancelLongPress();
    // Clue-board mode: cards and characters become line endpoints, not drags.
    if (boardMode && !target.closest('button:not(.presence-avatar__body), a, input, select, textarea, [data-no-drag]')) {
      const from = boardEndpointAt(target);
      if (from) {
        boardRef.current = { pointerId: e.pointerId, from, sx: e.clientX, sy: e.clientY, moved: false, rubber: null };
        try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* best-effort */ }
        e.preventDefault();
        return;
      }
    }
    // Mobile: a long press on blank canvas is the right-click (pin a note here).
    if (e.pointerType === 'touch' && onLongPress && boardEndpointAt(target) === null && pointersRef.current.size === 0) {
      const sx = e.clientX;
      const sy = e.clientY;
      longPressRef.current = {
        sx,
        sy,
        timer: window.setTimeout(() => {
          longPressRef.current = null;
          // The press became a gesture of its own: no pan continues from it.
          dragRef.current = null;
          pointersRef.current.clear();
          const world = worldAt(sx, sy);
          if (world) onLongPress(sx, sy, world.x, world.y);
        }, LONG_PRESS_MS),
      };
    }
    const obj = target.closest('.object');
    // Presence avatars are not cards: a click on one is the dialogue entry
    //, so it must start neither a card drag nor a viewport pan.
    if (target.closest(`[${PRESENCE_NODE_ATTR}]`)) return;
    if (obj) {
      const el = obj as HTMLElement;
      const path = el.dataset.path ?? '';
      if (target.closest('button, a, input, select, textarea, [data-no-drag]')) {
        return; // interactive child: plain click, no drag session
      }
      if (cardDragRef.current) return; // one drag at a time
      const item = itemsByPath.get(path);
      // Locked Chalk remains a viewport gesture target: do not prevent the
      // event or create any card-drag state, so dragging over it still pans.
      if (item?.kind !== 'chalk' || allowChalkDrag) {
        cardDragRef.current = {
          pointerId: e.pointerId,
          el,
          path,
          sx: e.clientX,
          sy: e.clientY,
          ix: readLeft(el),
          iy: readTop(el),
          moved: false,
          captured: false,
          pushed: new Set(),
        };
        raiseObject(path, el, item?.z ?? 1);
        el.classList.add('dragging-item');
        highlightLinks(path, true);
        e.preventDefault();
        return;
      }
    }

    // Blank viewport → pan + pinch (unchanged from T0.2).
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic/replayed pointers have no active pointer id; pan still works */
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = {
        d: Math.hypot(a.x - b.x, a.y - b.y),
        z: camera.getCam().z,
      };
      dragRef.current = null;
      return;
    }
    const camNow = camera.getCam();
    dragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      cx: camNow.x,
      cy: camNow.y,
      moved: 0,
      objectHit: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    // 2.5D parallax tracking: publish normalized [-1,1] coordinates to the
    // module store. Consumers (backdrop, particles) read it imperatively —
    // this used to be setState, re-rendering the whole canvas subtree on every
    // mouse move (cost grew with card count). The viewport rect is cached:
    // it only changes on resize, and reading it here forced a layout on every
    // move (profile: getBoundingClientRect 120× per 120 moves).
    const vp = camera.viewportRef.current;
    if (vp && parallaxOn) {
      let rect = viewportRectRef.current;
      if (!rect || rect.vp !== vp) {
        rect = { vp, r: vp.getBoundingClientRect() };
        viewportRectRef.current = rect;
      }
      const { width, height, left, top } = rect.r;
      if (width > 0 && height > 0) {
        const nx = ((e.clientX - left) / width - 0.5) * 2;
        const ny = ((e.clientY - top) / height - 0.5) * 2;
        setParallax(nx, ny);
      }
    }

    const lp = longPressRef.current;
    if (lp && pastTapThreshold(lp.sx, lp.sy, e.clientX, e.clientY)) cancelLongPress();

    const b = boardRef.current;
    if (b && e.pointerId === b.pointerId) {
      if (!b.moved && !pastTapThreshold(b.sx, b.sy, e.clientX, e.clientY)) return;
      b.moved = true;
      if (!b.rubber) {
        b.rubber = document.createElement('div');
        b.rubber.className = 'clue-rubber';
        document.body.appendChild(b.rubber);
      }
      const dx = e.clientX - b.sx;
      const dy = e.clientY - b.sy;
      b.rubber.style.width = `${Math.hypot(dx, dy)}px`;
      b.rubber.style.transform = `translate(${b.sx}px, ${b.sy}px) rotate(${Math.atan2(dy, dx)}rad)`;
      return;
    }

    const s = cardDragRef.current;
    if (s && e.pointerId === s.pointerId) {
      const dx = e.clientX - s.sx;
      const dy = e.clientY - s.sy;
      if (!s.moved) {
        if (!movedBeyondCardThreshold(s.sx, s.sy, e.clientX, e.clientY)) return;
        s.moved = true;
        try {
          s.el.setPointerCapture(e.pointerId);
          s.captured = true;
        } catch {
          /* capture is best-effort; bubbling still reaches the viewport */
        }
      }
      // Pointer→world conversion goes exclusively through the camera maths
      // (plan §6.8②), which on the map also undoes the floor projection: a drag
      // straight across the screen is a diagonal across the floor.
      const moved = screenDeltaToWorld(dx, dy, camera.getCam().z, viewRef.current);
      const x = s.ix + moved.x;
      const y = s.iy + moved.y;
      s.el.style.left = `${x}px`;
      s.el.style.top = `${y}px`;

      // Paper-slide foley while dragging: ~80ms throttle, intensity follows
      // the instantaneous pointer speed (a slow scoot is a soft whisper).
      const now = performance.now();
      const slide = paperSlideRef.current;
      if (!slide) {
        paperSlideRef.current = { t: now, x: e.clientX, y: e.clientY };
      } else if (now - slide.t >= 80) {
        const dt = Math.max(1, now - slide.t);
        const spd = Math.hypot(e.clientX - slide.x, e.clientY - slide.y) / dt;
        playFoley('paper-slide', Math.min(1, spd / 2));
        paperSlideRef.current = { t: now, x: e.clientX, y: e.clientY };
      }

      // Soft push of neighbours (pure math, direct DOM writes). Boxes come
      // from the measure cache — reading offsetHeight here forced a reflow of
      // the doc on every move (profile: `get offsetHeight` ≈ 6×/move).
      const view = camera.viewportRef.current;
      if (view) {
        const self = elementBox(s.el);
        const dragBox = makeBox(x, y, self.w, self.h);
        const others: HTMLElement[] = [];
        view.querySelectorAll<HTMLElement>('.object').forEach((el) => {
          if (el !== s.el) others.push(el);
        });
        const boxes = others.map((el) => {
          const b = elementBox(el);
          return makeBox(b.l, b.t, b.w, b.h);
        });
        for (const p of pushFrom(dragBox, boxes)) {
          const o = others[p.i];
          o.classList.add('pushed');
          o.style.left = `${readLeft(o) + p.dx}px`;
          o.style.top = `${readTop(o) + p.dy}px`;
          s.pushed.add(o);
        }
      }
      highlightLinks(s.path, true); // keep asserted while dragging
      updateAllLinks();
      return;
    }

    // Pan + pinch (existing).
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > 0) {
        const now = camera.getCam();
        camera.flyTo(now.x, now.y, clampZ(pinchRef.current.z * (dist / pinchRef.current.d)));
      }
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    d.moved = Math.max(d.moved, Math.hypot(dx, dy));
    if (movedBeyondCardThreshold(d.sx, d.sy, e.clientX, e.clientY)) {
      const moved = screenDeltaToWorld(dx, dy, camera.getCam().z, viewRef.current);
      camera.flyTo(d.cx - moved.x, d.cy - moved.y);
    }
  };

  /** Finish a card drag: relax residual overlap, persist moved cards, clean up. */
  const settleDrag = (s: CardDragSession, persist: boolean) => {
    if (persist && s.moved) {
      playFoley('bag-pack'); // drop thud once the card settles
      const view = camera.viewportRef.current;
      if (view) {
        const els: HTMLElement[] = [];
        view.querySelectorAll<HTMLElement>('.object').forEach((el) => els.push(el));
        const boxes = els.map((el) => {
          const b = elementBox(el);
          return makeBox(b.l, b.t, b.w, b.h);
        });
        const relax = relaxAll(boxes);
        for (const r of relax) {
          const el = els[r.i];
          el.classList.add('pushed');
          el.style.left = `${readLeft(el) + r.dx}px`;
          el.style.top = `${readTop(el) + r.dy}px`;
          s.pushed.add(el);
        }
        // Relax settled the layout past the last pointermove: refresh the links.
        updateAllLinks();
        // Persist every card whose final position differs from React state —
        // the dragged card AND every pushed/relaxed card (plan §6.8③).
        if (onMoveCard) {
          for (const el of els) {
            const p = el.dataset.path;
            if (!p) continue;
            const orig = itemsByPath.get(p);
            if (!orig) continue;
            const fx = readLeft(el);
            const fy = readTop(el);
            if (Math.abs(fx - orig.x) > 0.5 || Math.abs(fy - orig.y) > 0.5) {
              void onMoveCard(p, fx, fy);
            }
          }
        }
      }
      highlightLinks(s.path, false);
    }
    s.el.classList.remove('dragging-item');
    cardDragRef.current = null;
    window.setTimeout(() => {
      for (const el of s.pushed) el.classList.remove('pushed');
    }, 260);
  };

  const handlePointerEnd = (e: React.PointerEvent) => {
    cancelLongPress();
    if (endBoardSession(e, true)) return;
    const s = cardDragRef.current;
    if (s && e.pointerId === s.pointerId) {
      settleDrag(s, true);
      return;
    }
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    dragRef.current = null;
    // Pointer capture releases automatically on pointerup.
  };

  // Cancel = abort gesture; no persistence, no highlight/class fallout.
  const handlePointerCancel = (e: React.PointerEvent) => {
    cancelLongPress();
    if (endBoardSession(e, false)) return;
    const s = cardDragRef.current;
    if (s && e.pointerId === s.pointerId) {
      settleDrag(s, false);
      return;
    }
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    dragRef.current = null;
  };

  // HTML5 drop of a backpack item onto blank scene space (backpack→card stays
  // inside CardRenderer's own drop handlers; CanvasObject is not draggable).
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const itemPath = e.dataTransfer.getData('text/plain');
    if (itemPath && onDropItemToScene) {
      onDropItemToScene(itemPath);
    }
  };

  // World Studio: Right-click on blank canvas summons the Radial Creator Menu
  const handleContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.object') || target.closest('button, a, input') || target.closest(`[${PRESENCE_NODE_ATTR}]`)) {
      return; // Clicking on cards or interactive elements retains native/local behavior
    }
    e.preventDefault();
    // A touch long-press already handled it (some browsers also fire contextmenu).
    if ((e.nativeEvent as PointerEvent).pointerType === 'touch' && onLongPress) return;
    const worldCoord = worldAt(e.clientX, e.clientY);
    if (!worldCoord) return;

    playFoley('paper-slide', 0.8);
    onOpenRadialMenu?.(e.clientX, e.clientY, worldCoord.x, worldCoord.y);
  };

  return (
    <div
      ref={camera.viewportRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerCancel}
      onContextMenu={handleContextMenu}
      // Board mode: a tap on a card picks it for marking — it must not also open
      // the card's reading view or a character's dialogue.
      onClickCapture={boardMode ? (event) => {
        const t = event.target as HTMLElement;
        if (t.closest('button:not(.presence-avatar__body), a, input, select, textarea, [data-no-drag]')) return;
        if (boardEndpointAt(t)) { event.stopPropagation(); event.preventDefault(); }
      } : undefined}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className={`relative w-full h-full overflow-hidden cursor-grab active:cursor-grabbing select-none touch-none ${DEPTH_MARKER('world')}${boardMode ? ' clue-board-mode' : ''}`}
      data-depth-surface={DEPTH_KIND.world}
      // Chalk frames and ink flip with the backdrop.
      data-scene-tone={sceneTone}
      // Canvas or map. The CSS that stands cards and characters
      // upright on the map keys off this; the projection itself is written by
      // the camera loop, not here.
      data-view={viewMode}
      style={{ perspective: '1200px' }}
    >
      {/* 2.5D Background sheet with 0.25x parallax drift & video support. */}
      <div className={`absolute inset-0 ${DEPTH_MARKER('background')}`} data-depth-surface={DEPTH_KIND.background}>
        <SceneBackdrop bg={bg} effectsEnabled={effectsEnabled} />
        {/* Flat-canvas grid sheet: beneath the cards, never resized (see CanvasGrid). */}
        <CanvasGrid camera={camera} surface="viewport" />
      </div>

      {/* World Transform Layer — single transform layer, rAF writes transform.
          Must pin transform-origin to top-left: default is center, which would
          offset every screen↔world mapping by half the content size. */}
      <div ref={camera.worldRef} className="absolute inset-0 origin-top-left" data-depth-surface={DEPTH_KIND.world} onPointerOver={event => {
        const object = (event.target as HTMLElement).closest<HTMLElement>('.object[data-path]');
        if (object) setFocusedPortrait(object.dataset.path ?? null);
      }}>
        <LinkLayer links={layoutPending ? [] : links} />
        {/* Map-projection grid sheet: must live inside the world transform
            layer so the floor matrix warps it. */}
        <CanvasGrid camera={camera} surface="world" />

        <div
          className={`absolute inset-0 ${DEPTH_MARKER('entity')}`}
          data-depth-surface={DEPTH_KIND.entity}
          aria-busy={layoutPending || undefined}
          style={layoutPending ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
        >
          {/* Cards — absolutely positioned at server-seated coords. */}
          {items.map((item) => (
            <CanvasObject
              key={item.path}
              item={item}
              layer={currentLayer}
              focus={focus}
              index={gateOrdinal.get(item.path)}
              onSelectChoice={onSelectChoice}
              onEntityAction={onEntityAction}
              onDiceRolled={onDiceRolled}
              onEnterGate={onEnterGate}
              onOpenCharacterModal={onOpenCharacterModal}
              onItemDropOnTarget={onItemDropOnTarget}
              onTakeItem={onTakeItem}
              carried={carried}
              playerTag={playerTags?.get(item.path)}
              still={item.path !== playingPortrait}
              retiring={retiringPaths?.has(item.path)}
              onShowInStream={onChalkToStream}
            />
          ))}
          <PresenceLayer
            presence={presence}
            layerId={currentLayer}
            onOpenCharacterModal={onOpenCharacterModal}
            assetUrl={assetUrl}
          />
        </div>

        <div className={`absolute inset-0 ${DEPTH_MARKER('overlay')}`} data-depth-surface={DEPTH_KIND.overlay}>
          {ghost && (
            <div
              data-path={ghost.path}
              className="object--ghost"
              style={{ left: ghost.x, top: ghost.y, width: ghost.w, zIndex: ghost.z }}
              aria-hidden
            >
              <div className="ghost-card ghost-card--pending" style={{ height: ghost.h }}>
                <div className="ghost-card__skeleton" />
                <div className="ghost-card__stage">{ghostLabel ?? ghost.body}</div>
              </div>
            </div>
          )}
          <PhantomLayer
            currentLayer={currentLayer}
            bgSrc={bg.src}
            copy={ghostCopy ?? { reused: '', failed: '', unreachable: '' }}
          />
          {ambient && <AmbientLayer camera={camera} currentLayer={currentLayer} items={items} presence={presence} />}
          {/* Character tick: drawn even with ambient life off — it is a fact in the making. */}
          {ambient && <CanvasTickLayer camera={camera} currentLayer={currentLayer} items={items} presence={presence} />}
          <AgentCursorLayer camera={camera} currentLayer={currentLayer} items={items} presence={presence} />
        </div>
      </div>

      {/* Atmospheric particles own separate ambient/burst surfaces. */}
      <div className="absolute inset-0" data-depth-surface={DEPTH_KIND.background}>
        <ParticleLayer
          key={bg.tone}
          tone={bg.tone}
          ambient={effectsEnabled}
          effectsEnabled={effectsEnabled}
          particleDensity={particleDensity}
          hidden={hidden}
          reducedMotion={particleReducedMotion}
        />
      </div>
    </div>
  );
};
