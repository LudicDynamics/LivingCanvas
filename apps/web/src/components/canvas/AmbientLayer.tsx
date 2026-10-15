/**
 * Ambient life on the canvas and on the picture map.
 *
 * "The fake": while nobody talks to them, the people in the scene — and the
 * Writer, as "us" — keep small idle habits. Each has a labelled pointer that
 * wanders like a collaborator's in a shared document (hovers a card, taps it,
 * nudges it a few px and puts it back, points at the player or at someone
 * else, rests at an edge, sweeps a line as if selecting it), avatars breathe
 * and glance, and now and then someone shows an emote, a murmur, or a short
 * pre-written bark — sometimes two of them trade lines, so a scene feels like
 * it was going on before you came in.
 *
 * Cheap and honest:
 *  - no model call, no request but a read of `GET /api/ambient` per cast, no world
 *    fact, nothing logged: a bark is a bubble and gone;
 *  - nothing persists: a nudged card plays a `translate` animation and is back;
 *    no position, no action, no event;
 *  - pointer-events none everywhere; clicking a person still opens the real
 *    conversation exactly as before;
 *  - real work wins: when an agent's REAL pointer is up (AgentCursorLayer /
 *    MapCursors), its ambient twin steps aside; while the writer generates,
 *    the writer's pointer goes where the ink lands and shows a "writing…" pip;
 *  - the clock (lib/ambient/scheduler.ts) pauses for typing, dragging, dialogs,
 *    dice, the tutorial and a hidden tab; reduced motion → still dots and rare
 *    emotes only; phones → small dots instead of pointers;
 *  - 「世界小动作」 (lib/ambient/settings.ts) turns all of it off.
 *
 * One engine (`AmbientLife`) over a small geometry adapter (`AmbientSpace`):
 * `AmbientLayer` hosts it in the canvas's world layer (world px, camera zoom),
 * `MapAmbientLayer` in the picture map's pin stage (stage px, map zoom).
 */
import React from 'react';
import { useLocale } from '../../lib/i18n.js';
import { useStill } from '../../lib/motion.js';
import { useWriterState } from '../../lib/writer-state.js';
import { useAgentCursors } from '../../lib/agent-cursor.js';
import { SOURCE_NAME_KEYS } from '../../lib/agent-activity.js';
import { screenToWorld } from '../../lib/camera.js';
import type { MapPin } from '../../lib/board-model.js';
import { characterHue } from '../../lib/ambient/hue.js';
import { useAmbientLife } from '../../lib/ambient/settings.js';
import { getTickSpeaking, useTickSpeaking, useTickView } from '../../lib/tick/store.js';
import { glidePath, nudgeOffsets, type Point, type Rng } from '../../lib/ambient/motion.js';
import { bubblePauseOf, cursorPauseOf, isTyping, probeOverlays } from '../../lib/ambient/gate.js';
import {
  INITIAL_SCHEDULER,
  planTick,
  releaseSpeech,
  type AmbientAction,
  type AmbientActor,
  type SchedulerState,
} from '../../lib/ambient/scheduler.js';
import {
  barkDurationMs,
  chatLines,
  chatPairs,
  EMOTE_GLYPH,
  pickBark,
  pickEmote,
  type AmbientEntries,
  type AmbientEmote,
  type AmbientLocale,
  type BarkContext,
} from '../../lib/ambient/barks.js';
import type { CharacterPresenceView } from '../../lib/presence.js';
import type { CameraApi } from '../../state/useCamera.js';
import type { LayerItem } from '../../state/useWorld.js';
import './ambient-layer.css';

/** Most people with a pointer at once (plus the writer). */
const MAX_PEOPLE_CURSORS = 3;
const TICK_MS = 500;
/** A target closer than this to the player's own pointer is skipped (screen px). */
const PLAYER_CLEARANCE_PX = 110;

// ---- Geometry adapter ------------------------------------------------------

/** Someone who can idle: a character or an NPC (card on the canvas, pin on the map). */
export interface AmbientPerson {
  id: string;
  name: string;
  kind: 'character' | 'npc';
  /** Pointer rest spot: just off the avatar / the card's corner (space px). */
  home: Point;
  /** Above the head: where a bubble's tail points (space px). */
  bubble: Point;
  /** The NPC's own card / pin id, a related thing to touch. */
  ref?: string;
}

/** Something a pointer can visit: a canvas card, or a map pin. */
export interface AmbientThing {
  ref: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /** A map pin is a small target with its label beneath it. */
  pin?: boolean;
}

