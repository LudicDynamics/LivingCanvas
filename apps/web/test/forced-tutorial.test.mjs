// The forced first-run tutorial: each step advances only on
// the player's own real act, a missing target never locks the player out, and
// completion is remembered per browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  INITIAL_TUTORIAL,
  TUTORIAL_STORAGE_KEY,
  TUTORIAL_WRITER_PROMPT,
  TUTORIAL_FIRST_LINE,
  TUTORIAL_STEPS,
  advanceTutorial,
  continueTutorial,
  diceRewardSource,
  diceRolled,
  isSearchChalk,
  finishTutorial,
  INITIAL_TUTORIAL_LATCH,
  readTutorialDone,
  tutorialArmOnEntry,
  tutorialCaption,
  tutorialFirstLine,
  tutorialPlaces,
  tutorialTarget,
  tutorialTargets,
  writeTutorialDone,
} = await jiti.import('../src/lib/forced-tutorial.ts');

const messages = JSON.parse(await readFile(new URL('../src/lib/messages.json', import.meta.url), 'utf8'));
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

const base = {
  playerSentCount: 0,
  followAvailable: true,
  greeterFollowing: false,
  layer: 'map',
  writerOpen: false,
  writerWriting: false,
  itemPaths: ['map/a.md', 'map/gate/README.md'],
  unlockedPlaceAvailable: true,
  lockItemPath: null,
  carriedPaths: [],
};

test('walks speak → follow → writer → writer-send → new-item → enter on real events only', () => {
  let s = advanceTutorial(INITIAL_TUTORIAL, base);
  assert.equal(s.step, 'speak');
  s = advanceTutorial(s, base);
  assert.equal(s.step, 'speak', 'nothing happened, nothing advances');

  s = advanceTutorial(s, { ...base, playerSentCount: 1 });
  assert.equal(s.step, 'follow');
  const here = { ...base, playerSentCount: 1, greeterFollowing: true };
  s = advanceTutorial(s, here);
  assert.equal(s.step, 'writer', 'search comes before moving to another place');

  s = advanceTutorial(s, { ...here, writerOpen: true });
  assert.equal(s.step, 'writer-send');
  assert.deepEqual(s.baselineItems, base.itemPaths);

  s = advanceTutorial(s, { ...here, writerOpen: true, writerWriting: true });
  assert.equal(s.step, 'new-item');
  assert.equal(s.newItem, null);
  assert.equal(tutorialTarget(s), null, 'nothing to point at while the writer works');
  assert.equal(tutorialCaption(s, false), 'The writer is looking…');

  const found = { ...here, writerOpen: true, writerWriting: false, itemPaths: [...base.itemPaths, 'map/new.md'] };
  s = advanceTutorial(s, found);
  assert.equal(s.newItem, 'map/new.md');
  assert.equal(tutorialTarget(s), '[data-path="map/new.md"], [data-pin="map/new.md"] .map-pin__icon', 'the card, or its pin on the picture map');
  assert.equal(tutorialCaption(s, true), 'A new item appeared');
  s = advanceTutorial(s, found);
  assert.equal(s.step, 'new-item', 'the found item waits for the player');

  s = continueTutorial(s, found);
  assert.equal(s.step, 'enter', 'then on to moving somewhere else');
  assert.equal(s.startLayer, 'map');
  s = advanceTutorial(s, { ...found, layer: 'map/gate', itemPaths: ['map/gate/x.md'] });
  assert.equal(s.step, 'done', 'walking in ends the tutorial');

  assert.equal(finishTutorial(s).step, 'done');
});

test('the step list puts the search before the move', () => {
  const at = (step) => TUTORIAL_STEPS.indexOf(step);
  for (const search of ['writer', 'writer-send', 'new-item', 'chalk', 'roll', 'found']) {
    assert.ok(at(search) < at('take') && at(search) < at('enter'), `${search} before take / enter`);
  }
  assert.ok(at('take') < at('enter'));
  assert.equal(TUTORIAL_STEPS.at(-1), 'done');
  assert.equal(continueTutorial({ ...INITIAL_TUTORIAL, step: 'speak' }, base).step, 'speak', 'continue only ends a search');
});

