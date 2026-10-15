/**
 * 个人页面 data mapping: every source the page
 * reads → one model. Pure: no fetch, no storage, no clock (all passed in), so
 * the whole mapping is unit-tested (apps/web/test/profile-model.test.mjs).
 *
 * Sources, and what each is trusted for:
 *   saves        GET /api/profile/saves — this device's saves: the ending reached, the 复盘,
 *                the CGs shown, gallery and ending counts (files only)
 *   summaries    lib/account-data.ts — every save the account played anywhere: turns, scene
 *   account      GET /api/profile/account — chronicle playthroughs + endings (cross-device),
 *                the wallet's entries (credits per day, daily claims); null = signed out
 *   usage        lib/account-data.ts loadUsage — plan, balance, tokens today / this month
 *   journal      lib/profile-journal.ts — endings seen here, play time, badges already earned
 *   collections  ClosedRun's older per-edition ending collection (titles only)
 *   groups       GET /api/worlds — names, covers, editions, the workshop
 */
import { evaluateAchievements, type AchievementState, type AchievementStats } from './achievements.js';
import type { AccountUsage, SaveSummary } from './account-data.js';
import type { WorldShelf } from './airp-gateway.js';
import type { JournalEnding, ProfileJournal } from './profile-journal.js';
import { worldTitle } from './world-launcher.js';

export type Group = NonNullable<WorldShelf['groups']>[number];

/** One save on this device (apps/server/src/profile-saves.ts ProfileSave). */
export interface ProfileSaveRecord {
  saveId: string;
  manifestId: string;
  name: string;
  locale: string | null;
  mode: 'open' | 'semi' | 'closed';
  createdAt: string | null;
  updatedAt: string;
  endingsTotal: number;
  ending: { id: string; title: string; at: string | null } | null;
  debrief: { unlocked: number; total: number; at: string | null } | null;
  mysteriesTotal: number;
  cgs: { path: string; caption: string | null; at: string | null }[];
  cgTotal: number;
  workshop: { status: 'draft' | 'published'; owner: string; createdAt: string; publishedAt: string | null } | null;
}

/** GET /api/profile/account `account` (apps/server/src/sync/profile-data.ts AccountProfile). */
export interface AccountProfileData {
  playthroughs: { saveId: string; worldRef: string | null; worldTitle: string | null; startedAt: string | null; lastTurnAt: string | null; lastPlayedAt: string | null; turns: number; playSeconds: number; endings: { id: string; title: string | null; at: string | null }[] }[];
  endings: { worldRef: string | null; id: string; title: string | null; firstAt: string | null; times: number }[];
  summary: { playthroughs: number; turns: number; playSeconds: number; endings: number; daysPlayed: number; firstPlayedAt: string | null } | null;
  ledger: { entries: { at: string; credits: number; kind: string; ref: string | null }[]; complete: boolean } | null;
}

export interface ProfileInputs {
  groups: readonly Group[];
  saves: readonly ProfileSaveRecord[];
  summaries: readonly SaveSummary[];
  reviews: Readonly<Record<string, unknown>>;
  favorites: Iterable<string>;
  journal: ProfileJournal;
  collections: readonly { worldRef: string; endingId: string; title: string }[];
  account: AccountProfileData | null;
  usage: AccountUsage | null;
  /** The interface language: picks which edition names a world. */
  locale: string;
  now: number;
  /** ms → the player's calendar day "YYYY-MM-DD" (default: this browser's time zone). */
  dayKey?: (ms: number) => string;
  /** Days in the usage chart (default 14). */
  days?: number;
}

