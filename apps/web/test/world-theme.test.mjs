// World themes on the client: the create form's draft
// (a type presets everything, the toggles stay editable) and the first-entry
// intro's gate (once per workshop save, before the forced tutorial).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  INITIAL_INTRO_GATE,
  WORLD_TYPES,
  WORLD_CATEGORIES,
  pickerCategoryOf,
  applyIntroSuggestion,
  draftMode,
  draftUsesDice,
  flagAvailable,
  introGateFrom,
  introSuggestRequest,
  isSandbox,
  themeDraftFor,
  sameThemeDraft,
  themeDraftOf,
  themeRequestOf,
  toggleThemeFlag,
  tutorialHeldByIntro,
} = await jiti.import('../src/lib/world-theme.ts');

test('picking a type presets rules and flags; the toggles stay editable and derive the mode', () => {
  const trpg = themeDraftFor('trpg');
  assert.equal(trpg.rules, 'coc');
  assert.equal(trpg.structure.endings, true);
  assert.equal(trpg.structure.mysteries, true);
  assert.equal(draftMode(trpg), 'semi');
  assert.equal(flagAvailable(trpg, 'clock'), true);
  const timed = toggleThemeFlag(trpg, 'clock', true);
  assert.equal(draftMode(timed), 'closed');
  // Endings off: a sandbox, and the clock that needed them goes too.
  const open = toggleThemeFlag(timed, 'endings', false);
  assert.equal(isSandbox(open), true);
  assert.equal(open.structure.clock, false);
  assert.equal(flagAvailable(open, 'clock'), false);
  assert.equal(draftMode(open), 'open');
  assert.equal(draftUsesDice(themeDraftFor('companion')), false);
  assert.equal(WORLD_TYPES.at(-1).id, 'blank');
  // The picker: three categories; an older stored type shows as the category it folds into.
  assert.deepEqual(WORLD_CATEGORIES.map((c) => c.id), ['trpg', 'story', 'free']);
  assert.equal(pickerCategoryOf(themeDraftFor('free')), 'free');
  assert.equal(pickerCategoryOf(themeDraftFor('galgame')), 'story');
  assert.equal(pickerCategoryOf(themeDraftFor('infinite')), 'trpg');
  assert.equal(pickerCategoryOf({ ...trpg, type: '' }), null);
  assert.equal(draftUsesDice(themeDraftFor('free')), true);
  assert.deepEqual(themeRequestOf(open), { players: 'single', type: 'trpg', rules: 'coc', structure: { endings: false, mysteries: true, clock: false, puzzles: false } });
  assert.equal(themeDraftFor('nonsense').type, 'trpg', 'an unknown type falls back to the default');
});

const state = (over = {}) => ({ workshop: true, shown: false, canSuggest: true, intro: { title: 'T', kicker: 'k', lines: [] }, fields: { identity: '', goal: '', first: '' }, ...over });

test('the intro opens once, for workshop saves only, and holds the tutorial until it closes', () => {
  assert.equal(tutorialHeldByIntro(INITIAL_INTRO_GATE, 'made-1', false), false, 'a curated world never waits');
  assert.equal(tutorialHeldByIntro(INITIAL_INTRO_GATE, 'made-1', true), true, 'a workshop world waits for its marker');
  const open = introGateFrom('made-1', state());
  assert.equal(open.status, 'open');
  assert.equal(tutorialHeldByIntro(open, 'made-1', true), true);
  assert.equal(tutorialHeldByIntro({ ...open, status: 'done' }, 'made-1', true), false, 'closing releases it');
  assert.equal(introGateFrom('made-1', state({ shown: true })).status, 'done', 'already seen on this save');
  assert.equal(introGateFrom('made-1', state({ workshop: false })).status, 'done');
  assert.equal(introGateFrom('made-1', null).status, 'done', 'an unreadable marker releases the tutorial');
  assert.equal(tutorialHeldByIntro(open, 'made-2', true), true, 'another world is not settled by this one');
});

test('一键填写 fills one field and keeps what the player typed', () => {
  const typed = { identity: 'A courier', goal: '', first: 'The docks' };
  assert.deepEqual(introSuggestRequest(typed, 'first'), { identity: 'A courier', goal: '', first: '' });
  const merged = applyIntroSuggestion(typed, { identity: 'X', goal: 'Find the ship', first: 'Y' }, 'goal');
  assert.deepEqual(merged, { identity: 'A courier', goal: 'Find the ship', first: 'The docks' });
});

test('App shows the intro before the forced tutorial and gates the tutorial on it', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /tutorialArmed && !launcherOpen && !introHold/);
  assert.ok(app.indexOf('<WorldIntroDialog') < app.indexOf('<ForcedTutorial'), 'the popup renders before (under) the tutorial slot');
});

test('设定 tab: a stored theme becomes an editable draft; a legacy theme without a type keeps its rules and flags', () => {
  const stored = themeDraftOf({ players: 'single', type: 'infinite', rules: 'coc', structure: { endings: true, mysteries: true, clock: false, puzzles: false } });
  assert.deepEqual({ ...stored, structure: { ...stored.structure } }, { type: 'infinite', rules: 'coc', structure: { endings: true, mysteries: true, clock: false, puzzles: false } });
  assert.equal(sameThemeDraft(stored, stored), true);
  assert.equal(sameThemeDraft(stored, toggleThemeFlag(stored, 'clock', true)), false);
  assert.equal(sameThemeDraft(stored, { ...stored, rules: 'dnd' }), false);
  const legacy = themeDraftOf({ players: 'single', rules: 'dnd', structure: { endings: false, clock: true } });
  assert.equal(legacy.type, '');
  assert.equal(legacy.structure.clock, false, 'clock needs endings');
  assert.deepEqual(themeRequestOf(legacy), { players: 'single', rules: 'dnd', structure: { endings: false, mysteries: false, clock: false, puzzles: false } });
  assert.equal(themeDraftOf({ type: 'nope', rules: 'nope', structure: {} }).rules, 'narrative');
});