export interface AmbientSpace {
  people: readonly AmbientPerson[];
  things: readonly AmbientThing[];
  /** Screen px per space px. */
  zoom(): number;
  /** Client point → space px (null when off the surface). */
  clientToSpace(cx: number, cy: number): Point | null;
  /** The visible viewport, client coords. */
  viewportRect(): DOMRect | null;
  /** The element to tap / nudge for a thing. */
  thingEl(ref: string): HTMLElement | null;
  /** The element that glances / steps for a person (presence avatar, NPC pin). */
  personEl(id: string): HTMLElement | null;
  /** Where the writer's ink lands while it generates. */
  writerSpot(): Point | null;
  /** Gets `data-ambient-life` (breathing CSS). */
  surfaceEl(): HTMLElement | null;
}

interface Bubble {
  key: number;
  actor: string;
  kind: 'emote' | 'bark' | 'murmur';
  text?: string;
  emote?: AmbientEmote;
  until: number;
}

interface Selection {
  key: number;
  x: number;
  y: number;
  w: number;
  h: number;
  hue?: string;
}

function useCompact(): boolean {
  const query = '(pointer: coarse), (max-width: 700px)';
  const [compact, setCompact] = React.useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const update = () => setCompact(mq.matches);
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return compact;
}

/**
 * The world's ambient data, read again whenever the cast changes. Not once per
 * mount: the play canvas mounts behind the lobby, before any world is open, so
 * its first read is a 409 `no_active_world` — and a later world (or another
 * save) brings other people. Failure just means wordless emotes.
 */
function useAmbientEntries(castKey: string): AmbientEntries {
  const [entries, setEntries] = React.useState<AmbientEntries>({});
  React.useEffect(() => {
    if (!castKey) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      fetch('/api/ambient', { headers: { Accept: 'application/json' } })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (alive && body && typeof body.entries === 'object' && body.entries) setEntries(body.entries as AmbientEntries);
        })
        .catch(() => {});
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [castKey]);
  return entries;
}

const AmbientCursor: React.FC<{
  id: string;
  name: string;
  hue?: string;
  writing: boolean;
  writingLabel: string;
  dot: boolean;
  yielded: boolean;
  register: (id: string, el: HTMLDivElement | null) => void;
}> = React.memo(({ id, name, hue, writing, writingLabel, dot, yielded, register }) => (
  <div
    ref={(el) => register(id, el)}
    className="ambient-cursor"
    data-ambient-actor={id}
    data-dot={dot ? 'true' : 'false'}
    data-writing={writing ? 'true' : 'false'}
    data-yielded={yielded ? 'true' : 'false'}
    style={hue ? ({ '--ambient-hue': hue } as React.CSSProperties) : undefined}
    aria-hidden
  >
    <div className="ambient-cursor__body">
      <svg className="ambient-cursor__pointer" width="18" height="24" viewBox="0 0 22 30" aria-hidden>
        <path d="M1.5 1.5 L1.5 23 L7.2 17.6 L11 26.6 L14.8 25 L11.1 16.3 L19 16.3 Z" />
      </svg>
      <span className="ambient-cursor__tag">
        <span className="ambient-cursor__name">{name}</span>
        {writing && <span className="ambient-cursor__pip">{writingLabel}</span>}
      </span>
      <span className="ambient-cursor__ripple" />
    </div>
  </div>
));
AmbientCursor.displayName = 'AmbientCursor';

const realAgentId = (id: string) => (id === 'writer' ? 'writer' : `character:${id}`);