test('a search that turns up the key flows search → take it → go in', () => {
  const gate = { path: 'world/cellar/README.md', frontmatter: { type: 'gate', requires: { items: ['player/key.md'] } } };
  const key = { path: 'world/key.md', frontmatter: { type: 'item' } };
  const chalk = 'world/search-1.md';
  const layerOf = (items, carried = [], extra = {}) => ({
    ...base, layer: 'world', playerSentCount: 1, greeterFollowing: true, writerOpen: true,
    itemPaths: items.map(i => i.path), carriedPaths: carried,
    ...tutorialPlaces(items, new Set(carried)), ...extra,
  });
  let s = advanceTutorial(INITIAL_TUTORIAL, layerOf([gate]));
  assert.equal(s.step, 'writer-send', 'a locked place does not stop the search from coming first');
  s = advanceTutorial(s, layerOf([gate], [], { writerWriting: true }));
  assert.equal(s.step, 'new-item');
  const withChalk = layerOf([gate, { path: chalk, frontmatter: { search_source: 'writer' } }], [], { searchChalks: [chalk] });
  s = advanceTutorial(s, withChalk);
  assert.equal(s.step, 'chalk');
  s = advanceTutorial(s, { ...withChalk, rolledPaths: [chalk] });
  assert.equal(s.step, 'found');
  const paid = layerOf([gate, key], [], { searchChalks: [chalk], rolledPaths: [chalk], rewards: [{ path: key.path, source: chalk }] });
  s = advanceTutorial(s, paid);
  assert.equal(s.newItem, key.path);
  s = continueTutorial(s, paid);
  assert.equal(s.step, 'take');
  assert.equal(s.takeItem, key.path);
  s = advanceTutorial(s, layerOf([gate], ['player/key.md']));
  assert.equal(s.step, 'enter');
  s = advanceTutorial(s, { ...layerOf([gate], ['player/key.md']), layer: 'world/cellar' });
  assert.equal(s.step, 'done');
});

test('a search that finds nothing still continues to the move', () => {
  let s = { ...INITIAL_TUTORIAL, step: 'found', chalk: 'world/search-1.md' };
  s = advanceTutorial(s, { ...base, rolledPaths: ['world/search-1.md'] });
  assert.equal(s.writerSettled, true);
  s = continueTutorial(s, base);
  assert.equal(s.step, 'enter');
});

test('the follow step waits for a real follow even without an invitation; only a world with no greeter skips it', () => {
  let s = advanceTutorial(INITIAL_TUTORIAL, { ...base, playerSentCount: 1, followInvitePending: false });
  assert.equal(s.step, 'follow', 'no invitation is not a reason to skip');
  assert.equal(tutorialTarget(s), '[data-tutorial="follow"]');
  assert.equal(tutorialCaption(s, false, false), 'Open your companion and ask them to come with you.');
  assert.equal(tutorialCaption(s, false, true), 'Wait for their answer…');
  s = advanceTutorial(INITIAL_TUTORIAL, { ...base, playerSentCount: 1, followAvailable: false });
  assert.equal(s.step, 'writer');
});

test('speak advances on a message the player sent, not on anyone speaking first (return visits)', () => {
  let s = advanceTutorial(INITIAL_TUTORIAL, { ...base, playerSentCount: 0 });
  assert.equal(s.step, 'speak');
  s = advanceTutorial(s, { ...base, playerSentCount: 2 });
  assert.equal(s.step, 'follow');
});

test('enter prefers an unlocked place and keeps the locked one as a fallback', () => {
  const s = continueTutorial({ ...INITIAL_TUTORIAL, step: 'found', writerSettled: true }, base);
  assert.equal(s.step, 'enter');
  const targets = tutorialTargets(s);
  // The big 「进入地点」 button wins once it shows,
  // then the unlocked place itself; locked ones are the fallback.
  assert.equal(targets[0], '[data-card-action="enter"]:not([data-tutorial-locked="true"])');
  assert.match(targets[1], /\[data-tutorial="gate"\]:not\(\[data-tutorial-locked="true"\]\)/);
  assert.equal(targets[targets.length - 1], '[data-tutorial="gate"], [data-guide-target="enter"]');
  assert.equal(tutorialCaption(s, true), 'Go into a place: rest on it (or tap it), then press “Enter place”.');
});