export interface EndingRecord { worldKey: string; endingId: string; title: string; firstAt: string | null; times: number }
export interface HistoryRow {
  saveId: string;
  worldKey: string;
  edition: string | null;
  name: string;
  cover: string | null;
  scene: string | null;
  startedAt: string | null;
  lastAt: string | null;
  turns: number;
  /** Active play time (this device's journal); null when not recorded. */
  playMs: number | null;
  endings: { id: string; title: string; at: string | null }[];
  /** 复盘 secrets found / total (this device's save debrief); null when the world has none or it is unknown. */
  secrets: { found: number; total: number } | null;
  /** 「再玩一次」: the world's template to start a new run from (its edition, else the naming one); null = not on this shelf. */
  playPath: string | null;
  onDevice: boolean;
}
export interface WorldEndings { worldKey: string; name: string; cover: string | null; reached: EndingRecord[]; total: number | null }
export interface UsageDay { day: string; credits: number | null }
export interface CgEntry { worldKey: string; worldName: string; saveId: string; path: string; caption: string | null; at: string | null }
export interface WorldGallery { worldKey: string; name: string; seen: CgEntry[]; total: number }

export interface ProfileModel {
  signedIn: boolean;
  overview: {
    plan: string | null;
    trialEndsAt: string | null;
    /** a canceled paid subscription's end (won't renew); null = renews / none */
    endsAt: string | null;
    balance: number | null;
    pointName: string | null;
    playMs: number;
    endings: number;
    playthroughs: number;
    worlds: number;
    turns: number;
  };
  history: HistoryRow[];
  endingsByWorld: WorldEndings[];
  usage: {
    days: UsageDay[];
    /** false = the wallet had more entries than were read: the oldest days are unknown (null). */
    complete: boolean;
    today: { tokens: number } | null;
    month: { tokens: number } | null;
    /** Turns per world: where the play (and so the credits) went. */
    byWorld: { worldKey: string; name: string; turns: number; share: number }[];
  };
  achievements: AchievementState[];
  galleries: WorldGallery[];
}

