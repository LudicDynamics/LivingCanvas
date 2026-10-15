// The forced tutorial waits for the performance:
//   1. it advanced to the next caption the moment the player clicked, over the
//      writer's turn, the item / new-scene card, the dice;
//   2. while the writer worked the whole screen went black (a full-dim veil);
//   3. at the end it could come back at `speak` behind a full mask, stuck
//      until "Skip this time".
// Pure pacing machine + the one "is a performance playing" answer + source
// contracts on the component and App.
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  INITIAL_PACING,
  INITIAL_TUTORIAL,
  TUTORIAL_ACT_GRACE_MS,
  TUTORIAL_PERFORM_MAX_MS,
  TUTORIAL_QUIET_MS,
  advanceTutorial,
  continueTutorial,
  pacingStep,
  pacingWakeAt,
  tutorialPacingKey,
  tutorialPhase,
} = await jiti.import('../src/lib/forced-tutorial.ts');

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const component = await read('../src/components/chrome/ForcedTutorial.tsx');
const app = await read('../src/App.tsx');

const at = (state, step, extra = {}) => ({ ...state, step, ...extra });
/** Fold a sequence of observations: [state, performing, now]. */
function run(observations) {
  let pacing = INITIAL_PACING;
  for (const [state, performing, now] of observations) pacing = pacingStep(pacing, { state, performing, now });
  return pacing;
}

test('the first look waits a quiet beat; a UI-only move (opening the writer) shows at once', () => {
  //— even with
  // nothing reported playing, the very first look is the world's for a beat.
  const speak = INITIAL_TUTORIAL;
  let p = run([[speak, false, 1000]]);
  assert.equal(tutorialPhase(p, 1000), 'settling', 'not at the instant of entry');
  assert.equal(tutorialPhase(p, 1000 + TUTORIAL_QUIET_MS - 1), 'settling');
  assert.equal(tutorialPhase(p, 1000 + TUTORIAL_QUIET_MS), 'waiting', 'then the first guidance');
  assert.equal(pacingWakeAt(p, 1000), 1000 + TUTORIAL_QUIET_MS, 'the component wakes for it');
  p = pacingStep(p, { state: at(speak, 'writer'), performing: false, now: 4000 });
  // `writer` comes after follow — no performance owed to it.
  assert.equal(tutorialPhase(p, 4000), 'waiting');
  p = pacingStep(p, { state: at(speak, 'writer-send'), performing: false, now: 5000 });
  assert.equal(tutorialPhase(p, 5000), 'waiting', 'opening the writer is a UI move: the send step shows at once');
});

test('the arrival (opening card, greeting, its voice) holds the first look; the quiet beat follows it', () => {
  // The component folds `arriving` (and the `voice` / `character` performances) into `performing`.
  const speak = INITIAL_TUTORIAL;
  let p = run([[speak, true, 0]]);
  assert.equal(tutorialPhase(p, 0), 'performing');
  assert.equal(tutorialPhase(p, 9000), 'performing', 'a long opening card still holds it');
  // Card over, greeting delivered, its voice ends at 14s.
  p = pacingStep(p, { state: speak, performing: false, now: 14_000 });
  assert.equal(tutorialPhase(p, 14_000 + TUTORIAL_QUIET_MS - 1), 'settling');
  assert.equal(tutorialPhase(p, 14_000 + TUTORIAL_QUIET_MS), 'waiting', 'speak shows only after the greeting was heard');
});

test('an act holds the guidance while the performance plays, then a quiet beat, then the next step', () => {
  const t0 = 10_000;
  const sendStep = at(INITIAL_TUTORIAL, 'writer-send');
  let p = run([[sendStep, false, t0]]);
  assert.equal(tutorialPhase(p, t0 + TUTORIAL_QUIET_MS), 'waiting');
  // The player sends: the writer starts; the step moves on to `new-item` at once.
  const looking = at(sendStep, 'new-item', { writerStarted: true });
  p = pacingStep(p, { state: looking, performing: true, now: t0 + 100 });
  assert.equal(tutorialPhase(p, t0 + 100), 'performing', 'no caption, no mask while the writer works');
  // A card lands mid-turn: the step has something to point at, still performing.
  const found = { ...looking, newItem: 'map/new.md' };
  p = pacingStep(p, { state: found, performing: true, now: t0 + 20_000 });
  assert.equal(tutorialPhase(p, t0 + 20_000), 'performing', 'the new card is not highlighted over the writer');
  // The writer goes idle → an item-obtained card plays → it ends.
  p = pacingStep(p, { state: found, performing: false, now: t0 + 30_000 });
  assert.equal(tutorialPhase(p, t0 + 30_000), 'settling');
  p = pacingStep(p, { state: found, performing: true, now: t0 + 30_500 });
  assert.equal(tutorialPhase(p, t0 + 31_000), 'performing', 'the presentation that follows the turn holds it again');
  p = pacingStep(p, { state: found, performing: false, now: t0 + 34_000 });
  assert.equal(tutorialPhase(p, t0 + 34_000 + TUTORIAL_QUIET_MS - 1), 'settling', 'a quiet beat after the stage goes still');
  assert.equal(tutorialPhase(p, t0 + 34_000 + TUTORIAL_QUIET_MS), 'waiting', 'then the next step');
  assert.equal(pacingWakeAt(p, t0 + 34_000), t0 + 34_000 + TUTORIAL_QUIET_MS, 'the component wakes exactly then');
});

