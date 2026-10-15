import { Lock } from 'lucide-react';
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WorldShelf } from '../lib/airp-gateway.js';
import { withBase } from '../lib/base-path.js';
import { LOCALES, LOCALE_NAMES, useLocale } from '../lib/i18n.js';
import { useStill } from '../lib/motion.js';
import { probeCount } from '../lib/frame-probe.js';
import type { PerformanceSettings as PerformanceSettingsState } from '../lib/performance-settings.js';
import { PerformanceSettingsTrigger } from './PerformanceSettings.js';
import type { FocusCoordinator, FocusSurfaceLease } from '../lib/focus-coordinator.js';
import { ContactPanel } from './chrome/ContactPanel.js';
import { AccountPanel } from './chrome/AccountPanel.js';
import { BrickSocialMarks, WorldSocialRow, progressLine, type BrickSocial } from './WorldSocial.js';
import { LauncherNotices } from './Announcements.js';
import { accountData, useAccountData, worldKeyOf } from '../lib/account-data.js';
import { track } from '../lib/analytics.js';
import { guestModeOf, guestTileMark, useGuestTrial } from '../lib/guest-trial.js';
import { groupPlaceBadge } from '../lib/world-sync.js';
import { AMBIENT_LOOK, ambientBackdropUrl, coverThumbUrl } from '../lib/launcher-ambient.js';
import {
  brickGeometry,
  brickWorld,
  editionLabel,
  glideStep,
  GLIDE_STOP_SPEED,
  isNewWorldBrick,
  LAUNCHER_CREDIT,
  launcherWorlds,
  ALL_CATEGORIES,
  categoryChips,
  filterByCategory,
  readLobbyCategory,
  writeLobbyCategory,
  opensIntroCard,
  releaseVelocity,
  revealDelta,
  startPan,
  visibleBricks,
  worldTitle,
  type PanSample,
  type ShelfGroup,
} from '../lib/world-launcher.js';
import { WorldIntroCard, WorldMarks } from './WorldIntroCard.js';
import { prologueReplayFor } from '../lib/first-run.js';
import { WORLD_CATEGORIES, worldCategoryOf } from '@airp/shared/themes';
import { prefetchWorld } from '../lib/browser-mode.js';
import './world-launcher.css';
import './create-world.css';

const LANGUAGES = LOCALES.map(code => [code, LOCALE_NAMES[code]] as const);
/** Movement below this is a click on a brick, not a drag of the wall. */
const DRAG_THRESHOLD = 6;
/** A release after holding still this long does not glide. */
const GLIDE_WINDOW_MS = 80;
/** Fastest glide after a fling, px/ms: a flick must not throw the wall a million pixels. */
const MAX_GLIDE_SPEED = 3;
/** Wheel and keys ease towards their target: share of the remaining distance per 60fps frame. */
const EASE_PER_FRAME = 0.16;
/** Wheel ticks in quick succession speed the wall up, to at most this factor. */
const MAX_WHEEL_BOOST = 2.2;
/** The wall counts as still this long after the last wheel / glide frame. */
const MOTION_IDLE_MS = 150;
/** How many bricks play their world's video at once: those nearest the centre, plus the hovered one. */
const PLAYING_BRICKS = 5;
/** Stable identity for "nothing plays" — a fresh Set per render would defeat
 * the Brick memo and reshuffle play/pause while dragging. */
const PLAYING_NONE: ReadonlySet<string> = new Set<string>();

type Translate = ReturnType<typeof useLocale>['t'];

interface BrickProps {
  brickKey: string;
  world: ShelfGroup;
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  active: boolean;
  open: boolean;
  playing: boolean;
  /** The cover to draw: a downscaled copy once lib/launcher-ambient.ts has made it, the original until then. */
  cover: string;
  loading: string | null;
  /** The world path (`worlds/<id>` or `published/<id>`) a publish/unpublish is in flight for, if any. */
  publishing: string | null;
  /** Favorite, ratings and where the saves got to (lib/account-data.ts); null for the workshop brick. */
  social: BrickSocial | null;
  t: Translate;
  /** Interface language: the category badge reads its label from WORLD_CATEGORIES. */
  locale: string;
  onHover: (key: string | null) => void;
  onToggle: (key: string) => void;
  /** Open the world's intro card instead of the in-brick actions. */
  onIntro: (worldId: string) => void;
  onLoad: (path: string) => void;
  onCreate: () => void;
  onPublish: (editPath: string, publish: boolean) => void;
  /** The guest trial (lib/guest-trial.ts): signed out, the trial world says 免登录试玩, every other world is locked. */
  guestMark?: 'trial' | 'locked' | null;
  /** 「上传到云端」 for a 本机 original. */
  onKeepInCloud?: (editPath: string) => void;
  /** 「两份都保留」 for a conflict (§5.2). */
  onKeepBoth?: (editPath: string) => void;
}

