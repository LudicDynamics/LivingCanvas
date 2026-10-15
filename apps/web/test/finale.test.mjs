// The finale: the ending screen as a staged
// reveal — beats, what remains (no spoilers), the result share card, the stage
// performance, and source contracts for the structure, motion and i18n.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const finale = await jiti.import('../src/lib/finale.ts');
const share = await jiti.import('../src/lib/result-share.ts');
const perf = await jiti.import('../src/lib/stage-performance.ts');
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const SUMMARY = {
  startedAt: '2026-10-03T10:00:00Z',
  endedAt: '2026-10-03T10:41:10Z',
  steps: null,
  turns: 17,
  rolls: [{ name: 'search', result: 7, passed: true }],
  places: [{ layer: 'world/a', name: 'A', visited: true }, { layer: 'world/b', name: null, visited: false }, { layer: 'world/c', name: null, visited: false }],
  clues: [{ path: 'player/receipt.md', name: 'The receipt' }],
  endings: [{ id: 'caught', title: 'Caught', reached: true }, { id: 'half', title: null, reached: false }, { id: 'fourth', title: null, reached: false }],
};
const DEBRIEF = {
  mysteries: [{ id: 'a', question: 'Who?', options: [] }, { id: 'b', question: 'How?', options: [] }, { id: 'c', question: 'Why?', options: [] }],
  result: {
    total: 3, surface: 1, hidden: 1, unlocked: 2, tier: 'most', epilogue: 'MOST',
    mysteries: [
      { id: 'a', question: 'Who?', choice: 'x', label: 'X', verdict: 'hidden', proof: 'world/edith/margin-note.md', proofName: 'Margin note' },
      { id: 'b', question: 'How?', choice: 'y', label: 'Y', verdict: 'surface', proof: 'player/receipt.md' },
      { id: 'c', question: 'Why?', choice: 'z', label: 'Z', verdict: 'guessed' },
    ],
  },
};

test('beats: title → picture → summary → remains → actions; static when reduced motion or effects off', () => {
  assert.deepEqual([...finale.FINALE_BEATS], ['title', 'picture', 'summary', 'remains', 'actions']);
  assert.equal(finale.finaleAnimated(false, true), true);
  assert.equal(finale.finaleAnimated(true, true), false, 'prefers-reduced-motion wins');
  assert.equal(finale.finaleAnimated(false, false), false, 'effects off = static layout');
  assert.equal(finale.openingBeat(true), 0);
  assert.equal(finale.openingBeat(false), finale.FINALE_LAST, 'a static page opens on its final beat');
  assert.equal(finale.nextBeat(finale.FINALE_LAST), finale.FINALE_LAST);
  assert.equal(finale.beatShown(1, 'title'), true);
  assert.equal(finale.beatShown(1, 'summary'), false);
  assert.ok(finale.BEAT_HOLD_MS.title > finale.BEAT_HOLD_MS.summary, 'the title holds longest');
});

test('performance: the sequence counts until its last beat, and is a stage-performance source', () => {
  assert.equal(finale.finalePerforming(true, 0), true);
  assert.equal(finale.finalePerforming(true, finale.FINALE_LAST), false);
  assert.equal(finale.finalePerforming(false, 0), false, 'closed: nothing is playing');
  // It waits out a scene card or a CG still on stage — not itself, a voice, or a character answering.
  assert.equal(finale.finaleWaitsFor(['milestone']), true);
  assert.equal(finale.finaleWaitsFor(['cg']), true);
  assert.equal(finale.finaleWaitsFor(['ending', 'voice', 'character']), false);
  perf.resetPerformingForTest();
  perf.setPerforming('ending', true);
  assert.deepEqual(perf.performingSources(), ['ending']);
  assert.equal(perf.readPerformance(), true, 'the forced tutorial waits for the finale');
  perf.setPerforming('ending', false);
  assert.deepEqual(perf.performingSources(), []);
  perf.resetPerformingForTest();
});

