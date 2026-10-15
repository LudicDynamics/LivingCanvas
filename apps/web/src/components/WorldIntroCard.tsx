/**
 * WorldIntroCard — the lobby's "what is this world" card.
 * A click on a brick opens it BEFORE anything loads: the cover, a one-line
 * hook, genres, what you do here, play time, difficulty, mechanics, who you
 * meet, how many endings, who it suits, the rule system, the languages, and
 * how finished the world is. 「开始游戏」 starts a new game (the launcher's
 * `onLoad`, which App tracks as `world_enter`); a save in progress can be
 * continued from here too. A centred card on wide screens, a bottom sheet on
 * phones (world-intro-card.css).
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { worldCategoryOf } from '@airp/shared/themes';
import type { ShelfIntro } from '../lib/airp-gateway.js';
import type { FocusCoordinator } from '../lib/focus-coordinator.js';
import { editionLabel, worldTitle, type ShelfGroup } from '../lib/world-launcher.js';
import { WorldSocialRow, progressLine, type BrickSocial } from './WorldSocial.js';
import { localized } from '../lib/announcements.js';
import { useWorldLogs, type WorldLog } from '../lib/world-logs.js';
import { plainText } from '../lib/mini-markdown.js';
import './world-intro-card.css';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Every label the card can show, as literal `t()` calls (check:i18n reads them). */
export function introLabels(t: Translate) {
  return {
    status: {
      playable: t('Playable'),
      'in-development': t('In development'),
      experimental: t('Experimental'),
    } as Record<string, string>,
    genre: {
      mystery: t('Detective'),
      horror: t('Horror'),
      romance: t('Romance'),
      fantasy: t('Fantasy'),
      'time-travel': t('Time travel'),
      'slice-of-life': t('Slice of life'),
      historical: t('Historical'),
      adventure: t('Adventure'),
    } as Record<string, string>,
    difficulty: {
      intro: t('Beginner'),
      standard: t('Standard'),
      hardcore: t('Hardcore'),
    } as Record<string, string>,
    rules: {
      coc: t('CoC rules'),
      dnd: t('D&D rules'),
      none: t('No rules'),
    } as Record<string, string>,
  };
}

type CardLocale = 'en' | 'zh-CN' | 'ja' | 'ko';
const cardLocale = (locale: string | undefined): CardLocale => (locale === 'zh-CN' || locale === 'ja' || locale === 'ko' ? locale : 'en');

/**
 * What kind of world this is, the same marks on a
 * brick and on the card: the category (跑团世界 / 剧情世界 / 自由世界, from the
 * one table WORLD_CATEGORIES), 「实验」 for a world trying a new kind of play,
 * and a small 「制作中」 where the author says something is unfinished.
 */
export function WorldMarks({ world, t, locale, className }: { world: ShelfGroup; t: Translate; locale?: string; className: string }) {
  const category = worldCategoryOf(world.category);
  const experimental = world.intro?.experimental === true;
  const unfinished = Boolean(world.intro?.unfinished);
  if (!category && !experimental && !unfinished) return null;
  return (
    <>
      {category && <span className={`${className} is-${category.id}`} data-testid="world-category">{category.label[cardLocale(locale)]}</span>}
      {experimental && <span className={`${className} is-experimental`}>{t('Experimental')}</span>}
      {unfinished && <span className={`${className} is-unfinished`}>{t('Work in progress')}</span>}
    </>
  );
}

/** A mechanic's glyph and label; `endings` reads its count. */
export function mechanicLabel(t: Translate, mechanic: string, endings: number): { icon: string; label: string } | null {
  switch (mechanic) {
    case 'dice': return { icon: '⚄', label: t('Dice checks') };
    case 'clock': return { icon: '◷', label: t('Time limit') };
    case 'endings': return { icon: '◇', label: t('Multiple endings · {count}', { count: endings }) };
    case 'sanity': return { icon: '☾', label: t('Sanity') };
    case 'voice': return { icon: '♪', label: t('Voiced characters') };
    case 'live-image': return { icon: '✦', label: t('Live-generated scenes') };
    case 'growth': return { icon: '↗', label: t('Character growth') };
    case 'free-explore': return { icon: '∞', label: t('Free exploration · no fixed ending') };
    default: return null;
  }
}

