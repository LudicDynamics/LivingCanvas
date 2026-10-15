import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { MarkdownText } from '../../lib/md.js';
import { withBase } from '../../lib/base-path.js';
import {
  isLongText,
  latestEntry,
  oneLine,
  stampOf,
  streamRows,
  type StreamEntry,
  type StreamHistory,
} from '../../lib/message-stream.js';
import './message-drawer.css';

/**
 * MessageDrawer — the bottom drawer that holds every word of the run
 *. At rest it is ONE line: the newest thing said, with who said
 * it. Pressing the writer (✎) pulls it up together with the writer's input,
 * and putting the writer away puts it down again
 *
 * The line itself, or a chalk's 「在消息里看」 on the canvas, opens it alone.
 *
 * Two pages: 「消息」 — one timeline, writer / characters / you told apart, long
 * entries folded — and 「选项」, which took over the left edge's parked option
 * rail (the same ChoiceRail, drawn flat).
 *
 * A press inside never counts as "outside" for the writer sheet
 * (`data-message-drawer`, WriterFab).
 *
 * The timeline reaches back past this tab: the save's history
 * is read when it opens, and scrolling to the top reads the page above, the
 * reading position kept where it was. A loop reset is a line across it.
 */
export interface StreamFace {
  name: string;
  avatar?: string | null;
}

export interface MessageDrawerProps {
  entries: readonly StreamEntry[];
  /** The save's history above what is shown (more to read, a page on its way). */
  history?: StreamHistory;
  /** Read the page above (the list is scrolled to its top). */
  onLoadOlder?(): void;
  open: boolean;
  onOpen(): void;
  onClose(): void;
  /** Scroll to this entry and light it (`n` re-triggers the same id). */
  focus?: { id: string; n: number } | null;
  /** Characters by id: name and face. */
  faces: Readonly<Record<string, StreamFace>>;
  player: StreamFace;
  /** A layer id → its display name, for the place dividers. */
  placeName(layer: string | null): string;
  /** Chalks still on the canvas, by path (the others went to the drawer). */
  onCanvas: ReadonlySet<string>;
  /** Chalks that asked for something and got it (drawn compact, ✓). */
  isDone(path: string): boolean;
  /** 「在画布上看」 for a chalk still on the canvas. */
  onShowOnCanvas?(path: string): void;
  /** The 「选项」 page (the flat ChoiceRail); omitted = no tab. */
  options?: React.ReactNode;
  optionCount?: number;
  /** Where the player is, for the head. */
  place: string;
  /** Something else owns the bottom of a narrow screen (an open dialogue): the peek steps aside. */
  crowded?: boolean;
  /** A guide / tutorial step pulled the drawer up for this page (`n` re-triggers the same tab). */
  tabRequest?: { tab: 'stream' | 'options'; n: number } | null;
}

type Tab = 'stream' | 'options';

const KIND_GLYPH: Readonly<Record<StreamEntry['kind'], string>> = { writer: '✎', character: '', you: '', dice: '🎲', event: '✦', loop: '↻' };
/** How close to the top of the list (px) reading the page above starts. */
const OLDER_EDGE = 64;

function Face({ face, fallback }: { face?: StreamFace | null; fallback: string }): React.ReactElement {
  return (
    <span className="message-stream__face" aria-hidden="true">
      {face?.avatar ? <img src={withBase(face.avatar)} alt="" /> : <b>{(face?.name || fallback).charAt(0)}</b>}
    </span>
  );
}

function Folding({ text, markdown }: { text: string; markdown?: boolean }): React.ReactElement {
  const { t } = useLocale();
  const long = isLongText(text);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="message-stream__text" data-folded={long && !open ? 'true' : undefined}>
        {markdown ? <MarkdownText text={text} /> : text}
      </div>
      {long && (
        <button type="button" className="message-stream__fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t('Show less') : t('Show more')}
        </button>
      )}
    </>
  );
}