test('decodeBeforeReveal: never rejects; no url / no Image is "none"', async () => {
  assert.equal(await finale.decodeBeforeReveal(null), 'none');
  assert.equal(await finale.decodeBeforeReveal('/x.webp'), 'none', 'node has no Image');
  const saved = globalThis.Image;
  try {
    globalThis.Image = class { decode() { return Promise.reject(new Error('bad')); } };
    assert.equal(await finale.decodeBeforeReveal('/x.webp'), 'failed');
    globalThis.Image = class { decode() { return new Promise(() => {}); } };
    assert.equal(await finale.decodeBeforeReveal('/x.webp', 5), 'timeout');
    globalThis.Image = class { decode() { return Promise.resolve(); } };
    assert.equal(await finale.decodeBeforeReveal('/x.webp'), 'decoded');
  } finally {
    globalThis.Image = saved;
  }
});

test('proof labels: the server name, else the bag card, else the file stem; only for unlocked secrets', () => {
  const [a, b, c] = DEBRIEF.result.mysteries;
  assert.equal(finale.proofLabel(a, SUMMARY.clues), 'Margin note');
  assert.equal(finale.proofLabel(b, SUMMARY.clues), 'The receipt');
  assert.equal(finale.proofLabel(c, SUMMARY.clues), null);
  assert.equal(finale.proofLabel({ verdict: 'surface', proof: 'world/x/pigment-record.md' }, []), 'pigment-record');
  assert.equal(finale.proofLabel({ verdict: 'wrong', proof: 'world/x.md' }, []), null);
});

test('remains: counts only — unvisited places, endings neither reached nor collected, secrets not unlocked', () => {
  const r = finale.remainsOf(SUMMARY, {}, DEBRIEF);
  assert.deepEqual(r, { places: 2, endings: 2, secrets: 1, guessed: 1 });
  assert.equal(finale.remainsOf(SUMMARY, { half: 'Half' }, DEBRIEF).endings, 1, 'an ending seen in an earlier run is not unseen');
  assert.equal(finale.remainsOf(SUMMARY, {}, null).secrets, 0, 'no debrief, no secrets');
  assert.equal(finale.remainsOf(SUMMARY, {}, { ...DEBRIEF, result: null }).secrets, 3, 'skipped debrief: every secret still hidden');
  const all = finale.remainsOf({ ...SUMMARY, places: [SUMMARY.places[0]], endings: [SUMMARY.endings[0]] }, {}, null);
  assert.equal(finale.anythingRemains(all), false);
});

test('result card: facts only, no unseen titles; a text line for copy / text share', async () => {
  const run = { mode: 'semi', clock: null, ending: { id: 'caught', title: 'Caught', body: '…', bg: 'assets/e.webp' }, summary: SUMMARY, debrief: DEBRIEF };
  const card = share.buildResultCard(run, { locale: 'ko', worldId: 'whitechapel', worldName: 'Whitechapel', picture: 'http://x/e.webp', collection: {} });
  assert.deepEqual(card, {
    kind: 'result', locale: 'ko', worldId: 'whitechapel', worldName: 'Whitechapel', endingId: 'caught', endingTitle: 'Caught',
    picture: 'http://x/e.webp', minutes: 42, turns: 17, items: 1,
    secrets: { unlocked: 2, total: 3, hidden: 1 }, endings: { seen: 1, total: 3 }, places: { visited: 1, total: 3 },
  });
  assert.doesNotMatch(JSON.stringify(card), /Who\?|How\?|margin/i, 'no question, answer or proof leaks into the card');
  assert.equal(share.buildResultCard({ ...run, ending: null }, { locale: 'en', worldId: 'w', worldName: 'W', picture: null, collection: {} }), null);
  const t = (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, n) => String(v[n]));
  assert.equal(share.resultShareText(card, t), 'Whitechapel · Ending「Caught」 · 42 min · Secrets solved 2 / 3 · Endings 1 / 3');
  const blob = new Blob(['x']);
  assert.equal(await share.cardBlob(blob), blob);
  assert.equal(await share.cardBlob({ blob }), blob);
  assert.equal(await share.cardBlob(42), null);
});

