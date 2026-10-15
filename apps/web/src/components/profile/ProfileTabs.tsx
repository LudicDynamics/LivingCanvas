/**
 * The account popup's 我的记录 / 奖励 / CG tabs (components/account/AccountDialog.tsx; the design notes, formerly
 * the full-screen 个人页面, the design notes; / 10-04):
 *   我的记录  overview, playthroughs (world, ending, date, play time, turns, secrets x/y, 「再玩一次」), credits used
 *   奖励      today's allowance, the account's billing rewards (claimable / 「玩一会儿后解锁 · n/20」 / claimed),
 *            achievements
 *   CG       the CGs seen, a large view with the share cards made from that CG + 「生成分享卡」, and 「我的分享卡」
 * Signed out they show this device's records and a sign-in line; signed in, chronicle and the wallet add every
 * device's playthroughs and the credits. All mapping is in lib/profile-model.ts; this file only loads and draws.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CalendarCheck, Crown, DoorOpen, Flag, Globe, Heart, Image as ImageIcon, Images, KeyRound, Lock, Map as MapIcon, PenLine, Sparkles, Star, X,
  type LucideIcon,
} from 'lucide-react';
import { useLocale } from '../../lib/i18n.js';
import { withBase } from '../../lib/base-path.js';
import { accountData, rewardState, useAccountData, type AccountUsage, type InviteInfo } from '../../lib/account-data.js';
import { shareCards, SHARE_CARDS_CHANGED, type ShareCardRecord } from '../../lib/share-card-store.js';
import { ShareCardDialog } from '../chrome/ShareCardDialog.js';
import { useAccountLayer } from '../account/account-layer.js';
import { RewardList, useRewardClaims } from '../chrome/RewardList.js';
import { DailyClaim } from '../chrome/DailyClaim.js';
import '../chrome/invite.css';
import { airpGateway, type WorldShelf } from '../../lib/airp-gateway.js';
import { PLAN_TIERS, endingNote, planTier, trialNote } from '../../lib/plans.js';
import type { AchievementIcon, AchievementState } from '../../lib/achievements.js';
import { readEndingCollections, readJournal, reportPendingEndings, writeJournal } from '../../lib/profile-journal.js';
import { buildProfile, settleEarned, type AccountProfileData, type CgEntry, type ProfileModel, type ProfileSaveRecord } from '../../lib/profile-model.js';
import './profile-page.css';

const ICONS: Record<AchievementIcon, LucideIcon> = {
  door: DoorOpen, flag: Flag, map: MapIcon, crown: Crown, key: KeyRound, image: ImageIcon, gallery: Images,
  star: Star, heart: Heart, pen: PenLine, globe: Globe, calendar: CalendarCheck,
};

interface Loaded {
  groups: NonNullable<WorldShelf['groups']>;
  saves: ProfileSaveRecord[];
  account: AccountProfileData | null;
  usage: AccountUsage | null;
}

async function loadProfileSources(): Promise<Loaded> {
  const json = (url: string) => fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  const [shelf, saves, account, usage] = await Promise.all([
    airpGateway.worlds().catch(() => null),
    json('/api/profile/saves'),
    json('/api/profile/account'),
    accountData()?.loadUsage().catch(() => null) ?? Promise.resolve(null),
  ]);
  return {
    groups: shelf?.groups ?? [],
    saves: Array.isArray(saves?.saves) ? saves.saves : [],
    account: account?.ok && account.account ? account.account as AccountProfileData : null,
    usage: usage ?? null,
  };
}

export const cgUrl = (c: Pick<CgEntry, 'saveId' | 'path'>) => withBase(`/api/profile/cg?save=${encodeURIComponent(c.saveId)}&path=${encodeURIComponent(c.path)}`);

/** Load every source once per popup and build the model; new badges are settled (and announced) once. */
export function useProfile(): { model: ProfileModel | null; announce: AchievementState[]; usage: AccountUsage | null } {
  const { locale } = useLocale();
  const data = useAccountData();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [announce, setAnnounce] = useState<AchievementState[]>([]);
  const settled = useRef(false);

  useEffect(() => {
    let live = true;
    void reportPendingEndings();
    void loadProfileSources().then((l) => { if (live) setLoaded(l); });
    return () => { live = false; };
  }, []);

  const model: ProfileModel | null = useMemo(() => {
    if (!loaded) return null;
    return buildProfile({
      groups: loaded.groups,
      saves: loaded.saves,
      summaries: data.saves,
      reviews: data.reviews,
      favorites: data.favorites,
      journal: readJournal(),
      collections: readEndingCollections(),
      account: loaded.account,
      usage: loaded.usage,
      locale,
      now: Date.now(),
    });
  }, [loaded, data.saves, data.reviews, data.favorites, locale]);

  // badges: remember when each was first earned, announce the new ones once
  useEffect(() => {
    if (!model || settled.current) return;
    settled.current = true;
    const { journal, announce: fresh } = settleEarned(readJournal(), model.achievements, new Date().toISOString());
    writeJournal(journal);
    setAnnounce(fresh);
  }, [model]);

  return { model, announce, usage: loaded?.usage ?? null };
}

