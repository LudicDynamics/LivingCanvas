// 个人页面 data mapping (lib/profile-model.ts, lib/achievements.ts, lib/profile-journal.ts;
// the design notes): every source → one model.
//
// Pinned:
//   - one history row per save wherever it was seen (this device, the account's summaries,
//     chronicle), editions folded into one world key, named in the interface language;
//   - endings deduped per world + ending across chronicle, saves, the journal and the old
//     per-edition collection; a world's total from the saves on this device;
//   - credits per day from the wallet's spends only; unknown days when the wallet was cut off;
//     by-world = share of turns;
//   - CGs from this device's saves, deduped per world + picture; gallery size;
//   - achievements from those facts; once earned never lost; claim streak from daily claims;
//   - the journal: play time from turn gaps, endings once per run, announcements once.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const { buildProfile, settleEarned, longestStreak } = await jiti.import('../src/lib/profile-model.ts');
const { ACHIEVEMENTS, evaluateAchievements } = await jiti.import('../src/lib/achievements.ts');
const { addTurn, addEnding, readJournal, writeJournal, readEndingCollections, PLAY_GAP_MS, TURN_MS, JOURNAL_KEY } = await jiti.import('../src/lib/profile-journal.ts');

const NOW = Date.parse('2026-10-03T12:00:00.000Z');
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const emptyJournal = () => ({ endings: [], play: {}, earned: {}, seen: [] });

const groups = [
  { id: 'whitechapel', name: 'Whitechapel', templatePath: 'templates/whitechapel', cover: '/api/worlds/cover?id=whitechapel', locale: 'en', saves: [] },
  { id: 'whitechapel-zh', name: '白教堂 · 中文', templatePath: 'templates/whitechapel-zh', cover: '/api/worlds/cover?id=whitechapel-zh', locale: 'zh-CN', saves: [{ id: 'wc-zh-1', path: 'worlds/wc-zh-1', updatedAt: '2026-10-02T10:00:00.000Z', active: false }] },
  { id: 'first-snow', name: 'First Snow', templatePath: 'templates/first-snow', cover: null, locale: 'en', saves: [{ id: 'fs-1', path: 'worlds/fs-1', updatedAt: '2026-10-01T10:00:00.000Z', active: false }] },
  { id: 'my-world', name: 'Mine', templatePath: 'published/my-world', cover: null, locale: 'en', workshop: { status: 'published', owner: 'local', mine: true, editPath: 'worlds/my-world' }, saves: [{ id: 'my-world', path: 'worlds/my-world', updatedAt: '2026-09-30T10:00:00.000Z', active: false }] },
];

