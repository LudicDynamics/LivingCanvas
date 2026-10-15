// The world comes first
//
//
// Entering a world, the tutorial's first step (`speak`) showed ~1.2 s after the
// opening scene card ended — over the companion's greeting while its voice was
// still being fetched / playing — and the skip pill sat on screen from the first
// frame of a return visit. Now nothing of the tutorial renders until:
//   (a) the world is loaded and the launcher is gone,
//   (b) the opening scene card has played,
//   (c) the greeting has been delivered (authored line on screen / return line
//       asked for) — then its answer (`character`) and its VOICE (`voice`, new)
//       are performances —
// plus the quiet beat after the stage goes still.
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  INITIAL_PACING,
  INITIAL_TUTORIAL,
  TUTORIAL_ARRIVAL_MAX_MS,
  TUTORIAL_QUIET_MS,
  pacingStep,
  settleArrivalGreeting,
  tutorialArrivalPending,
  tutorialPhase,
} = await jiti.import('../src/lib/forced-tutorial.ts');

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const app = await read('../src/App.tsx');
const component = await read('../src/components/chrome/ForcedTutorial.tsx');
const hook = await read('../src/lib/use-spoken-lines.ts');
const speakerVoice = await read('../src/lib/speaker-voice.ts');
const audio = await read('../src/lib/audio.ts');

test('arrival: pending until the world is on screen, the opening card has played and the greeting is delivered', () => {
  const ready = { worldReady: true, openingDone: true, greeting: 'sent' };
  assert.equal(tutorialArrivalPending(ready), false);
  assert.equal(tutorialArrivalPending({ ...ready, worldReady: false }), true, 'launcher up / still loading');
  assert.equal(tutorialArrivalPending({ ...ready, openingDone: false }), true, 'opening scene card still playing');
  assert.equal(tutorialArrivalPending({ ...ready, greeting: 'waiting' }), true, 'between the card and the greeting');
  assert.equal(tutorialArrivalPending({ ...ready, greeting: 'none' }), false, 'no greeting is coming');
  assert.ok(TUTORIAL_ARRIVAL_MAX_MS >= 10_000 && TUTORIAL_ARRIVAL_MAX_MS <= 30_000, 'a lost greeting cannot hide the tutorial for long');
});

test('arrival: a delivered (or abandoned) greeting is final for the entry', () => {
  assert.equal(settleArrivalGreeting('waiting', 'sent'), 'sent');
  assert.equal(settleArrivalGreeting('waiting', 'none'), 'none');
  assert.equal(settleArrivalGreeting('sent', 'none'), 'sent', 'the cap firing after delivery changes nothing');
  assert.equal(settleArrivalGreeting('none', 'sent'), 'none');
});

test('timeline: card 0–9 s → greeting → voice until 14 s → speak at 14 s + quiet beat, never before', () => {
  // `performing` as the component sees it: arriving || a reported performance.
  const speak = INITIAL_TUTORIAL;
  const frames = [
    [0, true], // entry: opening card (arriving + milestone)
    [9000, true], // card ends, greeting delivered in the same beat; voice asked for
    [9100, true], // voice fetching / playing
    [14_000, false], // voice ended
  ];
  let p = INITIAL_PACING;
  for (const [now, performing] of frames) p = pacingStep(p, { state: speak, performing, now });
  for (const now of [0, 2000, 9000, 9050, 12_000, 14_000, 14_000 + TUTORIAL_QUIET_MS - 1]) {
    assert.notEqual(tutorialPhase(p, now), 'waiting', `no guidance at ${now} ms`);
  }
  assert.equal(tutorialPhase(p, 14_000 + TUTORIAL_QUIET_MS), 'waiting');
});

test('stage-performance: a spoken line is a performance, counted across overlapping speakers', async () => {
  const perf = await jiti.import('../src/lib/stage-performance.ts');
  perf.resetPerformingForTest();
  const a = perf.voiceLineBegan();
  const b = perf.voiceLineBegan();
  assert.deepEqual(perf.performingSources(), ['voice']);
  assert.equal(perf.readPerformance(), true);
  a();
  a(); // idempotent
  assert.deepEqual(perf.performingSources(), ['voice'], 'the other speaker is still talking');
  b();
  assert.deepEqual(perf.performingSources(), []);
  assert.equal(perf.readPerformance(), false);
  perf.resetPerformingForTest();
});

test('stage-performance: a voice line that never ends expires like any report', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const perf = await jiti.import('../src/lib/stage-performance.ts');
    perf.resetPerformingForTest();
    perf.voiceLineBegan();
    mock.timers.tick(perf.PERFORMING_MAX_MS);
    assert.deepEqual(perf.performingSources(), []);
    perf.resetPerformingForTest();
  } finally {
    mock.timers.reset();
  }
});

