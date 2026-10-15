import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type KeyboardEvent } from 'react';
import { CharacterMedia } from '../media/CharacterMedia.js';
import { movedBeyondCardThreshold } from '../../lib/card-interaction.js';
import {
  DEFAULT_PORTRAIT_BOUNDS,
  clampPortraitAnchor,
  defaultPortraitAnchor,
  isPortraitAnchor,
  portraitBounds,
  portraitStorageKey,
  type PortraitAnchor,
  type PortraitBounds,
} from '../../lib/nook-portrait.js';

export interface NookPortraitProps {
  worldId: string;
  characterId: string;
  displayName: string;
  /** Live status line (nook 02 §⑫-8), shown on the nameplate below the figure. */
  statusLine?: string | null;
  video?: string;
  poster?: string;
  enabled: boolean;
  hidden?: boolean;
  fallback: ReactNode;
  /** Activating the portrait opens the character dialogue. */
  onActivate?: () => void;
  /** Accessible name for the activation, e.g. "Talk to Elias". */
  activateLabel?: string;
}

function readAnchor(worldId: string, characterId: string): PortraitAnchor {
  const fallback = defaultPortraitAnchor(
    typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches,
  );
  if (!worldId || typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(portraitStorageKey(worldId, characterId));
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isPortraitAnchor(parsed) ? clampPortraitAnchor(parsed) : fallback;
  } catch {
    return fallback;
  }
}

function saveAnchor(worldId: string, characterId: string, anchor: PortraitAnchor): boolean {
  if (!worldId || typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(portraitStorageKey(worldId, characterId), JSON.stringify(anchor));
    return true;
  } catch {
    return false;
  }
}

/**
 * The Nook portrait is a movable prop, not a second stage. It
 * reuses `CharacterMedia` for readiness/fallback and owns only its own
 * presentation transform: pointer capture, keyboard-equivalent nudges, and
 * world/character-scoped position memory. It never touches the action layer,
 * the camera stack, or the card canvas.
 */