const save = (over) => ({ manifestId: 'x', name: 'X', locale: 'en', mode: 'open', createdAt: null, updatedAt: '2026-10-01T00:00:00.000Z', endingsTotal: 0, ending: null, debrief: null, mysteriesTotal: 0, cgs: [], cgTotal: 0, workshop: null, ...over });
const saves = [
  save({ saveId: 'wc-zh-1', manifestId: 'whitechapel-zh', name: '白教堂', locale: 'zh-CN', mode: 'closed', createdAt: '2026-10-02T08:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z', endingsTotal: 2, ending: { id: 'caught', title: '抓住了他', at: '2026-10-02T09:50:00.000Z' }, debrief: { unlocked: 2, total: 3, at: '2026-10-02T09:55:00.000Z' }, mysteriesTotal: 3, cgs: [{ path: 'assets/cg/fire.webp', caption: '火', at: '2026-10-02T09:00:00.000Z' }], cgTotal: 2 }),
  save({ saveId: 'fs-1', manifestId: 'first-snow', name: 'First Snow', updatedAt: '2026-10-01T10:00:00.000Z', cgs: [{ path: 'assets/cg/snow.webp', caption: null, at: '2026-10-01T09:00:00.000Z' }], cgTotal: 1 }),
  save({ saveId: 'my-world', manifestId: 'my-world', name: 'Mine', updatedAt: '2026-09-30T10:00:00.000Z', workshop: { status: 'published', owner: 'local', createdAt: '2026-09-29T00:00:00.000Z', publishedAt: '2026-09-30T00:00:00.000Z' } }),
];
const summaries = [
  { saveId: 'wc-zh-1', worldId: 'whitechapel', worldName: '白教堂', scene: '停尸房', turns: 30, text: null, updatedAt: '2026-10-02T09:58:00.000Z' },
  { saveId: 'wc-en-phone', worldId: 'whitechapel', worldName: 'Whitechapel', scene: 'The morgue', turns: 12, text: null, updatedAt: '2026-10-03T08:00:00.000Z' },
  { saveId: 'fs-1', worldId: 'first-snow', worldName: 'First Snow', scene: 'Rooftop', turns: 5, text: null, updatedAt: '2026-10-01T10:00:00.000Z' },
];
const account = {
  playthroughs: [
    { saveId: 'wc-en-phone', worldRef: 'whitechapel', worldTitle: 'Whitechapel', startedAt: '2026-10-03T07:00:00.000Z', lastTurnAt: '2026-10-03T08:00:00.000Z', lastPlayedAt: '2026-10-03T08:00:00.000Z', turns: 14, playSeconds: 0, endings: [{ id: 'dawn', title: 'Dawn', at: '2026-10-03T07:59:00.000Z' }] },
    { saveId: 'wc-zh-1', worldRef: 'whitechapel-zh', worldTitle: '白教堂', startedAt: '2026-10-02T08:01:00.000Z', lastTurnAt: '2026-10-02T09:58:00.000Z', lastPlayedAt: null, turns: 31, playSeconds: 0, endings: [{ id: 'caught', title: '抓住了他', at: '2026-10-02T09:49:00.000Z' }] },
  ],
  endings: [{ worldRef: 'whitechapel-zh', id: 'caught', title: '抓住了他', firstAt: '2026-10-02T09:49:00.000Z', times: 2 }],
  summary: { playthroughs: 2, turns: 45, playSeconds: 0, endings: 2, daysPlayed: 2, firstPlayedAt: '2026-10-02T08:01:00.000Z' },
  ledger: {
    complete: true,
    entries: [
      { at: '2026-10-03T08:00:00.000Z', credits: -2.5, kind: 'spend', ref: 'request:r1' },
      { at: '2026-10-03T07:00:00.000Z', credits: -0.5, kind: 'spend', ref: 'request:r2' },
      { at: '2026-10-02T09:00:00.000Z', credits: -4, kind: 'spend', ref: 'request:r3' },
      { at: '2026-10-02T00:00:00.000Z', credits: 100, kind: 'grant', ref: 'claim:daily:2026-10-02' },
      { at: '2026-10-01T00:00:00.000Z', credits: 100, kind: 'grant', ref: 'claim:daily:2026-10-01' },
    ],
  },
};
const usage = { plan: 'free', today: { tokens: 3400, usd: 0 }, month: { tokens: 98000, usd: 0 }, wallet: { pointName: '結印', available: 1234.5, usedToday: 3, resetsAt: null }, membership: { plan: 'story', source: 'code', trialEndsAt: '2026-11-01T03:00:00.000Z' } };

const base = (over = {}) => ({
  groups, saves, summaries, reviews: {}, favorites: [], journal: emptyJournal(), collections: [], account, usage, locale: 'zh-CN', now: NOW, dayKey: utcDay, days: 4, ...over,
});

test('history: one row per save across device, summaries and chronicle; editions folded; named in the interface language', () => {
  const m = buildProfile(base());
  assert.deepEqual(m.history.map((r) => r.saveId), ['wc-en-phone', 'wc-zh-1', 'fs-1'], 'newest first; a save with no turn and no ending is not a playthrough');
  const zh = m.history.find((r) => r.saveId === 'wc-zh-1');
  assert.equal(zh.worldKey, 'whitechapel');
  assert.equal(zh.edition, 'whitechapel-zh');
  assert.equal(zh.turns, 31, 'the largest count any source has');
  assert.equal(zh.startedAt, '2026-10-02T08:00:00.000Z');
  assert.equal(zh.scene, '停尸房');
  assert.deepEqual(zh.endings, [{ id: 'caught', title: '抓住了他', at: '2026-10-02T09:49:00.000Z' }], 'one ending, earliest time');
  assert.equal(zh.onDevice, true);
  const phone = m.history.find((r) => r.saveId === 'wc-en-phone');
  assert.deepEqual([phone.worldKey, phone.onDevice, phone.turns, phone.cover], ['whitechapel', false, 14, '/api/worlds/cover?id=whitechapel-zh']);
  assert.equal(m.overview.worlds, 3, 'the unplayed workshop save still counts as a world entered');
  assert.equal(m.overview.playthroughs, 3);
  assert.equal(m.overview.turns, 50);
  assert.deepEqual([m.overview.plan, m.overview.trialEndsAt, m.overview.balance, m.overview.pointName], ['story', '2026-11-01T03:00:00.000Z', 1234.5, '結印']);
  assert.equal(m.overview.endsAt, null, 'a trial is not an ending subscription');
  assert.equal(buildProfile(base({ usage: { ...usage, membership: { plan: 'story', source: 'stripe', trialEndsAt: null, endsAt: '2026-11-05T18:09:12.000Z' } } })).overview.endsAt, '2026-11-05T18:09:12.000Z');
  assert.equal(m.signedIn, true);
});

