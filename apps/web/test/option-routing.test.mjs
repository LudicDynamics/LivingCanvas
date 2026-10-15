// Option routing on the page: moves ride the writer's tray, lines a
// character's bubble; the companion's hint hands over slips and lines; each layer remembers its own view.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseFrontmatter } from '@airp/shared';
import { buildInteractiveFields, visibleChoiceOptions } from '@airp/shared/frontmatter';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const r = await jiti.import('../src/lib/option-routing.ts');
const vm = await jiti.import('../src/lib/view-mode.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const templates = new URL('../../../templates/', import.meta.url);
const optionsOf = (card) => {
  const choice = buildInteractiveFields(card.frontmatter ?? {}).choice;
  return choice ? visibleChoiceOptions(choice) : [];
};

const README = {
  path: 'world/seated-car/README.md',
  frontmatter: {
    choice: { options: [
      { id: 'take', label: 'Pick up the notebook' },
      { id: 'roll', label: 'Roll to ask the student' },
      { id: 'who', label: 'Who is Su He?', to: 'xia-cheng', say: 'Who is Su He? Do you know her?' },
      { id: 'pal', label: 'You look first?', to: 'companion', say: 'Could you look first?' },
      { id: 'bare', label: 'Talk it over with Xia Cheng' },
      { id: 'skip', label: 'Skip act one', for: 'from-prologue' },
    ] },
    choice_actions: {
      take: { kind: 'take', paths: ['world/seated-car/su-he-notebook.md'] },
      roll: { kind: 'search', spot: 'scene' },
      bare: { kind: 'character', character: 'xia-cheng' },
    },
  },
};
const DOOR = { path: 'world/seated-car/freight-door.md', frontmatter: { type: 'gate', target: 'world/freight-car', choice: { options: [{ id: 'go', label: 'Go to car 5' }] }, choice_actions: { go: { kind: 'enter', target: 'world/freight-car' } } } };

test('routeOptions: moves become slips (door first, glyph by verb), lines go to whoever they are said to', () => {
  const { slips, lines } = r.routeOptions([README, DOOR], optionsOf, { companion: 'xia-cheng', fromPrologue: false });
  assert.deepEqual(slips.map((s) => [s.label, s.glyph]), [['Go to car 5', '→'], ['Pick up the notebook', '✋'], ['Roll to ask the student', '🎲']]);
  assert.deepEqual(lines.map((l) => [l.to, l.say]), [['xia-cheng', 'Who is Su He? Do you know her?'], ['xia-cheng', 'Could you look first?']]);
  assert.ok(!slips.some((s) => s.label.startsWith('Talk it over')) && !lines.some((l) => l.say.startsWith('Talk it over')), 'a bare kind: character stays in the left rail');
  assert.ok(!slips.some((s) => s.fromPrologue), 'the fast-forward is only for a player from the prologue');
});

test('routeOptions: no companion → `to: companion` lines are dropped; from the prologue → the fast-forward leads; a used move stays (not new), a said line is gone', () => {
  const lone = r.routeOptions([README], optionsOf, { companion: null, fromPrologue: true, used: new Set(['world/seated-car/README.md#take', 'world/seated-car/README.md#who']) });
  assert.deepEqual(lone.lines.map((l) => l.say), [], 'the line said once is gone');
  assert.equal(lone.slips[0].label, 'Skip act one');
  assert.equal(lone.slips[0].glyph, '⏩');
  const take = lone.slips.find((s) => s.label === 'Pick up the notebook');
  assert.equal(take?.used, true, 'chosen, but not done: it stays, marked used');
  assert.equal(lone.slips.at(-1), take, 'used moves sink below the new ones');
});

// ── used options ────────────────────────────

const SEATED = {
  path: 'world/seated-car/README.md',
  frontmatter: {
    choice: { options: [
      { id: 'take-notebook', label: 'Pick up the notebook' },
      { id: 'search', label: 'Roll to ask the student' },
      { id: 'talk-student', label: 'Talk to the student' },
      { id: 'go', label: 'Back to the train' },
      { id: 'ask-who', label: 'Who is Su He?', to: 'xia-cheng' },
      { id: 'ask-again', label: 'Again?', to: 'xia-cheng', repeat: true },
      { id: 'look', label: 'Look out of the window', once: true },
    ] },
    choice_actions: {
      'take-notebook': { kind: 'take', paths: ['world/seated-car/su-he-notebook.md'] },
      search: { kind: 'search', spot: 'scene' },
      'talk-student': { kind: 'talk', npc: 'world/seated-car/zhou-zihang.md' },
      go: { kind: 'enter', target: 'map' },
    },
  },
};
const NOTEBOOK = { path: 'world/seated-car/su-he-notebook.md', frontmatter: { type: 'note', title: 'Notebook' } };
const route = (cards, extra = {}) => {
  const used = extra.used ?? new Set();
  const done = r.optionDoneOf({ states: extra.states, cards, carried: extra.carried ?? new Set(), dir: 'world/seated-car', used });
  return r.routeOptions(cards, optionsOf, { companion: 'xia-cheng', fromPrologue: false, used, done, isUsed: r.optionUsedOf(extra.states, used) });
};
const labels = (slips) => slips.map((s) => s.label);

test('used options: a take is gone once its things are in the bag (or no longer on the page); a door / talk stays', () => {
  assert.deepEqual(labels(route([SEATED, NOTEBOOK]).slips), ['Pick up the notebook', 'Roll to ask the student', 'Talk to the student', 'Back to the train', 'Look out of the window']);
  const taken = route([SEATED], { carried: new Set(['player/su-he-notebook.md']) });
  assert.ok(!labels(taken.slips).includes('Pick up the notebook'), 'in the bag: done');
  const gone = route([SEATED]);
  assert.ok(!labels(gone.slips).includes('Pick up the notebook'), 'not on this page any more: done');
  const used = route([SEATED, NOTEBOOK], { used: new Set(['world/seated-car/README.md#go', 'world/seated-car/README.md#talk-student']) });
  assert.deepEqual(used.slips.filter((s) => s.used).map((s) => s.label), ['Talk to the student', 'Back to the train'], 'doors and talks stay, marked used (no ink)');
});

test('used options: a search is gone once its chalk is rolled; still standing unrolled, it stays', () => {
  const chalk = (result) => ({ path: 'world/seated-car/search-scene.md', frontmatter: { type: 'chalk', roll_dice: { type: '2d10', desc: 'Ask', expect: '>=11', ...(result === undefined ? {} : { result }) } } });
  assert.ok(labels(route([SEATED, NOTEBOOK, chalk()]).slips).includes('Roll to ask the student'));
  assert.ok(!labels(route([SEATED, NOTEBOOK, chalk(14)]).slips).includes('Roll to ask the student'));
});

test('used options: the server\'s answer wins where the page cannot see (a chalk cleared away, a choice made elsewhere)', () => {
  const states = { 'world/seated-car/README.md': { done: ['search'], used: ['talk-student'] } };
  const out = route([SEATED, NOTEBOOK], { states });
  assert.ok(!labels(out.slips).includes('Roll to ask the student'));
  assert.equal(out.slips.find((s) => s.label === 'Talk to the student')?.used, true);
  const drawnElsewhere = route([SEATED], { states: {} });
  assert.ok(labels(drawnElsewhere.slips).includes('Pick up the notebook'), 'the server answered: a card not drawn here is not taken');
  const said = route([SEATED, NOTEBOOK], { states: {}, used: new Set(['world/seated-car/README.md#look']) });
  assert.ok(!labels(said.slips).includes('Look out of the window'), 'what only this tab knows (once, lines) still counts');
});

test('used options: a line is gone after it was said (unless repeat: true); once: true goes after one use', () => {
  const used = new Set(['world/seated-car/README.md#ask-who', 'world/seated-car/README.md#ask-again', 'world/seated-car/README.md#look']);
  const out = route([SEATED, NOTEBOOK], { used });
  assert.deepEqual(out.lines.map((l) => l.say), ['Again?']);
  assert.ok(!labels(out.slips).includes('Look out of the window'));
  assert.deepEqual(r.linesFor('xia-cheng', { routed: out.lines, used }).map((l) => l.say), ['Again?'], 'a repeat line survives the bubble\'s used filter too');
});

test('used options: a hint never hands over a done move', () => {
  const hint = { id: 'h', by: 'xia-cheng', say: 'Look?', beat: 3, suggest: [{ card: 'world/seated-car/README.md', option: 'search' }] };
  const rolled = { path: 'world/seated-car/search-scene.md', frontmatter: { roll_dice: { type: '2d10', desc: 'Ask', expect: '>=11', result: 3 } } };
  const cards = [SEATED, NOTEBOOK, rolled];
  const done = r.optionDoneOf({ cards, carried: new Set(), dir: 'world/seated-car' });
  assert.deepEqual(r.hintSlips(hint, cards, optionsOf, 'world/seated-car', new Set(), done), []);
});

test('hintSlips / mergeSlips: the hint hands slips over (with the companion\'s face), first, labelled from the card; moot ones drop', () => {
  const hint = { id: 'h', by: 'xia-cheng', say: 'Look?', beat: 3, replies: ['Is this hers?'], suggest: [
    { card: 'world/seated-car/README.md', option: 'take' },
    { card: 'world/seated-car/gone.md', option: 'x' },
    { enter: 'world/sleeper', label: 'Go to the sleeper' },
    { enter: 'world/seated-car', label: 'Stay here' },
  ] };
  const handed = r.hintSlips(hint, [README], optionsOf, 'world/seated-car');
  assert.deepEqual(handed.map((s) => [s.label, s.by]), [['Pick up the notebook', 'xia-cheng'], ['Go to the sleeper', 'xia-cheng']]);
  const { slips } = r.routeOptions([README], optionsOf, { companion: 'xia-cheng', fromPrologue: false });
  const merged = r.mergeSlips(handed, slips);
  assert.equal(merged[0].by, 'xia-cheng');
  assert.equal(merged.filter((s) => s.label === 'Pick up the notebook').length, 1, 'one slip per move');
  assert.equal(r.hintSlips({ ...hint, by: 'writer' }, [README], optionsOf, 'map')[0].by, undefined, 'a margin note has no face');
});

test('linesFor: the opening while the greeting waits; else the hint\'s replies (its speaker only) and the layer\'s lines, three at most', () => {
  const { lines } = r.routeOptions([README], optionsOf, { companion: 'xia-cheng', fromPrologue: false });
  const hint = { id: 'h', by: 'xia-cheng', say: 'Look?', beat: 3, suggest: [], replies: ['Is this hers?'] };
  assert.deepEqual(r.linesFor('xia-cheng', { opening: ['Hello'], hint, routed: lines }).map((l) => l.say), ['Hello']);
  assert.deepEqual(r.linesFor('xia-cheng', { hint, routed: lines }).map((l) => l.say), ['Is this hers?', 'Who is Su He? Do you know her?', 'Could you look first?']);
  assert.deepEqual(r.linesFor('zhong-huaili', { hint, routed: lines }), [], 'someone else\'s hint is not theirs to answer');
  assert.deepEqual(r.linesFor('xia-cheng', { hint, routed: lines, used: new Set(['hint:h:Is this hers?']) }).length, 2);
});

test('routeOptions: a sub-place\'s README seen from outside lends its moves (last), never its lines', () => {
  const here = { path: 'world/README.md', frontmatter: { choice: { options: [{ id: 'list', label: 'Read the list' }] } } };
  const { slips, lines } = r.routeOptions([here, README], optionsOf, { companion: 'xia-cheng', fromPrologue: false });
  assert.equal(slips[0].label, 'Read the list');
  assert.deepEqual(lines, [], 'the seated car\'s lines are said in the seated car');
});

test('npcLinesOf and the run\'s used set', () => {
  assert.deepEqual(r.npcLinesOf('world/x/su-he.md', { replies: ['Who brought you?', ' ', 3, 'The tea?', 'a', 'b'] }), ['Who brought you?', 'The tea?', 'a']);
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  r.markUsed('save-1', 'k1', storage);
  assert.deepEqual([...r.readUsed('save-1', storage)], ['k1']);
  assert.deepEqual([...r.readUsed('save-2', storage)], [], 'per run');
});

test('the full 末班车 routes as designed: 2 车 has two moves (no 「go chat with the student」) and a line to 夏澄, its exits lead once open; the bubbles of the cars are the companion\'s', async () => {
  for (const id of ['last-train', 'last-train-zh', 'last-train-jp', 'last-train-ko']) {
    const seat = parseFrontmatter(await readFile(new URL(`${id}/world/seated-car/README.md`, templates), 'utf8'));
    const routed = r.routeOptions([{ path: 'world/seated-car/README.md', frontmatter: seat.frontmatter }], optionsOf, { companion: 'xia-cheng', fromPrologue: false });
    assert.deepEqual(routed.slips.map((s) => s.glyph), ['✋', '🎲'], id);
    assert.equal(routed.lines.length, 1, id);
    // The account in (or four beats): 「去车尾的卧铺」「回到整列车看看」 lead the tray.
    const open = { ...seat.frontmatter, status: { data: { exits: 'open' } } };
    const opened = r.routeOptions([{ path: 'world/seated-car/README.md', frontmatter: open }], optionsOf, { companion: 'xia-cheng', fromPrologue: false });
    assert.deepEqual(opened.slips.slice(0, 2).map((s) => s.option), ['go-sleeper', 'go-train'], id);
    const sleeper = parseFrontmatter(await readFile(new URL(`${id}/world/sleeper/README.md`, templates), 'utf8'));
    const s = r.routeOptions([{ path: 'world/sleeper/README.md', frontmatter: sleeper.frontmatter }], optionsOf, { companion: 'xia-cheng', fromPrologue: false });
    assert.deepEqual([...new Set(s.lines.map((l) => l.to))], ['zhong-huaili'], `${id}: the sleeper's lines are said to 钟怀礼`);
    assert.ok(s.slips.some((x) => x.option === 'talk'), `${id}: knocking is a move (it opens him)`);
  }
});

test('view per layer (D8): the player\'s switch here > the layer\'s view > as is; a map without a picture is no view', () => {
  assert.equal(vm.viewOnLayer({ stored: 'canvas', declared: 'map', current: 'map' }), 'canvas');
  assert.equal(vm.viewOnLayer({ stored: null, declared: 'map', current: 'canvas' }), 'map');
  assert.equal(vm.viewOnLayer({ stored: 'nope', declared: null, current: 'map' }), 'map', 'undeclared: the current view carries on');
  assert.equal(vm.layerDeclaredViewOf({ view: 'map', map: { plan: { picture: 'assets/maps/x.webp' } } }), 'map');
  assert.equal(vm.layerDeclaredViewOf({ view: 'map' }), null);
  assert.equal(vm.layerDeclaredViewOf({ view: 'canvas' }), 'canvas');
  assert.equal(vm.layerViewKey('save-1', 'world/sleeper'), 'airp.view:save-1:world/sleeper');
});

test('the writer\'s tray: an ink ✎ with a count at rest (pulses once), a ≤3-line preview on hover / keyboard focus only, the slips inside the opened sheet', async () => {
  const fab = await src('../src/components/chrome/WriterFab.tsx');
  assert.match(fab, /data-has-slips=\{slips\.length > 0 \? 'true' : undefined\}/);
  //: nothing pins the preview open — not a scene's first look, not a note.
  assert.doesNotMatch(fab, /data-tray-pinned|pinned\?: boolean/);
  assert.match(fab, /max=\{note \? TRAY_PEEK - 1 : TRAY_PEEK\}/);
  assert.match(fab, /\.\.\.\(note \? \[`note:\$\{note\.id\}`\] : \[\]\)/, 'a new margin note pulses the ink too');
  assert.equal(r.TRAY_PEEK, 3);
  assert.match(fab, /className="writer-fab__count" data-testid="writer-count"/);
  assert.match(fab, /const unused = slips\.filter\(\(s\) => !s\.used\)/, 'the ink counts only moves not made yet');
  assert.match(fab, /unused\.length > 0 && <span className="writer-fab__count"/);
  assert.match(fab, /testId="writer-sheet-slips"[\s\S]*<WriterBar \{\.\.\.bar\} embedded \/>/, 'the input card is merged under the slips');
  const css = await src('../src/components/chrome/writer-fab.css');
  assert.match(css, /\.writer-fab\[data-has-slips='true'\] \.writer-fab__button \{/);
  assert.match(css, /@media \(hover: hover\) \{\s*\.writer-fab:hover \.writer-tray \{/);
  assert.doesNotMatch(css, /data-tray-pinned/);
  assert.match(css, /\.writer-fab:has\(:focus-visible\) \.writer-tray \{/);
  assert.match(css, /animation: writer-ink-bloom var\(--ux-duration-pulse\) var\(--ux-motion-ink\) 1;/, 'one pulse');
  assert.match(css, /max-width: min\(280px, calc\(100vw - 32px\)\);/);
  assert.match(css, /width: min\(320px, /);
  assert.match(css, /max-height: min\(360px, /);
  // Separate lanes: narrow, the ✎ is a cell of the character's reply row — no preview rises over their words.
  assert.match(css, /@media \(max-width: 1100px\) \{\s*\.writer-fab\[data-clear-companion='true'\] \.writer-tray \{ display: none; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.writer-fab__button\[data-fresh='true'\] \{ animation: none; \}/);
});

test('App wiring: one routing pass feeds the tray, the dock\'s bubble, the rail\'s hover lines and the NPC bubble', async () => {
  const app = await src('../src/App.tsx');
  assert.match(app, /<WriterTrayFab[\s\S]*?slips=\{writerSlips\}/);
  assert.doesNotMatch(app, /trayPinned|pinTray/);
  assert.match(app, /lines=\{dockLines\}/);
  assert.match(app, /linesByCharacter=\{railLines\}/);
  assert.match(app, /<NpcDialogueHost [^>]*layer=\{replyChipsOn \? layer : undefined\} regenLocked=\{lineLocked\}/);
  assert.match(app, /useCharacterTick\(\{\s*enabled: worldTickOf\(manifest\) !== null,\s*beats: hintsOn,/);
  assert.match(app, /enterLayerView\(routeRun, layer, layerDeclaredViewOf/);
});