test('when every place is locked, take the unlocking item first, then enter', () => {
  const locked = {
    ...base, playerSentCount: 1, greeterFollowing: true,
    itemPaths: ['world/hall/key.md', 'world/hall/clubroom/README.md'],
    unlockedPlaceAvailable: false, lockItemPath: 'world/hall/key.md',
  };
  let s = continueTutorial({ ...INITIAL_TUTORIAL, step: 'found', writerSettled: true }, locked);
  assert.equal(s.step, 'take');
  assert.match(tutorialTarget(s), /\[data-path="world\/hall\/key\.md"\]/);
  // The item's own 「收入随身」 button first (hover pill, focus view, map panel), else the card.
  assert.deepEqual(tutorialTargets(s), [
    '[data-card-action="take"][data-card-path="world/hall/key.md"]',
    tutorialTarget(s),
  ]);
  assert.equal(tutorialCaption(s, true), 'This place is locked — take the item first: press “Take along”.');
  s = advanceTutorial(s, locked);
  assert.equal(s.step, 'take', 'nothing taken, nothing advances');
  s = advanceTutorial(s, { ...locked, itemPaths: ['world/hall/clubroom/README.md'], carriedPaths: ['player/key.md'], unlockedPlaceAvailable: true, lockItemPath: null });
  assert.equal(s.step, 'enter');
  s = advanceTutorial(s, { ...locked, layer: 'world/hall/clubroom', carriedPaths: ['player/key.md'] });
  assert.equal(s.step, 'done');
});

test('tutorialPlaces reads locks from requires.items against what is carried', () => {
  const gate = { path: 'world/clubroom/README.md', frontmatter: { type: 'gate', requires: { items: ['player/clubroom-key.md'] } } };
  const open = { path: 'world/yard/README.md', frontmatter: { type: 'gate' } };
  const key = { path: 'world/clubroom-key.md', frontmatter: { type: 'prop' } };
  const other = { path: 'world/note.md', frontmatter: {} };
  const fixed = { path: 'world/statue.md', frontmatter: { portable: false } };
  assert.deepEqual(tutorialPlaces([gate, open, key], new Set()), { unlockedPlaceAvailable: true, lockItemPath: null, lockItemIsKey: false });
  assert.deepEqual(tutorialPlaces([gate, other, key], new Set()), { unlockedPlaceAvailable: false, lockItemPath: 'world/clubroom-key.md', lockItemIsKey: true });
  assert.deepEqual(tutorialPlaces([gate, fixed, other], new Set()), { unlockedPlaceAvailable: false, lockItemPath: 'world/note.md', lockItemIsKey: false });
  assert.deepEqual(tutorialPlaces([gate, fixed], new Set()), { unlockedPlaceAvailable: false, lockItemPath: null, lockItemIsKey: false });
  assert.deepEqual(tutorialPlaces([gate], new Set(['player/clubroom-key.md'])), { unlockedPlaceAvailable: true, lockItemPath: null, lockItemIsKey: false });
});