function Loading() {
  const { t } = useLocale();
  return <p className="profile-page__muted" role="status">{t('Loading…')}</p>;
}

function SignInLine({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useLocale();
  return (
    <p className="profile-page__signin" data-testid="profile-signin">
      {t('Only this device’s records are shown. Sign in to keep them across devices and see your credits.')}
      <button type="button" className="profile-page__link" onClick={onSignIn}>{t('Sign in / Sign up')}</button>
    </p>
  );
}

/** 我的记录 */
export function RecordsTab({ model, announce, onSignIn, onPlay }: { model: ProfileModel | null; announce: AchievementState[]; onSignIn: () => void; onPlay: (path: string) => void }) {
  const { t, locale } = useLocale();
  if (!model) return <Loading />;
  return (
    <div className="profile-page" data-testid="records-tab">
      {announce.length > 0 && (
        <p className="profile-page__notice" role="status" data-testid="profile-notice">
          <Sparkles aria-hidden="true" />
          {t('You earned: {names}', { names: announce.map((a) => t(a.def.title)).join(locale === 'en' || locale === 'ko' ? ', ' : '、') })}
        </p>
      )}
      {!model.signedIn && <SignInLine onSignIn={onSignIn} />}
      <Overview model={model} />
      <History model={model} onPlay={onPlay} />
      <Usage model={model} />
    </div>
  );
}

/** 奖励: today's allowance, billing rewards (all states, claimed included), achievements. */
export function RewardsTab({ model, usage, onSignIn }: { model: ProfileModel | null; usage: AccountUsage | null; onSignIn: () => void }) {
  const { t } = useLocale();
  const [daily, setDaily] = useState(usage?.wallet?.daily ?? null);
  useEffect(() => { setDaily(usage?.wallet?.daily ?? null); }, [usage]);
  const { rewards, loaded, busy, status, claim } = useRewardClaims(['claimable', 'pending_verification', 'claimed']);
  if (!model) return <Loading />;
  // claimable first, then the ones still unlocking, then the claimed ones
  const order = { claimable: 0, pending_verification: 1, claimed: 2, revoked: 3, expired: 4 } as const;
  const sorted = [...rewards].sort((a, b) => order[rewardState(a)] - order[rewardState(b)]);
  return (
    <div className="profile-page" data-testid="rewards-tab">
      {!model.signedIn && <SignInLine onSignIn={onSignIn} />}
      {model.signedIn && (
        <Section id="rewards" title={t('Rewards')}>
          {daily && <DailyClaim daily={daily} unit={usage?.wallet?.pointName || t('credits')} onClaimed={(c) => setDaily(c.daily ?? { ...daily, claimable: false })} />}
          {sorted.length > 0
            ? <RewardList rewards={sorted} busy={busy} onClaim={(r) => void claim(r)} />
            : loaded && !daily ? <p className="profile-page__muted">{t('No rewards yet. Invite a friend or come back tomorrow.')}</p> : null}
          {status && <p className="profile-page__muted" role={status.error ? 'alert' : 'status'}>{status.text}</p>}
        </Section>
      )}
      <Achievements model={model} />
    </div>
  );
}

function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section className="profile-page__section" aria-labelledby={`profile-${id}`} data-section={id}>
      <div className="profile-page__section-head">
        <h3 id={`profile-${id}`}>{title}</h3>
        {aside && <span className="profile-page__muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function useFormat() {
  const { t, locale } = useLocale();
  const date = useMemo(() => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }), [locale]);
  const day = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }), [locale]);
  return {
    date: (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? date.format(new Date(iso)) : '—'),
    day: (key: string) => day.format(new Date(`${key}T12:00:00`)),
    duration: (ms: number) => {
      const minutes = Math.max(1, Math.round(ms / 60_000));
      const h = Math.floor(minutes / 60);
      return h ? t('{h} h {m} min', { h, m: minutes % 60 }) : t('{m} min', { m: minutes });
    },
    number: (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 1 }),
  };
}