test('a step reached by an act waits a grace window for its performance to begin', () => {
  const t0 = 50_000;
  const take = at(INITIAL_TUTORIAL, 'take', { takeItem: 'world/a/key.md' });
  let p = run([[take, false, t0]]);
  // The player takes the item; the move answers before the item card starts.
  const enter = at(take, 'enter', { startLayer: 'world/a', takenCount: 1 });
  p = pacingStep(p, { state: enter, performing: false, now: t0 + 10 });
  assert.equal(tutorialPhase(p, t0 + 10), 'settling', 'not straight to the next caption');
  p = pacingStep(p, { state: enter, performing: true, now: t0 + 400 });
  assert.equal(tutorialPhase(p, t0 + 2000), 'performing');
  p = pacingStep(p, { state: enter, performing: false, now: t0 + 3200 });
  assert.equal(tutorialPhase(p, t0 + 3200 + TUTORIAL_QUIET_MS), 'waiting');
  // No performance ever comes: the grace alone runs out.
  let q = run([[take, false, t0], [enter, false, t0 + 10]]);
  assert.equal(tutorialPhase(q, t0 + 10 + TUTORIAL_ACT_GRACE_MS - 1), 'settling');
  assert.equal(tutorialPhase(q, t0 + 10 + TUTORIAL_ACT_GRACE_MS), 'waiting');
});

test('a very fast writer reply (starts and ends inside the grace) still settles before the next step', () => {
  const t0 = 1_000;
  const send = at(INITIAL_TUTORIAL, 'writer-send');
  const looking = at(send, 'new-item', { writerStarted: true });
  const p = run([[send, false, t0], [looking, true, t0 + 50], [looking, false, t0 + 200]]);
  const until = Math.max(t0 + 200 + TUTORIAL_QUIET_MS, t0 + 50 + TUTORIAL_ACT_GRACE_MS);
  assert.equal(tutorialPhase(p, until - 1), 'settling');
  assert.equal(tutorialPhase(p, until), 'waiting');
});

test('a writer error / aborted turn ends the performance like any other end: the tutorial resumes', () => {
  // writer-state turns `error` / `turn_aborted` into phase idle; that is `performing: false` here.
  const looking = at(INITIAL_TUTORIAL, 'new-item', { writerStarted: true });
  let p = run([[at(INITIAL_TUTORIAL, 'writer-send'), false, 0], [looking, true, 10]]);
  p = pacingStep(p, { state: looking, performing: false, now: 5000 });
  const settled = advanceTutorial(looking, { playerSentCount: 1, followAvailable: false, greeterFollowing: false, layer: 'map', writerOpen: true, writerWriting: false, itemPaths: [], unlockedPlaceAvailable: true, lockItemPath: null, carriedPaths: [] });
  assert.equal(settled.writerSettled, true, 'nothing new: a Continue-able caption');
  p = pacingStep(p, { state: settled, performing: false, now: 5010 });
  assert.equal(tutorialPhase(p, 5010 + TUTORIAL_ACT_GRACE_MS), 'waiting', 'guidance returns; nothing hangs');
});

test('a performance that never reports its end stops holding the guidance (no hang)', () => {
  const looking = at(INITIAL_TUTORIAL, 'new-item', { writerStarted: true });
  const p = run([[looking, true, 0]]);
  assert.equal(tutorialPhase(p, TUTORIAL_PERFORM_MAX_MS - 1), 'performing');
  assert.equal(tutorialPhase(p, TUTORIAL_PERFORM_MAX_MS), 'waiting');
  assert.equal(pacingWakeAt(p, 10), TUTORIAL_PERFORM_MAX_MS, 'the component wakes at the cap');
  assert.equal(pacingWakeAt(p, TUTORIAL_PERFORM_MAX_MS + 1), null);
});