/** One glass brick. Memoised: panning mounts and unmounts bricks at the edges only. */
const Brick = memo(function Brick({ brickKey, world, index, left, top, width, height, active, open, playing, cover: coverUrl, loading, publishing, social, t, locale, onHover, onToggle, onIntro, onLoad, onCreate, onPublish, onKeepInCloud, onKeepBoth, guestMark = null }: BrickProps) {
  const [ready, setReady] = useState(false);
  // Keep the <video> element once it has played. Re-mounting it on every
  // window crossing restarts the network fetch AND the decoder — a 100-200ms
  // main-thread block per cell crossing (measured as the launcher's dominant
  // longtasks). A paused element just freezes on its last frame.
  const [everPlayed, setEverPlayed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (playing) setEverPlayed(true);
    const video = videoRef.current;
    if (!video) return;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing]);
  // The first brick is the workshop's door, not a world.
  if (isNewWorldBrick(world)) {
    return (
      <article
        className={`world-launcher__tile is-new${active ? ' is-active' : ''}`}
        data-brick={brickKey}
        style={{ left, top, width, height }}
        onPointerEnter={() => onHover(brickKey)}
        onPointerLeave={() => onHover(null)}
      >
        <span className="world-launcher__plus" aria-hidden="true">＋</span>
        <span className="world-launcher__sheen" aria-hidden="true" />
        <button type="button" className="world-launcher__hit" aria-label={t('Make a world')} onClick={onCreate} onFocus={() => onHover(brickKey)} />
        <span className="world-launcher__meta" aria-hidden="true"><span><i>{String(index + 1).padStart(2, '0')}</i>{t('WORKSHOP')}</span></span>
        <div className="world-launcher__caption">
          <b>{t('Make a world')}</b>
          <small>{t('A name, a line and a cover — then tell the writer what it is.')}</small>
        </div>
      </article>
    );
  }
  const title = worldTitle(world.name);
  const marked = Boolean(world.category || world.intro?.experimental || world.intro?.unfinished);
  const latest = world.saves[0];
  const current = world.saves.some(save => save.active);
  const cover = { backgroundImage: `url("${coverUrl}")` };
  const workshop = world.workshop;
  const busy = loading !== null || publishing !== null;
  // What 「发布」/「撤回发布」 act on: the author's original; or — hosted, where a
  // published world leaves the author's drafts —
  // the author's own public copy.
  const publishTarget = workshop?.editPath ?? (workshop?.mine && workshop.status === 'published' ? world.templatePath : null);
  // 官方 / 云端 / 本机.
  const place = groupPlaceBadge(world.place);
  // An official edition its owner edits is only ever REpublished: the lobby keeps it public.
  const republish = workshop?.official === true;
  return (
    <article
      className={`world-launcher__tile${active ? ' is-active' : ''}${guestMark === 'locked' ? ' is-locked' : ''}`}
      data-brick={brickKey}
      data-guest={guestMark ?? undefined}
      style={{ left, top, width, height }}
      onPointerEnter={() => onHover(brickKey)}
      onPointerLeave={() => onHover(null)}
    >
      {/* An <img>, not a CSS background: decoded off the main thread, sized up
          front (no layout shift), and the rim below reuses the same bitmap. */}
      <img
        className="world-launcher__image"
        src={coverUrl}
        alt=""
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        draggable={false}
        aria-hidden="true"
      />
      {world.coverVideo && (playing || everPlayed) && (
        <video
          ref={videoRef}
          className={`world-launcher__video${ready ? ' is-ready' : ''}`}
          src={world.coverVideo}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          onLoadedData={() => setReady(true)}
        />
      )}
      {/* The slab's thick edge: the same picture, magnified, seen only in a band. */}
      <span className="world-launcher__rim" aria-hidden="true"><span style={cover} /></span>
      <span className="world-launcher__fringe" aria-hidden="true" />
      <span className="world-launcher__sheen" aria-hidden="true" />
      <button
        type="button"
        className="world-launcher__hit"
        aria-expanded={open}
        aria-label={title}
        onClick={() => {
          // Browser mode: start downloading this world while the card is read (no-op otherwise).
          if (!open) prefetchWorld(world.templatePath);
          // The intro card answers "what is this world" before anything loads.
          if (opensIntroCard(world)) { track('world_tile_open', undefined, worldKeyOf(world)); onIntro(world.id); return; }
          if (!open) track('world_tile_open', undefined, worldKeyOf(world));
          onToggle(brickKey);
        }}
        onFocus={() => onHover(brickKey)}
      />
      <span className="world-launcher__meta" aria-hidden="true">
        <span><i>{String(index + 1).padStart(2, '0')}</i>{editionLabel(world.locale)}</span>
        <BrickSocialMarks social={social} t={t} />
        {workshop
          ? <span className={`world-launcher__badge${workshop.status === 'published' ? ' is-published' : ''}`}>{workshop.status === 'published' ? t('Published') : t('Draft')}</span>
          : <span>{current ? t('Current game') : t('{count} saves', { count: world.saves.length })}</span>}
        {place && <span className={`world-place world-place--${place.tone}`} data-place={place.tone}>{t(place.label)}</span>}
      </span>
      <div className="world-launcher__caption">
        {(marked || world.intro?.recommended || guestMark) && (
          <span className="world-launcher__tags">
            {guestMark === 'trial' && <span className="world-launcher__ribbon is-trial" data-testid="guest-trial-ribbon">{t('Free trial, no sign-in')}</span>}
            {guestMark === 'locked' && <span className="world-launcher__lock" data-testid="guest-lock"><Lock aria-hidden="true" size={12} />{t('Sign in to unlock every world')}</span>}
            {world.intro?.recommended && <span className="world-launcher__ribbon">{t('Recommended for beginners')}</span>}
            <WorldMarks world={world} t={t} locale={locale} className="world-launcher__status" />
          </span>
        )}
        <b>{title}</b>
        {(world.intro && !world.intro.derived ? world.intro.hook : world.description) && <small>{world.intro && !world.intro.derived ? world.intro.hook : world.description}</small>}
        {open && (
          <div className="world-launcher__actions">
            {/* A made world: its author opens the original to keep building it
                and publishes from here; everyone else plays the published copy. */}
            {workshop?.editPath && (
              <button type="button" disabled={busy} onClick={() => onLoad(workshop.editPath!)}>
                {t('Open and keep building')}{loading === workshop.editPath ? t(' · opening…') : ''}
              </button>
            )}
            {publishTarget && (
              <button type="button" disabled={busy} onClick={() => onPublish(publishTarget, republish || workshop!.status !== 'published')}>
                {publishing === publishTarget ? t('Working…') : republish ? t('Republish') : workshop!.status === 'published' ? t('Unpublish') : t('Publish')}
              </button>
            )}
            {workshop?.editPath && world.place?.conflict && onKeepBoth && (
              <>
                <small className="world-launcher__progress">{t('The cloud copy was changed on another device while this one changed too. Nothing was overwritten.')}</small>
                <button type="button" disabled={busy} onClick={() => onKeepBoth(workshop.editPath!)}>
                  {publishing === workshop.editPath ? t('Working…') : t('Keep both')}
                </button>
              </>
            )}
            {workshop?.editPath && world.place?.kind === 'local' && onKeepInCloud && (
              <button type="button" disabled={busy} onClick={() => onKeepInCloud(workshop.editPath!)}>
                {publishing === workshop.editPath ? t('Working…') : t('Upload to the cloud')}
              </button>
            )}
            {latest && (!workshop || latest.path !== workshop.editPath) && (
              <button type="button" disabled={busy} onClick={() => onLoad(latest.path)}>
                {t('Continue latest save')}{loading === latest.path ? t(' · opening…') : ''}
              </button>
            )}
            {latest && social?.here && progressLine(social.here, t) && (
              <small className="world-launcher__progress">{progressLine(social.here, t)}</small>
            )}
            {/* Played on another device: the save stays there; here is only where it got to. */}
            {!latest && social?.elsewhere && (
              <small className="world-launcher__progress">
                {t('On another device')} · {progressLine(social.elsewhere, t) ?? t('{count} turns', { count: social.elsewhere.turns })}
              </small>
            )}
            {world.templatePath && (
              <button type="button" disabled={busy} onClick={() => onLoad(world.templatePath!)}>
                {t('＋ Start a new game')}{loading === world.templatePath ? t(' · opening…') : ''}
              </button>
            )}
            {social && <WorldSocialRow social={social} t={t} />}
          </div>
        )}
      </div>
    </article>
  );
});

