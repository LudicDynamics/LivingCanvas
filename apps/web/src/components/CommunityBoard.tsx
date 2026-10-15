import { track } from '../lib/analytics.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { announcements, current, localized, threadOf, useAnnouncements, type Announcement } from '../lib/announcements.js';
import { createBoardClient, formatJst, lastSeen, linkOf, markSeen, mergeFeed, refusalText, safeImage, sortAnnouncements, type BoardAnswer, type BoardComment, type BoardFeed, type FeedItem } from '../lib/board.js';
import { useLocale } from '../lib/i18n.js';
import { lobbyLogs, useLobbyLogs, type LogItem } from '../lib/lobby-logs.js';
import { MiniMarkdown } from '../lib/mini-markdown.js';
import './community-board.css';

type Translate = ReturnType<typeof useLocale>['t'];
const client = createBoardClient();
const LEVEL: Record<Announcement['level'], string> = { info: 'Notice', maintenance: 'Maintenance', important: 'Important' };
const REASONS = [['spam', 'Spam'], ['abuse', 'Abuse or harassment'], ['spoiler', 'Spoiler'], ['personal_info', 'Personal information'], ['other', 'Something else']] as const;
const MAX_COMMENT = 500;
const storage = () => { try { return window.localStorage; } catch { return null; } };

const who = (x: { mine: boolean; author: string | null; tag: string | null }, t: Translate) =>
  x.mine ? t('You') : x.author ?? (x.tag ? `${t('Anonymous player')} ${x.tag}` : t('Anonymous player'));
function failure(answer: BoardAnswer<unknown>, t: Translate, locale: string): string {
  if (answer.ok) return '';
  const key = refusalText(answer);
  return t(key, answer.retryAt ? { date: formatJst(answer.retryAt, locale) } : { date: '' });
}

/** One comment, with 「Report」 for others' and 「Delete」 for your own. */
function CommentRow({ comment, t, locale, onGone }: { comment: BoardComment; t: Translate; locale: string; onGone: () => void }) {
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState('');
  return (
    <li className="community-board__comment">
      <p>{comment.text}</p>
      <small>
        {who(comment, t)} · {formatJst(comment.createdAt, locale)}
        {comment.mine ? (
          <button type="button" onClick={async () => { const r = await client.remove('comments', comment.id); if (r.ok) onGone(); else setNote(failure(r, t, locale)); }}>{t('Delete')}</button>
        ) : !note && !reporting && (
          <button type="button" onClick={() => setReporting(true)}>{t('Report')}</button>
        )}
      </small>
      {reporting && (
        <span className="community-board__report" role="group" aria-label={t('Why?')}>
          {REASONS.map(([reason, label]) => (
            <button key={reason} type="button" onClick={async () => {
              setReporting(false);
              const r = await client.report('comments', comment.id, reason);
              setNote(r.ok ? t('Reported. Thank you — an admin will look at it.') : failure(r, t, locale));
            }}>{t(label)}</button>
          ))}
          <button type="button" onClick={() => setReporting(false)}>{t('Cancel')}</button>
        </span>
      )}
      {note && <small className="community-board__note" role="status">{note}</small>}
    </li>
  );
}

/** The comments under one board item: read by anyone, written by signed-in, verified, not-brand-new accounts (data decides). */
function Thread({ target, t, locale, onCount }: { target: string; t: Translate; locale: string; onCount: (n: number) => void }) {
  const [list, setList] = useState<BoardComment[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    void client.comments(target).then(r => { if (live) setList(r.ok ? r.comments : []); });
    return () => { live = false; };
  }, [target]);
  const length = [...text].length;
  return (
    <div className="community-board__thread">
      {list === null ? <p className="community-board__muted">{t('Loading…')}</p> : list.length ? (
        <ul>{list.map(c => <CommentRow key={c.id} comment={c} t={t} locale={locale} onGone={() => { const next = list.filter(x => x.id !== c.id); setList(next); onCount(next.length); }} />)}</ul>
      ) : <p className="community-board__muted">{t('No comments yet.')}</p>}
      <form onSubmit={async event => {
        event.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        setMessage('');
        const r = await client.comment(target, text);
        setBusy(false);
        if (r.ok) {
          const next = [...(list ?? []), r.comment];
          setList(next);
          onCount(next.length);
          setText('');
        } else setMessage(failure(r, t, locale));
      }}>
        <textarea value={text} rows={2} maxLength={MAX_COMMENT} placeholder={t('Leave a comment (text only)')} aria-label={t('Leave a comment (text only)')} onChange={e => setText(e.target.value)} />
        <div className="community-board__compose-row">
          <small aria-live="polite">{length}/{MAX_COMMENT}</small>
          <button type="submit" disabled={busy || !text.trim() || length > MAX_COMMENT}>{busy ? t('Sending…') : t('Reply')}</button>
        </div>
        {message && <p className="community-board__note" role="status">{message}</p>}
      </form>
    </div>
  );
}