test('the search prompt yields a dice chalk: chalk → roll → found', () => {
  const inside = { ...base, layer: 'world/hall', itemPaths: ['world/hall/x.md'], writerOpen: true };
  let s = { ...INITIAL_TUTORIAL, step: 'new-item', baselineItems: ['world/hall/x.md'], writerStarted: true };
  const chalk = 'world/hall/search-desk.md';
  const withChalk = { ...inside, itemPaths: ['world/hall/x.md', chalk], searchChalks: [chalk] };
  s = advanceTutorial(s, withChalk);
  assert.equal(s.step, 'chalk');
  assert.equal(s.chalk, chalk);
  assert.equal(s.newItem, null, 'a chalk is not the found item');
  assert.deepEqual(tutorialTargets(s), [`[data-dice-roll="${chalk}"]`, `.object[data-path="${chalk}"], [data-path="${chalk}"], [data-pin="${chalk}"] .map-pin__icon`]);
  assert.equal(tutorialCaption(s, true), 'The writer set up a search — roll the dice.');

  s = advanceTutorial(s, { ...withChalk, rollControlShown: true });
  assert.equal(s.step, 'roll');
  assert.equal(tutorialTarget(s), `[data-dice-roll="${chalk}"]`);

  s = advanceTutorial(s, { ...withChalk, rollControlShown: true, rolledPaths: [chalk], heldPaths: [chalk] });
  assert.equal(s.step, 'roll', 'the ceremony still holds the result');
  s = advanceTutorial(s, { ...withChalk, rolledPaths: [chalk], heldPaths: [], writerWriting: true });
  assert.equal(s.step, 'found');
  assert.equal(s.newItem, null);
  assert.equal(tutorialCaption(s, false), 'The writer is looking…');

  const reward = 'world/hall/old-letter.md';
  s = advanceTutorial(s, { ...withChalk, itemPaths: [...withChalk.itemPaths, 'world/hall/other.md', reward], rolledPaths: [chalk], rewards: [{ path: 'world/hall/other.md', source: 'world/hall/search-2.md' }, { path: reward, source: chalk }] });
  assert.equal(s.newItem, reward);
  assert.equal(tutorialTarget(s), `[data-path="${reward}"], [data-pin="${reward}"] .map-pin__icon`);
  assert.equal(tutorialCaption(s, true), 'You found something.');
});

test('a roll that pays out nothing settles into a Done-able caption', () => {
  let s = { ...INITIAL_TUTORIAL, step: 'found', chalk: 'world/search-1.md' };
  s = advanceTutorial(s, { ...base, writerWriting: false, rolledPaths: ['world/search-1.md'] });
  assert.equal(s.writerSettled, true);
  assert.equal(tutorialCaption(s, false), 'Nothing turned up this time — keep exploring.');
});

test('a plain (non-search) card from the writer is still highlighted as the new item', () => {
  let s = { ...INITIAL_TUTORIAL, step: 'new-item', baselineItems: ['a'], writerStarted: true };
  s = advanceTutorial(s, { ...base, itemPaths: ['a', 'world/b.md'], searchChalks: [] });
  assert.equal(s.step, 'new-item');
  assert.equal(s.newItem, 'world/b.md');
});

test('search chalk / roll / reward readers', () => {
  assert.equal(isSearchChalk('world/hall/search-desk.md'), true);
  assert.equal(isSearchChalk('world/hall/search-3.md'), true);
  assert.equal(isSearchChalk('world/hall/research.md'), false);
  assert.equal(isSearchChalk('world/hall/clue.md', { search_source: 'writer' }), true);
  assert.equal(diceRolled({ roll_dice: { expect: '>=10' } }), false);
  assert.equal(diceRolled({ roll_dice: { result: 12 } }), true);
  assert.equal(diceRewardSource({ dice_reward: { source: 'world/search-1.md' } }), 'world/search-1.md');
  assert.equal(diceRewardSource({}), null);
});

test('a writer reply with no new card settles into a Done-able caption', () => {
  let s = { ...INITIAL_TUTORIAL, step: 'new-item', baselineItems: ['a'], writerStarted: true };
  s = advanceTutorial(s, { ...base, writerWriting: false, itemPaths: ['a'] });
  assert.equal(s.writerSettled, true);
  assert.equal(tutorialCaption(s, false), 'Nothing new this time — keep exploring.');
});

test('the classic layout (writer always open) passes straight to the send step', () => {
  const s = advanceTutorial({ ...INITIAL_TUTORIAL, step: 'writer' }, { ...base, writerOpen: true });
  assert.equal(s.step, 'writer-send');
  assert.equal(tutorialTarget(s), '[data-tutorial="writer-send"]');
});