test('endings: deduped per world + ending across every source; totals from this device; unreached titles never invented', () => {
  const m = buildProfile(base({ collections: [{ worldRef: 'whitechapel-jp', endingId: 'caught', title: '捕まえた' }, { worldRef: 'first-snow', endingId: 'thaw', title: 'Thaw' }] }));
  assert.equal(m.overview.endings, 3);
  const wc = m.endingsByWorld.find((w) => w.worldKey === 'whitechapel');
  assert.deepEqual(wc.reached.map((e) => [e.endingId, e.title, e.times]), [['caught', '抓住了他', 2], ['dawn', 'Dawn', 1]]);
  assert.equal(wc.total, 2);
  assert.equal(wc.name, '白教堂', 'the zh-CN edition names it in zh-CN');
  const fs = m.endingsByWorld.find((w) => w.worldKey === 'first-snow');
  assert.deepEqual([fs.reached[0].firstAt, fs.total], [null, null], 'an open world on this device declares no endings: no total');
});

test('usage: credits per day from spends only; cut-off wallet = unknown older days; by world = share of turns', () => {
  const m = buildProfile(base());
  assert.deepEqual(m.usage.days, [
    { day: '2026-09-30', credits: 0 }, { day: '2026-10-01', credits: 0 }, { day: '2026-10-02', credits: 4 }, { day: '2026-10-03', credits: 3 },
  ]);
  assert.equal(m.usage.complete, true);
  assert.deepEqual(m.usage.today, { tokens: 3400 });
  assert.deepEqual(m.usage.byWorld.map((w) => [w.worldKey, w.turns]), [['whitechapel', 45], ['first-snow', 5]]);
  assert.equal(m.usage.byWorld[0].share, 0.9);

  const cut = buildProfile(base({ account: { ...account, ledger: { complete: false, entries: account.ledger.entries.slice(0, 3) } } }));
  assert.deepEqual(cut.usage.days.map((d) => d.credits), [null, null, null, 3], 'the oldest day read may be partial: unknown, like everything before it');
  const out = buildProfile(base({ account: null, usage: null }));
  assert.equal(out.signedIn, false);
  assert.ok(out.usage.days.every((d) => d.credits === null));
  assert.equal(out.overview.balance, null);
  assert.deepEqual(out.history.map((r) => r.saveId).sort(), ['fs-1', 'wc-en-phone', 'wc-zh-1'], 'signed out: this device + the summaries kept here');
});

test('CGs: this device only, per world + picture, newest world first; gallery size never below what was seen', () => {
  const extra = save({ saveId: 'wc-zh-2', manifestId: 'whitechapel-zh', updatedAt: '2026-10-03T00:00:00.000Z', cgs: [{ path: 'assets/cg/fire.webp', caption: '火', at: '2026-10-03T01:00:00.000Z' }, { path: 'assets/cg/well.webp', caption: null, at: '2026-10-03T02:00:00.000Z' }], cgTotal: 2 });
  const m = buildProfile(base({ saves: [...saves, extra] }));
  assert.deepEqual(m.galleries.map((g) => [g.worldKey, g.seen.length, g.total]), [['whitechapel', 2, 2], ['first-snow', 1, 1]]);
  assert.deepEqual(m.galleries[0].seen.map((c) => [c.path, c.saveId]), [['assets/cg/fire.webp', 'wc-zh-2'], ['assets/cg/well.webp', 'wc-zh-2']]);
  assert.equal(m.galleries[0].name, '白教堂');
});

