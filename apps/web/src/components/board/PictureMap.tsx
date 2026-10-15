/**
 * PictureMap — the layer's own picture with its places, people, things and
 * text pinned on it (the design notes;: 「需要把地点放在图里面，而不是
 * 做成卡片」).
 *
 * — the map is the canvas,
 * drawn differently. So every pin that stands for a card opens the SAME card
 * interactions the canvas does (`MapCardPanel` → `EntityInteractions`: reader
 * text, choices, the dice roller, take along, enter, talk), new text arrives as
 * a pin, and the agents' pointers walk to the pins they are working on.
 *
 * The picture fills the viewport (cover at 1×) and fades into the page at its
 * edges; drag pans, wheel / pinch zooms (clamped). Pins are percentages inside
 * a stage that shares the picture's transform, so they stay on their spot.
 */
import { npcInitial, requestNpcTalk } from '../../lib/npc-dialogue.js';
import { airpGateway } from '../../lib/airp-gateway.js';
import '../canvas/npc-card.css';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { useStill } from '../../lib/motion.js';
import { pinMap, type MapPin } from '../../lib/board-model.js';
import { activityLabel, SOURCE_NAME_KEYS, type AgentActivity } from '../../lib/agent-activity.js';
import {
  CURSOR_REPLAY_STEP_MS,
  cursorSubject,
  replayIndexAt,
  resolveCursorTarget,
  useAgentCursors,
  type AgentCursor,
  type CursorStep,
} from '../../lib/agent-cursor.js';
import { MapCardPanel, type MapCardItem } from './MapCardPanel.js';
import { MapAmbientLayer } from '../canvas/AmbientLayer.js';
import { MapTickLayer } from '../canvas/TickIntentLayer.js';
import type { BoardProps } from './Board.js';
import '../canvas/agent-cursor.css';
import './board.css';

/** Zoom range, relative to "the picture just covers the viewport". */
export const MAP_MAX_ZOOM = 3;
/** Pointer travel (px) before a press becomes a pan and stops being a click. */
export const MAP_DRAG_THRESHOLD = 6;
/** How long a hover panel waits before closing, so the pointer can reach it. */
export const MAP_HOVER_CLOSE_MS = 250;
/** How long a newly arrived pin keeps its glowing ring. */
export const MAP_FRESH_MS = 4000;
/** Extra pan beyond the picture's edge, so an edge pin can reach the safe area. */
const PAN_SLACK = 160;

const PIN_GLYPH: Record<string, string> = { letter: '✉', note: '📜', prop: '◆', photo: '▣', image: '▣' };

interface View { x: number; y: number; z: number }
interface Size { w: number; h: number }

/** Kinds whose click opens the card panel rather than acting at once. */
const opensCard = (pin: MapPin) => pin.kind === 'item' || pin.kind === 'note' || pin.kind === 'dice';