test('a reload mid-tutorial while the writer is still working starts in `performing`', () => {
  // The component mounts with a fresh pacing; the first observation already performs.
  const p = run([[INITIAL_TUTORIAL, true, 7]]);
  assert.equal(tutorialPhase(p, 8), 'performing');
  assert.match(component, /const phase = pacing\.key === '' \? \(performing \? 'performing' : 'settling'\) : tutorialPhase\(pacing, Date\.now\(\)\);/, 'before the first pacing pass: never guidance');
});

test('the pacing key changes with what the guidance would point at', () => {
  const s = at(INITIAL_TUTORIAL, 'new-item');
  assert.notEqual(tutorialPacingKey(s), tutorialPacingKey({ ...s, newItem: 'a.md' }), 'a card appearing is a new thing to show');
  assert.notEqual(tutorialPacingKey(at(s, 'take', { takeItem: 'a' })), tutorialPacingKey(at(s, 'take', { takeItem: 'b' })), 'the next item of a two-item lock');
  assert.equal(tutorialPacingKey(s), tutorialPacingKey({ ...s, baselineItems: ['x'] }), 'bookkeeping is not');
});

test('stage-performance: one answer from the writer, the dice and the reported sources', async () => {
  const perf = await jiti.import('../src/lib/stage-performance.ts');
  perf.resetPerformingForTest();
  const quiet = { writerWorking: false, writerSubmitPending: false, diceCeremony: false, sources: [] };
  assert.equal(perf.performanceInProgress(quiet), false);
  for (const busy of [{ writerWorking: true }, { writerSubmitPending: true }, { diceCeremony: true }, { sources: ['milestone'] }]) {
    assert.equal(perf.performanceInProgress({ ...quiet, ...busy }), true, JSON.stringify(busy));
  }
  perf.setPerforming('milestone', true);
  perf.setPerforming('cg', true);
  assert.deepEqual(perf.performingSources(), ['milestone', 'cg']);
  assert.equal(perf.readPerformance(), true);
  perf.setPerforming('milestone', false);
  perf.setPerforming('cg', false);
  assert.deepEqual(perf.performingSources(), []);
  assert.equal(perf.readPerformance(), false, 'writer idle, no dice, nothing reported');
  assert.equal(perf.readPerformance(true), true, 'a prompt in flight already counts');
  // A character answer: the send starts it, settling ends it.
  perf.characterAnswerStarted();
  assert.deepEqual(perf.performingSources(), ['character']);
  perf.characterAnswerSettled();
  assert.deepEqual(perf.performingSources(), []);
  perf.resetPerformingForTest();
});

test('stage-performance: a report nobody clears expires (a lost frame cannot wedge the tutorial)', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const perf = await jiti.import('../src/lib/stage-performance.ts');
    perf.resetPerformingForTest();
    let calls = 0;
    const off = perf.subscribePerforming(() => { calls += 1; });
    perf.setPerforming('character', true);
    perf.setPerforming('character', true);
    assert.equal(calls, 1, 'a repeated start is not a change');
    mock.timers.tick(perf.PERFORMING_MAX_MS - 1);
    assert.deepEqual(perf.performingSources(), ['character']);
    mock.timers.tick(1);
    assert.deepEqual(perf.performingSources(), [], 'expired');
    assert.equal(calls, 2);
    off();
    perf.resetPerformingForTest();
  } finally {
    mock.timers.reset();
  }
});

test('the presentations report themselves: item / new-scene cards, the CG', async () => {
  const stage = await read('../src/components/chrome/MilestoneStage.tsx');
  assert.match(stage, /const presenting = current !== null \|\| replay !== null;\s*useEffect\(\(\) => \{ setPerforming\('milestone', presenting\); \}, \[presenting\]\);/);
  assert.match(stage, /setStageBusy\(false\); setPerforming\('milestone', false\); \}, \[\]\);/, 'an unmount clears it');
  const cg = await read('../src/components/chrome/CgReveal.tsx');
  assert.match(cg, /setPerforming\('cg', showing\)/);
  assert.match(cg, /\(\) => setPerforming\('cg', false\)/);
  const perf = await read('../src/lib/stage-performance.ts');
  assert.match(perf, /getWriterState\(\)\.phase === 'writing'/, 'the writer store is the writer truth');
  assert.match(perf, /getCeremonySnapshot\(\) !== null/, 'the dice store is the dice truth');
  assert.match(perf, /type === 'character_idle' \|\| type === 'error' \|\| type === 'turn_aborted'/, 'a character answer ends on its terminal frame');
});

