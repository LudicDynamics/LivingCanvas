/**
 * The two presentations. Transient
 * overlays only: each appears on its moment, plays, and leaves nothing behind.
 * They are a matched pair: the same frame — a dark card, a
 * double hairline, a diamond eyebrow, the name in the human face — in two
 * accents, rust for a thing, sea-blue for a place.
 *
 * - **New scene** (entered during play) — something OBTAINED, not a cut: a
 *   popup (never the whole screen) with the place's animated picture
 *   (`bgVideo`) played once, or its picture drifting (Ken Burns) when it has
 *   no clip, and 「打开了新的地点：…」. It closes by itself when the clip ends
 *   (click, tap or Esc sooner); a clip flies into the bag, where the player can
 *   play it again (`SCENE_REPLAY_DOM`). Effects off / reduced motion: a small
 *   static card in the item card's place (`scenePopPlan`).
 * - **The opening** (the save's first arrival) keeps the fuller presentation:
 *   the name, then the clip full-size, then it settles into the backdrop (map
 *   view: into the bag). It is the world's first look, not a find (§3.2).
 * - **Item obtained** — a new file in the bag: its art, its name, a line of it.
 *
 * Media decodes before a popup shows. Nothing here repaints the whole screen
 * per frame: the scrim is a static colour that fades once; every movement is a
 * transform or an opacity on the card. The first read after a load is the
 * baseline (a reload never replays); moments wait for the dice ceremony
 * (`deferReveal`) like the CG reveal; a hidden page holds the queue. Depth:
 * `--depth-milestone`, just under the CG reveal.
 */
import { track } from '../../lib/analytics.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { useStill } from '../../lib/motion.js';
import { usePerformanceSettings } from '../../lib/performance-settings.js';
import { mediaElementAudio, playFoley } from '../../lib/audio.js';
import { deferReveal } from '../../lib/reveal-gate.js';
import { ItemArtwork } from '../ItemArtwork.js';
import { worldEventToastStore } from '../../lib/world-event-toast.js';
import { setPerforming } from '../../lib/stage-performance.js';
import {
  claimSceneToast,
  enqueueMilestones,
  milestonesBetween,
  setStageBusy,
  scenePlan,
  scenePopPlan,
  scenePopRemainingMs,
  ITEM_MS,
  SCENE_POP_DECODE_MS,
  SCENE_REPLAY_DOM,
  type Milestone,
  type MomentScene,
  type RunMoments,
} from '../../lib/milestones.js';
import './milestone-stage.css';

export interface MilestoneStageProps {
  /** Changes on every world load: a new save starts from a fresh baseline. */
  worldKey: string;
  moments: RunMoments | null;
  view: 'canvas' | 'map';
  /** The page is hidden: hold the queue (no picture plays unseen). */
  hidden?: boolean;
  /** Something that must come first is up (the workshop intro card): hold the queue. */
  held?: boolean;
  /**
   * The save's first arrival (the `/api/opening` marker was unset when the
   * world loaded): the start scene gets its title card too, first in line.
   * `null` while the marker is being read.
   */
  opening?: boolean | null;
  /** The opening scene's presentation finished (or there was nothing to present). */
  onOpeningDone?: () => void;
  resolveAsset: (path: string, kind: 'image' | 'video') => string | null;
}

type Phase = 'title' | 'video' | 'settle';

/**
 * Play a scene clip with its own sound track when it has one, under the
 * engine's switches (mute, the music volume, the autoplay lock). A browser that
 * refuses sound still plays the picture, silently. The worlds' clips are
 * mostly silent today; a silent clip is unaffected.
 */
function startWithSound(el: HTMLVideoElement | null): void {
  if (!el) return;
  const { muted, volume } = mediaElementAudio();
  el.muted = muted;
  el.volume = volume;
  void el.play().catch(() => {
    if (el.muted) return;
    el.muted = true;
    void el.play().catch(() => { /* the poster stays; the phase clock still hands over */ });
  });
}

/** A clip that never reports `ended` (a stalled decode) still hands over. */
const VIDEO_MAX_MS = 15_000;
/** Where a scene's picture goes: the bag button, which holds the replays. */
const BAG_SELECTOR = '.prototype-bag-toggle';

