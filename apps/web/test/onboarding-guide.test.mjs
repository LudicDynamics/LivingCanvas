// The onboarding guide: four sentences that each wait for
// the player to do the thing and then clear themselves.
//
// The invariants worth pinning are the ones that would turn it back into the
// tour that was deleted on 2026-09-20: a step that advances on anything other
// than its own real event, an overlay that covers what it points at, a button
// that walks the player through it, or an opt-out that only lasts one save.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const onboarding = await jiti.import('../src/lib/onboarding.ts');
const {
  CREATOR_STEPS,
  GUIDE_STEPS,
  GUIDE_LINES,
  GUIDE_STORAGE_KEY,
  EMPTY_GUIDE_STATE,
  currentGuideStep,
  guideSelector,
  isGuideStep,
  markStep,
  parseGuideState,
  resetGuide,
  silenceGuide,
} = onboarding;

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const guide = await readFile(new URL('../src/components/chrome/OnboardingGuide.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/components/chrome/onboarding-guide.css', import.meta.url), 'utf8');
const lib = await readFile(new URL('../src/lib/onboarding.ts', import.meta.url), 'utf8');
const dock = await readFile(new URL('../src/components/sidebar/CharacterDock.tsx', import.meta.url), 'utf8');
const rail = await readFile(new URL('../src/components/sidebar/ChoiceRail.tsx', import.meta.url), 'utf8');
const fab = await readFile(new URL('../src/components/chrome/WriterFab.tsx', import.meta.url), 'utf8');
const messages = JSON.parse(await readFile(new URL('../src/lib/messages.json', import.meta.url), 'utf8'));

const all = state => GUIDE_STEPS.every(step => state.done.includes(step));
const present = () => true;

test('the four steps are the four moves, in the order a player meets them', () => {
  assert.deepEqual([...GUIDE_STEPS], ['speak', 'options', 'enter', 'writer']);
  for (const step of GUIDE_STEPS) {
    assert.ok(isGuideStep(step));
    assert.equal(guideSelector(step), `[data-guide-target="${step}"]`);
    // Every sentence goes through `t()`, so it must exist in both locales.
    const key = GUIDE_LINES[step];
    assert.ok(key, `${step} needs a sentence`);
    assert.ok(messages[key], `"${key}" is missing from messages.json`);
    assert.ok(messages[key]['zh-CN'] && messages[key].ja, `"${key}" needs zh-CN and ja`);
  }
  assert.equal(isGuideStep('tour'), false);
  assert.equal(isGuideStep(undefined), false);
  assert.ok(messages['Don’t show this again']);
});

test('a fresh player starts at the first step and advances one move at a time', () => {
  let state = EMPTY_GUIDE_STATE;
  assert.equal(currentGuideStep(state, present), 'speak');
  // The step does NOT move because it was drawn, asked again, or re-rendered.
  assert.equal(currentGuideStep(state, present), 'speak');
  for (const step of GUIDE_STEPS) {
    assert.equal(currentGuideStep(state, present), step);
    state = markStep(state, step);
  }
  assert.equal(currentGuideStep(state, present), null);
});

test('marking is idempotent and only ever clears its own step', () => {
  const once = markStep(EMPTY_GUIDE_STATE, 'options');
  assert.equal(markStep(once, 'options'), once, 'a repeated event must not grow the state');
  // Doing a later move early does not consume the earlier one: 'speak' is
  // still what the guide has to say.
  assert.equal(currentGuideStep(once, present), 'speak');
});

test('a step with no target on screen is passed over, not pointed at', () => {
  // A layer with no gate has no 'enter' target. The guide must not sit there
  // dimming the scene around nothing — it moves to the step it can show.
  const state = markStep(markStep(EMPTY_GUIDE_STATE, 'speak'), 'options');
  assert.equal(currentGuideStep(state, step => step !== 'enter'), 'writer');
  // And passing over does NOT mark it done: when a gate does appear, and it is
  // still the earliest undone step with a target, it gets its turn.
  assert.equal(currentGuideStep(state, present), 'enter');
  // Nothing on screen at all means no overlay, not a stuck one.
  assert.equal(currentGuideStep(state, () => false), null);
});

