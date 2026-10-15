/**
 * The agents' pointers on the canvas (lib/agent-cursor.ts).
 *
 * Lives inside Canvas's world transform layer, so `translate3d(x, y)` is world
 * pixels exactly like `.object` left/top and the presence avatars' centres,
 * and the pointer pans with the camera for free. The camera feed only writes
 * one CSS variable (`1 / zoom`) so the pointer keeps a constant on-screen size.
 *
 * Like PresenceLayer it is NOT a card: no `.object`, no `data-path`, never hit
 * by drag, collision, footprint or camera framing, and `pointer-events: none`.
 */
import React from 'react';
import { useLocale } from '../../lib/i18n.js';
import { useStill } from '../../lib/motion.js';
import { usePhantoms } from '../../lib/phantom.js';
import { activityLabel, SOURCE_NAME_KEYS, type AgentActivity } from '../../lib/agent-activity.js';
import {
  agentCursorStore,
  CURSOR_REPLAY_STEP_MS,
  cursorSubject,
  replayIndexAt,
  resolveCursorTarget,
  useAgentCursors,
  type AgentCursor,
  type CursorStep,
  type CursorTarget,
} from '../../lib/agent-cursor.js';
import { agentHash, characterHue } from '../../lib/ambient/hue.js';
import type { CharacterPresenceView } from '../../lib/presence.js';
import type { CameraApi } from '../../state/useCamera.js';
import type { LayerItem } from '../../state/useWorld.js';
import './agent-cursor.css';

interface AgentCursorLayerProps {
  camera: CameraApi;
  currentLayer: string;
  items: LayerItem[];
  presence: readonly CharacterPresenceView[];
}

interface Point {
  x: number;
  y: number;
}

const TARGET_ATTR = 'data-agent-cursor-target';
/** The replay's first and last stop: the character's own avatar. */
const HOME_STEP: CursorStep = { toolCallId: 'home', operation: 'other', self: true, state: 'ok' };

// Colours are shared with the ambient pointers (lib/ambient/hue.ts): one hand, one colour.
const hash = agentHash;

/** Small, stable per-call offset so repeated hits on one card still visibly move. */
function nudge(id: string): Point {
  const h = hash(id);
  return { x: ((h & 0xff) / 255 - 0.5) * 36, y: (((h >> 8) & 0xff) / 255 - 0.5) * 18 };
}

function findCard(root: HTMLElement | null, dataPath: string): HTMLElement | null {
  return root?.querySelector<HTMLElement>(`[data-path="${CSS.escape(dataPath)}"]`) ?? null;
}

/** Aim at the upper-right of the card body, where a hand would tap the title. */
function aimAt(el: HTMLElement, id: string): Point {
  const left = parseFloat(el.style.left);
  const top = parseFloat(el.style.top);
  const x = Number.isFinite(left) ? left : el.offsetLeft;
  const y = Number.isFinite(top) ? top : el.offsetTop;
  const w = el.offsetWidth || 240;
  const h = el.offsetHeight || 160;
  const n = nudge(id);
  return { x: x + w * 0.66 + n.x, y: y + Math.min(h * 0.32, 64) + n.y };
}

/** Tip of the pointer on the lower-right rim of an in-scene avatar (centre-positioned). */
function avatarPoint(presence: readonly CharacterPresenceView[], characterId?: string): Point | null {
  if (!characterId) return null;
  const view = presence.find((v) => v.id === characterId && v.state === 'in-scene' && v.position);
  return view?.position ? { x: view.position.x + 34, y: view.position.y + 30 } : null;
}

function isWrite(step: CursorStep): boolean {
  return step.operation === 'write' || step.operation === 'create' || step.operation === 'edit';
}