function Overview({ model }: { model: ProfileModel }) {
  const { t } = useLocale();
  const f = useFormat();
  const o = model.overview;
  const tier = PLAN_TIERS.find((p) => p.id === planTier(o.plan))!;
  const trial = trialNote(t, o.trialEndsAt);
  const ending = trial ? null : endingNote(t, o.endsAt);
  const tiles: { label: string; value: string; note?: string | null }[] = [
    { label: t('Plan'), value: model.signedIn || o.plan ? t(tier.name) : '—', note: trial ?? ending },
    { label: t('Balance'), value: o.balance !== null ? `${f.number(o.balance)} ${o.pointName || t('credits')}` : '—' },
    { label: t('Play time'), value: o.playMs > 0 ? f.duration(o.playMs) : '—' },
    { label: t('Endings'), value: String(o.endings) },
    { label: t('Playthroughs'), value: String(o.playthroughs) },
    { label: t('Turns'), value: f.number(o.turns) },
  ];
  return (
    <section className="profile-page__overview" aria-label={t('Overview')} data-section="overview">
      {tiles.map((tile) => (
        <div key={tile.label} className="profile-page__tile">
          <span className="profile-page__tile-label">{tile.label}</span>
          <span className="profile-page__tile-value">{tile.value}</span>
          {tile.note && <span className="profile-page__tile-note">{tile.note}</span>}
        </div>
      ))}
    </section>
  );
}

