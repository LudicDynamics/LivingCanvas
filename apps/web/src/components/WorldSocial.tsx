import React, { useEffect, useState } from 'react';
import { Bookmark, Coins, DoorOpen, Heart, Play } from 'lucide-react';
import { accountData, MAX_NOTE, useAccountData, type PublicComment, type Rating, type Review, type ReviewNotice, type SaveSummary } from '../lib/account-data.js';
import { useLocale } from '../lib/i18n.js';

/** What a brick knows about the player and the world (lib/account-data.ts). */
export interface BrickSocial {
  /** The id it is favorited / rated under (editions share one). */
  key: string;
  favorite: boolean;
  /** This player's public +1. */
  liked: boolean;
  review: Review | null;
  rating: Rating | null;
  /** Public counts: likes, and playthroughs (null = not shown: under 5 players or not public). */
  likes: number;
  plays: number | null;
  /** Server-wide 「总打开次数」 / 「总消耗 token 数」 (null = not shown: unpublished, chronicle down, or no data yet). */
  opens?: number | null;
  tokens?: number | null;
  /** Where this device's latest save of the world got to. */
  here: SaveSummary | null;
  /** The account's latest save of the world on ANOTHER device (none here). */
  elsewhere: SaveSummary | null;
}

type Translate = ReturnType<typeof useLocale>['t'];

/** 950 · 1.2k · 34k · 1.2M · 34M · 1.2B */
export const compact = (n: number) => {
  for (const [v, s] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']] as const) {
    if (n >= v) { const x = n / v; return `${x >= 10 ? Math.floor(x) : Math.floor(x * 10) / 10}${s}`; }
  }
  return String(Math.max(0, Math.floor(n)));
};

/** "★ 4.3 · 12  ♥ 34  ▶ 120" on the brick's top line (and a bookmark when saved). Nothing when there is nothing to say. */
export function BrickSocialMarks({ social, t }: { social: BrickSocial | null; t: Translate }) {
  if (!social) return null;
  const rated = social.rating && social.rating.count > 0 && social.rating.average !== null;
  const opens = typeof social.opens === 'number' && social.opens > 0 ? social.opens : null;
  const tokens = typeof social.tokens === 'number' && social.tokens > 0 ? social.tokens : null;
  if (!rated && !social.favorite && !social.likes && social.plays === null && opens === null && tokens === null) return null;
  return (
    <span className="world-launcher__marks">
      {social.favorite && <span className="world-launcher__heart" title={t('In your favorites')}><Bookmark size={11} aria-hidden="true" /></span>}
      {rated && <span title={t('{count} ratings', { count: social.rating!.count })}>★ {social.rating!.average!.toFixed(1)} · {social.rating!.count}</span>}
      {social.likes > 0 && <span title={t('{count} likes', { count: social.likes })}><Heart size={10} aria-hidden="true" /> {compact(social.likes)}</span>}
      {social.plays !== null && <span title={t('Played {count} times', { count: social.plays })}><Play size={10} aria-hidden="true" /> {compact(social.plays)}</span>}
      {opens !== null && <span className="world-launcher__stat" data-stat="opens" title={t('Opened {count} times (all players)', { count: opens.toLocaleString() })} aria-label={t('Opened {count} times (all players)', { count: opens.toLocaleString() })}><DoorOpen size={10} aria-hidden="true" /> {compact(opens)}</span>}
      {tokens !== null && <span className="world-launcher__stat" data-stat="tokens" title={t('{count} tokens used (all players, since Oct 4, 2026)', { count: tokens.toLocaleString() })} aria-label={t('{count} tokens used (all players, since Oct 4, 2026)', { count: tokens.toLocaleString() })}><Coins size={10} aria-hidden="true" /> {compact(tokens)}</span>}
    </span>
  );
}