const Pointer: React.FC<{
  cursor: AgentCursor;
  camera: CameraApi;
  currentLayer: string;
  items: LayerItem[];
  presence: readonly CharacterPresenceView[];
  phantomKey: string;
  still: boolean;
}> = ({ cursor, camera, currentLayer, items, presence, phantomKey, still }) => {
  const { t } = useLocale();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [point, setPoint] = React.useState<Point | null>(null);
  const [target, setTarget] = React.useState<CursorTarget | null>(null);
  const [replayIndex, setReplayIndex] = React.useState(-1);

  // Constant on-screen size: counter-scale by the live zoom.
  React.useEffect(() => camera.subscribe((view) => {
    rootRef.current?.style.setProperty('--agent-cursor-scale', String(1 / (view.z || 1)));
  }), [camera]);

  // Replay clock: the store owns when the replay ends; this only picks the step.
  const replaying = cursor.mode === 'replay';
  React.useEffect(() => {
    if (!replaying) return;
    const started = cursor.replayStartedAt ?? Date.now();
    const sync = () => setReplayIndex(replayIndexAt(cursor, Date.now() - started));
    sync();
    const timer = window.setInterval(sync, CURSOR_REPLAY_STEP_MS / 4);
    return () => window.clearInterval(timer);
  }, [replaying, cursor.replayStartedAt, cursor.trail]);

  const step: CursorStep = !replaying
    ? cursor
    : replayIndex >= 0 && replayIndex < cursor.trail.length
      ? cursor.trail[replayIndex]
      : HOME_STEP;
  const home = avatarPoint(presence, cursor.characterId);

  // A replay with nothing on this canvas to walk to is dropped, not staged.
  React.useEffect(() => {
    if (!replaying) return;
    const visible = home !== null || cursor.trail.some((s) => {
      if (!s.path) return false;
      const kind = resolveCursorTarget(s.path, items, currentLayer).kind;
      return kind === 'card' || kind === 'gate';
    });
    if (!visible) agentCursorStore.dismiss(cursor.agentId);
    // Only judged when the replay starts; later layout changes do not cancel it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaying, cursor.replayStartedAt]);

  // Resolve the step to a place on this canvas. Re-runs when the cards, the
  // avatars or the phantom registry change, so a fresh card is followed onto.
  React.useLayoutEffect(() => {
    const world = camera.worldRef.current;
    let el: HTMLElement | null = null;
    let next: CursorTarget | null = null;
    let spot: Point | null = null;
    if (step.self) {
      spot = home;
    } else {
      // The writer's skeleton / wet-ink card for THIS call is the most precise spot.
      if (isWrite(step)) el = findCard(world, `phantom:${step.toolCallId}`);
      if (!el && step.path) {
        next = resolveCursorTarget(step.path, items, currentLayer);
        if (next.kind === 'card' || next.kind === 'gate') el = findCard(world, next.path);
      }
    }
    if (el) {
      setPoint(aimAt(el, step.toolCallId));
      el.setAttribute(
        TARGET_ATTR,
        cursor.idle ? 'idle' : step.state === 'error' ? 'error' : next?.kind === 'gate' ? 'gate' : 'card',
      );
    } else if (spot) {
      setPoint(spot);
    } else {
      // Layer / elsewhere / not landed yet: stay put. First appearance comes
      // out of the character's avatar, else the middle of the view.
      setPoint((prev) => prev ?? home ?? (() => {
        const cam = camera.getCam();
        return { x: cam.x, y: cam.y };
      })());
    }
    setTarget(next);
    return () => el?.removeAttribute(TARGET_ATTR);
  }, [step, cursor.idle, items, currentLayer, phantomKey, camera, home?.x, home?.y]);

  const name = cursor.characterId
    ? presence.find((v) => v.id === cursor.characterId)?.name || cursor.characterId
    : t(SOURCE_NAME_KEYS.writer);
  const label = step === HOME_STEP
    ? null
    : activityLabel({ operation: step.operation, state: step.state, subject: cursorSubject(step.path) } as AgentActivity, t);
  const writing = !replaying && step.state === 'running' && isWrite(step);
  const hue = cursor.characterId ? characterHue(cursor.characterId) : undefined;

  return (
    <div
      ref={rootRef}
      className="agent-cursor"
      data-agent={cursor.agentId}
      data-state={step.state}
      data-idle={cursor.idle ? 'true' : 'false'}
      data-writing={writing ? 'true' : 'false'}
      data-away={target?.kind === 'elsewhere' ? 'true' : 'false'}
      data-still={still ? 'true' : 'false'}
      // Always mounted, so the zoom feed and the first aim have a node to write;
      // hidden until the first point is known.
      hidden={!point}
      style={{
        ...(point ? { transform: `translate3d(${point.x}px, ${point.y}px, 0)` } : {}),
        ...(hue ? { '--agent-cursor-hue': hue } : {}),
      } as React.CSSProperties}
      aria-hidden
    >
      {/* Re-keyed per step so an error step replays its shake. */}
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
};

export const AgentCursorLayer: React.FC<AgentCursorLayerProps> = ({ camera, currentLayer, items, presence }) => {
  const cursors = useAgentCursors();
  const phantoms = usePhantoms();
  const still = useStill();
  // Identity of the phantom set, so a skeleton appearing re-aims the pointer.
  const phantomKey = React.useMemo(() => phantoms.map((p) => p.toolCallId).join('|'), [phantoms]);
  // Deferred = the character is in its dialogue; it is replayed after, not shown now.
  const shown = cursors.filter((cursor) => cursor.mode !== 'deferred');
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((cursor) => (
        <Pointer
          key={`${cursor.agentId}:${cursor.mode}:${cursor.replayStartedAt ?? 0}`}
          cursor={cursor}
          camera={camera}
          currentLayer={currentLayer}
          items={items}
          presence={presence}
          phantomKey={phantomKey}
          still={still}
        />
      ))}
    </>
  );
};
