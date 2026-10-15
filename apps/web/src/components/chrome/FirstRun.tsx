/**
 * The first-run experience's own screens: the language confirm screen, the
 * prologue's 「⋯」 menu, and the reply chips above the companion's reply box (any world with `ui.replyChips`). The decisions live in
 * lib/first-run.ts; App.tsx owns the flow.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { buildInteractiveFields, visibleChoiceOptions } from '@airp/shared/frontmatter';
import { LOCALES, LOCALE_NAMES, useLocale, type Locale } from '../../lib/i18n.js';
import { openReportIssue } from '../../lib/report-issue.js';
import { useAudio } from '../../state/useAudio.js';
import { GATE_WHY, replyChipsOf, type ChipCard, type FirstRunGate } from '../../lib/first-run.js';
import { DeclaredChoiceHost, useDeclaredChoice, type DeclaredChoiceItem } from '../../lib/use-declared-choice.js';
import type { FocusCoordinator } from '../../lib/focus-coordinator.js';
import './first-run.css';

/**
 * Each language's own words on the language screen: the screen is read BEFORE a language is chosen, so every
 * button speaks its own language (not t()). The chosen language's words fill the two ways forward.
 */
const WORDS: Readonly<Record<Locale, { play: string; all: string; tagline: string }>> = {
  'zh-CN': { play: '直接试玩', all: '看看所有世界', tagline: '不用注册，5 分钟，先玩一段故事。' },
  ja: { play: 'すぐに遊ぶ', all: 'すべてのワールドを見る', tagline: '登録なし、5分。まずは物語をひとつ。' },
  ko: { play: '바로 플레이', all: '모든 월드 보기', tagline: '가입 없이, 5분. 먼저 이야기 하나.' },
  en: { play: 'Play now', all: 'See all worlds', tagline: 'No sign-up. Five minutes. Play a story first.' },
};
const SHORT: Readonly<Record<Locale, string>> = { 'zh-CN': '中文', ja: '日本語', ko: '한국어', en: 'English' };
const PICK_LINE = '选择语言 · 言語 · 언어 · Language';
/** Shown while the guest session and the prologue open (the chosen language's words). */
const OPENING: Readonly<Record<Locale, string>> = { 'zh-CN': '正在打开……', ja: '開いています…', ko: '여는 중…', en: 'Opening…' };

/**
 * ① the language screen: the four language buttons only SET the language
 * (the current one — English unless ?lang= / a stored pick — starts selected; the browser's language is only marked);
 * then two ways forward — the big 「直接试玩」 (straight into the prologue, no
 * cover or intro card; never the lobby, §9.5) and the smaller 「看看所有世界」 (the lobby).
 */
export function FirstRunLanguage({ locale, suggested = null, cover, busy, onLocale, onPlay, onAllWorlds }: {
  /** The language now (English until one is picked, or the `?lang=` / stored one). */
  locale: Locale;
  /**
   * The browser's languages suggest this one (lib/i18n.ts suggestedLocale; only when nothing was chosen): its button
   * is marked, nothing more — the interface stays in `locale` until a tap.
   */
  suggested?: Locale | null;
  /** The prologue's cover, darkened behind the screen (null: the plain backdrop). */
  cover: string | null;
  /** The prologue is opening: the buttons wait. */
  busy: boolean;
  onLocale(locale: Locale): void;
  onPlay(): void;
  onAllWorlds(): void;
}): React.ReactElement {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => { primary.current?.focus(); }, []);
  const words = WORDS[locale];
  return (
    <div className="first-run" role="dialog" aria-modal="true" aria-labelledby="first-run-brand" data-testid="first-run-language" lang={locale}>
      {cover && <img className="first-run__cover" src={cover} alt="" aria-hidden="true" decoding="async" draggable={false} />}
      <div className="first-run__scrim" aria-hidden="true" />
      <div className="first-run__panel">
        <h1 id="first-run-brand" className="first-run__brand">WORLDLINES <span>CANVAS</span></h1>
        <p className="first-run__pick">{PICK_LINE}</p>
        <div className="first-run__langs" role="radiogroup" aria-label={PICK_LINE}>
          {LOCALES.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={l === locale} lang={l} className={l === suggested && l !== locale ? 'first-run__lang first-run__lang--suggested' : 'first-run__lang'} data-locale={l} data-suggested={l === suggested ? 'true' : undefined} disabled={busy} onClick={() => onLocale(l)}>
              {SHORT[l]}
            </button>
          ))}
        </div>
        <button ref={primary} type="button" className="first-run__start" data-testid="first-run-play" disabled={busy} onClick={onPlay}>
          {busy ? OPENING[locale] : words.play}<span aria-hidden="true"> ▶</span>
        </button>
        <button type="button" className="first-run__all" data-testid="first-run-all-worlds-start" disabled={busy} onClick={onAllWorlds}>{words.all}</button>
        <p className="first-run__tagline">{words.tagline}</p>
      </div>
    </div>
  );
}