export function NookPortrait({
  worldId,
  characterId,
  displayName,
  statusLine,
  video,
  poster,
  enabled,
  hidden = false,
  fallback,
  onActivate,
  activateLabel,
}: NookPortraitProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const committedRef = useRef<PortraitAnchor>(readAnchor(worldId, characterId));
  const dragRef = useRef<{ pointerId: number; bounds: PortraitBounds } | null>(null);
  // Pointer origin of the current press: a release inside the shared card
  // threshold is a click (open the dialogue), beyond it a drag (move the prop).
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const liveAnchorRef = useRef<PortraitAnchor>(committedRef.current);
  const rafRef = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<PortraitAnchor>(committedRef.current);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'unsaved'>('idle');
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const next = readAnchor(worldId, characterId);
    committedRef.current = next;
    liveAnchorRef.current = next;
    setAnchor(next);
    setSaveState('idle');
    dragRef.current = null;
    setDragging(false);
  }, [worldId, characterId]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    dragRef.current = null;
  }, []);

  // Escape during a drag cancels the drag instead of closing the whole Nook
  // (UX21 §3). App owns Escape on the document-capture phase, so this must run
  // earlier — on the window-capture phase — and only while a drag is live.
  useEffect(() => {
    if (!dragging) return;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      restore();
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [dragging]);

  // Enter and Space activate the portrait. App owns Enter on the document
  // capture phase to focus the writer, so this must run earlier — on the window
  // capture phase — and only while the portrait itself holds focus.
  useEffect(() => {
    if (!onActivate || hidden) return;
    const onActivateKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (dragRef.current || document.activeElement !== rootRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      onActivate();
    };
    window.addEventListener('keydown', onActivateKey, true);
    return () => window.removeEventListener('keydown', onActivateKey, true);
  }, [onActivate, hidden]);

  // A committed anchor outlives viewport changes; re-clamp it against the live
  // footprint on resize so a remembered position never leaves the stage. This
  // rewrites the DOM transform only — it does not overwrite the saved anchor.
  useEffect(() => {
    const reclamp = () => {
      const root = rootRef.current;
      if (!root || dragRef.current) return;
      const next = clampPortraitAnchor(liveAnchorRef.current, boundsOf(root));
      liveAnchorRef.current = next;
      setAnchor(next);
      applyLiveAnchor(next);
    };
    // First paint has no measurable box yet; wait one frame, then keep the
    // remembered anchor on-stage for the life of this mount.
    const frame = requestAnimationFrame(reclamp);
    window.addEventListener('resize', reclamp);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', reclamp);
    };
  }, []);

  // The stage is the offsetParent `[data-nook-zone=canvas]`, never
  // `parentElement`: the host wraps this tree in a `display: contents` div,
  // which generates no box and reports a 0×0 rect.
  const boundsOf = (root: HTMLElement): PortraitBounds =>
    portraitBounds(root.getBoundingClientRect(), root.offsetParent?.getBoundingClientRect());

  const applyLiveAnchor = (next: PortraitAnchor) => {
    const root = rootRef.current;
    if (!root) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      root.style.setProperty('--nook-portrait-x', String(next.x));
      root.style.setProperty('--nook-portrait-y', String(next.y));
    });
  };

  const commit = (next: PortraitAnchor, bounds: PortraitBounds = DEFAULT_PORTRAIT_BOUNDS) => {
    const normalized = clampPortraitAnchor(next, bounds);
    committedRef.current = normalized;
    liveAnchorRef.current = normalized;
    setAnchor(normalized);
    applyLiveAnchor(normalized);
    setSaveState(saveAnchor(worldId, characterId, normalized) ? 'saved' : 'unsaved');
  };

  const restore = () => {
    const previous = committedRef.current;
    liveAnchorRef.current = previous;
    setAnchor(previous);
    applyLiveAnchor(previous);
    dragRef.current = null;
    pointerStartRef.current = null;
    setDragging(false);
    setSaveState('idle');
  };

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    const drag = dragRef.current;
    if (!root || !drag || drag.pointerId !== event.pointerId) return;
    const stage = root.offsetParent?.getBoundingClientRect();
    if (!stage || stage.width <= 0 || stage.height <= 0) return;
    const next = clampPortraitAnchor({
      x: (event.clientX - stage.left) / stage.width,
      y: (event.clientY - stage.top) / stage.height,
    }, drag.bounds);
    liveAnchorRef.current = next;
    applyLiveAnchor(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || hidden) return;
    const root = rootRef.current;
    if (!root) return;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    // Measure once per drag: bounds follow the footprint, but must not be read
    // on every pointermove (that would force synchronous layout — AGENTS §5).
    dragRef.current = { pointerId: event.pointerId, bounds: boundsOf(root) };
    setDragging(true);
    setSaveState('idle');
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  // A press that never moved is a click on the prop, not a drag. Reusing the
  // card threshold keeps ONE jitter tolerance for the canvas and the portrait
  // (lib/card-interaction.ts), so a twitchy click cannot both move and open.
  const possiblyActivate = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || !onActivate || hidden) return;
    if (movedBeyondCardThreshold(start.x, start.y, event.clientX, event.clientY)) return;
    event.stopPropagation();
    onActivate();
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = liveAnchorRef.current;
    dragRef.current = null;
    setDragging(false);
    commit(next, drag.bounds);
    possiblyActivate(event);
  };

  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    restore();
  };

  const onLostPointerCapture = (event: PointerEvent<HTMLDivElement>) => {
    // A capture loss before pointerup is a cancellation; after pointerup the
    // ref is already empty, making duplicate browser notifications harmless.
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    restore();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (dragRef.current) {
        event.preventDefault();
        restore();
      }
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      const root = rootRef.current;
      commit(defaultPortraitAnchor(
        typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches,
      ), root ? boundsOf(root) : DEFAULT_PORTRAIT_BOUNDS);
      return;
    }
    const step = event.shiftKey ? 0.04 : 0.01;
    const delta = event.key === 'ArrowLeft' ? { x: -step, y: 0 }
      : event.key === 'ArrowRight' ? { x: step, y: 0 }
        : event.key === 'ArrowUp' ? { x: 0, y: -step }
          : event.key === 'ArrowDown' ? { x: 0, y: step } : null;
    if (!delta) return;
    event.preventDefault();
    const root = rootRef.current;
    commit({ x: anchor.x + delta.x, y: anchor.y + delta.y }, root ? boundsOf(root) : DEFAULT_PORTRAIT_BOUNDS);
  };

  const style = {
    '--nook-portrait-x': String(anchor.x),
    '--nook-portrait-y': String(anchor.y),
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className="nook-character-media"
      style={style}
      role={onActivate && !hidden ? 'button' : 'group'}
      tabIndex={hidden ? -1 : 0}
      aria-label={activateLabel ?? `${displayName} portrait position`}
      aria-describedby={saveState === 'saved' ? `${characterId}-portrait-saved` : undefined}
      data-nook-portrait-dragging={dragging ? 'true' : 'false'}
      data-nook-portrait-save={saveState}
      onPointerDown={onPointerDown}
      onPointerMove={updateFromPointer}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onKeyDown={onKeyDown}
    >
      <div className="nook-character-media__stage">
        <CharacterMedia
          video={video}
          poster={poster}
          enabled={enabled}
          name={displayName}
          className="nook-character-media__asset"
          fallback={fallback}
        />
      </div>
      {/* Nameplate: one line naming who is standing there and what they are
          doing, like the reference caption chip — "Nanami, mid-thought." */}
      <div className="nook-character-media__nameplate">
        {statusLine
          ? <span className="nook-character-media__name">{displayName}, <span className="nook-character-media__status">{statusLine}</span></span>
          : <span className="nook-character-media__name">{displayName}</span>}
      </div>
      <span id={`${characterId}-portrait-saved`} className="sr-only" aria-live="polite">
        {saveState === 'saved' ? 'Portrait position saved.' : saveState === 'unsaved' ? 'Portrait position could not be saved.' : ''}
      </span>
    </div>
  );
}