/**
 * The world launcher: an endless wall of thick glass
 * bricks, one world per brick, repeating in every direction. Scroll, drag or use
 * the arrow keys to wander; the wall leans with the pointer. Every session starts
 * here and every world returns here.
 */
export function WorldLauncher({ shelf, loading, publishing, onLoad, onCreate, onPublish, onKeepInCloud, onKeepBoth, onClose, onManageSaves, shelfOpen, focus, performanceSettings, hidden, performanceSettingsOpen, onOpenPerformanceSettings }: {
  shelf: WorldShelf;
  loading: string | null;
  /** Save path whose publish/unpublish is in flight. */
  publishing: string | null;
  onLoad: (path: string) => void;
  /** The first brick: open the workshop's create dialog. */
  onCreate: () => void;
  onPublish: (editPath: string, publish: boolean) => void;
  /** 「上传到云端」 / 「两份都保留」. */
  onKeepInCloud?: (editPath: string) => void;
  onKeepBoth?: (editPath: string) => void;
  /** Present while a world is open: go back into it. */
  onClose?: () => void;
  onManageSaves: () => void;
  /** The 「选择世界」 shelf is open: the 「存档」 pill toggles it. */
  shelfOpen?: boolean;
  focus?: FocusCoordinator;
  performanceSettings: PerformanceSettingsState;
  hidden: boolean;
  performanceSettingsOpen: boolean;
  onOpenPerformanceSettings: (trigger: HTMLButtonElement) => void;
}) {
  const { t, locale, setLocale } = useLocale();
  const still = useStill();
  // The guest trial: signed out where it is on, the lobby marks the one playable world and locks the rest.
  const guestMode = guestModeOf(useGuestTrial());
  const mediaAllowed = performanceSettings.effectsEnabled && !hidden && !still;
  const tiltAllowed = mediaAllowed;
  const categoryLocale = locale === 'zh-CN' || locale === 'ja' || locale === 'ko' ? locale : 'en';
  const allWorlds = useMemo(() => launcherWorlds(shelf.groups ?? [], locale), [shelf.groups, locale]);
  // The category filter: remembered for the session; 「＋ 新建」 stays first.
  const [category, setCategory] = useState(readLobbyCategory);
  const chips = useMemo(() => categoryChips(allWorlds), [allWorlds]);
  const worlds = useMemo(() => filterByCategory(allWorlds, category), [allWorlds, category]);
  const shownCategory = chips.some(chip => chip.id === category) ? category : ALL_CATEGORIES;
  // Favorites, ratings and save progress that follow the account (lib/account-data.ts).
  const account = useAccountData();
  useEffect(() => { void accountData()?.refresh(); }, []);
  useEffect(() => {
    // ratings, likes and plays per world; plays are counted per edition (chronicle), summed per world
    const shown = worlds.filter(world => !isNewWorldBrick(world));
    const refs: Record<string, string[]> = {};
    for (const world of shown) {
      const key = worldKeyOf(world);
      refs[key] = world.workshop ? [world.id] : (shelf.groups ?? []).filter(g => !g.workshop && worldKeyOf(g) === key).map(g => g.id);
      if (!refs[key].length) refs[key] = [world.id];
    }
    void accountData()?.loadNumbers(shown.map(worldKeyOf), refs);
  }, [worlds, shelf.groups]);
  const socials = useMemo(() => {
    const out = new Map<string, BrickSocial>();
    for (const world of worlds) {
      if (isNewWorldBrick(world)) continue;
      const key = worldKeyOf(world);
      const local = new Set(world.saves.map(save => save.id));
      const latest = world.saves[0];
      out.set(world.id, {
        key,
        favorite: account.favorites.has(key),
        liked: account.likes.has(key),
        review: account.reviews[key] ?? null,
        rating: account.numbers[key]?.rating ?? account.ratings[key] ?? null,
        likes: account.numbers[key]?.likes ?? 0,
        plays: account.numbers[key]?.plays ?? null,
        opens: account.numbers[key]?.opens ?? null,
        tokens: account.numbers[key]?.tokens ?? null,
        here: latest ? account.saves.find(summary => summary.saveId === latest.id) ?? null : null,
        elsewhere: account.saves.find(summary => summary.worldId === key && !local.has(summary.saveId)) ?? null,
      });
    }
    return out;
  }, [worlds, account]);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const geometry = useMemo(() => brickGeometry(size.w), [size.w]);
  const cellW = geometry.w + geometry.gap;
  const cellH = geometry.h + geometry.gap;
  // Pan position (the wall point at the stage's top-left). Moving it touches
  // only the layer's transform; React re-renders when a brick boundary is crossed.
  const pan = useRef<{ x: number; y: number } | null>(null);
  // Where wheel and keys are easing the wall to; null while dragging or at rest.
  const target = useRef<{ x: number; y: number } | null>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  // The world whose intro card is open (its shelf id), if any.
  const [introId, setIntroId] = useState<string | null>(null);
  const introOpen = useRef(false);
  introOpen.current = introId !== null;
  const [dragging, setDragging] = useState(false);
  // `samples`: where the wall was over the last moves, for the release velocity (lib/world-launcher.ts releaseVelocity).
  const drag = useRef<{ id: number; x: number; y: number; t: number; samples: PanSample[]; moved: boolean } | null>(null);
  // Drag or coast: the simplified brick paint holds until the wall really stops (is-panning).
  const [gliding, setGliding] = useState(false);
  const panning = dragging || gliding;
  const suppressClick = useRef(false);
  const boost = useRef({ at: 0, factor: 1 });
  const frames = useRef({ tilt: 0, glide: 0, ease: 0 });
  // Wheel, keys and a fling's glide move the wall under a still pointer: every
  // brick sliding under it would take hover (is-active → a .45s box-shadow
  // transition, run on the main thread) one after another. While the wall
  // moves, hover holds still; when it settles, the brick under the pointer
  // takes it. Toggled on the root's classList, not React state: no re-render.
  const moving = useRef({ on: false, timer: 0 });
  const pointerAt = useRef<{ x: number; y: number } | null>(null);
  const loadRef = useRef(onLoad);
  loadRef.current = onLoad;
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  const openedRef = useRef<string | null>(null);
  openedRef.current = opened;
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  const requestClose = useCallback(() => {
    // Collapsing an opened brick keeps the launcher open, so it must not mark
    // the lease closing: a lease left "closing" refuses every later close.
    if (openedRef.current) { setOpened(null); return; }
    if (!closeHandler.current) return;
    const lease = leaseRef.current;
    if (lease && !lease.markClosing()) return;
    closeHandler.current();
  }, []);
  const active = opened ?? hovered;
  useEffect(() => {
    if (!focus) return;
    let opener: HTMLElement | null = null;
    let restored = false;
    const returnFocus = {
      capture: () => {
        if (opener) return;
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && activeElement !== document.body) opener = activeElement;
      },
      restore: () => {
        if (restored) return false;
        restored = true;
        if (opener && document.contains(opener)) {
          opener.focus();
          return true;
        }
        return false;
      },
    };
    const lease = focus.registerSurface({
      key: 'world-launcher',
      owner: 'workspace',
      priority: 400,
      root: root.current,
      close: requestClose,
      returnFocus,
    });
    leaseRef.current = lease;
    return () => {
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.unregister();
      window.requestAnimationFrame(() => returnFocus.restore());
    };
  }, [focus, requestClose]);

  // Launcher-scoped CSS keys on :root[data-airp-launcher], not
  // `body:has(.world-launcher)`: a :has() on <body> made every brick mounted
  // or re-classed while the wall moved re-check the whole document's style.
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.dataset.airpLauncher = 'open';
    return () => { delete html.dataset.airpLauncher; };
  }, []);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const place = useCallback(() => {
    const at = pan.current;
    if (!at || !layer.current) return;
    // Integer pixels only: a fractional translate resamples the wall's raster
    // tiles at a sub-pixel offset every frame, which shows up as drag stutter
    // on low-end compositors. The max error is under 1px and pans smoothly.
    layer.current.style.transform = `translate3d(${-Math.round(at.x)}px, ${-Math.round(at.y)}px, 0)`;
    probeCount('launcherPlace');
    const x = Math.floor(at.x / cellW) * cellW;
    const y = Math.floor(at.y / cellH) * cellH;
    setAnchor(previous => (previous.x === x && previous.y === y ? previous : { x, y }));
  }, [cellW, cellH]);

  // Open with the first brick at the top-left, so the wall reads in lobby order
  //: centred, the bricks above and left of it were the
  // END of the list — 开发中 / 实验 worlds — and looked like they came first.
  useLayoutEffect(() => {
    if (pan.current === null && size.w > 0) pan.current = startPan(geometry);
    place();
  }, [geometry, size, place]);

  const settleMotion = useCallback(() => {
    moving.current.on = false;
    root.current?.classList.remove('is-moving');
    const at = pointerAt.current;
    if (!at || drag.current?.moved) return;
    const tile = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>('.world-launcher__tile');
    setHovered(tile?.dataset.brick ?? null);
  }, []);
  const markMoving = useCallback(() => {
    const motion = moving.current;
    if (!motion.on) {
      motion.on = true;
      root.current?.classList.add('is-moving');
      setHovered(null);
    }
    window.clearTimeout(motion.timer);
    motion.timer = window.setTimeout(settleMotion, MOTION_IDLE_MS);
  }, [settleMotion]);
  useEffect(() => () => window.clearTimeout(moving.current.timer), []);

  /** Direct movement (drag, glide). */
  const panBy = useCallback((dx: number, dy: number) => {
    if (!pan.current) return;
    pan.current.x += dx;
    pan.current.y += dy;
    place();
  }, [place]);

  const stopMotion = useCallback(() => {
    cancelAnimationFrame(frames.current.glide);
    cancelAnimationFrame(frames.current.ease);
    frames.current.glide = 0;
    frames.current.ease = 0;
    target.current = null;
    setGliding(false);
  }, []);

  /** Wheel and keys: ease towards a target; quick successive ticks accelerate. */
  const scrollBy = useCallback((dx: number, dy: number) => {
    const at = pan.current;
    if (!at) return;
    const now = performance.now();
    const speed = boost.current;
    speed.factor = now - speed.at < 140 ? Math.min(MAX_WHEEL_BOOST, speed.factor * 1.06) : 1;
    speed.at = now;
    markMoving();
    const from = target.current ?? { x: at.x, y: at.y };
    target.current = { x: from.x + dx * speed.factor, y: from.y + dy * speed.factor };
    if (still) {
      at.x = target.current.x;
      at.y = target.current.y;
      target.current = null;
      place();
      return;
    }
    if (frames.current.ease) return;
    let last = now;
    const step = (time: number) => {
      const goal = target.current;
      const p = pan.current;
      if (!goal || !p) { frames.current.ease = 0; return; }
      const share = 1 - Math.pow(1 - EASE_PER_FRAME, Math.min(64, time - last) / 16.7);
      last = time;
      p.x += (goal.x - p.x) * share;
      p.y += (goal.y - p.y) * share;
      markMoving();
      if (Math.abs(goal.x - p.x) + Math.abs(goal.y - p.y) < 0.5) {
        p.x = goal.x;
        p.y = goal.y;
        target.current = null;
        frames.current.ease = 0;
        place();
        return;
      }
      place();
      frames.current.ease = requestAnimationFrame(step);
    };
    frames.current.ease = requestAnimationFrame(step);
  }, [place, still, markMoving]);

  useEffect(() => () => { cancelAnimationFrame(frames.current.tilt); stopMotion(); }, [stopMotion]);
  useEffect(() => {
    if (tiltAllowed) return;
    cancelAnimationFrame(frames.current.tilt);
    frames.current.tilt = 0;
    root.current?.style.setProperty('--tilt-x', '0');
    root.current?.style.setProperty('--tilt-y', '0');
  }, [tiltAllowed]);

  // Wheel and trackpad: both axes at once, so the wall scrolls in any direction.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelAnimationFrame(frames.current.glide);
      frames.current.glide = 0;
      setGliding(false);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      scrollBy(event.deltaX * unit, event.deltaY * unit);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [scrollBy]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const step = { ArrowLeft: [-cellW * 0.6, 0], ArrowRight: [cellW * 0.6, 0], ArrowUp: [0, -cellH * 0.6], ArrowDown: [0, cellH * 0.6] }[event.key];
      if (!step || introOpen.current || (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement)) return;
      event.preventDefault();
      scrollBy(step[0], step[1]);
      // Arrow navigation is local launcher behavior; Escape belongs only to
      // App's document-capture transaction.
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cellW, cellH, scrollBy]);

  // Lean is written to a CSS variable pair read only by the wall's transform:
  // the bricks themselves never repaint when the pointer moves.
  const lean = (x: number, y: number) => {
    cancelAnimationFrame(frames.current.tilt);
    if (!tiltAllowed) {
      frames.current.tilt = 0;
      root.current?.style.setProperty('--tilt-x', '0');
      root.current?.style.setProperty('--tilt-y', '0');
      return;
    }
    frames.current.tilt = requestAnimationFrame(() => {
      root.current?.style.setProperty('--tilt-x', x.toFixed(3));
      root.current?.style.setProperty('--tilt-y', y.toFixed(3));
    });
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    stopMotion();
    setGliding(false);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, t: performance.now(), samples: [], moved: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (event.pointerType !== 'touch') pointerAt.current = { x: event.clientX, y: event.clientY };
    const current = drag.current;
    if (current && current.id === event.pointerId) {
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (!current.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        current.moved = true;
        suppressClick.current = true;
        setDragging(true);
        setHovered(null);
        stage.current?.setPointerCapture(event.pointerId);
      }
      if (current.moved) {
        const now = event.timeStamp || performance.now();
        panBy(-dx, -dy);
        probeCount('launcherDrag');
        const at = pan.current;
        if (at) {
          current.samples.push({ t: now, x: at.x, y: at.y });
          if (current.samples.length > 12) current.samples.shift();
        }
        current.x = event.clientX;
        current.y = event.clientY;
        current.t = now;
      }
    }
    // Tilt rides the pointer only outside a drag: the wall is already panning
    // there, and re-aiming the 3D lean mid-gesture churns the compositor.
    if (tiltAllowed && !current?.moved && event.pointerType !== 'touch') {
      lean((event.clientX / window.innerWidth - 0.5) * 2, (event.clientY / window.innerHeight - 0.5) * 2);
    }
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    if (!current.moved) return;
    setDragging(false);
    // The click that follows this release belongs to the drag, not to a brick.
    window.setTimeout(() => { suppressClick.current = false; }, 0);
    if (still) { setGliding(false); return; }
    let { vx, vy } = releaseVelocity(current.samples, event.timeStamp || performance.now(), GLIDE_WINDOW_MS, MAX_GLIDE_SPEED);
    if (Math.hypot(vx, vy) <= GLIDE_STOP_SPEED) { setGliding(false); return; }
    setGliding(true);
    // The only React update of the coast: once, when it comes to rest (is-panning off).
    const endGlide = (): void => setGliding(false);
    // The coast only moves the wall's one transform (place → layer.style),
    // time-based: a frame's step comes from rAF timestamps, so a dropped frame
    // does not slow the wall down and catch up later. The first frame takes a
    // nominal 16ms — its timestamp can predate the release.
    let last = -1;
    const step = (now: number) => {
      const next = glideStep(vx, vy, last < 0 ? 16 : now - last);
      last = now;
      vx = next.vx;
      vy = next.vy;
      panBy(next.dx, next.dy);
      markMoving();
      if (Math.hypot(vx, vy) > GLIDE_STOP_SPEED) {
        frames.current.glide = requestAnimationFrame(step);
      } else {
        frames.current.glide = 0;
        endGlide();
      }
    };
    frames.current.glide = requestAnimationFrame(step);
  };

  const onHover = useCallback((key: string | null) => {
    if (!drag.current?.moved && !moving.current.on) setHovered(key);
  }, []);
  const onToggle = useCallback((key: string) => setOpened(value => (value === key ? null : key)), []);
  const onIntro = useCallback((worldId: string) => { setOpened(null); setIntroId(worldId); }, []);
  const chooseCategory = useCallback((next: string) => {
    writeLobbyCategory(next);
    setCategory(next);
    setOpened(null);
    // A new wall reads from its start again: 「＋ 新建」 top-left, then the filtered order.
    stopMotion();
    pan.current = startPan(geometry);
    place();
  }, [geometry, place, stopMotion]);
  // An opened brick comes fully into view, below the top bar: on a phone a brick half off an edge kept its
  // 「开始新游戏」 off screen (smoke test 2026-10-05).
  useEffect(() => {
    if (!opened) return;
    const frame = requestAnimationFrame(() => {
      const tile = layer.current?.querySelector<HTMLElement>(`[data-brick="${opened}"]`);
      const view = stage.current?.getBoundingClientRect();
      if (!tile || !view || !pan.current) return;
      const box = tile.getBoundingClientRect();
      const bar = root.current?.querySelector('.world-launcher__top')?.getBoundingClientRect();
      const margin = 12;
      const dx = revealDelta(box.left, box.right, view.left + margin, view.right - margin);
      const dy = revealDelta(box.top, box.bottom, Math.max(view.top, bar?.bottom ?? view.top) + margin, view.bottom - margin);
      if (!dx && !dy) return;
      stopMotion();
      panBy(dx, dy);
    });
    return () => cancelAnimationFrame(frame);
  }, [opened, panBy, stopMotion]);
  const load = useCallback((path: string) => loadRef.current(path), []);
  const createRef = useRef(onCreate);
  createRef.current = onCreate;
  const publishRef = useRef(onPublish);
  publishRef.current = onPublish;
  const create = useCallback(() => createRef.current(), []);
  // 公告 / 社区 (components/CommunityBoard.tsx): 「Open world」 brings that world's brick to the middle and opens it.
  const openWorldByKey = useCallback((key: string) => {
    const matches = (world: ShelfGroup) => !isNewWorldBrick(world) && (worldKeyOf(world) === key || world.id === key);
    let list = worlds;
    let index = list.findIndex(matches);
    // Outside the current filter: show everything, then find it there.
    if (index < 0) { list = allWorlds; index = list.findIndex(matches); if (index >= 0) { writeLobbyCategory(ALL_CATEGORIES); setCategory(ALL_CATEGORIES); } }
    if (index < 0) return false;
    stopMotion();
    pan.current = { x: index * cellW + geometry.w / 2 - size.w / 2, y: geometry.h / 2 - size.h / 2 };
    place();
    if (opensIntroCard(list[index])) setIntroId(list[index].id);
    else setOpened(`${index}:0`);
    return true;
  }, [worlds, allWorlds, cellW, geometry, size, place, stopMotion]);
  const worldNameOf = useCallback((key: string) => {
    const world = allWorlds.find(w => !isNewWorldBrick(w) && (worldKeyOf(w) === key || w.id === key));
    return world ? worldTitle(world.name) : null;
  }, [allWorlds]);
  const publish = useCallback((editPath: string, next: boolean) => publishRef.current(editPath, next), []);
  const keepInCloudRef = useRef(onKeepInCloud);
  keepInCloudRef.current = onKeepInCloud;
  const keepBothRef = useRef(onKeepBoth);
  keepBothRef.current = onKeepBoth;
  const keepInCloud = useCallback((editPath: string) => keepInCloudRef.current?.(editPath), []);
  const keepBoth = useCallback((editPath: string) => keepBothRef.current?.(editPath), []);

  // Covers: each downscaled once to what a brick can show, shared by every
  // brick of that world; the original URL stands in until the copy is ready.
  const brickWidth = geometry.w;
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(() => new Map());
  useEffect(() => {
    let live = true;
    const dpr = window.devicePixelRatio || 1;
    for (const world of worlds) {
      if (!world.cover) continue;
      const original = withBase(world.cover);
      void coverThumbUrl(original, brickWidth, dpr).then(url => {
        if (!live || url === original) return;
        setThumbs(previous => (previous.get(original) === url ? previous : new Map(previous).set(original, url)));
      });
    }
    return () => { live = false; };
  }, [worlds, brickWidth]);
  const coverOf = (world: ShelfGroup) => {
    const original = withBase(world.cover);
    return thumbs.get(original) ?? original;
  };

  // The glow behind the wall: a pre-blurred static bitmap (never a live CSS blur).
  const ambientCovers = useMemo(() => worlds.filter(world => world.cover).map(world => withBase(world.cover)), [worlds]);
  const ambientColumns = Math.max(1, worlds.length - 1);
  const ambientRadius = performanceSettings.backdropBlur === 'off' ? 0 : performanceSettings.backdropBlur === 'reduced' ? AMBIENT_LOOK.reducedRadius : AMBIENT_LOOK.radius;
  const [ambient, setAmbient] = useState<{ url: string | null; ready: boolean }>({ url: null, ready: false });
  useEffect(() => {
    if (!ambientRadius) return;
    let live = true;
    void ambientBackdropUrl(ambientCovers, ambientColumns, window.innerWidth, window.innerHeight, ambientRadius).then(url => {
      if (live && url) setAmbient(previous => (previous.url === url ? previous : { url, ready: previous.ready }));
    });
    return () => { live = false; };
  }, [ambientCovers, ambientColumns, ambientRadius, size.w, size.h]);

  const introWorld = introId ? allWorlds.find(world => world.id === introId) ?? null : null;
  const closeIntro = useCallback(() => setIntroId(null), []);

  const bricks = useMemo(
    () => visibleBricks(anchor.x, anchor.y, size.w + cellW, size.h + cellH, geometry, 1),
    [anchor, size, geometry, cellW, cellH],
  );
  // Videos play only near the centre of the view: decoding one per brick would stall the wall.
  // While panning, freeze playback and keep the simplified paint stack through
  // both the drag and its glide so newly exposed tile bands stay inexpensive.
  const playing = useMemo(() => {
    // `hover`: no autoplay ring — only the card under the pointer / focus plays (below).
    if (!mediaAllowed || panning || performanceSettings.launcherVideo === 'hover') return PLAYING_NONE;
    const centreX = anchor.x + cellW / 2 + size.w / 2;
    const centreY = anchor.y + cellH / 2 + size.h / 2;
    const ranked = bricks
      .map(brick => ({ key: `${brick.col}:${brick.row}`, distance: Math.hypot(brick.left + geometry.w / 2 - centreX, brick.top + geometry.h / 2 - centreY) }))
      .sort((a, b) => a.distance - b.distance);
    return new Set(ranked.slice(0, PLAYING_BRICKS).map(entry => entry.key));
  }, [anchor, bricks, cellW, cellH, geometry, size, mediaAllowed, panning, performanceSettings.launcherVideo]);

  return (
    <div
      ref={root}
      className={`world-launcher${dragging ? ' is-dragging' : ''}${panning ? ' is-panning' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('World launcher')}
      aria-hidden={performanceSettingsOpen || undefined}
      inert={performanceSettingsOpen || undefined}
      onPointerMove={onPointerMove}
      onPointerLeave={() => { pointerAt.current = null; lean(0, 0); }}
    >
      <div className="world-launcher__ambient" aria-hidden="true">
        {ambientRadius > 0 && ambient.url && (
          <img
            className={`world-launcher__ambient-image${ambient.ready ? ' is-ready' : ''}`}
            src={ambient.url}
            alt=""
            decoding="async"
            draggable={false}
            onLoad={() => setAmbient(previous => (previous.ready ? previous : { ...previous, ready: true }))}
          />
        )}
      </div>
      <header className="world-launcher__top">
        <span className="world-launcher__brand">World<span>lines</span></span>
        <div className="world-launcher__langs" role="group" aria-label={t('Language')}>
          {LANGUAGES.map(([code, label]) => (
            <button key={code} type="button" aria-pressed={locale === code} onClick={() => setLocale(code)}>{label}</button>
          ))}
        </div>
        <nav aria-label={t('World launcher')}>
          <LauncherNotices onOpenWorld={openWorldByKey} worldName={worldNameOf} />
          <ContactPanel focus={focus} variant="launcher" />
          <AccountPanel variant="launcher" focus={focus} />
          <button type="button" className="world-launcher__pill" aria-expanded={shelfOpen ?? false} data-testid="world-shelf-toggle" onClick={onManageSaves}>{t('Saved games')}</button>
          <PerformanceSettingsTrigger variant="launcher" open={performanceSettingsOpen} onOpen={onOpenPerformanceSettings} />
          {onClose && <button type="button" className="world-launcher__pill" onClick={requestClose}>{t('Continue this story')}</button>}
        </nav>
      </header>
      {chips.length > 1 && (
        <section className="world-launcher__kinds" aria-label={t('Kinds of world')} data-testid="world-categories">
          {/* What the three kinds mean, so the chips below are not just names. */}
          <ul className="world-launcher__explain">
            {WORLD_CATEGORIES.map(entry => (
              <li key={entry.id} className={`is-${entry.id}`}><b>{entry.label[categoryLocale]}</b><span>{entry.line[categoryLocale]}</span></li>
            ))}
          </ul>
          <div className="world-launcher__chips" role="group" aria-label={t('Kinds of world')}>
            {chips.map(chip => (
              <button key={chip.id} type="button" className={`world-launcher__chip is-${chip.id}`} aria-pressed={shownCategory === chip.id} data-category={chip.id} title={chip.id === ALL_CATEGORIES ? undefined : worldCategoryOf(chip.id)?.line[categoryLocale]} onClick={() => chooseCategory(chip.id)}>
                {chip.id === ALL_CATEGORIES ? t('All') : worldCategoryOf(chip.id)!.label[categoryLocale]}
                <span className="world-launcher__count">{chip.count}</span>
              </button>
            ))}
          </div>
          {/* Where the three sentences do not fit on one line (narrow / short windows, world-launcher.css), the chosen
              kind's sentence alone, one line. */}
          {shownCategory !== ALL_CATEGORIES && worldCategoryOf(shownCategory) && (
            <p className="world-launcher__line">{worldCategoryOf(shownCategory)!.line[categoryLocale]}</p>
          )}
        </section>
      )}
      <div
        ref={stage}
        className="world-launcher__stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={event => {
          if (!suppressClick.current) return;
          event.stopPropagation();
          event.preventDefault();
        }}
      >
        <div className="world-launcher__tilt">
          <div ref={layer} className="world-launcher__layer">
            {worlds.length > 0 && bricks.map(brick => {
              const index = brickWorld(brick.col, brick.row, worlds.length);
              const key = `${brick.col}:${brick.row}`;
              return (
                <Brick
                  key={key}
                  brickKey={key}
                  world={worlds[index]}
                  index={index}
                  left={brick.left}
                  top={brick.top}
                  width={geometry.w}
                  height={geometry.h}
                  active={active === key}
                  open={opened === key}
                  cover={coverOf(worlds[index])}
                  playing={mediaAllowed && (active === key || (performanceSettings.launcherVideo === 'autoplay' && playing.has(key)))}
                  loading={loading}
                  publishing={publishing}
                  social={socials.get(worlds[index].id) ?? null}
                  t={t}
                  locale={locale}
                  onHover={onHover}
                  onToggle={onToggle}
                  onIntro={onIntro}
                  onLoad={load}
                  onCreate={create}
                  onPublish={publish}
                  guestMark={guestTileMark(worlds[index], guestMode)}
                  onKeepInCloud={keepInCloud}
                  onKeepBoth={keepBoth}
                />
              );
            })}
          </div>
        </div>
      </div>
      {introWorld && (
        <WorldIntroCard
          world={introWorld}
          cover={withBase(introWorld.cover)}
          social={socials.get(introWorld.id) ?? null}
          loading={loading}
          t={t}
          locale={locale}
          focus={focus}
          onStart={load}
          onContinue={load}
          onClose={closeIntro}
          prologue={prologueReplayFor(introWorld.id, shelf.groups ?? [])}
        />
      )}
      <p className="world-launcher__hint" aria-hidden="true">{t('Drag or scroll to wander')}</p>
      {LAUNCHER_CREDIT && <p className="world-launcher__credit">{LAUNCHER_CREDIT}</p>}
    </div>
  );
}