/** The engine: clock, actions and drawing over an `AmbientSpace`. */
export const AmbientLife: React.FC<{
  space: AmbientSpace;
  currentLayer: string;
  /** Redraw writer aim when this changes (cards / pins appeared). */
  thingsKey: string;
  surface: 'canvas' | 'map';
}> = ({ space, currentLayer, thingsKey, surface }) => {
  const enabled = useAmbientLife();
  const still = useStill();
  const compact = useCompact();
  const { t, locale } = useLocale();
  const writer = useWriterState();
  const realCursors = useAgentCursors();
  // Character tick: the person whose intent is showing owns their pointer.
  const tick = useTickView();
  const tickActor = tick.enabled && tick.pending && tick.pending.page === currentLayer ? tick.pending.actor : null;
  // v2: real and ambient coexist — only a person speaking through the
  // tick right now (✎ bubble, invite card) holds back their ambient bubbles; everyone else goes on.
  const tickSpeaking = useTickSpeaking();

  const cursorEls = React.useRef(new Map<string, HTMLDivElement>());
  const positions = React.useRef(new Map<string, Point>());
  const schedRef = React.useRef<SchedulerState>(INITIAL_SCHEDULER);
  const rngRef = React.useRef<Rng>(Math.random);
  const pointerRef = React.useRef<{ x: number; y: number; at: number; mouse: boolean } | null>(null);
  const downRef = React.useRef(false);
  const keyAtRef = React.useRef(0);
  const recentRef = React.useRef<string[]>([]);
  const timersRef = React.useRef<number[]>([]);
  const seqRef = React.useRef(0);
  const [bubbles, setBubbles] = React.useState<Bubble[]>([]);
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const layerRef = React.useRef<HTMLDivElement | null>(null);

  const people = space.people;
  const writerBusy = writer.phase === 'writing';
  const liveReal = React.useMemo(() => new Set(realCursors.filter((c) => !c.idle && c.mode !== 'deferred').map((c) => c.agentId)), [realCursors]);
  const agentBusy = realCursors.some((c) => c.characterId && !c.idle);
  const dots = still || compact;

  // Who gets a pointer: the writer, then up to three people (characters first).
  const peopleKey = people.map((p) => p.id).join('|');
  const entries = useAmbientEntries(peopleKey);
  const cursorIds = React.useMemo(() => ['writer', ...people.slice(0, MAX_PEOPLE_CURSORS).map((p) => p.id)], [peopleKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const actors = React.useMemo<AmbientActor[]>(() => [
    { id: 'writer', kind: 'writer', cursor: true, speaks: false },
    ...people.map((p) => ({ id: p.id, kind: p.kind, cursor: cursorIds.includes(p.id), speaks: true })),
  ], [peopleKey, cursorIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live inputs read by the clock without re-subscribing it.
  const live = React.useRef({ space, currentLayer, entries, locale, writerBusy, agentBusy, enabled, dots, liveReal, still, actors, tickActor });
  live.current = { space, currentLayer, entries, locale, writerBusy, agentBusy, enabled, dots, liveReal, still, actors, tickActor };

  const register = React.useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cursorEls.current.set(id, el);
    else cursorEls.current.delete(id);
  }, []);

  // Breathing / glancing avatars: one attribute on the surface turns the CSS on.
  React.useEffect(() => {
    const el = space.surfaceEl();
    if (!el) return;
    el.setAttribute('data-ambient-life', enabled && !still ? 'on' : 'still');
    return () => el.removeAttribute('data-ambient-life');
  }, [space, enabled, still]);

  // Player input, as refs only (never React state on pointermove).
  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY, at: Date.now(), mouse: e.pointerType === 'mouse' };
    };
    const onDown = (e: PointerEvent) => {
      const r = live.current.space.viewportRect();
      if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) downRef.current = true;
    };
    const onUp = () => {
      downRef.current = false;
    };
    const onKey = () => {
      keyAtRef.current = Date.now();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    window.addEventListener('pointerup', onUp, { capture: true, passive: true });
    window.addEventListener('pointercancel', onUp, { capture: true, passive: true });
    window.addEventListener('keydown', onKey, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointerup', onUp, { capture: true });
      window.removeEventListener('pointercancel', onUp, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, []);

  /** The player's pointer in space px, when it is a mouse resting on the surface. */
  const playerPoint = React.useCallback((): Point | null => {
    const p = pointerRef.current;
    if (!p || !p.mouse || Date.now() - p.at > 20000) return null;
    const r = live.current.space.viewportRect();
    if (!r || p.x < r.left || p.x > r.right || p.y < r.top || p.y > r.bottom) return null;
    return live.current.space.clientToSpace(p.x, p.y);
  }, []);

  /** Too close to where the player is pointing (in screen px). */
  const nearPlayer = React.useCallback((pt: Point): boolean => {
    const player = playerPoint();
    if (!player) return false;
    return Math.hypot(pt.x - player.x, pt.y - player.y) * live.current.space.zoom() < PLAYER_CLEARANCE_PX;
  }, [playerPoint]);

  const homeOf = React.useCallback((id: string): Point => {
    const { space: s } = live.current;
    if (id !== 'writer') {
      const person = s.people.find((p) => p.id === id);
      if (person) return person.home;
    }
    const newest = [...s.things].sort((a, b) => b.z - a.z)[0];
    if (newest) return { x: newest.x + newest.w + 18 / s.zoom(), y: newest.y + 6 / s.zoom() };
    const r = s.viewportRect();
    return (r && s.clientToSpace(r.left + r.width * 0.62, r.top + r.height * 0.4)) ?? { x: 0, y: 0 };
  }, []);

  /** Glide a pointer (Web Animations, compositor transform only). */
  const glide = React.useCallback((id: string, to: Point, after?: () => void) => {
    const el = cursorEls.current.get(id);
    if (!el || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return;
    const from = positions.current.get(id) ?? homeOf(id);
    positions.current.set(id, to);
    if (live.current.dots || typeof el.animate !== 'function') {
      el.style.transform = `translate3d(${to.x}px, ${to.y}px, 0)`;
      after?.();
      return;
    }
    const plan = glidePath(from, to, rngRef.current);
    el.getAnimations?.().forEach((a) => a.cancel());
    el.style.transform = `translate3d(${from.x}px, ${from.y}px, 0)`;
    const anim = el.animate(plan.frames.map((f) => ({ transform: `translate3d(${f.x}px, ${f.y}px, 0)`, offset: f.offset })), { duration: plan.durationMs, easing: 'linear', fill: 'forwards' });
    anim.onfinish = () => {
      el.style.transform = `translate3d(${to.x}px, ${to.y}px, 0)`;
      anim.cancel();
      after?.();
    };
  }, [homeOf]);

  const later = React.useCallback((ms: number, fn: () => void) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  /** Things whose centre is on screen (away from the chrome-heavy edges); all of them when none is. */
  const visibleThings = React.useCallback((): readonly AmbientThing[] => {
    const { space: s } = live.current;
    const r = s.viewportRect();
    const a = r && s.clientToSpace(r.left + 60, r.top + 90);
    const b = r && s.clientToSpace(r.right - 90, r.bottom - 110);
    if (!a || !b) return s.things;
    const shown = s.things.filter((c) => {
      const cx = c.x + c.w / 2;
      const cy = c.y + Math.min(c.h, 120) / 2;
      return cx >= Math.min(a.x, b.x) && cx <= Math.max(a.x, b.x) && cy >= Math.min(a.y, b.y) && cy <= Math.max(a.y, b.y);
    });
    return shown.length ? shown : s.things;
  }, []);

  /** A thing the actor is related to: its own NPC card / pin, or things near it; the writer: newer things. */
  const relatedThing = React.useCallback((id: string): AmbientThing | null => {
    const { space: s } = live.current;
    const things = visibleThings();
    if (!things.length) return null;
    const rng = rngRef.current;
    if (id === 'writer') {
      const recent = [...things].sort((a, b) => b.z - a.z).slice(0, 5);
      return recent[Math.floor(rng() * recent.length)];
    }
    const person = s.people.find((p) => p.id === id);
    const own = person?.ref ? things.find((c) => c.ref === person.ref) : undefined;
    if (own && rng() < 0.35) return own;
    const home = person?.home ?? homeOf(id);
    const centre = (c: AmbientThing) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 });
    const near = [...things]
      .filter((c) => c.ref !== person?.ref)
      .sort((a, b) => Math.hypot(centre(a).x - home.x, centre(a).y - home.y) - Math.hypot(centre(b).x - home.x, centre(b).y - home.y))
      .slice(0, 3);
    return near.length ? near[Math.floor(rng() * near.length)] : own ?? null;
  }, [homeOf, visibleThings]);

  const touchThing = React.useCallback((thing: AmbientThing, how: 'tap' | 'nudge') => {
    const el = live.current.space.thingEl(thing.ref);
    // Never under the player's hand, never mid-drag, never a card that is open.
    if (!el || el.matches(':hover') || el.matches(':focus-within') || el.classList.contains('dragging-item') || el.hasAttribute('data-reading') || downRef.current) return;
    if (typeof el.animate !== 'function') return;
    if (how === 'tap') {
      el.animate([{ translate: '0 0' }, { translate: '0 -3px' }, { translate: '0 0' }], { duration: 420, easing: 'ease-out' });
    } else {
      const steps = nudgeOffsets(rngRef.current);
      el.animate(steps.map((p) => ({ translate: `${p.x}px ${p.y}px` })), { duration: 1300, easing: 'ease-in-out' });
    }
  }, []);

  const ripple = React.useCallback((id: string) => {
    cursorEls.current.get(id)?.setAttribute('data-tap', String(++seqRef.current % 2));
  }, []);

  const runCursor = React.useCallback((action: Extract<AmbientAction, { kind: 'cursor' }>) => {
    const id = action.actor;
    if (live.current.liveReal.has(realAgentId(id))) return;
    if (id === live.current.tickActor) return; // their intent's pointer owns it (TickIntentLayer)
    if (id === 'writer' && live.current.writerBusy) return; // the writing aim owns it
    if (live.current.dots) return; // a presence dot stays at its person / card edge
    const { space: s } = live.current;
    const unit = 1 / (s.zoom() || 1);
    const rng = rngRef.current;
    const el = cursorEls.current.get(id);
    el?.removeAttribute('data-resting');
    switch (action.move) {
      case 'home':
        glide(id, homeOf(id));
        return;
      case 'edge': {
        const r = s.viewportRect();
        if (!r) return;
        const cx = rng() < 0.5 ? r.left + 40 + rng() * 60 : r.right - 120 - rng() * 60;
        const cy = r.top + 120 + rng() * Math.max(40, r.height - 340);
        const pt = s.clientToSpace(cx, cy);
        if (!pt || nearPlayer(pt)) return;
        glide(id, pt, () => el?.setAttribute('data-resting', 'true'));
        return;
      }
      case 'point-player': {
        const player = playerPoint();
        if (!player) return;
        const from = positions.current.get(id) ?? homeOf(id);
        const d = Math.hypot(player.x - from.x, player.y - from.y) || 1;
        // Stop short of the player's pointer: point, never cover.
        const stop = (PLAYER_CLEARANCE_PX + 30) * unit;
        if (d <= stop) return;
        glide(id, { x: player.x + ((from.x - player.x) / d) * stop, y: player.y + ((from.y - player.y) / d) * stop });
        return;
      }
      case 'point-actor': {
        const other = action.other ? homeOf(action.other) : null;
        if (!other) return;
        const pt = { x: other.x - (26 - rng() * 12) * unit, y: other.y - (30 - rng() * 10) * unit };
        if (!nearPlayer(pt)) glide(id, pt);
        return;
      }
      case 'select': {
        const thing = relatedThing(id);
        if (!thing) return;
        // A line of a card's text, or a pin's label beneath it.
        const box = thing.pin
          ? { x: thing.x - thing.w * 0.6, y: thing.y + thing.h + 4 * unit, w: thing.w * 2.2, h: 15 * unit }
          : (() => {
            const w = thing.w * (0.4 + rng() * 0.35);
            return {
              x: thing.x + 18 * unit + rng() * Math.max(0, thing.w - w - 36 * unit),
              y: thing.y + 40 * unit + rng() * Math.max(10 * unit, Math.min(thing.h, 220 * unit) - 70 * unit),
              w,
              h: 16 * unit,
            };
          })();
        if (nearPlayer(box)) return;
        glide(id, { x: box.x, y: box.y + box.h * 0.4 }, () => {
          const key = ++seqRef.current;
          setSelection({ key, x: box.x, y: box.y, w: 0, h: box.h, hue: id === 'writer' ? undefined : characterHue(id) });
          // Sweep along the "line", then let go.
          requestAnimationFrame(() => setSelection((cur) => (cur && cur.key === key ? { ...cur, w: box.w } : cur)));
          glide(id, { x: box.x + box.w, y: box.y + box.h * 0.5 });
          later(1700, () => setSelection((cur) => (cur && cur.key === key ? null : cur)));
        });
        return;
      }
      case 'hover':
      case 'tap':
      case 'nudge': {
        const thing = relatedThing(id);
        if (!thing) return;
        const pt = thing.pin
          ? { x: thing.x + thing.w * (0.45 + rng() * 0.3), y: thing.y + thing.h * (0.45 + rng() * 0.3) }
          : { x: thing.x + thing.w * (0.3 + rng() * 0.5), y: thing.y + Math.min(thing.h, 240 * unit) * (0.2 + rng() * 0.4) };
        if (nearPlayer(pt)) return;
        glide(id, pt, () => {
          if (action.move === 'hover') return;
          ripple(id);
          touchThing(thing, action.move === 'tap' ? 'tap' : 'nudge');
        });
        return;
      }
    }
  }, [glide, homeOf, later, nearPlayer, playerPoint, relatedThing, ripple, touchThing]);

  const pushBubble = React.useCallback((bubble: Omit<Bubble, 'key'>) => {
    const key = ++seqRef.current;
    setBubbles((list) => [...list.filter((b) => b.actor !== bubble.actor), { ...bubble, key }]);
    later(Math.max(0, bubble.until - Date.now()), () => setBubbles((list) => list.filter((b) => b.key !== key)));
  }, [later]);

  /** Glance / step: the avatar turns a little toward someone, or shifts its weight, then back. */
  const glance = React.useCallback((id: string) => {
    if (live.current.still) return;
    const body = live.current.space.personEl(id);
    if (!body || typeof body.animate !== 'function' || body.matches(':hover')) return;
    const rng = rngRef.current;
    const side = rng() < 0.5 ? -1 : 1;
    if (rng() < 0.5) {
      body.animate([{ rotate: '0deg' }, { rotate: `${side * 5}deg` }, { rotate: `${side * 5}deg` }, { rotate: '0deg' }], { duration: 2200, easing: 'ease-in-out' });
    } else {
      const dx = side * (6 + rng() * 8);
      body.animate([{ translate: '0 0' }, { translate: `${dx}px -2px` }, { translate: `${dx}px -2px` }, { translate: '0 0' }], { duration: 2600, easing: 'ease-in-out' });
    }
  }, []);

  const barkContext = React.useCallback((): BarkContext => ({
    locale: live.current.locale as AmbientLocale,
    layer: live.current.currentLayer,
    hour: new Date().getHours(),
    cardPaths: new Set(live.current.space.things.map((it) => it.ref)),
  }), []);

  const runBubble = React.useCallback((action: Exclude<AmbientAction, { kind: 'cursor' }>) => {
    const { entries: all } = live.current;
    const rng = rngRef.current;
    const now = Date.now();
    const id = action.actor;
    // One bubble per person: a ✎ line of theirs is up (character tick v2).
    const speaking = getTickSpeaking();
    if (speaking.has(id) || ('partner' in action && action.partner && speaking.has(action.partner))) return;
    if (action.kind === 'emote') {
      pushBubble({ actor: id, kind: 'emote', emote: pickEmote(all[id], rng), until: now + 1800 });
      if (rng() < 0.4) glance(id);
      return;
    }
    if (action.kind === 'murmur') {
      pushBubble({ actor: id, kind: 'murmur', until: now + 2400 });
      return;
    }
    const ctx = barkContext();
    if (action.kind === 'chat' && action.partner) {
      const lines = chatLines(id, all[id], action.partner, ctx, rng);
      if (lines) {
        let at = 0;
        for (const line of lines) {
          const ms = barkDurationMs(line.text);
          later(at, () => {
            pushBubble({ actor: line.by, kind: 'bark', text: line.text, until: Date.now() + ms });
            glance(line.by);
          });
          at += ms + 450;
        }
        later(at, () => { schedRef.current = releaseSpeech(schedRef.current, Date.now()); });
        return;
      }
    }
    const text = pickBark(all[id], ctx, rng, recentRef.current);
    if (!text) {
      pushBubble({ actor: id, kind: 'emote', emote: pickEmote(all[id], rng), until: now + 1800 });
      schedRef.current = releaseSpeech(schedRef.current, now);
      return;
    }
    recentRef.current = [text, ...recentRef.current].slice(0, 4);
    const ms = barkDurationMs(text);
    pushBubble({ actor: id, kind: 'bark', text, until: now + ms });
    if (rng() < 0.5) glance(id);
    later(ms, () => { schedRef.current = releaseSpeech(schedRef.current, Date.now()); });
  }, [barkContext, glance, later, pushBubble]);

  const clearAll = React.useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
    setBubbles((list) => (list.length ? [] : list));
    setSelection(null);
    schedRef.current = releaseSpeech(schedRef.current, Date.now());
  }, []);

  // Writer generating: its pointer goes where the ink lands (the skeleton card,
  // else the newest thing) and shows a "writing…" pip — unless the real pointer is up.
  const writerYields = liveReal.has('writer');
  React.useEffect(() => {
    if (!enabled || !writerBusy || writerYields) return;
    const spot = live.current.space.writerSpot();
    if (spot) glide('writer', spot);
  }, [enabled, writerBusy, writerYields, thingsKey, glide]);

  // Place pointers at home when they first appear (and when dots: keep them there).
  React.useLayoutEffect(() => {
    for (const id of cursorIds) {
      const el = cursorEls.current.get(id);
      if (!el) continue;
      if (!positions.current.has(id) || dots) {
        const home = homeOf(id);
        positions.current.set(id, home);
        el.style.transform = `translate3d(${home.x}px, ${home.y}px, 0)`;
      }
    }
    for (const id of [...positions.current.keys()]) if (!cursorIds.includes(id)) positions.current.delete(id);
  }, [cursorIds, homeOf, dots, space]);

  // The clock.
  React.useEffect(() => {
    if (!enabled) {
      clearAll();
      return;
    }
    let wasBubblePaused = false;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const probe = {
        enabled: live.current.enabled,
        hidden: document.hidden,
        typing: isTyping(document.activeElement as HTMLElement | null, keyAtRef.current, now),
        dragging: downRef.current,
        ...probeOverlays(document),
        writerBusy: live.current.writerBusy,
        agentBusy: live.current.agentBusy,
      };
      const cursorPause = cursorPauseOf(probe);
      const bubblePause = bubblePauseOf(probe);
      // Why it is still, readable in devtools / screenshots (`data-pause`).
      const why = bubblePause ?? '';
      if (layerRef.current && layerRef.current.dataset.pause !== why) layerRef.current.dataset.pause = why;
      // A real reply, a dialog or the tutorial starting: take every bubble down at once.
      if (bubblePause && !wasBubblePaused) clearAll();
      wasBubblePaused = bubblePause !== null;
      const { entries: all, actors: cast } = live.current;
      const ctx = barkContext();
      const pairs = chatPairs(all, cast.filter((a) => a.speaks).map((a) => a.id));
      const result = planTick(schedRef.current, {
        now,
        actors: cast,
        cursorPause,
        bubblePause,
        // Phones keep bubbles and barks (their dots just stay put); reduced motion keeps rare emotes only.
        reducedMotion: live.current.still,
        rng: rngRef.current,
        playerKnown: Boolean(pointerRef.current?.mouse),
        canBark: (id) => pickBark(all[id], ctx, () => 0) !== null,
        chatPartners: (id) => pairs.filter(([a]) => a === id).map(([, b]) => b),
      });
      schedRef.current = result.state;
      for (const action of result.actions) {
        if (action.kind === 'cursor') runCursor(action);
        else runBubble(action);
      }
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
      clearAll();
    };
  }, [enabled, barkContext, clearAll, runBubble, runCursor]);

  if (!enabled) return null;

  const writerName = t(SOURCE_NAME_KEYS.writer);
  const writingLabel = t('Writing…');

  return (
    <div ref={layerRef} className="ambient-layer" data-surface={surface} data-still={still ? 'true' : 'false'} aria-hidden>
      {selection && (
        <div
          key={selection.key}
          className="ambient-selection"
          style={{ transform: `translate3d(${selection.x}px, ${selection.y}px, 0)`, width: selection.w, height: selection.h, ...(selection.hue ? { '--ambient-hue': selection.hue } : {}) } as React.CSSProperties}
        />
      )}
      {cursorIds.map((id) => {
        const person = people.find((p) => p.id === id);
        if (id !== 'writer' && !person) return null;
        const yielded = liveReal.has(realAgentId(id)) || id === tickActor;
        return (
          <AmbientCursor
            key={id}
            id={id}
            name={id === 'writer' ? writerName : person!.name}
            hue={id === 'writer' ? undefined : characterHue(id)}
            writing={id === 'writer' && writerBusy && !yielded}
            writingLabel={writingLabel}
            dot={dots}
            yielded={yielded}
            register={register}
          />
        );
      })}
      {bubbles.map((bubble) => {
        if (tickSpeaking.has(bubble.actor)) return null;
        const at = people.find((p) => p.id === bubble.actor)?.bubble;
        if (!at) return null;
        return (
          <div
            key={bubble.key}
            className="ambient-bubble"
            data-kind={bubble.kind}
            data-ambient-bubble={bubble.actor}
            style={{ transform: `translate3d(${at.x}px, ${at.y}px, 0)`, '--ambient-hue': characterHue(bubble.actor) } as React.CSSProperties}
          >
            <span className="ambient-bubble__inner">
              {bubble.kind === 'bark' && bubble.text}
              {bubble.kind === 'emote' && bubble.emote && <span className="ambient-bubble__emote" data-emote={bubble.emote}>{EMOTE_GLYPH[bubble.emote]}</span>}
              {bubble.kind === 'murmur' && (
                <span className="ambient-bubble__murmur">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ---- Canvas host ------------------------------------------------------------

const NPC_STEM = /([^/]+)\.md$/;

function npcName(item: LayerItem): string {
  const fm = item.frontmatter ?? {};
  return (typeof fm.name === 'string' && fm.name.trim()) || (typeof fm.title === 'string' && fm.title.trim()) || item.filename.replace(/\.md$/, '');
}

/** Characters (presence avatars) first, then NPC cards; one entry per id. */
export function canvasPeople(presence: readonly CharacterPresenceView[], items: readonly LayerItem[]): AmbientPerson[] {
  const out: AmbientPerson[] = [];
  const seen = new Set<string>();
  for (const view of presence) {
    if (view.state !== 'in-scene' || !view.position) continue;
    const { x, y } = view.position;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    seen.add(view.id);
    out.push({ id: view.id, name: view.name || view.id, kind: 'character', home: { x: x + 40, y: y + 34 }, bubble: { x, y: y - 64 } });
  }
  for (const item of items) {
    if (item.frontmatter?.type !== 'npc') continue;
    const id = NPC_STEM.exec(item.path)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const w = item.w || 220;
    out.push({ id, name: npcName(item), kind: 'npc', home: { x: item.x + w * 0.82, y: item.y + 28 }, bubble: { x: item.x + w / 2, y: item.y - 10 }, ref: item.path });
  }
  return out;
}

export const AmbientLayer: React.FC<{
  camera: CameraApi;
  currentLayer: string;
  items: LayerItem[];
  presence: readonly CharacterPresenceView[];
}> = ({ camera, currentLayer, items, presence }) => {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  // Constant on-screen size for tags / bubbles: one CSS variable, fed by the camera tick.
  React.useEffect(() => camera.subscribe((view) => {
    rootRef.current?.style.setProperty('--ambient-scale', String(1 / (view.z || 1)));
  }), [camera]);

  const space = React.useMemo<AmbientSpace>(() => {
    const world = () => camera.worldRef.current;
    return {
      people: canvasPeople(presence, items),
      things: items.filter((it) => !it.path.startsWith('phantom:')).map((it) => ({ ref: it.path, x: it.x, y: it.y, w: it.w || 220, h: it.h || 160, z: it.z })),
      zoom: () => camera.getCam().z || 1,
      viewportRect: () => camera.viewportRef.current?.getBoundingClientRect() ?? null,
      clientToSpace: (cx, cy) => {
        const r = camera.viewportRef.current?.getBoundingClientRect();
        if (!r) return null;
        const { w, h } = camera.getViewport();
        return screenToWorld(cx - r.left, cy - r.top, w, h, camera.getCam(), camera.getProjection());
      },
      thingEl: (ref) => world()?.querySelector<HTMLElement>(`.object[data-path="${CSS.escape(ref)}"]`) ?? null,
      personEl: (id) => world()?.querySelector<HTMLElement>(`[data-presence-id="${CSS.escape(id)}"] .presence-avatar__body`)
        ?? world()?.querySelector<HTMLElement>(`.object[data-path$="/${CSS.escape(id)}.md"] .npc-card__portrait`)
        ?? null,
      writerSpot: () => {
        const phantom = world()?.querySelector<HTMLElement>('[data-path^="phantom:"]');
        if (phantom) {
          const left = parseFloat(phantom.style.left);
          const top = parseFloat(phantom.style.top);
          if (Number.isFinite(left) && Number.isFinite(top)) return { x: left + 160, y: top + 40 };
        }
        const newest = [...items].sort((a, b) => b.z - a.z)[0];
        return newest ? { x: newest.x + (newest.w || 220) * 0.62, y: newest.y + 48 } : null;
      },
      surfaceEl: world,
    };
  }, [camera, items, presence]);
  const thingsKey = React.useMemo(() => items.map((it) => `${it.path}@${it.z}`).join('|'), [items]);

  return (
    <div ref={rootRef} className="ambient-host">
      <AmbientLife space={space} currentLayer={currentLayer} thingsKey={thingsKey} surface="canvas" />
    </div>
  );
};

// ---- Picture-map host --------------------------------------------------------

/**
 * Inside PictureMap's pin stage: pins are 0–1 fractions of the stage, the stage
 * is `sw × sh` px scaled by `zoom`, and `--map-pin-scale` (= 1 / zoom) already
 * counter-scales anything drawn here.
 */
export const MapAmbientLayer: React.FC<{
  pins: readonly MapPin[];
  layerId: string;
  stageWidth: number;
  stageHeight: number;
  zoom: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
}> = ({ pins, layerId, stageWidth, stageHeight, zoom, viewportRef }) => {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom || 1;
  const space = React.useMemo<AmbientSpace>(() => {
    const z = zoom || 1;
    const px = (pin: MapPin) => ({ x: pin.x * stageWidth, y: pin.y * stageHeight });
    const people: AmbientPerson[] = [];
    const things: AmbientThing[] = [];
    pins.forEach((pin, index) => {
      const at = px(pin);
      if ((pin.kind === 'character' && !pin.away) || pin.kind === 'npc') {
        const id = pin.kind === 'npc' ? NPC_STEM.exec(pin.ref)?.[1] ?? pin.ref : pin.ref;
        if (!people.some((p) => p.id === id)) {
          people.push({ id, name: pin.label, kind: pin.kind === 'npc' ? 'npc' : 'character', home: { x: at.x + 22 / z, y: at.y - 26 / z }, bubble: { x: at.x, y: at.y - 30 / z }, ref: pin.kind === 'npc' ? pin.id : undefined });
        }
      }
      if (pin.kind !== 'player' && pin.kind !== 'character') {
        things.push({ ref: pin.id, x: at.x - 20 / z, y: at.y - 20 / z, w: 40 / z, h: 40 / z, z: index, pin: true });
      }
    });
    const stageEl = () => hostRef.current?.parentElement ?? null;
    const pinEl = (id: string) => stageEl()?.querySelector<HTMLElement>(`.map-pin[data-pin="${CSS.escape(id)}"]`) ?? null;
    return {
      people,
      things,
      zoom: () => zoomRef.current,
      // The part of the map no chrome covers (PictureMap's `.board__safe`), else the whole viewport.
      viewportRect: () => (viewportRef.current?.querySelector<HTMLElement>('.board__safe') ?? viewportRef.current)?.getBoundingClientRect() ?? null,
      clientToSpace: (cx, cy) => {
        const r = stageEl()?.getBoundingClientRect();
        if (!r) return null;
        return { x: (cx - r.left) / zoomRef.current, y: (cy - r.top) / zoomRef.current };
      },
      thingEl: pinEl,
      personEl: (id) => (pinEl(id) ?? stageEl()?.querySelector<HTMLElement>(`.map-pin[data-pin$="/${CSS.escape(id)}.md"]`) ?? null)?.querySelector<HTMLElement>('.map-pin__icon') ?? null,
      writerSpot: () => {
        const fresh = stageEl()?.querySelector<HTMLElement>('.map-pin.is-fresh');
        const ref = fresh?.dataset.pin;
        const thing = (ref && things.find((t) => t.ref === ref)) || things[things.length - 1];
        return thing ? { x: thing.x + thing.w * 0.7, y: thing.y + thing.h * 0.6 } : null;
      },
      surfaceEl: stageEl,
    };
  }, [pins, stageWidth, stageHeight, zoom, viewportRef]);
  const thingsKey = React.useMemo(() => pins.map((p) => p.id).join('|'), [pins]);
  if (!stageWidth || !stageHeight) return null;
  return (
    <div ref={hostRef} className="ambient-host ambient-host--map">
      <AmbientLife key={layerId} space={space} currentLayer={layerId} thingsKey={thingsKey} surface="map" />
    </div>
  );
};