test('ForcedTutorial gates its guidance on the one performance answer', () => {
  assert.match(component, /const stagePerforming = usePerformanceInProgress\(writerSubmitPending\);\s*const performing = stagePerforming \|\| arriving \|\| \(held && state\.step === 'roll'\);/, 'a requested roll waits for its ceremony unmasked; the arrival is a performance');
  assert.match(component, /setPacing\(current => pacingStep\(current, \{ state: stateForPacing\.current, performing, now: Date\.now\(\) \}\)\);\s*\}, \[pacingKey, performing\]\);/);
  // Performing / settling: no mask, no caption, nothing swallowed — only the way out.
  const paused = component.match(/if \(!guiding\) \{([\s\S]*?)\n  \}\n/);
  assert.ok(paused, 'a paused render exists');
  assert.doesNotMatch(paused[1], /forced-tutorial__(hole|veil|caption|bubble)/);
  assert.match(paused[1], /onClick=\{end\}>\{t\('Skip this time'\)\}/, 'skip works at any point');
  assert.match(paused[1], /onClick=\{neverAgain\}>\{t\("Don't show again"\)\}/);
  assert.match(component, /if \(state\.step === 'done' \|\| !guiding \|\| !hasTarget\) return;/, 'no press is swallowed while not guiding');
  assert.match(app, /<ForcedTutorial [^>]*writerSubmitPending=\{writerSubmitPending\}/);
});

test('the last step closes itself; with no place on screen "Done" ends it', () => {
  assert.match(component, /const showDone = state\.step === 'enter' && !hasTarget;/);
  assert.match(component, /\{showDone && \(\s*<button type="button" className="forced-tutorial__done" onClick=\{end\}>\{t\('Done'\)\}<\/button>/);
  // Walking in is `done`, which ends it once (onEnd unmounts it in App).
  assert.match(component, /if \(state\.step === 'done' && !ended\.current\) \{\s*ended\.current = true;\s*onEnd\(\);/);
  assert.match(app, /const endTutorial = useCallback\(\(\) => \{\s*setTutorialArmed\(false\);/);
});

test('a finished tutorial is not re-armed by a late greeting in the same world entry', () => {
  // A save resumed inside a place greets only on reaching the entry layer — the
  // tutorial's own last move — and that greeting used to re-arm it at `speak`.
  // Once per entry, keyed by the world (lib/forced-tutorial `tutorialArmOnEntry`, behaviour in forced-tutorial.test.mjs).
  assert.match(app, /const tutorialLatchRef = useRef\(INITIAL_TUTORIAL_LATCH\);/);
  assert.match(app, /tutorialArmOnEntry\(tutorialLatchRef\.current, worldId, readTutorialDone\(window\.localStorage\)\);\s*tutorialLatchRef\.current = latch;\s*if \(!arm\) return;/);
  assert.match(app, /if \(!worldId \|\| launcherOpen\) \{\s*tutorialLatchRef\.current = INITIAL_TUTORIAL_LATCH;/, 'back at the launcher a new entry starts');
  assert.match(app, /writeTutorialDone\(window\.localStorage, false\);\s*tutorialLatchRef\.current = \{ worldId: manifestRef\.current\?\.id \?\? null, ran: true \};/, 'Settings → replay still runs it');
});

test('a message to a character starts a performance; its answer (or closing them) ends it', () => {
  assert.match(app, /const countTutorialSend = useCallback\(\(\) => \{\s*setTutorialSent\(count => count \+ 1\);\s*characterAnswerStarted\(\);/);
  assert.match(app, /onCharacterAnswered=\{\(\) => \{ markGuide\('speak'\); characterAnswerSettled\(\); (?:experienceAnswered\(\); )?(?:releaseTray\(\); )?\}\}/);
  assert.match(app, /frameQueue\.clear\('close'\);\s*\/\/[^\n]*\n\s*characterAnswerSettled\(\);/);
});

test('the companion speaking first (a return / greeting-less arrival) is a performance too', () => {
  assert.match(app, /sendMessage\(\{ type: 'character_prompt', characterId: greeter\.id, message: returnCue\(manifest\?\.locale, occasion\), savePath: activeWorldPath \}\);\s*\/\/[^\n]*\n\s*characterAnswerStarted\(\);/);
});

test('Continue after the search still leads on to the move (unchanged by pacing)', () => {
  const snap = { playerSentCount: 1, followAvailable: false, greeterFollowing: false, layer: 'map', writerOpen: true, writerWriting: false, itemPaths: ['map/g/README.md', 'map/n.md'], unlockedPlaceAvailable: true, lockItemPath: null, carriedPaths: [] };
  const s = continueTutorial({ ...INITIAL_TUTORIAL, step: 'new-item', newItem: 'map/n.md' }, snap);
  assert.equal(s.step, 'enter');
});