test('skipped or finished, it stays gone for the rest of the entry (reopen, second greeting, same layer again)', () => {
  // Entering Holmes arms it once.
  let r = tutorialArmOnEntry(INITIAL_TUTORIAL_LATCH, 'whitechapel', false);
  assert.equal(r.arm, true);
  // "Skip this time", then every later arm request in the same visit — the
  // return greeting on walking back onto the entry layer, the page reopening
  // the same save after the server lost it, a re-render — is refused.
  for (let i = 0; i < 3; i++) {
    r = tutorialArmOnEntry(r.latch, 'whitechapel', false);
    assert.equal(r.arm, false);
  }
  // No world yet (manifest still loading): nothing, and the latch is untouched.
  assert.deepEqual(tutorialArmOnEntry(r.latch, null, false), { latch: r.latch, arm: false });
  // Another world is a new entry.
  r = tutorialArmOnEntry(r.latch, 'wuwu', false);
  assert.equal(r.arm, true);
  // Back at the launcher (the latch resets; a page reload lands there too): it shows again.
  assert.equal(tutorialArmOnEntry(INITIAL_TUTORIAL_LATCH, 'wuwu', false).arm, true);
  // "Don't show again" wins over a fresh entry.
  const hidden = tutorialArmOnEntry(INITIAL_TUTORIAL_LATCH, 'wuwu', true);
  assert.equal(hidden.arm, false);
  assert.equal(tutorialArmOnEntry(hidden.latch, 'wuwu', false).arm, false, 'nor does a later request in that entry');
});

test('completion persists and storage failures never throw', () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  assert.equal(readTutorialDone(storage), false);
  writeTutorialDone(storage, true);
  assert.equal(store.get(TUTORIAL_STORAGE_KEY), '1');
  assert.equal(readTutorialDone(storage), true);
  writeTutorialDone(storage, false);
  assert.equal(readTutorialDone(storage), false);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readTutorialDone(broken), false);
  assert.doesNotThrow(() => writeTutorialDone(broken, true));
});

test('every caption and the writer prompt are translated in zh-CN and ja', () => {
  const keys = [
    TUTORIAL_WRITER_PROMPT, TUTORIAL_FIRST_LINE, 'Skip this time', "Don't show again", 'Continue',
    'This place is locked — take the item first: press “Take along”.', 'Still locked — take the next item too: press “Take along”.',
    'The writer set up a search — roll the dice.', 'Roll the dice.', 'You found something.',
    'Nothing turned up this time — keep exploring.', 'Open your companion and ask them to come with you.',
    'Your first line is ready — send it as it is, or change it.', 'Let them come with you.', 'Wait for their answer…',
    'Go into a place: rest on it (or tap it), then press “Enter place”.', 'Open the writer.', 'Send this to the writer.',
    'The writer is looking…', 'A new item appeared', 'Nothing new this time — keep exploring.',
  ];
  for (const key of keys) {
    assert.ok(messages[key]?.['zh-CN'], `zh-CN for ${key}`);
    assert.ok(messages[key]?.ja, `ja for ${key}`);
  }
  assert.equal(messages[TUTORIAL_WRITER_PROMPT]['zh-CN'], '搜索这里还有什么');
  assert.equal(messages['Skip this time']['zh-CN'], '本次跳过');
  assert.equal(messages['The writer set up a search — roll the dice.']['zh-CN'], '作家布置了一次搜查——掷骰子吧。');
  assert.equal(messages['You found something.'].ja, '何かを見つけた。');
  assert.equal(messages["Don't show again"]['zh-CN'], '不再显示');
  assert.equal(messages['This place is locked — take the item first: press “Take along”.']['zh-CN'], '这里上锁了——先拿上物品：按「收入随身」。');
  // The old captions (before the big buttons) are gone.
  for (const old of ['This place is locked — take the item first.', 'Still locked — take the next item too.', 'Go into a place: click it, then enter.']) assert.equal(messages[old], undefined, old);
});

test('App arms it on every world entry (first arrival and return) until "Don\'t show again"', () => {
  assert.match(app, /if \(!arm\) return;\s*setTutorialSent\(0\);\s*setTutorialArmed\(true\)/);
  assert.match(app, /setPendingGreeting\(\{ occasion, worldId: manifest\.id, entry: runKey \}\);[\s\S]{0,300}armTutorial\(manifest\?\.id\);\s*\n\s*\};/, 'a return visit (and a greeting-less arrival) arms it too');
  assert.match(app, /setOpening\(\{ \.\.\.plan, phase: 'greeting' \}\);[\s\S]{0,200}?settleArrival\(runKey, 'sent'\);\s*\n\s*armTutorial\(manifest\?\.id\);/, 'a first act arms it');
  assert.match(app, /countTutorialSend\(\)/, 'the speak step counts what the player sends');
  assert.match(app, /followOffer=\{tutorialFollowOffer\}/, 'the dock offers a follow control without an invitation');
  assert.match(app, /<ForcedTutorial /);
});