test('source: ClosedRun stages the reveal, registers the performance, decodes first and plays the sting', () => {
  const src = read('../src/components/chrome/ClosedRun.tsx');
  assert.match(src, /setPerforming\('ending', performing\)/);
  assert.match(src, /useEffect\(\(\) => \(\) => setPerforming\('ending', false\), \[\]\)/, 'unmount releases the source');
  assert.match(src, /decodeBeforeReveal\(bg\)/);
  assert.match(src, /playFoley\('scene-sting', 0\.9\)/);
  assert.match(src, /stungRef\.current === endingId/, 'one sting per ending, not per reopen');
  assert.match(src, /finaleAnimated\(reducedMotion, settings\.effectsEnabled\)/);
  for (const beat of ['title', 'picture', 'summary', 'remains', 'actions']) {
    assert.match(src, new RegExp(`shownAttr\\(at, '${beat}'\\)`), `a section for the ${beat} beat`);
  }
  assert.match(src, /<Remains /);
  assert.match(src, /t\('Proved by \{clue\}'/);
  assert.match(src, /t\('Last words from \{name\}'/);
  assert.match(src, /<ShareResultButton run=\{run\} className="closed-ending__secondary" \/>/, 'the finale share action is the invite-aware result card (feat/invite)');
  assert.match(src, /t\('Back to lobby'\)/);
  assert.match(src, /loadResultCardRenderer\(\)/);
  assert.doesNotMatch(src, /from '\.\.\/\.\.\/lib\/share-card\.js'/, 'no static import of the renderer: it may not be in this build');
  const loader = read('../src/lib/share-card-loader.ts');
  assert.match(loader, /import\.meta\.glob\('\.\/share-card\.ts'\)/);
  assert.match(loader, /renderResultCard/);
  const app = read('../src/App.tsx');
  assert.match(app, /onLobby=\{\(\) => setLauncherOpen\(true\)\}/);
  assert.match(app, /companion=\{finaleCompanion\}/);
  assert.match(app, /held=\{launcherOpen \|\| loadingWorld !== null\}/, 'the finale holds while the launcher covers it');
  assert.match(src, /if \(beat === 0 && \(!pictureReady \|\| stageBusy\)\) return;/, 'the title holds until the stage is quiet');
  assert.match(app, /lastCharacterLine\(who\.id\)/);
});

test('css: compositor-only motion, static when still, glass panels, a 390 layout', () => {
  const css = read('../src/components/chrome/closed-run.css');
  const finaleCss = css.slice(css.indexOf('/* ── The finale'));
  for (const m of finaleCss.matchAll(/transition:\s*([^;]+);/g)) {
    const props = m[1].split(',').map((p) => p.trim().split(/\s+/)[0]);
    for (const p of props) assert.ok(['opacity', 'transform', 'none', 'background-color', 'color'].includes(p), `transition on ${p}`);
  }
  // Only the hover colours of small buttons transition colour; no full-screen layer does.
  for (const block of finaleCss.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/g)) {
    assert.doesNotMatch(block[1].replace(/transform:[^;]+;/g, ''), /[a-z-]+:/, 'keyframes animate transform only');
  }
  assert.match(finaleCss, /\.closed-ending\[data-animated='false'\] \[data-beat\] \{ transition: none; \}/);
  assert.match(finaleCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(finaleCss, /@media \(max-width: 560px\)/);
  assert.match(finaleCss, /backdrop-filter: var\(--ux-glass-blur\)/);
  assert.match(finaleCss, /:root\[data-airp-blur="off"\] \.closed-ending__panel/);
  assert.doesNotMatch(finaleCss, /animation:[^;]*infinite/, 'nothing loops');
  assert.match(finaleCss, /\.closed-ending\[data-grain='true'\]/, 'grain only when the grain setting is on');
});

test('i18n: every finale string has zh-CN, ja and ko', () => {
  const messages = JSON.parse(read('../src/lib/messages.json'));
  for (const key of [
    'Your moves', 'Items found', 'Proved by {clue}', 'Last words from {name}', 'Still undiscovered',
    '{n} places never visited', '{n} endings unseen', '{n} secrets still hidden', '{n} right guesses still need proof',
    'Nothing left undiscovered', 'Share result', 'Back to lobby', 'Tap to skip', 'Result card', 'Preparing the card…',
    'Copy text', 'Save image', 'Share',
  ]) {
    for (const locale of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[locale], `${key} → ${locale}`);
  }
});
