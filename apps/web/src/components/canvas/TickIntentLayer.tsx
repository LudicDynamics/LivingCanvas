/**
 * Character tick on the page: an intent you can see coming.
 *
 * When the engine shows an intent on this page, the acting person's pointer
 * leaves their portrait on a curve and STOPS on the target — a door, a card, a
 * person — while a ring tightens around it, with the move's icon and a name tag
 * (「罗斯 → 书房的门」). The icon opens the counters this move allows:
 * 「盯住」 (spends a beat), go through that door first, take it first, call them
 * over to talk. One beat later it lands (a ripple, the card changes, the event
 * card) or is stopped (the pointer pulls back, a 「…」).
 *
 * Honest by construction:
 *  - nothing here decides anything: the server's view (lib/tick/store.ts) is the
 *    truth; this layer only draws it and reports `seen` once it really drew it
 *    (a hidden tab draws nothing, so the window does not run);
 *  - it is drawn whether or not 「世界小动作」 is on (an intent is a world fact
 *    in the making, not decoration); the ambient twin of the acting person's
 *    pointer steps aside while it shows;
 *  - phones get a dot beside the target instead of a pointer; reduced motion
 *    gets no glide and a still ring.
 *
 * One component over a small geometry adapter, like AmbientLayer: the picture
 * map's pin stage and the canvas's world layer each host it.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '../../lib/i18n.js';
import { useStill } from '../../lib/motion.js';
import { characterHue } from '../../lib/ambient/hue.js';
import { glidePath, type Point } from '../../lib/ambient/motion.js';
import { guardIntent, reportSeen, requestTickCounter, setTickSpeaking, useTickView } from '../../lib/tick/store.js';
import type { TickEntryView, TickIntentView } from '@airp/shared/tick';
import type { MapPin } from '../../lib/board-model.js';
import type { LayerItem } from '../../state/useWorld.js';
import type { CharacterPresenceView } from '../../lib/presence.js';
import type { CameraApi } from '../../state/useCamera.js';
import './tick-layer.css';

export interface TickBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where things are, in the host's own px. */
export interface TickSpace {
  /** A target's box: a door, a card, a person. */
  box(target: string): TickBox | null;
  /** Where the acting person's pointer rests (beside their portrait / pin). */
  home(actor: string, card: string): Point | null;
}

/** The move's icon (§4.1): one glyph per verb, the same for culprit and innocent. */
export const TICK_VERB_GLYPH: Readonly<Record<string, string>> = Object.freeze({
  approach: '👣',
  take: '✋',
  hide: '🫥',
  shift: '↔',
  flip: '⟲',
  mark: '✎',
  lock: '🔒',
  unlock: '🔓',
  note: '📝',
  talk: '💬',
  advance: '➜',
  speak: '💬',
  invite: '🙋',
});

/** v2 moods (rules/tick-model.ts TICK_MOODS). */
const MOOD_GLYPH: Readonly<Record<string, string>> = Object.freeze({ dots: '…', question: '?', exclaim: '!', sigh: '～', sweat: '💧' });

/** How long a person's own line (✎) stays up. */
const SAID_MS = 6500;

/** How long a landed / stopped move stays on stage. */
const RESULT_MS = 2600;

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