test('only "Don\'t show again" persists; Done and "Skip this time" do not', async () => {
  const component = await readFile(new URL('../src/components/chrome/ForcedTutorial.tsx', import.meta.url), 'utf8');
  const end = component.match(/const end = useCallback\(\(\) => \{([\s\S]*?)\}, \[onEnd\]\);/);
  assert.ok(end, 'end callback found');
  assert.doesNotMatch(end[1], /writeTutorialDone/);
  assert.match(component, /const neverAgain = useCallback\(\(\) => \{\s*writeTutorialDone\([^)]*, true\);/);
  assert.match(component, /onClick=\{neverAgain\}>\{t\("Don't show again"\)\}/);
  assert.match(component, /onClick=\{end\}>\{t\('Skip this time'\)\}/);
});

test('the old "Skip tutorial" marker no longer hides the tutorial (wuwu showed nothing)', async () => {
  // v1 wrote `airp:tutorial:done` from its Skip button; that must not count.
  assert.notEqual(TUTORIAL_STORAGE_KEY, 'airp:tutorial:done');
  const fs = await import('node:fs/promises');
  const app = await fs.readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // Entering a world arms it on its own, independent of the entry layer / opening marker,
  // and it never paints over the launcher.
  assert.match(app, /if \(!companion \|\| characters\.length === 0\) return;\s*armTutorial\(worldId\);/);
  assert.match(app, /\{tutorialArmed && !launcherOpen && (?:!introHold && )?(?:!openingSceneHold && )?\(/); // the opening scene card goes first too; a workshop world's intro popup goes first
});

test('a lock that wants two items walks the player through BOTH (wuwu: letter + badge)', () => {
  // wuwu-zh world/harbor-chart asks for player/commission-letter.md AND player/investigator-badge.md,
  // and both lie on the entry layer as world/*.md.
  const gate = { path: 'world/harbor-chart/README.md', kind: 'gate', frontmatter: { type: 'gate', requires: { items: ['player/commission-letter.md', 'player/investigator-badge.md'] } } };
  const letter = { path: 'world/commission-letter.md', frontmatter: { type: 'item' } };
  const badge = { path: 'world/investigator-badge.md', frontmatter: { type: 'item' } };
  const layerOf = (items, carried) => ({
    ...base, layer: 'world', playerSentCount: 1, greeterFollowing: true,
    itemPaths: items.map(i => i.path), carriedPaths: carried,
    ...tutorialPlaces(items, new Set(carried)),
  });

  let snap = layerOf([gate, letter, badge], []);
  assert.equal(snap.lockItemIsKey, true);
  let s = continueTutorial({ ...INITIAL_TUTORIAL, step: 'found', writerSettled: true }, snap);
  assert.equal(s.step, 'take');
  const first = s.takeItem;
  assert.equal(tutorialCaption(s, true), 'This place is locked — take the item first: press “Take along”.');

  // Took the first key: still locked, so it points at the other one.
  const firstCard = first === letter.path ? letter : badge;
  const other = first === letter.path ? badge : letter;
  snap = layerOf([gate, other], [`player/${firstCard.path.split('/').pop()}`]);
  s = advanceTutorial(s, snap);
  assert.equal(s.step, 'take');
  assert.equal(s.takeItem, other.path);
  assert.equal(tutorialCaption(s, true), 'Still locked — take the next item too: press “Take along”.');
  assert.ok(messages['Still locked — take the next item too: press “Take along”.']?.['zh-CN']);

  // Both carried: the lock opens and the tutorial moves on to entering.
  snap = layerOf([gate], ['player/commission-letter.md', 'player/investigator-badge.md']);
  s = advanceTutorial(s, snap);
  assert.equal(s.step, 'enter');
});

test('a lock whose key is not on the layer does not march the player through every item', () => {
  const gate = { path: 'world/door/README.md', kind: 'gate', frontmatter: { type: 'gate', requires: { items: ['player/key.md'] } } };
  const a = { path: 'world/a.md', frontmatter: { type: 'item' } };
  const b = { path: 'world/b.md', frontmatter: { type: 'item' } };
  const info = tutorialPlaces([gate, a, b], new Set());
  assert.equal(info.lockItemIsKey, false);
  let s = continueTutorial({ ...INITIAL_TUTORIAL, step: 'found', writerSettled: true }, { ...base, layer: 'world', playerSentCount: 1, greeterFollowing: true, itemPaths: [gate.path, a.path, b.path], ...info });
  assert.equal(s.step, 'take');
  const after = tutorialPlaces([gate, b], new Set(['player/a.md']));
  s = advanceTutorial(s, { ...base, layer: 'world', playerSentCount: 1, greeterFollowing: true, itemPaths: [gate.path, b.path], carriedPaths: ['player/a.md'], ...after });
  assert.equal(s.step, 'enter', 'one stand-in item is enough; the locked place explains what it needs');
});

test('the tutorial never swallows a release or the wheel, and lets empty-stage drags through', async () => {
  // A swallowed pointerup left a canvas drag stuck following the mouse; a
  // swallowed wheel/pan meant a target hidden off-screen could not be reached.
  const src = await readFile(new URL('../src/components/chrome/ForcedTutorial.tsx', import.meta.url), 'utf8');
  const list = src.match(/const SWALLOWED = \[([^\]]*)\]/)[1];
  for (const released of ['pointerup', 'mouseup', 'touchend', 'pointercancel', 'wheel']) {
    assert.ok(!list.includes(`'${released}'`), `${released} must pass through`);
  }
  assert.match(src, /if \(node instanceof Element && !node\.closest\(INTERACTIVE\)\) return;/);
});

test('a caption about something playing is a plain status line: no dim, presses pass', async () => {
  const { TUTORIAL_WAIT_CAPTIONS } = await jiti.import('../src/lib/forced-tutorial.ts');
  assert.ok(TUTORIAL_WAIT_CAPTIONS.has('Wait for their answer…'));
  assert.ok(TUTORIAL_WAIT_CAPTIONS.has('The writer is looking…'));
  assert.ok(!TUTORIAL_WAIT_CAPTIONS.has('Open your companion and ask them to come with you.'));
  const src = await readFile(new URL('../src/components/chrome/ForcedTutorial.tsx', import.meta.url), 'utf8');
  // Presses are held only around a highlighted target, and only while guiding.
  assert.match(src, /if \(state\.step === 'done' \|\| !guiding \|\| !hasTarget\) return;/);
  assert.match(src, /\) : status \? null : \(\s*<div className="forced-tutorial__veil"/, 'a status caption has no veil at all');
  const css = await readFile(new URL('../src/components/chrome/forced-tutorial.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /veil--waiting/, 'the full-dim waiting veil (the black screen while the writer worked) is gone');
  assert.doesNotMatch(src, /veil--waiting/);
});

test('no companion greeting (and so no voice) while the launcher covers the world', () => {
  // The server loads a default (English) world at startup; its companion used to
  // greet behind the world list and be heard in the wrong language.
  assert.match(app, /if \(launcherOpen\) return;\n/);
  assert.match(app, /if \(launcherOpen\) return; \/\/ held until the player actually enters the world/);
});

// The speak step's pre-filled first line.
const tr = (locale, key) => (locale === 'en' ? key : messages[key]?.[locale] ?? key);

test('the first line follows the WORLD language, falling back to the built-in default', () => {
  assert.equal(tutorialFirstLine({ locale: 'zh-CN' }, 'en', tr), '你好，我刚到这里，这是哪里？', 'a Chinese world under an English UI');
  assert.equal(tutorialFirstLine({ locale: 'ja' }, 'zh-CN', tr), 'こんにちは、今着いたところです。ここはどこですか？');
  assert.equal(tutorialFirstLine({ locale: 'en' }, 'ja', tr), TUTORIAL_FIRST_LINE);
  assert.equal(tutorialFirstLine({}, 'ja', tr), messages[TUTORIAL_FIRST_LINE].ja, 'no world locale: the UI decides');
  assert.equal(tutorialFirstLine(null, 'en', tr), TUTORIAL_FIRST_LINE);
});

test('a world can write its own first line, one string or one per locale', () => {
  assert.equal(tutorialFirstLine({ locale: 'zh-CN', tutorial: { firstLine: ' 请问侦探社怎么走？ ' } }, 'en', tr), '请问侦探社怎么走？');
  const perLocale = { tutorial: { firstLine: { 'zh-CN': '老莫，今晚有什么消息？', ja: 'モーさん、今夜は何か？' } } };
  assert.equal(tutorialFirstLine({ ...perLocale, locale: 'ja' }, 'en', tr), 'モーさん、今夜は何か？');
  assert.equal(tutorialFirstLine({ ...perLocale, locale: 'en' }, 'zh-CN', tr), TUTORIAL_FIRST_LINE, 'a map without this language: the default, never another language');
  assert.equal(tutorialFirstLine({ locale: 'zh-CN', tutorial: { firstLine: '   ' } }, 'en', tr), '你好，我刚到这里，这是哪里？', 'blank is not a line');
  assert.equal(tutorialFirstLine({ locale: 'zh-CN', tutorial: { firstLine: 42 } }, 'en', tr), '你好，我刚到这里，这是哪里？');
  for (const locale of ['zh-CN', 'ja']) assert.ok(messages[TUTORIAL_FIRST_LINE]?.[locale], `${locale} default`);
});

test('App pre-fills the reply box only while the forced tutorial shows its speak step', () => {
  assert.match(app, /const tutorialSpeakLine = tutorialArmed && !launcherOpen && !introHold && tutorialStep === 'speak'\s*\?\s*tutorialFirstLine\(manifest, locale, translate\)\s*:\s*null;/);
  assert.match(app, /<CharacterDock[\s\S]{0,2500}prefill=\{tutorialSpeakLine\}/);
  assert.match(app, /<ForcedTutorial [^>]*onStep=\{setTutorialStep\}/);
  assert.match(app, /const endTutorial = useCallback\(\(\) => \{\s*setTutorialArmed\(false\);\s*setTutorialStep\(null\);/, 'no step, no prefill, once it ends');
  assert.equal((app.match(/prefill=\{/g) ?? []).length, 1, 'nothing else pre-fills the reply box');
});

test('the dock fills only an EMPTY box, and selects the line so it reads as editable', async () => {
  const dock = await readFile(new URL('../src/components/sidebar/CharacterDock.tsx', import.meta.url), 'utf8');
  assert.match(dock, /prefill = null,/, 'absent means no prefill');
  assert.match(dock, /if \(!prefill \|\| !active\) return;\s*setDraft\(current => \{\s*if \(current\.trim\(\)\) return current;/, 'typed text is never overwritten');
  assert.match(dock, /\}, \[prefill, active\?\.id\]\);/, 'fills when the line arrives, not on every keystroke');
  assert.match(dock, /input\.focus\(\);\s*input\.select\(\);/);
  const component = await readFile(new URL('../src/components/chrome/ForcedTutorial.tsx', import.meta.url), 'utf8');
  // Reported only once the first guidance shows: no prefill / focus (a phone's keyboard) during the arrival.
  assert.match(component, /onStep\?\.\(firstLook \? null : state\.step\);/);
  assert.equal(tutorialCaption(INITIAL_TUTORIAL, true), 'Your first line is ready — send it as it is, or change it.');
  assert.equal(messages['Your first line is ready — send it as it is, or change it.']['zh-CN'], '第一句已经帮你写好了——可以直接发送，也可以改。');
});

test('clicking what the search found (or Continue) moves on instead of ending', async () => {
  const component = await readFile(new URL('../src/components/chrome/ForcedTutorial.tsx', import.meta.url), 'utf8');
  assert.match(component, /current === 'new-item' \|\| current === 'found'\) && newItem\) \{\s*window\.setTimeout\(next, 0\);/);
  assert.match(component, /onClick=\{next\}>\{t\('Continue'\)\}/);
  assert.match(component, /if \(state\.step === 'done' && !ended\.current\) \{\s*ended\.current = true;\s*onEnd\(\);/, 'walking in ends it once');
});