function History({ model, onPlay }: { model: ProfileModel; onPlay: (path: string) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const [all, setAll] = useState(false);
  const rows = all ? model.history : model.history.slice(0, 8);
  return (
    <Section id="history" title={t('Play history')} aside={model.overview.worlds ? t('{count} worlds', { count: model.overview.worlds }) : null}>
      {model.history.length === 0 ? <p className="profile-page__muted">{t('No playthroughs yet.')}</p> : (
        <ul className="profile-page__history">
          {rows.map((row) => (
            <li key={row.saveId} className="profile-page__run">
              <div className="profile-page__run-cover" style={row.cover ? { backgroundImage: `url("${withBase(row.cover)}")` } : undefined} aria-hidden="true" />
              <div className="profile-page__run-body">
                <p className="profile-page__run-title">{row.name}</p>
                <p className="profile-page__run-meta">
                  {[
                    row.startedAt && row.lastAt && f.date(row.startedAt) !== f.date(row.lastAt) ? `${f.date(row.startedAt)} – ${f.date(row.lastAt)}` : f.date(row.lastAt ?? row.startedAt),
                    t('{turns} turns', { turns: row.turns }),
                    row.playMs ? f.duration(row.playMs) : null,
                    row.secrets ? t('Secrets {found}/{total}', { found: row.secrets.found, total: row.secrets.total }) : null,
                    row.onDevice ? null : t('Another device'),
                  ].filter(Boolean).join(' · ')}
                </p>
                {row.endings.length > 0
                  ? row.endings.map((e) => <p key={e.id} className="profile-page__run-ending"><Flag aria-hidden="true" />{t('Ending: {title}', { title: e.title })}{e.at ? <span className="profile-page__muted"> · {f.date(e.at)}</span> : null}</p>)
                  : row.scene ? <p className="profile-page__muted">{row.scene}</p> : null}
              </div>
              {row.playPath && (
                <button type="button" className="profile-page__again account-panel__secondary" data-testid="play-again" onClick={() => onPlay(row.playPath!)}>{t('Play this world again')}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {model.history.length > 8 && (
        <button type="button" className="profile-page__link" onClick={() => setAll((v) => !v)}>{all ? t('Show fewer') : t('Show all ({count})', { count: model.history.length })}</button>
      )}
      {model.endingsByWorld.length > 0 && (
        <div className="profile-page__endings">
          <h4>{t('Endings by world')}</h4>
          <ul>
            {model.endingsByWorld.map((w) => (
              <li key={w.worldKey}>
                <span className="profile-page__endings-world">{w.name}</span>
                <span className="profile-page__muted">{w.total ? t('{reached} / {total} endings', { reached: w.reached.length, total: w.total }) : t('{count} endings', { count: w.reached.length })}</span>
                <span className="profile-page__endings-list">{w.reached.map((e) => e.title).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function Usage({ model }: { model: ProfileModel }) {
  const { t } = useLocale();
  const f = useFormat();
  const u = model.usage;
  const known = u.days.filter((d) => d.credits !== null);
  const max = Math.max(1e-9, ...known.map((d) => d.credits ?? 0));
  const total = known.reduce((a, d) => a + (d.credits ?? 0), 0);
  return (
    <Section id="usage" title={t('Credits used')} aside={known.length ? t('Last {days} days: {total}', { days: u.days.length, total: f.number(total) }) : null}>
      {u.today && u.month && <p className="profile-page__muted">{t('AI today: {today} tokens · this month: {month} tokens', { today: f.number(u.today.tokens), month: f.number(u.month.tokens) })}</p>}
      {!model.signedIn ? <p className="profile-page__muted">{t('Sign in to see the credits you used.')}</p>
        : known.length === 0 ? <p className="profile-page__muted">{t('Daily credits are not available right now.')}</p>
        : (
          <div className="profile-page__chart" role="img" aria-label={t('Credits used per day')}>
            {u.days.map((d) => (
              <div key={d.day} className="profile-page__bar" data-unknown={d.credits === null || undefined} title={`${f.day(d.day)} · ${d.credits === null ? '—' : f.number(d.credits)}`}>
                <span className="profile-page__bar-fill" style={{ height: d.credits === null ? '0%' : `${Math.max(d.credits > 0 ? 4 : 0, (d.credits / max) * 100)}%` }} />
                <span className="profile-page__bar-day">{f.day(d.day)}</span>
              </div>
            ))}
          </div>
        )}
      {model.signedIn && !u.complete && known.length > 0 && <p className="profile-page__fine">{t('Older days are not counted here.')}</p>}
      {u.byWorld.length > 0 && (
        <div className="profile-page__worlds">
          <h4>{t('By world (share of turns)')}</h4>
          <ul>
            {u.byWorld.slice(0, 6).map((w) => (
              <li key={w.worldKey}>
                <span className="profile-page__worlds-name">{w.name}</span>
                <span className="profile-page__worlds-bar"><span style={{ width: `${Math.round(w.share * 100)}%` }} /></span>
                <span className="profile-page__muted">{Math.round(w.share * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function Achievements({ model }: { model: ProfileModel }) {
  const { t } = useLocale();
  const f = useFormat();
  const earned = model.achievements.filter((a) => a.earned).length;
  return (
    <Section id="achievements" title={t('Achievements')} aside={t('{earned} / {total} earned', { earned, total: model.achievements.length })}>
      <ul className="profile-page__badges">
        {model.achievements.map((a) => {
          const Icon = ICONS[a.def.icon];
          return (
            <li key={a.def.id} className="profile-page__badge" data-earned={a.earned || undefined} data-testid={`badge-${a.def.id}`}>
              <span className="profile-page__badge-icon" aria-hidden="true">{a.earned ? <Icon /> : <Lock />}</span>
              <span className="profile-page__badge-title">{a.earned ? t(a.def.title) : t('Locked')}</span>
              <span className="profile-page__badge-hint">
                {a.earned ? (a.earnedAt ? f.date(a.earnedAt) : t(a.def.hint)) : t(a.def.hint)}
                {!a.earned && a.def.goal > 1 ? ` (${a.value}/${a.def.goal})` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Object URLs for share-card blobs, revoked when the list changes / unmounts. */
function useCardUrls(cards: ShareCardRecord[]): Map<string, string> {
  const urls = useMemo(() => new Map(cards.map((c) => [c.id, URL.createObjectURL(c.blob)] as const)), [cards]);
  useEffect(() => () => { for (const u of urls.values()) URL.revokeObjectURL(u); }, [urls]);
  return urls;
}

/** 「我的分享卡」 (lib/share-card-store.ts): newest used first; optionally only one CG's cards. */
function useShareCards(cgPath?: string): ShareCardRecord[] {
  const [cards, setCards] = useState<ShareCardRecord[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void shareCards().list(cgPath ? { cgPath } : undefined).then((l) => { if (live) setCards(l); }).catch(() => {});
    load();
    window.addEventListener(SHARE_CARDS_CHANGED, load);
    return () => { live = false; window.removeEventListener(SHARE_CARDS_CHANGED, load); };
  }, [cgPath]);
  return cards;
}

function ShareCardStrip({ cards, testId }: { cards: ShareCardRecord[]; testId: string }) {
  const { t } = useLocale();
  const f = useFormat();
  const urls = useCardUrls(cards);
  return (
    <ul className="profile-page__cards" data-testid={testId}>
      {cards.map((c) => (
        <li key={c.id} className="profile-page__card" data-format={c.format}>
          <a href={urls.get(c.id)} download={`livingcanvas-${c.kind}-${c.format}.png`} onClick={() => void shareCards().touch(c.id)} title={t('Download')}>
            <img src={urls.get(c.id)} alt={[c.worldTitle, c.endingTitle].filter(Boolean).join(' · ') || t('Share image')} loading="lazy" />
          </a>
          <span className="profile-page__card-meta">
            {c.kind === 'result' ? t('Share result') : t('Share image')} · {f.date(new Date(c.createdAt).toISOString())}
          </span>
          <button type="button" className="profile-page__link" aria-label={t('Delete share card')} onClick={() => void shareCards().remove(c.id)}>{t('Delete')}</button>
        </li>
      ))}
    </ul>
  );
}

/** CG: the galleries, then 「我的分享卡」. A CG opens large with its cards and 「生成分享卡」. */
export function CgTab({ model }: { model: ProfileModel | null }) {
  const { t } = useLocale();
  const [viewing, setViewing] = useState<CgEntry | null>(null);
  const all = useShareCards();
  // Esc closes the large view first, not the popup: a surface above the popup in App's Escape router
  // (../account/account-layer.ts); without a router (tests, embeds) its own capture-phase key.
  const routed = useAccountLayer('cg-view', viewing !== null, () => setViewing(null));
  useEffect(() => {
    if (!viewing || routed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setViewing(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [viewing, routed]);
  if (!model) return <Loading />;
  if (viewing) return <CgViewer cg={viewing} onClose={() => setViewing(null)} />;
  return (
    <div className="profile-page" data-testid="cg-tab">
      <Section id="gallery" title={t('CG gallery')}>
        {model.galleries.length === 0 ? <p className="profile-page__muted">{t('No CGs yet. A picture appears here once a world shows it to you.')}</p> : model.galleries.map((g) => (
          <div key={g.worldKey} className="profile-page__gallery">
            <h4>{g.name} <span className="profile-page__muted">{g.seen.length} / {g.total}</span></h4>
            <ul>
              {g.seen.map((c) => (
                <li key={c.path}>
                  <button type="button" className="profile-page__thumb" onClick={() => setViewing(c)} aria-label={t('Open CG from {world}', { world: g.name })}>
                    <img src={cgUrl(c)} alt="" loading="lazy" decoding="async" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
      <Section id="share-cards" title={t('My share cards')} aside={all.length ? String(all.length) : null}>
        {all.length === 0 ? <p className="profile-page__muted">{t('Share cards you download or share are kept here, on this browser.')}</p> : <ShareCardStrip cards={all} testId="my-share-cards" />}
      </Section>
    </div>
  );
}

function CgViewer({ cg, onClose }: { cg: CgEntry; onClose: () => void }) {
  const { t } = useLocale();
  const cards = useShareCards(cg.path);
  const [invite, setInvite] = useState<InviteInfo | null | undefined>(undefined);
  const [making, setMaking] = useState(false);
  useEffect(() => {
    let live = true;
    void (accountData()?.invite() ?? Promise.resolve(null)).then((i) => { if (live) setInvite(i ?? null); }).catch(() => { if (live) setInvite(null); });
    return () => { live = false; };
  }, []);
  const artId = `cg:${cg.worldKey}|${cg.path}`;
  return (
    <div className="profile-page profile-page__cg-view" data-testid="cg-view">
      <button type="button" className="profile-page__link" onClick={onClose}>{t('Back to gallery')}</button>
      <figure className="profile-page__cg-large">
        <img src={cgUrl(cg)} alt={cg.caption ?? ''} />
        <figcaption>{cg.worldName}{cg.caption ? ` · ${cg.caption}` : ''}</figcaption>
      </figure>
      <div className="profile-page__cg-actions">
        <button type="button" className="account-panel__action" data-testid="make-share-card" disabled={!invite?.enabled} onClick={() => setMaking(true)}>{t('Create share card')}</button>
        {invite === null && <span className="profile-page__muted">{t('Sign in to make share cards.')}</span>}
      </div>
      <Section id="cg-cards" title={t('Share cards from this CG')}>
        {cards.length === 0 ? <p className="profile-page__muted">{t('None yet.')}</p> : <ShareCardStrip cards={cards} testId="cg-share-cards" />}
      </Section>
      {making && invite && (
        <ShareCardDialog
          kind="invite"
          code={invite.code}
          url={invite.shareUrl}
          credits={invite.inviteeCredits}
          worldTitle={cg.worldName}
          extraArt={[{ id: artId, label: cg.caption || cg.worldName, src: cgUrl(cg), caption: cg.caption, worldTitle: cg.worldName, worldKey: cg.worldKey, cgPath: cg.path }]}
          initialPick={artId}
          onClose={() => setMaking(false)}
        />
      )}
    </div>
  );
}