test('下次不要再显示 is the PLAYER’s, and covers saves that do not exist yet', () => {
  const off = silenceGuide();
  assert.equal(off.off, true);
  assert.equal(currentGuideStep(off, present), null);
  // Every step is marked too, so clearing the flag alone can never resurrect a
  // half-finished guide — only an explicit replay does.
  assert.ok(all(off));
  assert.equal(currentGuideStep({ ...off, off: false }, present), null);
  // It lives in localStorage, NOT in the save's opening marker: a new save on
  // the same machine must stay silent for a player who asked for silence.
  assert.equal(GUIDE_STORAGE_KEY, 'airp.guide');
  assert.doesNotMatch(lib, /airpGateway|\/api\/opening|markOpening/);
  assert.match(lib, /localStorage\.getItem\(GUIDE_STORAGE_KEY\)/);
  assert.match(lib, /localStorage\.setItem\(GUIDE_STORAGE_KEY/);
});

test('replaying brings all four back; stored junk never crashes the guide', () => {
  assert.deepEqual(resetGuide(), { done: [], off: false });
  assert.equal(currentGuideStep(resetGuide(), present), 'speak');
  // The one settings control resets both halves: the save's first act and the
  // player's guide.
  const replay = app.slice(app.indexOf('const replayOpening ='), app.indexOf('const greeterId ='));
  assert.match(replay, /markOpening\(false\)/);
  assert.match(replay, /resetGuide\(\)/);
  // Anything unrecognised in storage degrades to "start over", never throws.
  assert.deepEqual(parseGuideState(null), EMPTY_GUIDE_STATE);
  assert.deepEqual(parseGuideState('nonsense'), EMPTY_GUIDE_STATE);
  assert.deepEqual(parseGuideState({ done: ['speak', 'speak', 'tour', 7] }), { done: ['speak'], off: false });
  assert.deepEqual(parseGuideState({ off: 'yes' }), EMPTY_GUIDE_STATE);
});

test('each step is cleared by its OWN real event, wired where that event happens', () => {
  // speak — any settled character turn, not just the first act's. The act's
  // own `onAnswered` keeps its gate so the save's marker is unaffected.
  assert.match(dock, /if \(awaitingAnswer && was !== 'idle' && dialogue\.phase === 'idle'\) onAnsweredRef\.current\?\.\(\);/);
  assert.match(dock, /if \(was !== 'idle' && dialogue\.phase === 'idle'\) onCharacterAnsweredRef\.current\?\.\(\);/);
  // The same edge also ends the answer as a performance (lib/stage-performance, forced tutorial pacing).
  assert.match(app, /onCharacterAnswered=\{\(\) => \{ markGuide\('speak'\); characterAnswerSettled\(\); (?:experienceAnswered\(\); )?(?:releaseTray\(\); )?\}\}/);
  // options — a resolved rail choice, in all three of its outcomes.
  assert.match(app, /onChoice=\{\(prompt\) => \{ markGuide\('options'\); runEntityAction\(prompt\); \}\}/);
  assert.match(app, /onEnterGate=\{\(target\) => \{ markGuide\('options'\);/);
  assert.match(app, /onOpenCharacter=\{\(id\) => \{ markGuide\('options'\);/);
  // enter — standing on a layer that is not the world's entry. Loading the
  // world is not it: at load the entry layer IS the current layer.
  assert.match(app, /if \(layer !== \(manifest\.entry \|\| 'map'\)\) markGuide\('enter'\);/);
  // writer — an ACCEPTED writer turn, after the gateway took it.
  const submit = app.slice(app.indexOf('const submitWriterText ='), app.indexOf('const prepareWriterHint ='));
  assert.match(submit, /markGuide\('writer'\)/);
  assert.ok(
    submit.indexOf("markGuide('writer')") > submit.indexOf('if (!result.accepted)'),
    'a refused writer turn must not count as the player having used the writer',
  );
});

test('nothing advances it except those events — no timer, no next button', () => {
  for (const [name, source] of [['OnboardingGuide.tsx', guide], ['onboarding.ts', lib]]) {
    assert.doesNotMatch(source, /setTimeout|setInterval/, `${name} must not advance on a clock`);
    assert.doesNotMatch(source, /t\('(?:Next|Back|Skip)\b|Step \{n\} of/, `${name} must not walk the player through it`);
  }
  // The only button in the overlay is the opt-out.
  assert.equal((guide.match(/<button/g) ?? []).length, 1);
  assert.match(guide, /onClick=\{guide\.silence\}/);
  // And clicking the dim does nothing at all — it cannot even be clicked.
  assert.doesNotMatch(guide, /onClick=\{[^}]*mark\b/);
});

test('the overlay never covers what it points at, and blocks nothing else', () => {
  // The dim is the HOLE's own spread shadow, so the target rectangle is the
  // one place no paint lands.
  assert.match(css, /\.onboarding-guide__hole \{[\s\S]{0,300}box-shadow: var\(--ux-shadow-guide-scrim\)/);
  // The whole layer is inert; only the bubble takes the pointer back.
  assert.match(css, /\.onboarding-guide \{[\s\S]{0,300}pointer-events: none/);
  assert.match(css, /\.onboarding-guide__bubble \{[\s\S]{0,600}pointer-events: auto/);
  assert.doesNotMatch(css, /\.onboarding-guide__hole \{[\s\S]{0,300}pointer-events: auto/);
  // Phones: the bubble sat over the lobby's 「开始新游戏」 and took its tap; there only the off switch is a button.
  assert.match(css, /@media \(max-width: 520px\) \{\s*\.onboarding-guide__bubble \{ pointer-events: none; \}\s*\.onboarding-guide__off \{ pointer-events: auto; \}/);
  // So the reply box stays typeable while step one is on screen: there is no
  // focus lease, no `inert`, and no backdrop element between them.
  assert.doesNotMatch(guide, /registerSurface|inert|preventDefault|stopPropagation/);
});

test('targets are marked by the components, and clipped to what is visible', () => {
  assert.match(dock, /data-guide-target="speak"/);
  assert.match(rail, /data-guide-target="options"/);
  assert.match(rail, /data-guide-target=\{choiceKind\(group\.frontmatter, option\) === 'enter' \? 'enter' : undefined\}/);
  assert.match(fab, /data-guide-target="writer"/);
  // Exactly one element per step offers itself, except the rail's gate options,
  // which are per-option and resolved by `querySelector` taking the first.
  for (const step of ['speak', 'options', 'writer']) {
    const uses = [dock, rail, fab].join('\n').match(new RegExp(`data-guide-target="${step}"`, 'g')) ?? [];
    assert.equal(uses.length, 1, `${step} must be claimed once`);
  }
  // The rail PARKS by sliding off the left edge, so its options keep a valid
  // rectangle while invisible. Clipping to the viewport is what stops the
  // guide pointing at a box nobody can see.
  assert.match(guide, /Math\.min\(rect\.right, window\.innerWidth\)/);
  assert.match(guide, /Math\.min\(rect\.bottom, window\.innerHeight\)/);
  assert.match(guide, /if \(width < 1 \|\| height < 1\) return null;/);
});

test('the box follows a target that moves, and is only re-measured, never cached', () => {
  // The rail slides, the dock is a full column and the writer sits bottom
  // right: a one-shot `getBoundingClientRect` on mount would aim at the parked
  // position forever.
  assert.match(guide, /requestAnimationFrame\(tick\)/);
  assert.match(guide, /cancelAnimationFrame\(frame\)/);
  // React only hears about it when it actually changed, so a still target
  // costs no re-render.
  assert.match(guide, /if \(!same\(boxRef\.current, nextBox\)\)/);
});

test('classic shows none of it, and the dock never says the same thing twice', () => {
  // The layout decides; `classic` has no rail, dock or FAB to point at.
  // The mode only picks WHICH list (player / creator); `companion` still decides whether any of it runs.
  assert.match(app, /const guide = useOnboardingGuide\(companion, authoring \? 'creator' : handoff \? 'handoff' : 'player'\);/);
  // The forced first-run tutorial stands the guide down while it runs.
  // Never over the lobby: the guide only shows once a world is entered.
  assert.match(app, /\{companion && !launcherOpen && (?:!tutorialArmed && )?(?:!introHold && )?(?:!prologueOpen && )?<OnboardingGuide guide=\{guide\} \/>\}/);
  assert.match(guide, /if \(!enabled \|\| state\.off/);
  // The first act's coach mark and the guide's first step are the same
  // sentence on the same box, so only one of them is ever on screen.
  assert.equal(GUIDE_LINES.speak, 'Say something back — that is how it starts.');
  assert.match(app, /coach: opening\.phase === 'greeting' && opening\.greeterId !== null && guide\.step !== 'speak'/);
});

test('this is not the deleted tour: it never runs ahead of the player', () => {
  // The 2026-09-20 removal is still a removal (see first-act.test.mjs).
  assert.doesNotMatch(guide, /TutorialSpotlight|tutorial-spotlight/);
  assert.doesNotMatch(lib, /TutorialSpotlight|tutorial-spotlight/);
  // No step index, no total, nothing that implies a sequence to sit through.
  assert.doesNotMatch(guide, /\bof \{total\}|stepIndex|currentIndex/);
  // A player who already knows the game is never shown a sentence: doing the
  // four moves marks all four without any of them having been displayed.
  let state = EMPTY_GUIDE_STATE;
  for (const step of ['writer', 'enter', 'options', 'speak']) state = markStep(state, step);
  assert.ok(all(state));
  assert.equal(currentGuideStep(state, present), null);
});

// ---- The author's three moves -------------------

test('the creator list is a second list, not a fifth step: same rules, different moves', () => {
  assert.deepEqual([...CREATOR_STEPS], ['build', 'god', 'home']);
  // Still exactly four player steps — the creator list never leaks into them.
  assert.deepEqual([...GUIDE_STEPS], ['speak', 'options', 'enter', 'writer']);
  for (const step of CREATOR_STEPS) {
    assert.equal(isGuideStep(step), false, `${step} is not a player step`);
    // `build` shares the player's writer button; the FAB carries ONE attribute.
    assert.equal(guideSelector(step), `[data-guide-target="${step === 'build' ? 'writer' : step}"]`);
    const key = GUIDE_LINES[step];
    assert.ok(messages[key]?.['zh-CN'] && messages[key]?.ja, `"${key}" needs zh-CN and ja`);
  }
  // Progress is one store: a creator step survives a round trip through storage…
  const state = parseGuideState({ done: ['build', 'speak', 'junk'], off: false });
  assert.deepEqual(state.done, ['build', 'speak']);
  // …and the creator walk starts at the first undone creator step, with player steps ignored.
  assert.equal(currentGuideStep(state, present, CREATOR_STEPS), 'god');
  assert.equal(currentGuideStep(markStep(state, 'god'), present, CREATOR_STEPS), 'home');
  assert.equal(currentGuideStep(markStep(markStep(state, 'god'), 'home'), present, CREATOR_STEPS), null);
  // 下次不要再显示 silences both lists; replay brings both back.
  assert.equal(currentGuideStep(silenceGuide(), present, CREATOR_STEPS), null);
  assert.equal(currentGuideStep(resetGuide(), present, CREATOR_STEPS), 'build');
});

test('each creator step is cleared by its own real event, and the targets are marked by the components', async () => {
  // build — the writer accepted a turn in the author's own world (beside the player's `writer`).
  assert.match(app, /markGuide\('writer'\);\s*markGuide\('beyond'\);\s*if \(authoring\) markGuide\('build'\);/);
  // god — God Hand switched ON, not off.
  assert.match(app, /if \(!isGodHandOpen\) markGuide\('god'\);/);
  // home — the author opens the launcher, where Publish lives.
  assert.match(app, /data-guide-target="home" onClick=\{\(\) => \{ if \(authoring\) markGuide\('home'\);/);
  const god = await readFile(new URL('../src/components/god/GodModeToolbar.tsx', import.meta.url), 'utf8');
  assert.match(god, /data-guide-target="god"/);
  // The hook takes the mode and re-resolves when it changes; the overlay itself is shared.
  assert.match(guide, /export function useOnboardingGuide\(enabled: boolean, mode: GuideMode = 'player'\)/);
  assert.match(guide, /\}, \[enabled, mode, state\]\);/);
});