test('the spoken-lines batch reports itself from the ask to the end of the last clip', () => {
  assert.match(hook, /import \{ voiceLineBegan \} from '\.\/stage-performance\.js';/);
  // The queue moved to lib/speaker-voice.ts (per-speaker voice, fix/tts-no-narration): the hook
  // hands it the performance reporter and the busy check; the drain reports itself end to end.
  assert.match(hook, /performance: voiceLineBegan,\s*isBusy: isVoiceBusy,/);
  assert.match(speakerVoice, /const heard = this\.deps\.performance\?\.\(\) \?\? \(\(\): void => \{\}\);\s*try \{/);
  assert.match(speakerVoice, /\} finally \{\s*heard\(\);/);
  assert.match(speakerVoice, /await this\.waitForSilence\(epochValid\);\s*await this\.waitUntilHeard\(epochValid\);/);
  assert.match(speakerVoice, /private async waitUntilHeard\(stillValid: \(\) => boolean\): Promise<void> \{[\s\S]*?while \(this\.deps\.isBusy\(\) && stillValid\(\) && this\.deps\.now\(\) < deadline\)/, 'a line still loading counts as being said');
  assert.match(audio, /export function isVoiceBusy\(\): boolean \{\s*return voiceClip !== null \|\| voiceLoading !== null;/);
  assert.match(audio, /voiceLoading = token;\s*void loadSample\(url\)\.then\(\(buf\) => \{\s*if \(voiceLoading === token\) voiceLoading = null;/);
  assert.match(audio, /voiceToken \+= 1; \/\/ invalidate any in-flight load\s*voiceUrl = null;\s*voiceLoading = null;/, 'a stop ends the load too');
});

test('ForcedTutorial: invisible (no mask, no caption, no skip pill) until its first guidance', () => {
  assert.match(component, /arriving = false, onStep, onEnd \}: ForcedTutorialProps/);
  assert.match(component, /const guiding = phase === 'waiting' && !arriving;/);
  assert.match(component, /const \[firstLook, setFirstLook\] = useState\(true\);\s*useEffect\(\(\) => \{ if \(guiding\) setFirstLook\(false\); \}, \[guiding\]\);\s*const hidden = firstLook && !guiding;/);
  // The hidden return comes before the paused (skip-pill) render.
  const hiddenAt = component.indexOf('if (hidden) return null;');
  const pausedAt = component.indexOf('if (!guiding) {');
  assert.ok(hiddenAt > 0 && hiddenAt < pausedAt, 'nothing renders during the arrival');
  assert.match(component, /onStep\?\.\(firstLook \? null : state\.step\);/, 'the reply box is not pre-filled / focused during the arrival');
});

test('App: the arrival is per entry, never under the launcher or mid-load, and the greeting reports where it is', () => {
  assert.match(app, /const entryKey = !launcherOpen && runKey \? runKey : '';/);
  assert.match(app, /const tutorialArriving = tutorialArrivalPending\(\{\s*worldReady: entryKey !== '',\s*openingDone: !openingSceneHold,\s*greeting: !companion \? 'none' : arrival\.key === entryKey \? arrival\.greeting : 'waiting',\s*\}\);/);
  assert.match(app, /<ForcedTutorial [^>]*arriving=\{tutorialArriving\}/);
  assert.match(app, /\{tutorialArmed && !launcherOpen && !introHold && !openingSceneHold && \(\s*<ForcedTutorial /, 'still not even mounted over the launcher / during the card');
  // The cap counts from the end of the opening card.
  assert.match(app, /if \(!entryKey \|\| openingSceneHold\) return;\s*const cap = window\.setTimeout\(\(\) => settleArrival\(entryKey, 'none'\), TUTORIAL_ARRIVAL_MAX_MS\);/);
  // Delivered: the authored greeting on screen, or the return line asked for.
  assert.match(app, /setOpening\(\{ \.\.\.plan, phase: 'greeting' \}\);[\s\S]{0,160}?settleArrival\(runKey, 'sent'\);/);
  assert.match(app, /characterAnswerStarted\(\);\s*\/\/[^\n]*\n\s*settleArrival\(entry, 'sent'\);/);
  // Nothing is coming: resumed inside a place, unreadable marker, no greeter, a later entry.
  assert.match(app, /if \(layer !== \(manifest\?\.entry \|\| 'map'\)\) \{ settleArrival\(runKey, 'none'\); return; \}/);
  assert.match(app, /concluded = true;\s*settleArrival\(runKey, 'none'\);\s*return; \/\/ Unreachable marker/);
  assert.match(app, /if \(!greeter\) \{ settleArrival\(entry, 'none'\); return; \}/);
  assert.match(app, /if \(openingRunRef\.current !== runKey\) settleArrival\(runKey, 'none'\);/);
  // Back at the launcher the first act is over: its greeting is not re-seeded and re-spoken under the launcher.
  assert.match(app, /if \(launcherOpen\) setOpening\(null\);/);
});

test('"Don\'t show again" still keeps it away entirely', () => {
  assert.match(app, /const armTutorial = useCallback\(\(worldId: string \| null \| undefined\) => \{\s*const \{ latch, arm \} = tutorialArmOnEntry\(tutorialLatchRef\.current, worldId, readTutorialDone\(window\.localStorage\)\);/);
});