/** The transform that carries `el` onto the bag button — one measurement, at hand-over time. */
function flightToBag(el: HTMLElement | null): string | null {
  const bag = document.querySelector(BAG_SELECTOR);
  if (!bag || !el) return null;
  const a = el.getBoundingClientRect();
  const b = bag.getBoundingClientRect();
  if (b.width === 0 || a.width === 0) return null;
  const s = Math.max(0.02, b.width / Math.max(1, a.width));
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${s})`;
}

type PopStage = 'loading' | 'shown' | 'exit';

interface ScenePopupProps {
  scene: MomentScene;
  reducedMotion: boolean;
  effects: boolean;
  /** Quality preset (full particles): the one-shot light sweep across the frame. */
  flourish: boolean;
  resolveAsset: MilestoneStageProps['resolveAsset'];
  onDone: () => void;
}

/**
 * A scene entered during play: 「打开了新的地点」 with its picture, once.
 * loading (media decodes, invisible) → shown (sting; the clip plays once with
 * its sound) → exit (a fade, or the flight into the bag) → `onDone`.
 */
function ScenePopup({ scene, reducedMotion, effects, flourish, resolveAsset, onDone }: ScenePopupProps): React.ReactElement {
  const { t } = useLocale();
  const src = scene.video ? resolveAsset(scene.video, 'video') : null;
  const poster = scene.poster ? resolveAsset(scene.poster, 'image') : null;
  const [clipFailed, setClipFailed] = useState(false);
  const plan = scenePopPlan({ reducedMotion, effects, hasVideo: !!src && !clipFailed, hasPoster: !!poster });
  const [stage, setStage] = useState<PopStage>('loading');
  const [clipEnded, setClipEnded] = useState(false);
  const [flight, setFlight] = useState<string | null>(null);
  const stageRef = useRef<PopStage>('loading');
  stageRef.current = stage;
  const shownAtRef = useRef(0);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const planRef = useRef(plan);
  planRef.current = plan;

  const show = useCallback(() => {
    if (stageRef.current === 'loading') setStage('shown');
  }, []);

  const close = useCallback(() => {
    if (stageRef.current === 'exit') return;
    stageRef.current = 'exit';
    const p = planRef.current;
    if (p.flyToBag) setFlight(flightToBag(cardRef.current));
    setStage('exit');
  }, []);

  // Decode before showing: the clip's first frame (`onLoadedData`) or the
  // picture; past the wait it shows with what it has.
  useEffect(() => {
    if (stage !== 'loading') return;
    const timer = window.setTimeout(show, SCENE_POP_DECODE_MS);
    if (plan.mode === 'motion') {
      if ((videoRef.current?.readyState ?? 0) >= 2) show();
    } else if (poster && imgRef.current) {
      const img = imgRef.current;
      (typeof img.decode === 'function' ? img.decode() : Promise.resolve()).then(show, show);
    } else show();
    return () => window.clearTimeout(timer);
  }, [stage, plan.mode, poster, show]);

  // On stage: the sting, and the clip once with its own sound.
  useEffect(() => {
    if (stage !== 'shown') return;
    shownAtRef.current = performance.now();
    playFoley('scene-sting', 0.9);
    if (planRef.current.mode === 'motion') startWithSound(videoRef.current);
  }, [stage]);

  // It closes by itself: after the clip (and a beat), or after its hold.
  useEffect(() => {
    if (stage !== 'shown') return;
    const elapsed = performance.now() - shownAtRef.current;
    const timer = window.setTimeout(close, scenePopRemainingMs(plan, elapsed, clipEnded || clipFailed));
    return () => window.clearTimeout(timer);
  }, [stage, plan.mode, clipEnded, clipFailed, close]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stage !== 'exit') return;
    const timer = window.setTimeout(() => doneRef.current(), plan.exitMs);
    return () => window.clearTimeout(timer);
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes it too. It never takes focus: whatever the player was typing keeps it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const label = t('A new place opens: {name}', { name: scene.name });
  const style = {
    '--pop-hold-ms': `${plan.maxMs}ms`,
    '--pop-exit-ms': `${plan.exitMs}ms`,
  } as React.CSSProperties;

  if (plan.mode === 'static') {
    return (
      <div
        ref={cardRef}
        className="milestone-card milestone-card--compact"
        data-kind="scene"
        data-mode="static"
        data-stage={stage}
        role="status"
        aria-live="polite"
        data-testid="milestone-scene"
        style={style}
        onClick={close}
        title={t('Close')}
      >
        <span className="milestone-card__thumb" aria-hidden="true">
          {poster ? <img ref={imgRef} src={poster} alt="" decoding="async" draggable={false} /> : <span className="milestone-card__glyph" />}
        </span>
        <span className="milestone-card__text">
          <span className="sr-only">{label}</span>
          <span className="milestone-card__eyebrow" aria-hidden="true">{t('A new place opens')}</span>
          <span className="milestone-card__name" aria-hidden="true">{scene.name}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="milestone-pop" data-kind="scene" data-mode={plan.mode} data-stage={stage} data-testid="milestone-scene" style={style}>
      {plan.scrim && <div className="milestone-pop__scrim" onClick={close} aria-hidden="true" />}
      <div
        ref={cardRef}
        className="milestone-card milestone-card--scene"
        data-kind="scene"
        data-flourish={flourish ? 'true' : undefined}
        role="status"
        aria-live="polite"
        style={flight ? { transform: flight } : undefined}
        onClick={close}
      >
        <div className="milestone-card__media">
          {plan.mode === 'motion' && src ? (
            <video
              key={src}
              ref={videoRef}
              className="milestone-card__video"
              src={src}
              poster={poster ?? undefined}
              preload="auto"
              playsInline
              muted
              onLoadedData={show}
              onEnded={() => setClipEnded(true)}
              onError={() => setClipFailed(true)}
            />
          ) : poster ? (
            <img ref={imgRef} className="milestone-card__still" src={poster} alt="" decoding="async" draggable={false} />
          ) : (
            <span className="milestone-card__glyph" aria-hidden="true" />
          )}
        </div>
        <span className="milestone-card__text">
          <span className="sr-only">{label}</span>
          <span className="milestone-card__eyebrow" aria-hidden="true">{t('A new place opens')}</span>
          <span className="milestone-card__name" aria-hidden="true">{scene.name}</span>
        </span>
        <button type="button" className="milestone-card__close" aria-label={t('Close')} onClick={(e) => { e.stopPropagation(); close(); }}>×</button>
      </div>
    </div>
  );
}

export function MilestoneStage({ worldKey, moments, view, hidden = false, held = false, opening = null, onOpeningDone, resolveAsset }: MilestoneStageProps): React.ReactElement | null {
  const { t } = useLocale();
  const reducedMotion = useStill();
  // The scene's animated picture is an effect: off → the static card.
  const perf = usePerformanceSettings();
  const effects = perf.effectsEnabled;
  // The quality preset's extra: a one-shot light sweep across either card.
  const flourish = effects && perf.particleDensity === 'full';
  const [queue, setQueue] = useState<Milestone[]>([]);
  const [phase, setPhase] = useState<Phase>('title');
  const [replay, setReplay] = useState<MomentScene | null>(null);
  const [flight, setFlight] = useState<string | null>(null);
  const prevRef = useRef<RunMoments | null>(null);
  const presentedRef = useRef<Set<string>>(new Set());
  const keyRef = useRef(worldKey);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const openingRef = useRef(false);
  const openingDoneRef = useRef(onOpeningDone);
  openingDoneRef.current = onOpeningDone;

  // A new save: fresh baseline, nothing carried over.
  if (keyRef.current !== worldKey) {
    keyRef.current = worldKey;
    prevRef.current = null;
    presentedRef.current = new Set();
    openingRef.current = false;
  }
  // Drop what was queued for the previous save. Only on a real change: a mount
  // (and StrictMode's second mount) must not wipe the opening queued just now.
  const clearedKeyRef = useRef(worldKey);
  useEffect(() => {
    if (clearedKeyRef.current === worldKey) return;
    clearedKeyRef.current = worldKey;
    setQueue([]);
    setReplay(null);
  }, [worldKey]);

  useEffect(() => {
    if (!moments) return;
    const found = milestonesBetween(prevRef.current, moments).filter((m) => !presentedRef.current.has(m.id));
    prevRef.current = moments;
    if (found.length === 0) return;
    for (const m of found) {
      presentedRef.current.add(m.id);
      // This card is the scene's line: its "Entered …" toast stands down (§3.1).
      if (m.kind === 'scene') claimSceneToast(m.scene.layer);
      // 改进产品 (lib/analytics.ts): an item was obtained (the fact only).
      if (m.kind === 'item') track('item_obtained');
    }
    const key = worldKey;
    deferReveal(() => {
      if (keyRef.current === key) setQueue((q) => enqueueMilestones(q, found));
    });
  }, [moments, worldKey]);

  // The opening: the start scene, once, ahead of anything else in the queue.
  useEffect(() => {
    if (opening !== true || !moments || openingRef.current) return;
    openingRef.current = true;
    const start = moments.scenes[0];
    if (!start) { openingDoneRef.current?.(); return; }
    const m: Milestone = { kind: 'scene', id: `scene:${start.layer}`, scene: start, opening: true };
    presentedRef.current.add(m.id);
    setQueue((q) => [m, ...q.filter((x) => x.id !== m.id)]);
  }, [opening, moments]);

  useEffect(() => {
    const onReplay = (e: Event) => {
      const scene = (e as CustomEvent<{ scene?: MomentScene }>).detail?.scene;
      if (scene && scene.video) setReplay(scene);
    };
    window.addEventListener(SCENE_REPLAY_DOM, onReplay);
    return () => window.removeEventListener(SCENE_REPLAY_DOM, onReplay);
  }, []);

  const current = hidden || held ? null : queue[0] ?? null;
  // A scene card, or a scene animation replayed from the bag, holds system
  // notices and world-event toasts until it is gone (§3.3).
  const sceneOnStage = current?.kind === 'scene' || replay !== null;
  useEffect(() => {
    // Release the world toasts' clocks first, so notices that waited are ingested fresh.
    worldEventToastStore.hold(sceneOnStage);
    setStageBusy(sceneOnStage);
  }, [sceneOnStage]);
  // Any card on stage (item or scene) is a performance: the forced tutorial waits for it.
  const presenting = current !== null || replay !== null;
  useEffect(() => { setPerforming('milestone', presenting); }, [presenting]);
  useEffect(() => () => { worldEventToastStore.hold(false); setStageBusy(false); setPerforming('milestone', false); }, []);

  // The fuller title → clip → settle presentation is the opening's only.
  const opener = current?.kind === 'scene' && current.opening === true;
  const plan = current?.kind === 'scene' && opener
    ? scenePlan({ reducedMotion, effects, hasVideo: !!current.scene.video, view })
    : null;

  const finish = useCallback(() => {
    const head = queue[0];
    if (head?.kind === 'scene' && head.opening) openingDoneRef.current?.();
    setFlight(null);
    setPhase('title');
    setQueue((q) => q.slice(1));
  }, [queue]);

  const settle = useCallback(() => {
    if (!plan || plan.settleMs === 0) { finish(); return; }
    // Map view: fly the picture into the bag button.
    if (plan.settle === 'bag') setFlight(flightToBag(frameRef.current));
    setPhase('settle');
  }, [plan, finish]);

  // Phase clock. Each phase hands over by itself; a skip just hands over sooner.
  // A popup (a scene entered during play) runs its own clock (`ScenePopup`).
  useEffect(() => {
    if (!current) return;
    if (current.kind === 'item') {
      playFoley('item-get', 0.9);
      const timer = window.setTimeout(finish, reducedMotion ? ITEM_MS + 800 : ITEM_MS);
      return () => window.clearTimeout(timer);
    }
    if (!plan) return;
    if (phase === 'title') {
      playFoley('scene-sting', 0.9);
      const timer = window.setTimeout(() => {
        if (plan.playVideo) setPhase('video');
        else finish();
      }, plan.titleMs);
      return () => window.clearTimeout(timer);
    }
    if (phase === 'video') {
      startWithSound(videoRef.current);
      const timer = window.setTimeout(settle, VIDEO_MAX_MS);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(finish, plan.settleMs);
    return () => window.clearTimeout(timer);
  }, [current?.id, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc dismisses an item card too (it is not focused: it never steals the input).
  useEffect(() => {
    if (current?.kind !== 'item') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current?.id, current?.kind, finish]);

  // The opening and a replay are modal (the player watches or asked for them); a popup never takes focus.
  useEffect(() => {
    if (opener || replay) rootRef.current?.focus({ preventScroll: true });
  }, [current?.id, replay]); // eslint-disable-line react-hooks/exhaustive-deps

  const skip = useCallback(() => {
    if (!current || current.kind !== 'scene') return;
    if (phase === 'title') {
      if (plan?.playVideo) setPhase('video');
      else finish();
    } else if (phase === 'video') settle();
    else finish();
  }, [current, phase, plan, settle, finish]);

  const onKey = (e: React.KeyboardEvent, act: () => void) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      act();
    }
  };

  if (replay) {
    // Replay from the bag: the same scene frame, larger, the clip with its sound; stays until closed.
    const src = replay.video ? resolveAsset(replay.video, 'video') : null;
    const poster = replay.poster ? resolveAsset(replay.poster, 'image') : null;
    const close = () => setReplay(null);
    return (
      <div
        ref={rootRef}
        className="milestone-pop"
        data-kind="replay"
        data-stage="shown"
        role="dialog"
        aria-modal="true"
        aria-label={replay.name}
        tabIndex={-1}
        onKeyDown={(e) => onKey(e, close)}
      >
        <div className="milestone-pop__scrim" onClick={close} aria-hidden="true" />
        <figure className="milestone-card milestone-card--scene milestone-card--replay" data-kind="scene">
          <div className="milestone-card__media">
            {src && (
              <video
                key={src}
                className="milestone-card__video"
                src={src}
                poster={poster ?? undefined}
                ref={(el) => { if (el && !reducedMotion && el.dataset.started !== 'true') { el.dataset.started = 'true'; startWithSound(el); } }}
                controls={reducedMotion}
                muted={reducedMotion ? mediaElementAudio().muted : undefined}
                playsInline
              />
            )}
          </div>
          <figcaption className="milestone-card__text">
            <span className="milestone-card__eyebrow">{t('Scenes')}</span>
            <span className="milestone-card__name">{replay.name}</span>
          </figcaption>
          <button type="button" className="milestone-card__close" aria-label={t('Close')} onClick={(e) => { e.stopPropagation(); close(); }}>×</button>
        </figure>
      </div>
    );
  }

  if (!current) return null;

  if (current.kind === 'item') {
    const { item } = current;
    return (
      <div
        className="milestone-card milestone-card--compact milestone-item"
        data-kind="item"
        data-flourish={flourish ? 'true' : undefined}
        role="status"
        aria-live="polite"
        data-testid="milestone-item"
        onClick={finish}
        title={t('Close')}
      >
        <ItemArtwork item={{ filename: item.filename, frontmatter: item.frontmatter as Record<string, any> }} />
        <span className="milestone-card__text">
          <span className="milestone-card__eyebrow">{t('Obtained')}</span>
          <span className="milestone-card__name">{item.name}</span>
          {item.summary && <span className="milestone-card__summary">{item.summary}</span>}
        </span>
      </div>
    );
  }

  if (!opener) {
    return (
      <ScenePopup
        key={current.id}
        scene={current.scene}
        reducedMotion={reducedMotion}
        effects={effects}
        flourish={flourish}
        resolveAsset={resolveAsset}
        onDone={finish}
      />
    );
  }

  const { scene } = current;
  const src = scene.video ? resolveAsset(scene.video, 'video') : null;
  const poster = scene.poster ? resolveAsset(scene.poster, 'image') : null;
  const showVideo = phase !== 'title' && !!src;
  return (
    <div
      ref={rootRef}
      className="milestone-stage"
      data-kind="scene"
      data-phase={phase}
      data-settle={phase === 'settle' ? plan?.settle : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={scene.name}
      tabIndex={-1}
      style={{ '--milestone-settle-ms': `${plan?.settleMs ?? 0}ms` } as React.CSSProperties}
      onClick={skip}
      onKeyDown={(e) => onKey(e, skip)}
      data-testid="milestone-opening"
    >
      {showVideo && (
        <div ref={frameRef} className="milestone-stage__frame" style={flight ? { transform: flight } : undefined}>
          <video
            key={src}
            ref={videoRef}
            className="milestone-stage__video"
            src={src!}
            poster={poster ?? undefined}
            playsInline
            onEnded={() => { if (phase === 'video') settle(); }}
            onError={() => { if (phase === 'video') settle(); }}
          />
        </div>
      )}
      <div className="milestone-stage__title" data-small={showVideo ? 'true' : undefined}>
        <span className="milestone-stage__name">{scene.name}</span>
      </div>
      <button type="button" className="milestone-stage__skip" onClick={(e) => { e.stopPropagation(); skip(); }}>{t('Skip')}</button>
    </div>
  );
}