export function PictureMap(props: BoardProps & { image: string }): React.ReactElement {
  const { t } = useLocale();
  const still = useStill();
  const { worldId, layerId, readme, items, characters, parent, carried, image } = props;
  const map = useMemo(
    () => pinMap({ worldId, layerId, readme, items, characters, parent }, carried),
    [worldId, layerId, readme, items, characters, parent, carried],
  );
  const [ratio, setRatio] = useState(16 / 9);
  useEffect(() => {
    const probe = new Image();
    probe.onload = () => { if (probe.naturalWidth && probe.naturalHeight) setRatio(probe.naturalWidth / probe.naturalHeight); };
    probe.src = image;
  }, [image]);

  // ---- Viewport, cover size, pan / zoom ------------------------------------
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const safeRef = useRef<HTMLDivElement | null>(null);
  const storyRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [captionHeight, setCaptionHeight] = useState(0);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      setSize({ w: viewport.clientWidth, h: viewport.clientHeight });
      setCaptionHeight(storyRef.current?.offsetHeight ?? 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (storyRef.current) observer.observe(storyRef.current);
    return () => observer.disconnect();
  }, [map.narration]);
  // The picture at 1× covers the viewport, like `object-fit: cover`.
  const stage = size.w && size.h
    ? (size.w / size.h > ratio ? { sw: size.w, sh: size.w / ratio } : { sw: size.h * ratio, sh: size.h })
    : { sw: 0, sh: 0 };
  // At this zoom the whole picture fits; framing may go that far to show every pin.
  const containZoom = stage.sw ? Math.min(1, size.w / stage.sw, size.h / stage.sh) : 1;

  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 });
  const [minZoom, setMinZoom] = useState(1);
  const userMoved = useRef(false);
  const clampView = useCallback((next: View, floor = minZoom): View => {
    const z = Math.min(MAP_MAX_ZOOM, Math.max(floor, next.z));
    const rangeX = Math.abs(stage.sw * z - size.w) / 2 + PAN_SLACK;
    const rangeY = Math.abs(stage.sh * z - size.h) / 2 + PAN_SLACK;
    return { z, x: Math.max(-rangeX, Math.min(rangeX, next.x)), y: Math.max(-rangeY, Math.min(rangeY, next.y)) };
  }, [minZoom, stage.sw, stage.sh, size.w, size.h]);

  /**
   * The first view of a layer: every pin inside the area no chrome covers (the
   * caption on top, the character rail or the companion column on the right),
   * zooming out only as far as that needs.
   */
  const frame = useCallback(() => {
    const safe = safeRef.current?.getBoundingClientRect();
    const box = viewportRef.current?.getBoundingClientRect();
    if (!safe || !box || !stage.sw) return;
    const shown = map.pins;
    const xs = shown.map(pin => pin.x);
    const ys = shown.map(pin => pin.y);
    const pad = 0.05;
    const x0 = shown.length ? Math.max(0, Math.min(...xs) - pad) : 0;
    const x1 = shown.length ? Math.min(1, Math.max(...xs) + pad) : 1;
    const y0 = shown.length ? Math.max(0, Math.min(...ys) - pad) : 0;
    const y1 = shown.length ? Math.min(1, Math.max(...ys) + pad) : 1;
    const fit = Math.min(safe.width / Math.max(1, (x1 - x0) * stage.sw), safe.height / Math.max(1, (y1 - y0) * stage.sh));
    const z = Math.max(containZoom, Math.min(1, fit));
    const floor = Math.min(1, z);
    setMinZoom(floor);
    // Centre of the pins' box, in px from the stage centre, lands on the safe centre.
    const bx = ((x0 + x1) / 2 - 0.5) * stage.sw * z;
    const by = ((y0 + y1) / 2 - 0.5) * stage.sh * z;
    const safeCx = safe.left - box.left + safe.width / 2;
    const safeCy = safe.top - box.top + safe.height / 2;
    setView(clampView({ z, x: safeCx - size.w / 2 - bx, y: safeCy - size.h / 2 - by }, floor));
  }, [map.pins, stage.sw, stage.sh, containZoom, clampView, size.w, size.h]);

  useEffect(() => { userMoved.current = false; }, [layerId, image]);
  useLayoutEffect(() => {
    if (!userMoved.current) frame();
  }, [frame, props.clearCompanion, captionHeight]);
  const resetView = () => { userMoved.current = false; frame(); };

  const zoomAround = useCallback((px: number, py: number, factor: number) => {
    userMoved.current = true;
    setView(current => {
      const z = Math.min(MAP_MAX_ZOOM, Math.max(minZoom, current.z * factor));
      const k = z / current.z;
      return clampView({ z, x: px - (px - current.x) * k, y: py - (py - current.y) * k });
    });
  }, [minZoom, clampView]);

  // Wheel zoom around the pointer (non-passive: the page must not scroll).
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = viewport.getBoundingClientRect();
      zoomAround(event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2, Math.exp(-event.deltaY * 0.0015));
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  // Drag to pan, two fingers to pinch. A press that travels past the threshold
  // is a pan: the click it would have produced is swallowed, so pins still
  // answer a plain click and never a drag.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean; dist?: number; z?: number } | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      suppressClick.current = false;
      gesture.current = { sx: event.clientX, sy: event.clientY, vx: view.x, vy: view.y, moved: false };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { sx: (a.x + b.x) / 2, sy: (a.y + b.y) / 2, vx: view.x, vy: view.y, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y), z: view.z };
    }
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    const box = event.currentTarget.getBoundingClientRect();
    if (pointers.current.size >= 2 && g.dist && g.z) {
      const [a, b] = [...pointers.current.values()];
      const factor = (g.z * Math.hypot(a.x - b.x, a.y - b.y) / g.dist) / view.z;
      suppressClick.current = true;
      zoomAround((a.x + b.x) / 2 - box.left - box.width / 2, (a.y + b.y) / 2 - box.top - box.height / 2, factor);
      return;
    }
    const dx = event.clientX - g.sx;
    const dy = event.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < MAP_DRAG_THRESHOLD) return;
    if (!g.moved) {
      g.moved = true;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    userMoved.current = true;
    setView(current => clampView({ ...current, x: g.vx + dx, y: g.vy + dy }));
  };
  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
  };

  // ---- Panels: a hover summary that can be reached, and the card panel -----
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const holdHover = (id: string) => { window.clearTimeout(closeTimer.current); setHover(id); };
  const releaseHover = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHover(null), MAP_HOVER_CLOSE_MS);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => { setOpen(null); setHover(null); }, [layerId]);
  // A card that left the layer (taken, moved) takes its panel with it.
  useEffect(() => {
    if (open && !map.pins.some(pin => pin.id === open)) setOpen(null);
  }, [open, map.pins]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Touch has no hover: the first tap on a place shows its popover (name and a
  // big 「进入地点」), the button inside goes in.
  const lastPointer = useRef<string>('mouse');
  const pressPin = (pin: MapPin) => {
    if (pin.kind === 'place' && lastPointer.current !== 'mouse' && hover !== pin.id) {
      window.clearTimeout(closeTimer.current);
      setHover(pin.id);
      return;
    }
    primary(pin);
  };
  const primary = (pin: MapPin) => {
    if (pin.kind === 'place') { setHover(null); props.onEnterPlace(pin.ref); }
    else if (pin.kind === 'character') props.onMeetCharacter(pin.ref);
    else if (pin.kind === 'npc') {
      // An NPC card: the pin opens the conversation, like a character's does.
      setHover(null);
      requestNpcTalk({ path: pin.ref, frontmatter: (items.find(item => item.path === pin.ref)?.frontmatter as Record<string, unknown> | null) ?? null });
    }
    else if (opensCard(pin)) { setHover(null); setOpen(current => (current === pin.id ? null : pin.id)); }
  };
  const actionLabel = (pin: MapPin): string => {
    if (pin.kind === 'place') return t('Enter place');
    if (pin.kind === 'character') return pin.away ? t('Go and talk') : t('Talk');
    if (pin.kind === 'npc') return t('Talk');
    return t('Open card');
  };

  // ---- New pins glow in; people glide (CSS) --------------------------------
  const seen = useRef<{ layer: string; ids: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const freshTimers = useRef<number[]>([]);
  useEffect(() => {
    const ids = new Set(map.pins.map(pin => pin.id));
    const previous = seen.current;
    seen.current = { layer: layerId, ids };
    if (!previous || previous.layer !== layerId) { setFresh(new Set()); return; }
    const added = [...ids].filter(id => !previous.ids.has(id));
    if (added.length === 0) return;
    setFresh(current => new Set([...current, ...added]));
    freshTimers.current.push(window.setTimeout(() => setFresh(current => {
      const next = new Set(current);
      for (const id of added) next.delete(id);
      return next;
    }), MAP_FRESH_MS));
  }, [map.pins, layerId]);
  useEffect(() => () => freshTimers.current.forEach(timer => window.clearTimeout(timer)), []);

  // ---- Where a pin is on screen (for the floating panels) -----------------
  const screenOf = (pin: MapPin) => ({
    x: size.w / 2 + view.x + (pin.x - 0.5) * stage.sw * view.z,
    y: size.h / 2 + view.y + (pin.y - 0.5) * stage.sh * view.z,
  });
  const floatStyle = (pin: MapPin, width: number): React.CSSProperties => {
    const at = screenOf(pin);
    // Stay inside what no chrome covers (the companion column, the rail).
    const safe = safeRef.current?.getBoundingClientRect();
    const box = viewportRef.current?.getBoundingClientRect();
    const right = safe && box ? safe.right - box.left : size.w - 96;
    const top = Math.max(captionHeight + 8, Math.min(at.y - 40, size.h - 180));
    const side = at.x + 24 + width > right && at.x - 24 - width > 0 ? 'left' : 'right';
    return {
      top,
      maxHeight: Math.max(160, size.h - top - 16),
      ...(side === 'left'
        ? { left: Math.max(8, Math.min(at.x - 24 - width, right - width)) }
        : { left: Math.min(at.x + 24, Math.max(8, right - width)) }),
    };
  };

  const stageStyle: React.CSSProperties = {
    width: stage.sw,
    height: stage.sh,
    left: (size.w - stage.sw) / 2,
    top: (size.h - stage.sh) / 2,
    transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.z})`,
    ['--map-pin-scale' as string]: String(1 / view.z),
  };

  const openPin = open ? map.pins.find(pin => pin.id === open) : undefined;
  const openItem = openPin ? items.find(item => item.path === openPin.ref) : undefined;
  const hoverPin = hover && hover !== open ? map.pins.find(pin => pin.id === hover) : undefined;

  return (
    <div
      ref={rootRef}
      className="board board--picture"
      data-clear-companion={props.clearCompanion ? 'true' : undefined}
      data-still={still ? 'true' : undefined}
      style={{ ['--map-caption-height' as string]: `${captionHeight}px` }}
    >
      <div
        ref={viewportRef}
        className="board__viewport"
        onPointerDown={event => { lastPointer.current = event.pointerType; onPointerDown(event); }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={event => {
          if (suppressClick.current) { event.stopPropagation(); event.preventDefault(); suppressClick.current = false; }
        }}
        onClick={event => {
          // A plain click on the picture (not on a pin) puts the open card away.
          if (!(event.target as HTMLElement).closest('.map-pin')) {
            setOpen(null);
            // A tap on the picture puts a tapped-open place popover away too.
            if (lastPointer.current !== 'mouse') setHover(null);
          }
        }}
      >
        <div className="board__stage board__stage--picture" style={stageStyle}>
          <img className="board__picture" src={image} alt="" draggable={false} />
        </div>
        {/* The picture fades into the page on every side. */}
        <div className="board__fog" aria-hidden="true" />
        <div className="board__stage board__stage--pins" style={stageStyle}>
          {map.pins.map(pin => {
            const style = { left: `${pin.x * 100}%`, top: `${pin.y * 100}%` };
            const isFresh = fresh.has(pin.id);
            if (pin.kind === 'player') {
              return <span key={pin.id} className="map-pin map-pin--player" style={style} aria-label={t('You')}><span className="map-pin__dot" /></span>;
            }
            const label = pin.kind === 'place' && pin.locked ? `${pin.label} · ${t('Locked')}` : pin.label;
            return (
              <div
                key={pin.id}
                className={`map-pin map-pin--${pin.kind}${pin.locked ? ' is-locked' : ''}${pin.away ? ' is-away' : ''}${open === pin.id ? ' is-pinned' : ''}${hover === pin.id ? ' is-hovered' : ''}${isFresh ? ' is-fresh' : ''}`}
                data-pin={pin.id}
                style={style}
                onPointerEnter={event => { if (event.pointerType === 'mouse') holdHover(pin.id); }}
                onPointerLeave={event => { if (event.pointerType === 'mouse') releaseHover(); }}
                onPointerDown={event => { lastPointer.current = event.pointerType; }}
                onFocus={() => holdHover(pin.id)}
                onBlur={releaseHover}
              >
                <button
                  type="button"
                  className="map-pin__icon"
                  onClick={() => pressPin(pin)}
                  aria-label={label}
                  aria-expanded={opensCard(pin) ? open === pin.id : undefined}
                  data-guide-target={pin.kind === 'place' ? 'enter' : undefined}
                  data-tutorial-locked={pin.kind === 'place' && pin.locked ? 'true' : undefined}
                >
                  {pin.kind === 'npc'
                    ? (pin.avatar ? <img className="map-pin__avatar" src={props.resolveAsset?.(pin.avatar) ?? airpGateway.assetUrl(pin.avatar, undefined, 'image')} alt="" /> : <span className="map-pin__initial">{npcInitial(pin.label)}</span>)
                    : pin.kind === 'character'
                    ? (pin.avatar ? <img className="map-pin__avatar" src={pin.avatar} alt="" /> : <span className="map-pin__initial">{pin.label.charAt(0)}</span>)
                    : pin.kind === 'item'
                      ? <span className="map-pin__glyph" aria-hidden="true">{PIN_GLYPH[pin.itemType ?? ''] ?? '◆'}</span>
                      : pin.kind === 'note'
                        ? <span className="map-pin__glyph map-pin__slip" aria-hidden="true" />
                        : pin.kind === 'dice'
                          ? <span className="map-pin__glyph map-pin__die" aria-hidden="true">⚄</span>
                          : <span className="map-pin__dot" aria-hidden="true" />}
                </button>
                {/* A place's name is part of its door: the name itself is a big, obvious thing to press. */}
                <span
                  className={`map-pin__label${pin.kind === 'place' ? ' map-pin__label--place' : ''}`}
                  aria-hidden="true"
                  onClick={pin.kind === 'place' ? () => pressPin(pin) : undefined}
                >{pin.kind === 'place' && pin.locked ? '🔒 ' : ''}{pin.label}{pin.kind === 'place' && !pin.locked ? <span className="map-pin__go" aria-hidden="true"> →</span> : null}</span>
              </div>
            );
          })}
          {/* Idle life: under the real pointers, never in their way. */}
          <MapAmbientLayer pins={map.pins} layerId={layerId} stageWidth={stage.sw} stageHeight={stage.sh} zoom={view.z} viewportRef={viewportRef} />
          <MapCursors pins={map.pins} items={items} layerId={layerId} characters={characters} still={still} />
          {/* Character tick: an intent you can see coming, and stop. */}
          <MapTickLayer pins={map.pins} layerId={layerId} stageWidth={stage.sw} stageHeight={stage.sh} zoom={view.z} />
        </div>
        {/* What no chrome covers: framing aims every pin inside it. */}
        <div ref={safeRef} className="board__safe" aria-hidden="true" />
      </div>

      {/* The layer's narration: the newest paragraph as a caption, the whole
          story so far on hover. Each piece is also its own note pin. */}
      {map.narration && (
        <div ref={storyRef} className="board__story" tabIndex={0}>
          <p className="board__narration">{map.narration}</p>
          {map.story.length > 1 && (
            <div className="board__story-panel" role="note">
              {map.story.map((entry, index) => (
                <section key={index}>
                  <h4>{entry.title}</h4>
                  <p>{entry.text}</p>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="map-corner">
        {parent && (
          <button type="button" className="map-exit" onClick={() => props.onLeave(parent.id)}>
            ↩ {t('Back to {place}', { place: parent.name })}
          </button>
        )}
        <div className="map-zoom" role="group" aria-label={t('Map controls')}>
          <button type="button" onClick={() => zoomAround(0, 0, 1.25)} aria-label={t('Zoom in')} title={t('Zoom in')}>+</button>
          <button type="button" onClick={() => zoomAround(0, 0, 0.8)} aria-label={t('Zoom out')} title={t('Zoom out')}>−</button>
          <button type="button" onClick={resetView} aria-label={t('Reset view')} title={t('Reset view')}>⤢</button>
        </div>
      </div>

      {hoverPin && (
        <div
          className="map-float map-pin__panel"
          role="group"
          aria-label={hoverPin.label}
          style={floatStyle(hoverPin, 300)}
          onPointerEnter={() => holdHover(hoverPin.id)}
          onPointerLeave={releaseHover}
        >
          <h4>{hoverPin.label}</h4>
          {hoverPin.kind === 'character' && hoverPin.away && hoverPin.detail && <p className="map-pin__where">{t('At {place}', { place: hoverPin.detail })}</p>}
          {hoverPin.kind !== 'character' && hoverPin.detail && <p>{hoverPin.detail}</p>}
          {hoverPin.locked && hoverPin.blocked && <p className="map-pin__blocked">🔒 {hoverPin.blocked}</p>}
          <div className="map-pin__actions">
            <button
              type="button"
              onClick={() => primary(hoverPin)}
              data-card-action={hoverPin.kind === 'place' ? 'enter' : undefined}
              data-card-path={hoverPin.kind === 'place' ? hoverPin.ref : undefined}
              data-tutorial-locked={hoverPin.kind === 'place' && hoverPin.locked ? 'true' : undefined}
            >{actionLabel(hoverPin)}</button>
          </div>
        </div>
      )}

      {openPin && openItem && (
        <MapCardPanel
          item={openItem as MapCardItem}
          style={floatStyle(openPin, 380)}
          focus={props.focus}
          onClose={() => setOpen(null)}
          onEntityAction={props.onEntityAction}
          onEnterPlace={props.onEnterPlace}
          onMeetCharacter={props.onMeetCharacter}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The agents' pointers, walking to the pin of the file they are working on
// (the same store and look as the canvas's AgentCursorLayer).

const CHARACTER_HUES = ['#4f7a5f', '#46708a', '#8a557c', '#94702b', '#6a5f9c'];
const HOME_STEP: CursorStep = { toolCallId: 'home', operation: 'other', self: true, state: 'ok' };

function hueOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return CHARACTER_HUES[Math.abs(h) % CHARACTER_HUES.length];
}

/** The pin a cursor step points at on this map, or null when it has none. */
export function pinForStep(
  step: CursorStep,
  characterId: string | undefined,
  pins: readonly MapPin[],
  items: BoardProps['items'],
  layerId: string,
): MapPin | null {
  if (step.self) return pins.find(pin => pin.kind === 'character' && pin.ref === characterId) ?? null;
  if (!step.path) return null;
  const target = resolveCursorTarget(step.path, items, layerId);
  if (target.kind !== 'card' && target.kind !== 'gate') return null;
  return pins.find(pin => pin.id === target.path) ?? null;
}

function MapCursors({ pins, items, layerId, characters, still }: {
  pins: readonly MapPin[];
  items: BoardProps['items'];
  layerId: string;
  characters: BoardProps['characters'];
  still: boolean;
}): React.ReactElement | null {
  const cursors = useAgentCursors().filter(cursor => cursor.mode !== 'deferred');
  if (cursors.length === 0) return null;
  return <>{cursors.map(cursor => (
    <MapCursor
      key={`${cursor.agentId}:${cursor.mode}:${cursor.replayStartedAt ?? 0}`}
      cursor={cursor}
      pins={pins}
      items={items}
      layerId={layerId}
      characters={characters}
      still={still}
    />
  ))}</>;
}

function MapCursor({ cursor, pins, items, layerId, characters, still }: {
  cursor: AgentCursor;
  pins: readonly MapPin[];
  items: BoardProps['items'];
  layerId: string;
  characters: BoardProps['characters'];
  still: boolean;
}): React.ReactElement | null {
  const { t } = useLocale();
  const replaying = cursor.mode === 'replay';
  const [replayIndex, setReplayIndex] = useState(-1);
  useEffect(() => {
    if (!replaying) return;
    const started = cursor.replayStartedAt ?? Date.now();
    const sync = () => setReplayIndex(replayIndexAt(cursor, Date.now() - started));
    sync();
    const timer = window.setInterval(sync, CURSOR_REPLAY_STEP_MS / 4);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaying, cursor.replayStartedAt, cursor.trail]);
  const step: CursorStep = !replaying
    ? cursor
    : replayIndex >= 0 && replayIndex < cursor.trail.length ? cursor.trail[replayIndex] : HOME_STEP;

  const target = pinForStep(step, cursor.characterId, pins, items, layerId);
  const home = cursor.characterId ? pins.find(pin => pin.kind === 'character' && pin.ref === cursor.characterId) ?? null : null;
  // Stay on the last pin while the agent works somewhere this map cannot show.
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (target) setPoint({ x: target.x, y: target.y });
    else setPoint(previous => previous ?? (home ? { x: home.x, y: home.y } : null));
  }, [target?.x, target?.y, home?.x, home?.y]);
  if (!point) return null;

  const name = cursor.characterId
    ? characters.find(character => character.id === cursor.characterId)?.name || cursor.characterId
    : t(SOURCE_NAME_KEYS.writer);
  const label = step === HOME_STEP
    ? null
    : activityLabel({ operation: step.operation, state: step.state, subject: cursorSubject(step.path) } as AgentActivity, t);
  const writing = !replaying && step.state === 'running' && (step.operation === 'write' || step.operation === 'create' || step.operation === 'edit');
  return (
    <div
      className="agent-cursor map-agent-cursor"
      data-agent={cursor.agentId}
      data-state={step.state}
      data-idle={cursor.idle ? 'true' : 'false'}
      data-writing={writing ? 'true' : 'false'}
      data-away={target ? 'false' : 'true'}
      data-still={still ? 'true' : 'false'}
      data-target-pin={target?.id}
      style={{
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        ...(cursor.characterId ? { '--agent-cursor-hue': hueOf(cursor.characterId) } : {}),
      } as React.CSSProperties}
      aria-hidden
    >
      <div className="agent-cursor__body" key={`${step.toolCallId}:${step.state}`}>
        <svg className="agent-cursor__pointer" width="22" height="30" viewBox="0 0 22 30" aria-hidden>
          <path d="M1.5 1.5 L1.5 23 L7.2 17.6 L11 26.6 L14.8 25 L11.1 16.3 L19 16.3 Z" />
        </svg>
        <span className="agent-cursor__tag">
          <span className="agent-cursor__name">{name}</span>
          {label && <span className="agent-cursor__label">{label}</span>}
        </span>
      </div>
    </div>
  );
}