function usePageVisible(): boolean {
  const [visible, setVisible] = React.useState(() => typeof document === 'undefined' || !document.hidden);
  React.useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

interface Stage {
  /** What is on stage: the intent itself, or the moment it resolved. */
  phase: 'intent' | 'landed' | 'stopped';
  id: string;
  actor: string;
  name: string;
  card: string;
  verb: string;
  target: string;
  label: string;
  counter: string[];
  text?: string;
  /** v2: the person's own line with this intent (a claim). */
  say?: string;
  mood?: string;
}

const stageOfIntent = (p: TickIntentView): Stage => ({ phase: 'intent', id: p.id, actor: p.actor, name: p.name, card: p.card, verb: p.verb, target: p.target, label: p.label, counter: p.counter, ...(p.words?.say ? { say: p.words.say } : {}), ...(p.words?.mood ? { mood: p.words.mood } : {}) });

/** v2: a line said unprompted, or a note left. */
interface Said {
  id: string;
  actor: string;
  name: string;
  card: string;
  verb: string;
  text: string;
  mood?: string;
}

/** The engine: reads the view, draws the intent for `layer`, reports `seen`. */
export const TickIntentLife: React.FC<{ space: TickSpace; layer: string; surface: 'map' | 'canvas' }> = ({ space, layer, surface }) => {
  const view = useTickView();
  const still = useStill();
  const compact = useCompact();
  const visible = usePageVisible();
  const { t } = useLocale();
  const [stage, setStage] = React.useState<Stage | null>(null);
  const [menu, setMenu] = React.useState(false);
  /** Where the counter menu opens (viewport px): portalled, so a transformed map never clips it. */
  const [menuAt, setMenuAt] = React.useState<{ left: number; top: number } | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = React.useState(false);
  const cursorRef = React.useRef<HTMLDivElement | null>(null);
  const lastIntent = React.useRef<Stage | null>(null);
  const shownResult = React.useRef<string | null>(null);
  const [said, setSaid] = React.useState<Said | null>(null);
  const shownSaid = React.useRef<string | null>(null);
  const [dismissedInvite, setDismissedInvite] = React.useState<string | null>(null);

  const pending = view.enabled && view.pending && view.pending.page === layer ? view.pending : null;

  // What is on stage follows the view: a new intent, or the resolution of the one we showed.
  React.useEffect(() => {
    if (pending) {
      const next = stageOfIntent(pending);
      lastIntent.current = next;
      setStage((cur) => (cur && cur.phase === 'intent' && cur.id === next.id ? cur : next));
      return;
    }
    const shown = lastIntent.current;
    const done: TickEntryView | undefined = shown ? view.recent.find((e) => e.id === shown.id) : undefined;
    if (shown && done && shownResult.current !== done.id) {
      shownResult.current = done.id;
      setMenu(false);
      if (done.result === 'void') {
        setStage(null);
        return;
      }
      setStage({ ...shown, phase: done.result === 'landed' ? 'landed' : 'stopped', text: done.text });
      return;
    }
    if (!shown || !done) setStage((cur) => (cur && cur.phase === 'intent' ? null : cur));
  }, [pending?.id, view.recent, layer]); // eslint-disable-line react-hooks/exhaustive-deps

  // A landed / stopped moment stays a little, then the stage clears.
  React.useEffect(() => {
    if (!stage || stage.phase === 'intent') return;
    const id = stage.id;
    const timer = window.setTimeout(() => setStage((cur) => (cur && cur.id === id && cur.phase !== 'intent' ? null : cur)), RESULT_MS);
    return () => window.clearTimeout(timer);
  }, [stage?.id, stage?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // v2: a chatter line that just happened on this page (✎ bubble beside the person), once per line.
  React.useEffect(() => {
    if (!view.enabled) return;
    const last = [...view.recent].reverse().find((e) => e.chatter && e.page === layer);
    if (!last || shownSaid.current === last.id || view.beat - last.beat > 0) return;
    shownSaid.current = last.id;
    const w = last.words ?? {};
    const text = w.say ?? w.note?.body ?? '';
    if (!text || w.invite) return; // an invite has its own card
    setSaid({ id: last.id, actor: last.actor, name: last.name, card: last.card, verb: last.verb, text, ...(w.mood ? { mood: w.mood } : {}) });
  }, [view.recent, view.beat, view.enabled, layer]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!said) return;
    const id = said.id;
    const timer = window.setTimeout(() => setSaid((cur) => (cur && cur.id === id ? null : cur)), SAID_MS);
    return () => window.clearTimeout(timer);
  }, [said?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const invite = view.enabled && view.invite && view.invite.page === layer && view.invite.id !== dismissedInvite ? view.invite : null;

  // One bubble per person (§9 #7): whoever speaks here through the tick, their ambient bubbles wait.
  const speakers = [stage?.phase === 'intent' && stage.say ? stage.actor : null, said?.actor ?? null, invite?.actor ?? null].filter((x): x is string => !!x);
  const speakersKey = speakers.join('|');
  React.useEffect(() => {
    setTickSpeaking(speakersKey ? speakersKey.split('|') : []);
  }, [speakersKey]);
  React.useEffect(() => () => setTickSpeaking([]), []);

    const box = stage ? space.box(stage.target) : null;
  const home = stage ? space.home(stage.actor, stage.card) : null;

  // The pointer: from the portrait to the target on a hand-like curve; back home when stopped.
  React.useLayoutEffect(() => {
    const el = cursorRef.current;
    if (!el || !stage || !box) return;
    const aim = { x: box.x + box.w * 0.62, y: box.y + box.h * 0.55 };
    const from = home ?? aim;
    const to = stage.phase === 'stopped' ? from : aim;
    const start = stage.phase === 'stopped' ? aim : from;
    if (still || compact || typeof el.animate !== 'function') {
      el.style.transform = `translate3d(${to.x}px, ${to.y}px, 0)`;
      return;
    }
    if (stage.phase === 'landed') {
      el.style.transform = `translate3d(${aim.x}px, ${aim.y}px, 0)`;
      return;
    }
    const plan = glidePath(start, to, Math.random);
    el.getAnimations?.().forEach((a) => a.cancel());
    const anim = el.animate(plan.frames.map((f) => ({ transform: `translate3d(${f.x}px, ${f.y}px, 0)`, offset: f.offset })), { duration: plan.durationMs, easing: 'linear', fill: 'forwards' });
    anim.onfinish = () => {
      el.style.transform = `translate3d(${to.x}px, ${to.y}px, 0)`;
      anim.cancel();
    };
  }, [stage?.id, stage?.phase, box?.x, box?.y, home?.x, home?.y, still, compact]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seen: only once it is really on screen — drawn, the tab visible, the marker inside the viewport
  // (a target panned off a phone's map is not seen yet). The window starts there.
  const markerRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (!pending || pending.seen || !visible || !box) return;
    const id = pending.id;
    const onScreen = () => {
      const r = markerRef.current?.getBoundingClientRect();
      return !!r && r.width > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
    };
    let first = true;
    const timer = window.setInterval(() => {
      // One beat of looking first (the pointer is still travelling).
      if (first) { first = false; return; }
      if (!document.hidden && onScreen()) {
        window.clearInterval(timer);
        void reportSeen(id);
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [pending?.id, pending?.seen, visible, Boolean(box)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close the counter menu on Escape or a press elsewhere.
  React.useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
    const onDown = (e: PointerEvent) => {
      const node = e.target as Node | null;
      if (node && (menuRef.current?.contains(node) || (node as Element).closest?.('.tick-marker__icon'))) return;
      setMenu(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [menu]);

  const touched = view.enabled ? view.touched.filter((m) => space.box(m.target)) : [];

  if (!view.enabled || (!stage && touched.length === 0 && !said && !invite)) return null;
  // Phones: a person's line / invite docks above the input (portalled), never off the edge of a small map.
  const saidHome = said ? space.home(said.actor, said.card) : null;
  const inviteHome = invite ? space.home(invite.actor, invite.card) : null;
  const saidBody = said && (
    <div className="tick-said__body">
      <span className="tick-said__who">
        <span className="tick-say__mark" aria-hidden>✎</span>
        {said.verb === 'note' ? t('{name} left a note', { name: said.name }) : t('{name} says', { name: said.name })}
        {said.mood && <span className="tick-say__mood" aria-hidden>{MOOD_GLYPH[said.mood] ?? ''}</span>}
      </span>
      <span className="tick-said__text">{said.text}</span>
    </div>
  );
  const inviteBody = invite && (
    <div className="tick-invite__body" onPointerDown={(e) => e.stopPropagation()}>
      <p className="tick-invite__title">
        <span className="tick-say__mark" aria-hidden>✎</span>
        {t('{name} wants a word with you', { name: invite.name })}
      </p>
      <p className="tick-invite__text">{invite.text}</p>
      <div className="tick-invite__actions">
        <button type="button" className="tick-invite__go" onClick={() => { setDismissedInvite(invite.id); requestTickCounter({ kind: 'talk', target: invite.card, actor: invite.card }); }}>
          {t('Hear them out')}
        </button>
        <button type="button" className="tick-invite__skip" onClick={() => setDismissedInvite(invite.id)}>
          {t('Not now')}
        </button>
      </div>
    </div>
  );

  const hue = stage ? characterHue(stage.actor) : undefined;
  const ringSize = box ? Math.max(box.w, box.h) + 26 : 0;
  const counters = stage?.phase === 'intent' ? stage.counter : [];
  const play = async (kind: string) => {
    if (!stage) return;
    setMenu(false);
    if (kind === 'guard') {
      setBusy(true);
      await guardIntent(stage.id, layer);
      setBusy(false);
      return;
    }
    requestTickCounter({ kind: kind as 'enter' | 'take' | 'talk', target: stage.target, actor: stage.card });
  };
  const counterLabel = (kind: string) => {
    if (kind === 'guard') return t('Watch it (spends a beat)');
    if (kind === 'enter') return t('Go through this door first');
    if (kind === 'take') return t('Take it first');
    return t('Call {name} over to talk', { name: stage?.name ?? '' });
  };

  return (
    <div className="tick-layer" data-surface={surface} data-still={still ? 'true' : 'false'} data-compact={compact ? 'true' : 'false'}>
      {touched.map((m) => {
        const b = space.box(m.target)!;
        return (
          <div
            key={`touched:${m.target}`}
            className="tick-touched"
            style={{ transform: `translate3d(${b.x + b.w / 2}px, ${b.y - 4}px, 0)`, '--tick-hue': characterHue(m.actor) } as React.CSSProperties}
            aria-hidden
          >
            <span className="tick-touched__inner">{t('Someone touched this')}</span>
          </div>
        );
      })}
      {stage && box && (
        <>
          <div
            key={`ring:${stage.id}`}
            className="tick-ring"
            data-phase={stage.phase}
            style={{ transform: `translate3d(${box.x + box.w / 2}px, ${box.y + box.h / 2}px, 0)`, '--tick-ring': `${ringSize}px`, '--tick-hue': hue } as React.CSSProperties}
            aria-hidden
          />
          <div
            ref={cursorRef}
            className="tick-cursor"
            data-phase={stage.phase}
            data-dot={compact ? 'true' : 'false'}
            data-tick-actor={stage.actor}
            style={{ '--tick-hue': hue } as React.CSSProperties}
            aria-hidden
          >
            <div className="tick-cursor__body">
              <svg className="tick-cursor__pointer" width="18" height="24" viewBox="0 0 22 30" aria-hidden>
                <path d="M1.5 1.5 L1.5 23 L7.2 17.6 L11 26.6 L14.8 25 L11.1 16.3 L19 16.3 Z" />
              </svg>
              <span className="tick-cursor__tag">{stage.phase === 'stopped' ? `${stage.name} …` : stage.label}</span>
              {stage.phase === 'intent' && stage.say && (
                <span className="tick-say" data-tick-say={stage.actor} title={t('{name} said this — their claim, not a fact', { name: stage.name })}>
                  <span className="tick-say__mark" aria-hidden>✎</span>
                  {stage.mood && <span className="tick-say__mood" aria-hidden>{MOOD_GLYPH[stage.mood] ?? ''}</span>}
                  {stage.say}
                </span>
              )}
              {stage.phase === 'landed' && <span className="tick-cursor__ripple" />}
            </div>
          </div>
          <div
            className="tick-marker"
            data-phase={stage.phase}
            style={{ transform: `translate3d(${box.x + box.w / 2 + ringSize / 2 - 4}px, ${box.y + box.h / 2 - ringSize / 2 - 4}px, 0)`, '--tick-hue': hue } as React.CSSProperties}
          >
            <div className="tick-marker__body">
              <button
                ref={markerRef}
                type="button"
                className="tick-marker__icon"
                aria-label={`${stage.label} · ${t('Character turn')}`}
                aria-expanded={stage.phase === 'intent' ? menu : undefined}
                disabled={stage.phase !== 'intent' || busy}
                data-tick-marker={stage.id}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  const w = Math.min(260, window.innerWidth - 16);
                  const right = r.right + 8 + w <= window.innerWidth - 8;
                  const left = right ? r.right + 8 : Math.max(8, Math.min(r.left - 8 - w, window.innerWidth - 8 - w));
                  const top = Math.max(8, Math.min(r.top, window.innerHeight - 320));
                  setMenuAt({ left, top });
                  setMenu((m) => !m);
                }}
              >
                <span aria-hidden>{TICK_VERB_GLYPH[stage.verb] ?? '•'}</span>
              </button>
              {stage.phase !== 'intent' && stage.text && !compact && (
                <p className="tick-marker__result" role="status">{stage.text}</p>
              )}
              {/* Phones: the outcome as a short toast across the bottom, never clipped by the map. */}
              {stage.phase !== 'intent' && stage.text && compact && typeof document !== 'undefined' && createPortal(
                <p className="tick-toast" role="status" style={{ '--tick-hue': hue } as React.CSSProperties}>{stage.text}</p>,
                document.body,
              )}
              {stage.phase === 'intent' && menu && menuAt && typeof document !== 'undefined' && createPortal(
                <div ref={menuRef} className="tick-menu" role="menu" style={{ left: menuAt.left, top: menuAt.top, '--tick-hue': hue } as React.CSSProperties} onPointerDown={(e) => e.stopPropagation()}>
                  <p className="tick-menu__title">
                    <span>{t('{name} is about to act', { name: stage.name })}</span>
                    {view.wip && <span className="tick-menu__wip">{t('Work in progress')}</span>}
                  </p>
                  <p className="tick-menu__label">{stage.label}</p>
                  {counters.map((kind) => (
                    <button key={kind} type="button" role="menuitem" className="tick-menu__item" data-counter={kind} onClick={() => void play(kind)}>
                      {counterLabel(kind)}
                    </button>
                  ))}
                  <button type="button" role="menuitem" className="tick-menu__item tick-menu__item--quiet" onClick={() => setMenu(false)}>
                    {t('Let it be')}
                  </button>
                  <p className="tick-menu__hint">{t('If nobody stops it, it happens after your next move.')}</p>
                </div>,
                document.body,
              )}
            </div>
          </div>
        </>
      )}
      {said && (compact ? typeof document !== 'undefined' && createPortal(
        <div key={`said:${said.id}`} className="tick-said tick-said--dock" data-verb={said.verb} data-tick-said={said.actor} style={{ '--tick-hue': characterHue(said.actor) } as React.CSSProperties} role="status">
          {saidBody}
        </div>,
        document.body,
      ) : saidHome && (
        <div
          key={`said:${said.id}`}
          className="tick-said"
          data-verb={said.verb}
          data-tick-said={said.actor}
          style={{ transform: `translate3d(${saidHome.x}px, ${saidHome.y}px, 0)`, '--tick-hue': characterHue(said.actor) } as React.CSSProperties}
          role="status"
        >
          {saidBody}
        </div>
      ))}
      {invite && (compact ? typeof document !== 'undefined' && createPortal(
        <div key={`invite:${invite.id}`} className="tick-invite tick-invite--dock" data-tick-invite={invite.actor} style={{ '--tick-hue': characterHue(invite.actor) } as React.CSSProperties} role="dialog" aria-label={t('{name} wants a word with you', { name: invite.name })}>
          {inviteBody}
        </div>,
        document.body,
      ) : inviteHome && (
        <div
          key={`invite:${invite.id}`}
          className="tick-invite"
          data-tick-invite={invite.actor}
          style={{ transform: `translate3d(${inviteHome.x}px, ${inviteHome.y}px, 0)`, '--tick-hue': characterHue(invite.actor) } as React.CSSProperties}
          role="dialog"
          aria-label={t('{name} wants a word with you', { name: invite.name })}
        >
          {inviteBody}
        </div>
      ))}
    </div>
  );
};

// ---- picture-map host ------------------------------------------------------------

const DOOR_OF = (target: string) => target.replace(/\/+$/, '');

/** Inside PictureMap's pin stage (stage px; `--tick-scale` = 1 / zoom keeps things screen-sized). */
export const MapTickLayer: React.FC<{ pins: readonly MapPin[]; layerId: string; stageWidth: number; stageHeight: number; zoom: number }> = ({ pins, layerId, stageWidth, stageHeight, zoom }) => {
  const z = zoom || 1;
  const space = React.useMemo<TickSpace>(() => {
    const at = (pin: MapPin) => ({ x: pin.x * stageWidth, y: pin.y * stageHeight });
    const pinBox = (pin: MapPin): TickBox => {
      const p = at(pin);
      return { x: p.x - 20 / z, y: p.y - 20 / z, w: 40 / z, h: 40 / z };
    };
    const find = (target: string) => {
      const door = DOOR_OF(target);
      return pins.find((pin) => pin.id === target)
        ?? pins.find((pin) => pin.kind === 'place' && (pin.ref === door || pin.id === `${door}/README.md`))
        ?? (target.startsWith('characters/') ? pins.find((pin) => pin.kind === 'character' && pin.ref === target.split('/')[1]) : undefined);
    };
    return {
      box: (target) => {
        const pin = find(target);
        return pin ? pinBox(pin) : null;
      },
      home: (actor, card) => {
        const pin = pins.find((p) => p.id === card) ?? pins.find((p) => p.kind === 'character' && p.ref === actor);
        if (!pin) return null;
        const p = at(pin);
        return { x: p.x + 22 / z, y: p.y - 26 / z };
      },
    };
  }, [pins, stageWidth, stageHeight, z]);
  if (!stageWidth || !stageHeight) return null;
  return (
    <div className="tick-host tick-host--map" style={{ '--tick-scale': String(1 / z) } as React.CSSProperties}>
      <TickIntentLife key={layerId} space={space} layer={layerId} surface="map" />
    </div>
  );
};

// ---- canvas host -------------------------------------------------------------------

export const CanvasTickLayer: React.FC<{ camera: CameraApi; currentLayer: string; items: LayerItem[]; presence: readonly CharacterPresenceView[] }> = ({ camera, currentLayer, items, presence }) => {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => camera.subscribe((view) => {
    rootRef.current?.style.setProperty('--tick-scale', String(1 / (view.z || 1)));
  }), [camera]);
  const space = React.useMemo<TickSpace>(() => {
    const itemBox = (it: LayerItem): TickBox => ({ x: it.x, y: it.y, w: it.w || 220, h: Math.min(it.h || 160, 260) });
    const find = (target: string) => {
      const door = DOOR_OF(target);
      return items.find((it) => it.path === target) ?? items.find((it) => it.path === `${door}/README.md`);
    };
    return {
      box: (target) => {
        if (target.startsWith('characters/')) {
          const view = presence.find((p) => p.id === target.split('/')[1] && p.position);
          return view?.position ? { x: view.position.x - 30, y: view.position.y - 30, w: 60, h: 60 } : null;
        }
        const it = find(target);
        return it ? itemBox(it) : null;
      },
      home: (actor, card) => {
        const it = items.find((i) => i.path === card);
        if (it) return { x: it.x + (it.w || 220) * 0.82, y: it.y + 28 };
        const view = presence.find((p) => p.id === actor && p.position);
        return view?.position ? { x: view.position.x + 40, y: view.position.y + 34 } : null;
      },
    };
  }, [items, presence]);
  return (
    <div ref={rootRef} className="tick-host">
      <TickIntentLife key={currentLayer} space={space} layer={currentLayer} surface="canvas" />
    </div>
  );
};