test('achievements: computed from the facts; badges once earned stay; the claim streak from daily claims', () => {
  assert.equal(ACHIEVEMENTS.length, 12);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, 12, 'ids are unique');
  const m = buildProfile(base({ reviews: { whitechapel: { rating: 5 } }, favorites: ['first-snow'] }));
  const got = Object.fromEntries(m.achievements.map((a) => [a.def.id, a.earned]));
  assert.deepEqual(got, {
    'first-world': true, 'first-ending': true, 'endings-three-worlds': false, 'all-endings-one-world': true,
    'first-secret': true, 'first-cg': true, 'all-cgs-one-world': true, 'first-review': true, 'first-favorite': true,
    'first-workshop-world': true, 'first-published-world': true, 'claim-streak-7': false,
  });
  const three = m.achievements.find((a) => a.def.id === 'endings-three-worlds');
  assert.equal(three.value, 1, 'progress shown on a locked one');
  assert.equal(m.achievements.find((a) => a.def.id === 'claim-streak-7').value, 2);

  const bare = buildProfile(base({ saves: [], summaries: [], account: null, groups: [] }));
  assert.ok(bare.achievements.every((a) => !a.earned));
  const kept = evaluateAchievements(evaluateStatsZero(), { 'first-ending': '2026-09-01T00:00:00.000Z' });
  assert.deepEqual(kept.filter((a) => a.earned).map((a) => [a.def.id, a.earnedAt]), [['first-ending', '2026-09-01T00:00:00.000Z']]);

  assert.equal(longestStreak(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-03', 'nope']), 4);
  assert.equal(longestStreak([]), 0);
});

function evaluateStatsZero() {
  return { worldsEntered: 0, endingsReached: 0, worldsWithEnding: 0, bestEndings: { reached: 0, total: 0 }, bestDebrief: { unlocked: 0, total: 0 }, cgsSeen: 0, bestGallery: { seen: 0, total: 0 }, reviews: 0, favorites: 0, workshopMade: 0, workshopPublished: 0, claimStreak: 0 };
}

test('settleEarned: new badges get today, are announced once', () => {
  const m = buildProfile(base());
  const first = settleEarned(emptyJournal(), m.achievements, '2026-10-03T12:00:00.000Z');
  assert.ok(first.announce.length > 0);
  assert.ok(first.announce.every((a) => a.earnedAt === '2026-10-03T12:00:00.000Z'));
  const again = settleEarned(first.journal, buildProfile(base({ journal: first.journal })).achievements, '2026-10-04T00:00:00.000Z');
  assert.deepEqual(again.announce, [], 'nothing new');
  assert.equal(again.journal.earned['first-ending'], '2026-10-03T12:00:00.000Z', 'the first time stays');
});

test('journal: play time from turn gaps; endings once per run; storage round trip; the old collections read', () => {
  let j = emptyJournal();
  j = addTurn(j, 's1', 0);
  j = addTurn(j, 's1', 60_000);
  j = addTurn(j, 's1', 60_000 + PLAY_GAP_MS + 1);
  assert.deepEqual(j.play.s1, { first: 0, last: 60_000 + PLAY_GAP_MS + 1, ms: TURN_MS + 60_000 + TURN_MS, turns: 3 });
  const e = { saveId: 's1', worldRef: 'whitechapel-zh', worldKey: 'whitechapel', worldName: '白教堂', endingId: 'caught', title: '抓住了他', at: '2026-10-02T09:50:00.000Z', startedAt: '2026-10-02T08:00:00.000Z', turns: 30 };
  const [j2, added] = addEnding(j, e);
  assert.equal(added.reported, false);
  assert.equal(addEnding(j2, e)[1], null, 'the same run once');
  assert.ok(addEnding(j2, { ...e, startedAt: '2026-10-03T00:00:00.000Z' })[1], 'a replay of the same save is a new run');

  const mem = new Map();
  const env = { storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }, now: () => NOW };
  writeJournal(j2, env);
  assert.ok(mem.has(JOURNAL_KEY));
  assert.deepEqual(readJournal(env).endings.map((x) => x.endingId), ['caught']);
  mem.set(JOURNAL_KEY, '{broken');
  assert.deepEqual(readJournal(env).endings.map((x) => x.endingId), ['caught'], 'unreadable storage falls back to memory');

  const ls = { 'airp.endings.broken': '[', 'airp.endings.whitechapel-jp': JSON.stringify({ caught: '捕まえた', bad: 3 }), other: 'x' };
  const keys = Object.keys(ls);
  const storage = { length: keys.length, key: (i) => keys[i], getItem: (k) => ls[k] ?? null };
  assert.deepEqual(readEndingCollections(storage), [{ worldRef: 'whitechapel-jp', endingId: 'caught', title: '捕まえた' }]);
});