/** One line under 「Continue」: where the save got to. */
export function progressLine(summary: SaveSummary | null, t: Translate): string | null {
  if (!summary?.scene) return null;
  return summary.turns > 0 ? t('Reached {scene} · turn {turns}', { scene: summary.scene, turns: summary.turns }) : t('Reached {scene}', { scene: summary.scene });
}

const NOTICE_TEXT: Record<ReviewNotice, string> = {
  rate_limited: 'Too many edits just now. Try again in a few minutes.',
  taken_down: 'An admin hid your comment; it stays visible only to you.',
  signed_out: 'Saved on this device; others see it after you sign in.',
  content_refused: 'Your comment was not posted: it contains words that are not allowed here (slurs, contact details, explicit content).',
};
const REASONS = [['spam', 'Spam'], ['abuse', 'Abuse or harassment'], ['spoiler', 'Spoiler'], ['personal_info', 'Personal information'], ['other', 'Something else']] as const;

/** One public comment, with 「Report」 for everyone else's. */
function CommentLine({ comment, t }: { comment: PublicComment; t: Translate }) {
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<string>('abuse');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<'idle' | 'sent' | 'failed'>('idle');
  const data = accountData();
  return (
    <li className="world-launcher__comment">
      <span className="world-launcher__comment-stars" aria-label={t('{count} stars', { count: comment.rating })}>{'★'.repeat(comment.rating)}</span>
      {comment.comment && <span className="world-launcher__comment-text">{comment.comment}</span>}
      <small>{comment.mine ? t('You') : comment.author ?? (comment.tag ? `${t('Anonymous player')} ${comment.tag}` : t('Anonymous player'))} · {new Date(comment.createdAt ?? comment.updatedAt).toLocaleDateString()}</small>
      {!comment.mine && comment.comment && sent === 'idle' && !reporting && (
        <button type="button" className="world-launcher__report" onClick={() => setReporting(true)}>{t('Report')}</button>
      )}
      {sent === 'sent' && <small>{t('Reported. Thank you — an admin will look at it.')}</small>}
      {sent === 'failed' && <small>{t('Sign in to report a comment.')}</small>}
      {reporting && (
        <form
          className="world-launcher__report-form"
          onSubmit={async event => {
            event.preventDefault();
            setReporting(false);
            setSent((await data?.report(comment.id, reason, note)) ? 'sent' : 'failed');
          }}
        >
          <select value={reason} aria-label={t('Why?')} onChange={event => setReason(event.target.value)}>
            {REASONS.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </select>
          <input value={note} maxLength={500} placeholder={t('Anything the admins should know (optional)')} onChange={event => setNote(event.target.value)} />
          <button type="submit">{t('Send report')}</button>
          <button type="button" onClick={() => setReporting(false)}>{t('Cancel')}</button>
        </form>
      )}
    </li>
  );
}

/** Everyone's comments on a world, asked for when opened. */
function CommentList({ worldKey, t }: { worldKey: string; t: Translate }) {
  const account = useAccountData();
  useEffect(() => { void accountData()?.loadComments(worldKey); }, [worldKey]);
  const list = account.comments[worldKey];
  if (!list) return <p className="world-launcher__comments-empty">{t('Loading comments…')}</p>;
  const shown = list.filter(c => c.comment || c.mine);
  if (!shown.length) return <p className="world-launcher__comments-empty">{t('No comments yet.')}</p>;
  const more = account.commentsNext[worldKey];
  return (
    <ul className="world-launcher__comments">
      {shown.map(c => <CommentLine key={c.id} comment={c} t={t} />)}
      {more && <li><button type="button" className="world-launcher__report" onClick={() => { void accountData()?.loadMoreComments(worldKey); }}>{t('More comments')}</button></li>}
    </ul>
  );
}

/**
 * The open brick's own row: heart, your stars, your public comment, and everyone's
 * comments. Small and inside the caption, like the action buttons — no panel, no HUD.
 */
export function WorldSocialRow({ social, t }: { social: BrickSocial; t: Translate }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const notice = useAccountData().notices[social.key];
  const [note, setNote] = useState(social.review?.comment ?? '');
  const [privateNote, setPrivateNote] = useState(social.review?.note ?? '');
  useEffect(() => { if (!noteOpen) { setNote(social.review?.comment ?? ''); setPrivateNote(social.review?.note ?? ''); } }, [social.review?.comment, social.review?.note, noteOpen]);
  const data = accountData();
  if (!data) return null;
  const mine = social.review?.rating ?? 0;
  const rate = (stars: number) => { void data.setReview(social.key, stars === mine ? null : stars, social.review?.comment ?? ''); };
  return (
    <div className="world-launcher__social">
      <button
        type="button"
        className={`world-launcher__fav${social.liked ? ' is-on' : ''}`}
        aria-pressed={social.liked}
        aria-label={social.liked ? t('Unlike') : t('Like')}
        title={social.liked ? t('Unlike') : t('Like')}
        onClick={() => { void data.toggleLike(social.key); }}
      ><Heart size={13} fill={social.liked ? 'currentColor' : 'none'} aria-hidden="true" />{social.likes > 0 ? ` ${compact(social.likes)}` : ''}</button>
      <button
        type="button"
        className={`world-launcher__fav${social.favorite ? ' is-on' : ''}`}
        aria-pressed={social.favorite}
        aria-label={social.favorite ? t('Remove from favorites') : t('Add to favorites')}
        title={social.favorite ? t('Remove from favorites') : t('Add to favorites')}
        onClick={() => { void data.toggleFavorite(social.key); }}
      ><Bookmark size={13} fill={social.favorite ? 'currentColor' : 'none'} aria-hidden="true" /></button>
      <span className="world-launcher__stars" role="group" aria-label={t('Your rating')}>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            aria-pressed={n <= mine}
            aria-label={n === mine ? t('Remove your rating') : t('{count} stars', { count: n })}
            title={n === mine ? t('Remove your rating') : t('{count} stars', { count: n })}
            className={n <= mine ? 'is-on' : ''}
            onClick={() => rate(n)}
          >{n <= mine ? '★' : '☆'}</button>
        ))}
      </span>
      {mine > 0 && (
        <button type="button" className="world-launcher__note-toggle" aria-expanded={noteOpen} onClick={() => setNoteOpen(open => !open)}>
          {social.review?.comment ? t('Edit comment') : t('Comment')}
        </button>
      )}
      <button type="button" className="world-launcher__note-toggle" aria-expanded={commentsOpen} onClick={() => setCommentsOpen(open => !open)}>
        {t('Comments')}
      </button>
      {notice && <small className="world-launcher__progress">{t(NOTICE_TEXT[notice])}</small>}
      {noteOpen && mine > 0 && (
        <form
          className="world-launcher__note"
          onSubmit={event => {
            event.preventDefault();
            void data.setReview(social.key, mine, note, privateNote);
            setNoteOpen(false);
          }}
        >
          <textarea
            value={note}
            maxLength={MAX_NOTE}
            rows={3}
            placeholder={t('What stayed with you?')}
            aria-label={t('Your comment')}
            onChange={event => setNote(event.target.value)}
          />
          <small>{t('Everyone sees your comment with your stars (anonymously, or with your nickname). You can edit or delete it any time.')} {note.length}/{MAX_NOTE}</small>
          <textarea
            value={privateNote}
            maxLength={MAX_NOTE}
            rows={2}
            placeholder={t('A private note — only you see it')}
            aria-label={t('Private note')}
            onChange={event => setPrivateNote(event.target.value)}
          />
          <span className="world-launcher__note-actions">
            <button type="submit">{t('Post comment')}</button>
            {social.review?.comment && (
              <button type="button" onClick={() => { void data.setReview(social.key, mine, ''); setNote(''); setNoteOpen(false); }}>{t('Delete comment')}</button>
            )}
          </span>
        </form>
      )}
      {commentsOpen && <CommentList worldKey={social.key} t={t} />}
    </div>
  );
}