/** The prologue's only chrome besides the story (§3.1): language, mute, report a problem, see all worlds. */
export function FirstRunMenu({ onAllWorlds }: { onAllWorlds(): void }): React.ReactElement {
  const { t, locale, setLocale } = useLocale();
  const { muted, toggleMuted } = useAudio();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={root} className="first-run-menu" data-testid="first-run-menu">
      <button type="button" className="first-run-menu__toggle" aria-expanded={open} aria-label={t('More')} title={t('More')} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal size={20} aria-hidden="true" />
      </button>
      {open && (
        <div className="first-run-menu__sheet" role="menu">
          <label className="first-run-menu__row">
            <span>{t('Language')}</span>
            <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={t('Language')}>
              {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
            </select>
          </label>
          <button type="button" role="menuitem" className="first-run-menu__row" onClick={toggleMuted}>{t(muted ? 'Unmute sound' : 'Mute sound')}</button>
          <button type="button" role="menuitem" className="first-run-menu__row" data-testid="first-run-report" onClick={() => { setOpen(false); openReportIssue('stuck'); }}>{t('Report a problem')}</button>
          <button type="button" role="menuitem" className="first-run-menu__row" data-testid="first-run-all-worlds" onClick={() => { setOpen(false); onAllWorlds(); }}>{t('See all worlds')}</button>
        </div>
      )}
    </div>
  );
}

const optionsOf = (card: ChipCard) => {
  try {
    const choice = buildInteractiveFields(card.frontmatter ?? {}).choice;
    return choice ? visibleChoiceOptions(choice) : [];
  } catch {
    return [];
  }
};

/** In a full world's strip: this many chips, then 「更多」 for the rest (phones stay one tidy row). */
export const STRIP_VISIBLE = 3;
/** The most moves a strip ever offers (opened 「更多」 included). */
export const STRIP_MAX = 8;

/**
 * The next moves as chips above the reply box: the options of the cards
 * on this layer — the door first — through the same declared-choice path as the card panel and the left rail.
 * `stack` is the prologue's (three big rows); `strip` is any other world's: one row of at most three, 「更多」 for
 * the rest, sideways scroll on a phone. Typing stays right under it.
 */
export function ReplyChips({ cards, projection, focus, onChoice, onEnterGate, onOpenCharacter, layout = 'stack' }: {
  cards: (ChipCard & DeclaredChoiceItem)[];
  projection: string;
  focus?: FocusCoordinator;
  onChoice?(prompt: string): void;
  onEnterGate?(path: string): void;
  onOpenCharacter?(id: string): void;
  layout?: 'stack' | 'strip';
}): React.ReactElement | null {
  const { t } = useLocale();
  const strip = layout === 'strip';
  const chips = useMemo(() => replyChipsOf(cards, optionsOf, strip ? STRIP_MAX : 3), [cards, strip]);
  const byPath = useMemo(() => new Map(cards.map((c) => [c.path, c])), [cards]);
  const declared = useDeclaredChoice({ resolveItem: (path) => byPath.get(path) ?? null, projection, onChoice, onEnterGate, onOpenCharacter });
  const [more, setMore] = useState(false);
  // A new place, new moves: the strip folds back to three.
  useEffect(() => { setMore(false); }, [projection]);
  if (chips.length === 0) return <DeclaredChoiceHost declared={declared} focus={focus} />;
  const overflow = strip && chips.length > STRIP_VISIBLE;
  const shown = overflow && !more ? chips.slice(0, STRIP_VISIBLE) : chips;
  return (
    <>
      <div className={`reply-chips${strip ? ' reply-chips--strip' : ''}`} role="group" data-testid="reply-chips" data-layout={layout} data-expanded={overflow && more ? 'true' : undefined}>
        {shown.map((chip) => (
          <button key={`${chip.path}:${chip.option.id ?? chip.option.index}`} type="button" className="reply-chip" title={strip ? chip.option.label : undefined} data-chip-path={chip.path} data-chip-option={chip.option.id} disabled={declared.busy} onClick={() => declared.choose(chip.path, chip.option.id ?? chip.option.label)}>
            {chip.option.label}
          </button>
        ))}
        {overflow && (
          <button type="button" className="reply-chip reply-chip--more" data-testid="reply-chips-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
            {more ? t('Show less') : `${t('More')} · ${chips.length - STRIP_VISIBLE}`}
          </button>
        )}
      </div>
      <DeclaredChoiceHost declared={declared} focus={focus} />
    </>
  );
}

/**
 * The first run without a guest session: in place of the reply box, UNDER the greeter's line (in
 * the dock's flow, never over it), in the prologue's first scene — why (the trial already used on this device /
 * network, or not reachable), one line, 登录 (sign in, then the prologue carries on), and a quiet 「先看看所有世界」.
 * Never the lobby by itself.
 */
export function FirstRunSignInCard({ reason, onSignIn, onAllWorlds }: { reason: FirstRunGate; onSignIn(): void; onAllWorlds(): void }): React.ReactElement {
  const { t } = useLocale();
  const why = GATE_WHY[reason];
  return (
    <div className="first-run-gate" role="group" data-testid="first-run-gate" data-reason={reason}>
      {why && <p className="first-run-gate__why" data-testid="first-run-gate-why">{t(why)}</p>}
      <p className="first-run-gate__line">{t('To start this part, sign in first (500 credits on sign-up; your progress is kept).')}</p>
      <div className="first-run-gate__actions">
        <button type="button" className="first-run-gate__sign-in" data-testid="first-run-gate-sign-in" onClick={onSignIn}>{t('Sign in')}</button>
        <button type="button" className="first-run-gate__all" data-testid="first-run-gate-all-worlds" onClick={onAllWorlds}>{t('See all worlds first')}</button>
      </div>
    </div>
  );
}