/** "30–45 min", in the interface language. */
export function playTime(t: Translate, minutes: [number, number] | null): string | null {
  if (!minutes) return null;
  const [from, to] = minutes;
  return from === to ? t('{count} min', { count: from }) : t('{from}–{to} min', { from, to });
}

const initialOf = (name: string) => Array.from(name.trim())[0] ?? '?';

/** 「更新记录」: the world's latest published logs (platform/log, surface world), title + a short body, newest first. */
export function WorldUpdates({ logs, t, locale }: { logs: readonly WorldLog[]; t: Translate; locale?: string }) {
  if (!logs.length) return null;
  const lang = locale ?? 'en';
  const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric' }); };
  return (
    <section className="world-intro-card__updates" data-testid="world-updates">
      <h3>{t('Update log')}</h3>
      <ol>
        {logs.slice(0, 3).map(l => {
          const body = plainText(localized(l.body, lang)); // a preview: the markup's words, no markup
          return (
            <li key={l.id}>
              <time dateTime={l.publishedAt}>{day(l.publishedAt)}</time>
              <b>{localized(l.title, lang)}</b>
              {body && <p>{body.length > 160 ? `${[...body].slice(0, 160).join('')}…` : body}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A cast member's portrait; the name's initial when there is none or it does not load. */
function Portrait({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed
    ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
    : <span className="world-intro-card__initial" aria-hidden="true">{initialOf(name)}</span>;
}

export function WorldIntroCard({ world, cover, social, loading, t, locale, focus, onStart, onContinue, onClose, prologue = null }: {
  world: ShelfGroup;
  /** Interface language, for the category's own label and line. */
  locale?: string;
  cover: string;
  social: BrickSocial | null;
  /** Path being opened, if any. */
  loading: string | null;
  t: Translate;
  focus?: FocusCoordinator;
  onStart: (path: string) => void;
  onContinue: (path: string) => void;
  onClose: () => void;
  /** 「5 分钟序章」: this world's short prologue to (re)play (the full 末班车's card, the design notes). */
  prologue?: string | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Escape and the focus trap go through the coordinator, above the launcher (400).
  useEffect(() => {
    if (!focus) return;
    const lease = focus.registerSurface({ key: 'world-intro-card', owner: 'workspace', priority: 410, root: root.current, close: () => closeRef.current() });
    return () => lease.unregister();
  }, [focus]);
  useEffect(() => { start.current?.focus({ preventScroll: true }); }, []);

  const labels = introLabels(t);
  const intro: ShelfIntro | undefined = world.intro;
  const title = worldTitle(world.name);
  const latest = world.saves[0];
  const busy = loading !== null;
  const status = intro?.status ?? null;
  const category = worldCategoryOf(world.category);
  const time = playTime(t, intro?.minutes ?? null);
  const mechanics = (intro?.mechanics ?? []).map(m => mechanicLabel(t, m, intro?.endings ?? 0)).filter((m): m is NonNullable<typeof m> => m !== null);
  const languages = world.languages?.length ? world.languages : world.locale ? [world.locale] : [];
  const progress = latest && social?.here ? progressLine(social.here, t) : null;
  const updates = useWorldLogs(world.id);

  // Portalled to <body>: the launcher is its own stacking context, and the save
  // manager (opened beside it, sometimes on its own) must not cover the card.
  const card = (
    <div
      ref={root}
      className="world-intro-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="world-intro-card-title"
      data-testid="world-intro-card"
      onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <article className={`world-intro-card__panel${status ? ` is-${status}` : ''}`}>
        <header className="world-intro-card__hero">
          <img src={cover} alt="" draggable={false} />
          {intro?.recommended && <span className="world-intro-card__ribbon">{t('Recommended for beginners')}</span>}
          <button type="button" className="world-intro-card__close" aria-label={t('Close')} onClick={onClose}>×</button>
          <div className="world-intro-card__heading">
            <span className="world-intro-card__marks"><WorldMarks world={world} t={t} locale={locale} className="world-intro-card__status" /></span>
            <h2 id="world-intro-card-title">{title}</h2>
            {intro?.hook && <p className="world-intro-card__hook">{intro.hook}</p>}
          </div>
        </header>

        <div className="world-intro-card__body">
          <ul className="world-intro-card__facts" aria-label={t('At a glance')}>
            {intro?.genres.map(genre => <li key={genre} className="is-genre">{labels.genre[genre] ?? genre}</li>)}
            {time && <li>{t('Play time')} · {time}</li>}
            {intro?.difficulty && <li>{t('Difficulty')} · {labels.difficulty[intro.difficulty]}</li>}
            <li>{labels.rules[intro?.rules ?? 'none']}</li>
            <li>{t('Endings')} · {intro?.endings ? intro.endings : t('No fixed ending')}</li>
            {languages.length > 0 && <li>{languages.map(editionLabel).join(' / ')}</li>}
          </ul>

          {category && <p className="world-intro-card__category"><b>{category.label[cardLocale(locale)]}</b>{category.line[cardLocale(locale)]}</p>}

          {intro?.unfinished && (
            <p className="world-intro-card__unfinished" role="note">{intro.unfinished}</p>
          )}

          {intro?.loop.length ? (
            <section>
              <h3>{t('What you do here')}</h3>
              <ol className="world-intro-card__loop">{intro.loop.map((line, i) => <li key={i}>{line}</li>)}</ol>
            </section>
          ) : !intro?.hook && world.description ? <p className="world-intro-card__hook">{world.description}</p> : null}

          {mechanics.length > 0 && (
            <ul className="world-intro-card__mechanics" aria-label={t('Mechanics')}>
              {mechanics.map(m => <li key={m.label}><span aria-hidden="true">{m.icon}</span>{m.label}</li>)}
            </ul>
          )}

          {/* Character tick: marked 「制作中」 while it is being tuned. */}
          {intro?.characterTick && (
            <p className="world-intro-card__unfinished world-intro-card__tick" data-testid="world-intro-tick">
              <b>{t('Character turns')}{intro.characterTick.wip ? ` · ${t('Work in progress')}` : ''}</b>
              {t('People on the page act every few moves; you can get there first, watch them or interrupt.')}
            </p>
          )}

          {intro?.characters.length ? (
            <section>
              <h3>{t('Who you meet')}</h3>
              <ul className="world-intro-card__cast">
                {intro.characters.map(c => (
                  <li key={c.name}>
                    <Portrait src={c.avatar} name={c.name} />
                    <span><b>{c.name}</b>{c.line && <small>{c.line}</small>}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {intro?.for.length ? (
            <p className="world-intro-card__for"><span>{t('Good for')}</span>{intro.for.map(x => <em key={x}>{x}</em>)}</p>
          ) : null}

          <WorldUpdates logs={updates} t={t} locale={locale} />

          {social && <div className="world-launcher__actions world-intro-card__social"><WorldSocialRow social={social} t={t} /></div>}
        </div>

        <footer className="world-intro-card__actions">
          {progress && <small>{progress}</small>}
          {prologue && (
            <button type="button" className="world-intro-card__prologue" data-testid="world-intro-prologue" disabled={busy} onClick={() => onStart(prologue)}>
              {t('5-minute prologue')}{loading === prologue ? t(' · opening…') : ''}
            </button>
          )}
          {latest && (
            <button type="button" disabled={busy} onClick={() => onContinue(latest.path)}>
              {t('Continue latest save')}{loading === latest.path ? t(' · opening…') : ''}
            </button>
          )}
          {world.templatePath && (
            <button ref={start} type="button" className="world-intro-card__start" data-testid="world-intro-start" disabled={busy} onClick={() => onStart(world.templatePath!)}>
              {latest ? t('Start a new game') : t('Start game')}{loading === world.templatePath ? t(' · opening…') : ''}
            </button>
          )}
        </footer>
      </article>
    </div>
  );
  return typeof document === 'undefined' ? card : createPortal(card, document.body);
}