/** 「留言 (n)」 under an item: opens its thread in place. */
function ThreadToggle({ target, count, t, locale }: { target: string; count: number | undefined; t: Translate; locale: string }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(count);
  useEffect(() => setN(count), [count]);
  return (
    <>
      <button type="button" className="community-board__action" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        {n ? t('Comments ({count})', { count: n }) : t('Reply')}
      </button>
      {open && <Thread target={target} t={t} locale={locale} onCount={setN} />}
    </>
  );
}

function OpenWorld({ worldId, onOpenWorld, t }: { worldId: string; onOpenWorld: (id: string) => boolean; t: Translate }) {
  const [missing, setMissing] = useState(false);
  return (
    <>
      <button type="button" className="community-board__action is-primary" onClick={() => setMissing(!onOpenWorld(worldId))}>{t('Open world')}</button>
      {missing && <small className="community-board__note" role="status">{t('This world is not on this computer yet: find it on the world shelf under Remote.')}</small>}
    </>
  );
}

function AnnouncementCard({ item, fresh, count, t, locale, onOpenWorld }: { item: Announcement; fresh: boolean; count: number | undefined; t: Translate; locale: string; onOpenWorld: (id: string) => boolean }) {
  const body = localized(item.body, locale);
  const link = linkOf(item.linkUrl);
  const image = safeImage(item.imageUrl);
  const thread = threadOf(item.id);
  return (
    <article className={`community-board__card is-${item.level}`}>
      <header>
        <span className="community-board__tag">{item.pinned ? `${t('Pinned')} · ` : ''}{t(LEVEL[item.level])}</span>
        {fresh && <span className="community-board__new" aria-label={t('New')} />}
        <time dateTime={item.startsAt}>{formatJst(item.startsAt, locale)}</time>
      </header>
      <h3>{localized(item.title, locale)}</h3>
      {image && <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
      {body && <MiniMarkdown className="community-board__body" text={body} variant={item.source === 'log' ? 'log' : 'announcement'} />}
      <footer>
        {link && 'world' in link && <OpenWorld worldId={link.world} onOpenWorld={onOpenWorld} t={t} />}
        {link && 'href' in link && <a className="community-board__action is-primary" href={link.href} target="_blank" rel="noopener noreferrer">{t('Details')}</a>}
        {thread && <ThreadToggle target={thread} count={count} t={t} locale={locale} />}
      </footer>
    </article>
  );
}

/** 日志 categories (platform-data v5 `log.category`); literal t() calls so check:i18n sees every key. */
function categoryLabel(category: string, t: Translate): string {
  switch (category) {
    case 'release': return t('Release');
    case 'feature': return t('New feature');
    case 'improvement': return t('Improvement');
    case 'fix': return t('Fix');
    case 'incident': return t('Incident');
    case 'maintenance': return t('Maintenance');
    case 'world-update': return t('World update');
    case 'plan': return t('Roadmap');
    default: return t('Notice');
  }
}

/** The day a log was published, Japan time (the board's times are JST). */
function logDay(iso: string, locale: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : locale, { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
}

/** One entry of the 「日志」 tab: category chip, date, title, the body's small markup (escaped text), picture, links. */
export function LogCard({ item, t, locale, onOpenWorld }: { item: LogItem; t: Translate; locale: string; onOpenWorld: (id: string) => boolean }) {
  const body = localized(item.body, locale);
  const image = safeImage(item.imageUrl);
  const links = item.links.map(l => ({ ...l, link: linkOf(l.url) })).filter(l => l.link);
  return (
    <article className={`community-board__card is-log is-${item.category}`} data-log-id={item.id}>
      <header>
        <span className="community-board__chip">{categoryLabel(item.category, t)}</span>
        <time dateTime={item.publishedAt}>{logDay(item.publishedAt, locale)}</time>
      </header>
      <h3>{localized(item.title, locale)}</h3>
      {image && <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
      {body && <MiniMarkdown className="community-board__body" text={body} variant="log" />}
      {links.length > 0 && (
        <footer>
          {links.map((l, i) => l.link && 'world' in l.link
            ? <OpenWorld key={i} worldId={l.link.world} onOpenWorld={onOpenWorld} t={t} />
            : l.link && <a key={i} className="community-board__action is-primary" href={l.link.href} target="_blank" rel="noopener noreferrer">{l.label ?? t('Details')}</a>)}
        </footer>
      )}
    </article>
  );
}

function FeedCard({ item, count, worldName, t, locale, onOpenWorld }: { item: FeedItem; count: number | undefined; worldName: (id: string) => string | null; t: Translate; locale: string; onOpenWorld: (id: string) => boolean }) {
  let tag = '';
  let title = '';
  let text: string | null = null;
  let worldId: string | null = null;
  let byline: string | null = null;
  let image: string | null = null;
  if (item.kind === 'world') {
    tag = item.fresh === 'updated' ? t('World updated') : t('New world');
    title = item.world.name;
    text = item.world.description || null;
    worldId = item.world.id;
    byline = item.world.publisher;
    image = safeImage(item.world.coverUrl);
  } else if (item.kind === 'review') {
    const name = worldName(item.review.worldId) ?? item.review.worldId;
    tag = t('Review');
    title = `${'★'.repeat(item.review.rating)}${'☆'.repeat(5 - item.review.rating)} · ${name}`;
    text = item.review.comment;
    worldId = item.review.worldId;
    byline = who({ mine: false, author: item.review.author, tag: item.review.tag }, t);
  } else {
    tag = t('Player post');
    title = item.post.title;
    text = item.post.text;
    worldId = item.post.worldId;
    byline = who(item.post, t);
  }
  return (
    <article className={`community-board__card is-${item.kind}`}>
      <header>
        <span className="community-board__tag">{tag}</span>
        <time dateTime={item.at}>{formatJst(item.at, locale)}</time>
      </header>
      <h3>{title}</h3>
      {image && <img src={image} alt="" loading="lazy" decoding="async" />}
      {text && <p className="community-board__body">{text}</p>}
      {byline && <small className="community-board__muted">{byline}</small>}
      <footer>
        {worldId && <OpenWorld worldId={worldId} onOpenWorld={onOpenWorld} t={t} />}
        <ThreadToggle target={item.target} count={count} t={t} locale={locale} />
      </footer>
    </article>
  );
}

/** v1.5: a player's own post, shown only while an admin has posting open (board-config). */
function PostComposer({ t, locale, onPosted }: { t: Translate; locale: string; onPosted: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  if (!open) return <button type="button" className="community-board__action" onClick={() => setOpen(true)}>{t('Write a post')}</button>;
  return (
    <form className="community-board__post-form" onSubmit={async e => {
      e.preventDefault();
      const r = await client.post(title, text);
      if (r.ok) { setOpen(false); setTitle(''); setText(''); onPosted(); } else setMessage(failure(r, t, locale));
    }}>
      <input value={title} maxLength={80} placeholder={t('Title')} aria-label={t('Title')} onChange={e => setTitle(e.target.value)} />
      <textarea value={text} rows={4} maxLength={1000} placeholder={t('Text only, up to 1000 characters')} aria-label={t('Text only, up to 1000 characters')} onChange={e => setText(e.target.value)} />
      <div className="community-board__compose-row">
        <button type="button" onClick={() => setOpen(false)}>{t('Cancel')}</button>
        <button type="submit" disabled={!title.trim() || !text.trim()}>{t('Post')}</button>
      </div>
      {message && <p className="community-board__note" role="status">{message}</p>}
    </form>
  );
}

/**
 * 公告 / 社区: one quiet pill in the launcher's top bar (a dot while an announcement is
 * newer than this device's last visit); opens a side sheet with 「官方公告」, 「日志」 (only while there are logs) and
 * 「社区动态」. Nothing of it shows over a world. Announcements, worlds, reviews and posts can be commented on (日志
 * entries cannot); reviews and worlds open in the launcher.
 */
export function CommunityBoard({ onOpenWorld, worldName, openRequest = 0 }: { onOpenWorld: (worldId: string) => boolean; worldName: (worldId: string) => string | null; openRequest?: number }) {
  const { t, locale } = useLocale();
  const state = useAnnouncements();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'news' | 'logs' | 'community'>('news');
  const logs = useLobbyLogs();
  const hasLogs = logs.list.length > 0;
  const [seen, setSeen] = useState(() => lastSeen(storage()));
  const [feed, setFeed] = useState<BoardFeed | null>(null);
  const [feedState, setFeedState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => { void announcements()?.load(); }, []);
  // 改进产品 (lib/analytics.ts): the board was opened.
  useEffect(() => { if (open) track('board_open'); }, [open]);
  // on now, checked again (the answer may be minutes old; the store re-renders at each start / end)
  const news = useMemo(() => sortAnnouncements(current(state)), [state]);
  const fresh = news.filter(a => Date.parse(a.startsAt) > seen);
  const items = useMemo(() => (feed ? mergeFeed(feed) : []), [feed]);

  const loadFeed = async () => {
    setFeedState('loading');
    const r = await client.feed();
    if (r.ok) { setFeed(r); setFeedState('ready'); } else setFeedState('failed');
  };
  useEffect(() => {
    if (!open) return;
    document.documentElement.dataset.airpBoard = 'open';
    if (feedState === 'idle') void loadFeed();
    void lobbyLogs()?.load();
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', close, true);
    sheet.current?.focus();
    return () => { window.removeEventListener('keydown', close, true); delete document.documentElement.dataset.airpBoard; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const targets = [...news.map(a => threadOf(a.id)).filter((x): x is string => x !== null), ...items.map(i => i.target)];
    if (!targets.length) return;
    void client.counts(targets).then(r => { if (r.ok) setCounts(r.counts); });
  }, [open, news, items]);

  // no logs (offline, an older data): no 「日志」 tab — never left on an empty one
  useEffect(() => { if (tab === 'logs' && !hasLogs) setTab('news'); }, [tab, hasLogs]);
  // the top banner without a link opens the board on its entry
  useEffect(() => { if (openRequest > 0) { setTab('news'); setOpen(true); } }, [openRequest]);

  const toggle = () => {
    setOpen(v => {
      // closing marks everything seen; opening keeps the "new" marks visible while reading
      if (v) { markSeen(storage()); setSeen(Date.now()); }
      return !v;
    });
  };
  const openWorld = (id: string) => {
    const ok = onOpenWorld(id);
    if (ok) { markSeen(storage()); setSeen(Date.now()); setOpen(false); }
    return ok;
  };

  return (
    <>
      <button type="button" className="world-launcher__pill launcher-notices__pill" aria-expanded={open} aria-haspopup="dialog" onClick={toggle}>
        {t('Board')}{fresh.length > 0 && <span className="launcher-notices__dot" aria-label={t('{count} unread', { count: fresh.length })} />}
      </button>
      {/* on <body>: the top bar is its own stacking context, and the sheet must cover the wall's hint line */}
      {open && createPortal(
        <div className="community-board" role="dialog" aria-modal="false" aria-label={t('Board')} ref={sheet} tabIndex={-1}>
          <div className="community-board__head">
            <div className="community-board__tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'news'} onClick={() => setTab('news')}>
                {t('Announcements')}{fresh.length > 0 && <span className="launcher-notices__dot" aria-hidden="true" />}
              </button>
              {hasLogs && <button type="button" role="tab" aria-selected={tab === 'logs'} onClick={() => setTab('logs')}>{t('Logs')}</button>}
              <button type="button" role="tab" aria-selected={tab === 'community'} onClick={() => setTab('community')}>{t('Community')}</button>
            </div>
            <button type="button" className="community-board__close" aria-label={t('Close')} onClick={toggle}>✕</button>
          </div>
          <div className="community-board__list" role="tabpanel">
            {tab === 'news' && (news.length ? news.map(a => (
              <AnnouncementCard key={a.id} item={a} fresh={Date.parse(a.startsAt) > seen} count={counts[threadOf(a.id) ?? '']} t={t} locale={locale} onOpenWorld={openWorld} />
            )) : <p className="community-board__muted">{t('No announcements right now.')}</p>)}
            {tab === 'logs' && hasLogs && (
              <>
                {logs.list.map(l => <LogCard key={l.id} item={l} t={t} locale={locale} onOpenWorld={openWorld} />)}
                {logs.nextBefore && (
                  <button type="button" className="community-board__action community-board__more" disabled={logs.loadingMore} onClick={() => void lobbyLogs()?.more()}>
                    {logs.loadingMore ? t('Loading…') : t('Load more')}
                  </button>
                )}
              </>
            )}
            {tab === 'community' && (
              <>
                {feed?.config.postsEnabled && <PostComposer t={t} locale={locale} onPosted={() => void loadFeed()} />}
                {feedState === 'loading' && !feed && <p className="community-board__muted">{t('Loading…')}</p>}
                {feedState === 'failed' && <p className="community-board__muted">{t('The board could not be reached. Try again later.')}</p>}
                {feedState === 'ready' && !items.length && <p className="community-board__muted">{t('Nothing here yet. New worlds and reviews will show up here.')}</p>}
                {items.map(item => <FeedCard key={item.key} item={item} count={counts[item.target]} worldName={worldName} t={t} locale={locale} onOpenWorld={openWorld} />)}
              </>
            )}
          </div>
          <p className="community-board__foot">{t('Times are Japan time (JST). Comments are public; be kind.')}</p>
        </div>,
        document.body,
      )}
    </>
  );
}