const EDITION_SUFFIX = /-(jp|zh|ko)$/;
const maxIso = (...xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().pop() ?? null;
const minIso = (...xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort()[0] ?? null;

export function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Longest run of consecutive calendar days ("YYYY-MM-DD"). */
export function longestStreak(days: Iterable<string>): number {
  const sorted = [...new Set(days)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  let best = 0;
  let run = 0;
  let prev = NaN;
  for (const d of sorted) {
    const t = Date.parse(`${d}T00:00:00Z`);
    run = t - prev === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

export function buildProfile(input: ProfileInputs): ProfileModel {
  const dayKey = input.dayKey ?? localDayKey;
  const groupById = new Map(input.groups.map((g) => [g.id, g] as const));
  const groupOfSave = new Map<string, Group>();
  for (const g of input.groups) for (const s of g.saves) groupOfSave.set(s.id, g);
  const keyOfGroup = (g: Group) => (g.workshop ? g.id : g.id.replace(EDITION_SUFFIX, ''));
  const keyOfEdition = (edition: string) => { const g = groupById.get(edition); return g ? keyOfGroup(g) : edition.replace(EDITION_SUFFIX, ''); };

  // the edition that names a world: the interface language's, else the original, else any
  const groupsOfKey = new Map<string, Group[]>();
  for (const g of input.groups) groupsOfKey.set(keyOfGroup(g), [...(groupsOfKey.get(keyOfGroup(g)) ?? []), g]);
  const namingGroup = (key: string) => {
    const gs = groupsOfKey.get(key) ?? [];
    return gs.find((g) => g.locale === input.locale) ?? gs.find((g) => g.id === key) ?? gs[0] ?? null;
  };
  const fallbackNames = new Map<string, string>();
  const nameOf = (key: string) => { const g = namingGroup(key); return worldTitle(g?.name ?? fallbackNames.get(key) ?? key); };
  const coverOf = (key: string) => namingGroup(key)?.cover ?? null;

  const savesById = new Map(input.saves.map((s) => [s.saveId, s] as const));
  const summaryById = new Map(input.summaries.map((s) => [s.saveId, s] as const));
  const ptById = new Map((input.account?.playthroughs ?? []).map((p) => [p.saveId, p] as const));
  const journalBySave = new Map<string, JournalEnding[]>();
  for (const e of input.journal.endings) journalBySave.set(e.saveId, [...(journalBySave.get(e.saveId) ?? []), e]);

  // ── history: one row per save, wherever it was seen ──────────────────────────
  const ids = new Set<string>([...savesById.keys(), ...summaryById.keys(), ...ptById.keys(), ...journalBySave.keys()]);
  const history: HistoryRow[] = [];
  for (const saveId of ids) {
    const save = savesById.get(saveId);
    const sum = summaryById.get(saveId);
    const pt = ptById.get(saveId);
    const journaled = journalBySave.get(saveId) ?? [];
    const group = groupOfSave.get(saveId);
    const edition = group?.id ?? save?.manifestId ?? pt?.worldRef ?? journaled[0]?.worldRef ?? null;
    const worldKey = group ? keyOfGroup(group) : edition ? keyOfEdition(edition) : sum?.worldId ?? null;
    if (!worldKey) continue;
    const rawName = save?.name ?? pt?.worldTitle ?? sum?.worldName ?? journaled[0]?.worldName ?? null;
    if (rawName && !fallbackNames.has(worldKey)) fallbackNames.set(worldKey, rawName);
    const endings = new Map<string, { id: string; title: string; at: string | null }>();
    const addEnding = (id: string, title: string | null, at: string | null) => {
      const had = endings.get(id);
      endings.set(id, { id, title: had?.title ?? title ?? id, at: minIso(had?.at, at) });
    };
    for (const e of pt?.endings ?? []) addEnding(e.id, e.title, e.at);
    if (save?.ending) addEnding(save.ending.id, save.ending.title, save.ending.at);
    for (const e of journaled) addEnding(e.endingId, e.title, e.at);
    const play = input.journal.play[saveId];
    history.push({
      saveId,
      worldKey,
      edition,
      name: worldTitle(rawName ?? worldKey),
      cover: coverOf(worldKey),
      scene: sum?.scene ?? null,
      startedAt: minIso(pt?.startedAt, save?.createdAt, play ? new Date(play.first).toISOString() : null, journaled[0]?.startedAt),
      lastAt: maxIso(pt?.lastTurnAt, pt?.lastPlayedAt, sum?.updatedAt, save?.updatedAt, play ? new Date(play.last).toISOString() : null),
      turns: Math.max(pt?.turns ?? 0, sum?.turns ?? 0, play?.turns ?? 0, ...journaled.map((e) => e.turns ?? 0)),
      playMs: play ? play.ms : pt?.playSeconds ? pt.playSeconds * 1000 : null,
      endings: [...endings.values()].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')),
      secrets: save?.debrief && save.debrief.total > 0 ? { found: save.debrief.unlocked, total: save.debrief.total } : null,
      playPath: (edition ? groupById.get(edition)?.templatePath : null) ?? (worldKey ? namingGroup(worldKey)?.templatePath : null) ?? null,
      onDevice: !!save,
    });
  }
  history.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  // a save nobody played a turn in (the default world the server opens, a load and leave) counts as a world
  // entered, but is not a playthrough
  const entered = new Set(history.map((r) => r.worldKey));
  for (let i = history.length - 1; i >= 0; i--) if (history[i].turns === 0 && history[i].endings.length === 0) history.splice(i, 1);

  // ── endings, folded per world ────────────────────────────────────────────────
  const endingMap = new Map<string, EndingRecord>();
  const noteEnding = (worldKey: string, endingId: string, title: string | null, at: string | null, times = 1) => {
    const k = `${worldKey}|${endingId}`;
    const had = endingMap.get(k);
    endingMap.set(k, { worldKey, endingId, title: had?.title ?? title ?? endingId, firstAt: minIso(had?.firstAt, at), times: Math.max(had?.times ?? 0, times) });
  };
  for (const e of input.account?.endings ?? []) if (e.worldRef) noteEnding(keyOfEdition(e.worldRef), e.id, e.title, e.firstAt, e.times);
  for (const row of history) for (const e of row.endings) noteEnding(row.worldKey, e.id, e.title, e.at);
  for (const c of input.collections) noteEnding(keyOfEdition(c.worldRef), c.endingId, c.title, null);
  // a world's ending count: the largest any of its editions on this device declares
  const endingsTotal = new Map<string, number>();
  const galleryTotal = new Map<string, number>();
  for (const s of input.saves) {
    const g = groupOfSave.get(s.saveId);
    const key = g ? keyOfGroup(g) : keyOfEdition(s.manifestId);
    endingsTotal.set(key, Math.max(endingsTotal.get(key) ?? 0, s.endingsTotal));
    galleryTotal.set(key, Math.max(galleryTotal.get(key) ?? 0, s.cgTotal));
  }
  const byWorldEndings = new Map<string, EndingRecord[]>();
  for (const e of endingMap.values()) byWorldEndings.set(e.worldKey, [...(byWorldEndings.get(e.worldKey) ?? []), e]);
  const endingsByWorld: WorldEndings[] = [...byWorldEndings.entries()].map(([worldKey, reached]) => ({
    worldKey,
    name: nameOf(worldKey),
    cover: coverOf(worldKey),
    reached: reached.sort((a, b) => (a.firstAt ?? '9').localeCompare(b.firstAt ?? '9')),
    total: endingsTotal.get(worldKey) ? Math.max(endingsTotal.get(worldKey)!, reached.length) : null,
  })).sort((a, b) => (maxIso(...b.reached.map((r) => r.firstAt)) ?? '').localeCompare(maxIso(...a.reached.map((r) => r.firstAt)) ?? ''));

  // ── CGs (this device's saves only: the pictures live in them) ─────────────────
  const cgMap = new Map<string, CgEntry>();
  for (const s of input.saves) {
    const g = groupOfSave.get(s.saveId);
    const worldKey = g ? keyOfGroup(g) : keyOfEdition(s.manifestId);
    for (const c of s.cgs) {
      const k = `${worldKey}|${c.path}`;
      const had = cgMap.get(k);
      if (!had || (c.at ?? '') > (had.at ?? '')) cgMap.set(k, { worldKey, worldName: '', saveId: s.saveId, path: c.path, caption: c.caption, at: c.at });
    }
  }
  const galleryMap = new Map<string, CgEntry[]>();
  for (const c of cgMap.values()) galleryMap.set(c.worldKey, [...(galleryMap.get(c.worldKey) ?? []), { ...c, worldName: nameOf(c.worldKey) }]);
  const galleries: WorldGallery[] = [...galleryMap.entries()].map(([worldKey, seen]) => ({
    worldKey,
    name: nameOf(worldKey),
    seen: seen.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')),
    total: Math.max(galleryTotal.get(worldKey) ?? 0, seen.length),
  })).sort((a, b) => (maxIso(...b.seen.map((c) => c.at)) ?? '').localeCompare(maxIso(...a.seen.map((c) => c.at)) ?? ''));

  // ── usage ─────────────────────────────────────────────────────────────────────
  const ledger = input.account?.ledger ?? null;
  const spentByDay = new Map<string, number>();
  let oldest: string | null = null;
  for (const e of ledger?.entries ?? []) {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    const d = dayKey(t);
    if (!oldest || d < oldest) oldest = d;
    if (e.kind === 'spend' && e.credits < 0) spentByDay.set(d, (spentByDay.get(d) ?? 0) - e.credits);
  }
  const span = Math.max(1, input.days ?? 14);
  const days: UsageDay[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const d = dayKey(input.now - i * 86_400_000);
    // the oldest day read may be cut off, and anything before it is unknown
    const unknown = !ledger || (!ledger.complete && (!oldest || d <= oldest));
    days.push({ day: d, credits: unknown ? null : Math.round((spentByDay.get(d) ?? 0) * 1000) / 1000 });
  }
  const turnsByWorld = new Map<string, number>();
  for (const row of history) turnsByWorld.set(row.worldKey, (turnsByWorld.get(row.worldKey) ?? 0) + row.turns);
  const totalTurns = [...turnsByWorld.values()].reduce((a, b) => a + b, 0);
  const byWorld = [...turnsByWorld.entries()].filter(([, n]) => n > 0)
    .map(([worldKey, turns]) => ({ worldKey, name: nameOf(worldKey), turns, share: totalTurns ? turns / totalTurns : 0 }))
    .sort((a, b) => b.turns - a.turns);

  // ── achievements ──────────────────────────────────────────────────────────────
  let bestEndings = { reached: 0, total: 0 };
  for (const w of endingsByWorld) {
    if (!w.total) continue;
    const better = w.reached.length / w.total > (bestEndings.total ? bestEndings.reached / bestEndings.total : -1);
    if (better) bestEndings = { reached: w.reached.length, total: w.total };
  }
  let bestGallery = { seen: 0, total: 0 };
  for (const g of galleries) {
    if (!g.total) continue;
    if (g.seen.length / g.total > (bestGallery.total ? bestGallery.seen / bestGallery.total : -1)) bestGallery = { seen: g.seen.length, total: g.total };
  }
  let bestDebrief = { unlocked: 0, total: 0 };
  for (const s of input.saves) if (s.debrief && s.debrief.unlocked > bestDebrief.unlocked) bestDebrief = { unlocked: s.debrief.unlocked, total: s.debrief.total };
  const madeHere = input.saves.filter((s) => s.workshop && s.saveId === s.manifestId).length;
  const claims = (ledger?.entries ?? []).map((e) => (e.ref?.startsWith('claim:daily:') ? e.ref.slice('claim:daily:'.length) : '')).filter(Boolean);
  const stats: AchievementStats = {
    worldsEntered: entered.size,
    endingsReached: endingMap.size,
    worldsWithEnding: byWorldEndings.size,
    bestEndings,
    bestDebrief,
    cgsSeen: cgMap.size,
    bestGallery,
    reviews: Object.keys(input.reviews).length,
    favorites: new Set(input.favorites).size,
    workshopMade: Math.max(madeHere, input.groups.filter((g) => g.workshop?.mine).length),
    workshopPublished: input.groups.filter((g) => g.workshop?.mine && g.workshop.status === 'published').length,
    claimStreak: longestStreak(claims),
  };

  const journalMs = Object.values(input.journal.play).reduce((a, p) => a + (p.ms || 0), 0);
  const usage = input.usage;
  return {
    signedIn: input.account !== null,
    overview: {
      plan: usage?.membership?.plan ?? usage?.plan ?? null,
      trialEndsAt: usage?.membership?.trialEndsAt ?? null,
      endsAt: usage?.membership?.endsAt ?? null,
      balance: usage?.wallet?.available ?? null,
      pointName: usage?.wallet?.pointName ?? null,
      playMs: Math.max(journalMs, (input.account?.summary?.playSeconds ?? 0) * 1000),
      endings: endingMap.size,
      playthroughs: Math.max(history.length, input.account?.summary?.playthroughs ?? 0),
      worlds: stats.worldsEntered,
      turns: Math.max(totalTurns, input.account?.summary?.turns ?? 0),
    },
    history,
    endingsByWorld,
    usage: {
      days,
      complete: !!ledger?.complete,
      today: usage?.today ? { tokens: usage.today.tokens } : null,
      month: usage?.month ? { tokens: usage.month.tokens } : null,
      byWorld,
    },
    achievements: evaluateAchievements(stats, input.journal.earned),
    galleries,
  };
}

/**
 * Remember newly earned badges (with today's time) and which the page has
 * announced. → the journal to write and the badges to announce in 「你获得了…」.
 */
export function settleEarned(journal: ProfileJournal, achievements: readonly AchievementState[], nowIso: string): { journal: ProfileJournal; announce: AchievementState[] } {
  const earned = { ...journal.earned };
  for (const a of achievements) if (a.earned && !earned[a.def.id]) earned[a.def.id] = nowIso;
  const seen = new Set(journal.seen);
  const announce = achievements.filter((a) => a.earned && !seen.has(a.def.id)).map((a) => ({ ...a, earnedAt: earned[a.def.id] }));
  for (const a of announce) seen.add(a.def.id);
  return { journal: { ...journal, earned, seen: [...seen] }, announce };
}