export function MessageDrawer({
  entries,
  history,
  onLoadOlder,
  open,
  onOpen,
  onClose,
  focus = null,
  faces,
  player,
  placeName,
  onCanvas,
  isDone,
  onShowOnCanvas,
  options,
  optionCount = 0,
  place,
  crowded = false,
  tabRequest = null,
}: MessageDrawerProps): React.ReactElement {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>('stream');
  useEffect(() => {
    if (tabRequest && (tabRequest.tab === 'stream' || options)) setTab(tabRequest.tab);
  }, [tabRequest?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [lit, setLit] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => streamRows(entries), [entries]);
  const latest = useMemo(() => latestEntry(entries), [entries]);
  const followRef = useRef(true);
  /** The list's height and offset when a page above was asked for: the reading position survives it landing. */
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  const more = history?.more === true;
  const loadingOlder = history?.status === 'loading';
  const askOlder = (): void => {
    const list = listRef.current;
    if (!list || !more || loadingOlder || !onLoadOlder) return;
    anchorRef.current = { height: list.scrollHeight, top: list.scrollTop };
    onLoadOlder();
  };

  // A jump from the canvas: the stream page, the entry in view, lit for a moment.
  useEffect(() => {
    if (!focus || !open) return;
    setTab('stream');
    setLit(focus.id);
    setExpanded((prev) => new Set(prev).add(focus.id));
    const timer = window.setTimeout(() => setLit(null), 2600);
    return () => window.clearTimeout(timer);
  }, [focus?.id, focus?.n, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!open || tab !== 'stream') return;
    const list = listRef.current;
    if (!list) return;
    if (lit) {
      const row = list.querySelector<HTMLElement>(`[data-entry="${CSS.escape(lit)}"]`);
      row?.scrollIntoView({ block: 'center' });
      return;
    }
    // Older entries landed above: keep the line being read where it was.
    const anchor = anchorRef.current;
    if (anchor && list.scrollHeight !== anchor.height) {
      anchorRef.current = null;
      list.scrollTop = anchor.top + (list.scrollHeight - anchor.height);
      return;
    }
    // Opened, or a new entry while reading at the bottom: stay at the newest.
    if (followRef.current) list.scrollTop = list.scrollHeight;
  }, [open, tab, lit, rows.length]);
  // A page that brought nothing new (all already here) must not leave a stale anchor behind.
  useEffect(() => {
    if (!loadingOlder && anchorRef.current && listRef.current?.scrollHeight === anchorRef.current.height) anchorRef.current = null;
  }, [loadingOlder]);
  // A list too short to scroll cannot be scrolled to its top: read on while there is more and room.
  useEffect(() => {
    const list = listRef.current;
    if (!open || tab !== 'stream' || !list || !more || loadingOlder) return;
    if (list.scrollHeight <= list.clientHeight + OLDER_EDGE) askOlder();
  }, [open, tab, more, loadingOlder, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const who = (entry: StreamEntry): { label: string; face: StreamFace | null } => {
    if (entry.kind === 'you') return { label: t('You'), face: player };
    if (entry.kind === 'character') {
      const face = entry.who ? faces[entry.who] : undefined;
      return { label: face?.name || entry.name || entry.who || '', face: face ?? (entry.name ? { name: entry.name } : null) };
    }
    if (entry.kind === 'writer') return { label: t('Writer'), face: null };
    if (entry.kind === 'dice') return { label: t('Dice'), face: null };
    return { label: entry.name || t('Events'), face: null };
  };

  const peekWho = latest ? who(latest) : null;
  const toWhom = (entry: StreamEntry): string | null => {
    if (entry.kind !== 'you') return null;
    if (entry.who === 'writer') return t('to the writer');
    // A registered character by id, else an NPC card by its name (NpcDialogue records `name`).
    const name = (entry.who ? faces[entry.who]?.name : undefined) ?? entry.name;
    return name ? t('to {name}', { name }) : null;
  };

  const renderEntry = (entry: StreamEntry): React.ReactElement => {
    const { label, face } = who(entry);
    const common = {
      'data-entry': entry.id,
      'data-kind': entry.kind,
      'data-lit': lit === entry.id ? 'true' : undefined,
    };
    if (entry.kind === 'writer') {
      const done = entry.chalkPath ? isDone(entry.chalkPath) : false;
      const here = entry.chalkPath ? onCanvas.has(entry.chalkPath) : false;
      const compact = done && !expanded.has(entry.id);
      return (
        <article {...common} className="message-stream__entry message-stream__writer" data-done={done ? 'true' : undefined} data-compact={compact ? 'true' : undefined}>
          <header className="message-stream__byline">
            <span className="message-stream__mark" aria-hidden="true">{KIND_GLYPH.writer}</span>
            <span className="message-stream__name">{label}</span>
            {entry.title && <span className="message-stream__title">{entry.title}</span>}
            {done && <span className="message-stream__badge">{t('Done')}</span>}
            {here && onShowOnCanvas && entry.chalkPath && (
              <button type="button" className="message-stream__link" onClick={() => onShowOnCanvas(entry.chalkPath!)}>{t('On the canvas')}</button>
            )}
          </header>
          {compact ? (
            <button type="button" className="message-stream__compact" onClick={() => setExpanded((prev) => new Set(prev).add(entry.id))} title={t('Show more')}>
              {oneLine(entry.text)}
            </button>
          ) : (
            <Folding text={entry.text} markdown />
          )}
        </article>
      );
    }
    if (entry.kind === 'dice') {
      return (
        <article {...common} className="message-stream__entry message-stream__dice" data-outcome={entry.outcome ?? undefined}>
          <span className="message-stream__mark" aria-hidden="true">{KIND_GLYPH.dice}</span>
          <span className="message-stream__dice-desc">{entry.title || entry.text}</span>
          {entry.score && <span className="message-stream__dice-score">{entry.score}</span>}
          {entry.outcome && (
            <span className="message-stream__dice-verdict">
              {entry.outcome === 'crit' ? t('Critical success') : entry.outcome === 'fumble' ? t('Critical failure') : entry.outcome === 'pass' ? t('Success') : t('Failure')}
            </span>
          )}
        </article>
      );
    }
    if (entry.kind === 'event') {
      return (
        <article {...common} className="message-stream__entry message-stream__event">
          <header className="message-stream__byline">
            <span className="message-stream__mark" aria-hidden="true">{KIND_GLYPH.event}</span>
            <span className="message-stream__name">{label}</span>
            {entry.title && <span className="message-stream__title">{entry.title}</span>}
          </header>
          <Folding text={entry.text} />
        </article>
      );
    }
    const mine = entry.kind === 'you';
    const to = toWhom(entry);
    return (
      <article {...common} className={`message-stream__entry message-stream__said${mine ? ' message-stream__said--you' : ''}`} data-note={entry.note ? 'true' : undefined}>
        <Face face={face} fallback={label || '?'} />
        <div className="message-stream__bubble">
          <header className="message-stream__byline">
            <span className="message-stream__name">{label}</span>
            {to && <span className="message-stream__to">{to}</span>}
            {entry.note && <span className="message-stream__to">{t('left a note')}</span>}
          </header>
          {entry.recap && <span className="message-stream__recap">{t('From the conversation')}</span>}
          {entry.title && entry.note && <strong className="message-stream__note-title">{entry.title}</strong>}
          <Folding text={entry.text} />
        </div>
      </article>
    );
  };

  return (
    <section
      className="message-drawer prototype-chrome"
      data-message-drawer=""
      data-open={open ? 'true' : 'false'}
      data-crowded={crowded ? 'true' : undefined}
      aria-label={t('Story so far')}
    >
      {!open && (
        <button
          type="button"
          className="message-drawer__peek"
          data-testid="message-peek"
          aria-expanded={false}
          aria-label={t('Open the story so far')}
          onClick={onOpen}
        >
          {latest && peekWho ? (
            <>
              {latest.kind === 'character' || latest.kind === 'you'
                ? <Face face={peekWho.face} fallback={peekWho.label || '?'} />
                : <span className="message-drawer__peek-mark" aria-hidden="true">{KIND_GLYPH[latest.kind]}</span>}
              <span className="message-drawer__peek-who">{peekWho.label}</span>
              <span className="message-drawer__peek-text">{oneLine(latest.title && latest.kind === 'dice' ? latest.title : latest.text)}</span>
            </>
          ) : (
            <span className="message-drawer__peek-text">{t('Nothing said yet.')}</span>
          )}
          <span className="message-drawer__peek-chevron" aria-hidden="true">⌃</span>
        </button>
      )}
      {open && (
        <div className="message-drawer__panel" role="dialog" aria-modal="false" aria-label={t('Story so far')}>
          <header className="message-drawer__head">
            <div className="message-drawer__tabs" role="tablist" aria-label={t('Story so far')}>
              <button type="button" role="tab" aria-selected={tab === 'stream'} className="message-drawer__tab" onClick={() => setTab('stream')}>{t('Messages')}</button>
              {options && (
                <button type="button" role="tab" aria-selected={tab === 'options'} className="message-drawer__tab" data-guide-target="options" onClick={() => setTab('options')}>
                  {t('Options')}{optionCount > 0 && <span className="message-drawer__count">{optionCount}</span>}
                </button>
              )}
            </div>
            <span className="message-drawer__place" title={place}>{place}</span>
            <button type="button" className="message-drawer__close" data-testid="message-drawer-close" aria-label={t('Close')} title={t('Close')} onClick={onClose}>⌄</button>
          </header>
          {tab === 'stream' ? (
            <div
              className="message-stream"
              ref={listRef}
              role="log"
              aria-live="polite"
              onScroll={(event) => {
                const el = event.currentTarget;
                followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
                if (el.scrollTop < OLDER_EDGE) askOlder();
              }}
            >
              {(more || loadingOlder) && (
                <div className="message-stream__older" data-loading={loadingOlder ? 'true' : undefined}>
                  {loadingOlder
                    ? <span>{t('Loading earlier messages…')}</span>
                    : <button type="button" onClick={askOlder}>{t('Earlier messages')}</button>}
                </div>
              )}
              {rows.length === 0 && !loadingOlder && <p className="message-stream__empty">{t('Nothing said yet.')}</p>}
              {rows.map((row) => row.type === 'divider' ? (
                <div key={row.key} className="message-stream__divider" role="separator" data-place={row.place ? 'true' : undefined}>
                  <span>{row.place ? `${placeName(row.layer)} · ${stampOf(row.at)}` : stampOf(row.at)}</span>
                </div>
              ) : row.type === 'loop' ? (
                <div key={row.key} className="message-stream__divider message-stream__loop" role="separator" data-loop={row.loop}>
                  <span><b aria-hidden="true">{KIND_GLYPH.loop}</b> {t('Loop {n}', { n: row.loop })} · {stampOf(row.at)}</span>
                </div>
              ) : (
                <React.Fragment key={row.key}>{renderEntry(row.entry)}</React.Fragment>
              ))}
            </div>
          ) : (
            <div className="message-drawer__options">{options}</div>
          )}
        </div>
      )}
    </section>
  );
}
