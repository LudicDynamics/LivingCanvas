// Character tick on the page: the beat coalescer, and
// source facts that keep the page honest (seen only when really drawn, counters through the
// real actions, the ambient twin steps aside, beats only in a world with tick). Same jiti
// bootstrap as ambient-life.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
let beat = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  beat = await jiti.import('../src/lib/tick/beat.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping character-tick group:', err?.message ?? err);
}
const skip = beat ? false : 'jiti or pi-rp submodule unavailable';

/** A fake clock for the coalescer. */
function clock() {
  let now = 0;
  let timers = [];
  return {
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimer: (t) => { timers = timers.filter((x) => x !== t); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((t) => t !== next);
        now = next.at;
        next.fn();
      }
      now = end;
    },
  };
}

test('a choice and the writer turn it starts are ONE beat', { skip }, () => {
  const c = clock();
  let busy = false;
  let sent = 0;
  const b = beat.createBeatCoalescer({ busy: () => busy, send: () => { sent += 1; }, setTimer: c.setTimer, clearTimer: c.clearTimer });
  b.signal('act');
  c.advance(300);
  busy = true; // the writer starts
  c.advance(5000);
  assert.equal(sent, 0, 'never while the writer writes');
  busy = false;
  b.signal('writer'); // it settled
  c.advance(beat.BEAT_QUIET_MS + 10);
  assert.equal(sent, 1);
  c.advance(10000);
  assert.equal(sent, 1);
});

test('quiet inputs each make their own beat; cancel drops a pending one; busy only defers', { skip }, () => {
  const c = clock();
  let sent = 0;
  let busy = false;
  const b = beat.createBeatCoalescer({ busy: () => busy, send: () => { sent += 1; }, setTimer: c.setTimer, clearTimer: c.clearTimer });
  b.signal('act');
  c.advance(beat.BEAT_QUIET_MS + 1);
  b.signal('act');
  c.advance(beat.BEAT_QUIET_MS + 1);
  assert.equal(sent, 2);
  b.signal('act');
  b.cancel();
  c.advance(5000);
  assert.equal(sent, 2);
  busy = true;
  b.signal('act');
  c.advance(20000);
  assert.equal(sent, 2);
  assert.equal(b.pending(), true);
  busy = false;
  b.poke();
  c.advance(beat.BEAT_QUIET_MS);
  assert.equal(sent, 3);
});

test('the player\'s own moves: routes and world events', { skip }, () => {
  for (const r of ['/api/choice', '/api/enter-layer', '/api/dice', '/api/move', '/api/use-item']) assert.ok(beat.PLAYER_ACT_ROUTES.includes(r), r);
  for (const e of ['choice_selected', 'roll_resolved', 'layer_entered']) assert.ok(beat.PLAYER_ACT_EVENTS.includes(e), e);
  assert.ok(!beat.PLAYER_ACT_EVENTS.includes('story_event'), 'the tick\'s own facts are not a player beat');
});

test('source facts: seen only when drawn and on screen; counters through the real actions; ambient twin yields', () => {
  const layer = read('components/canvas/TickIntentLayer.tsx');
  assert.match(layer, /document\.hidden/);
  assert.match(layer, /getBoundingClientRect/);
  assert.match(layer, /reportSeen\(id\)/);
  assert.match(layer, /guardIntent\(stage\.id, layer\)/);
  assert.match(layer, /requestTickCounter\(/);
  const ambient = read('components/canvas/AmbientLayer.tsx');
  assert.match(ambient, /id === live\.current\.tickActor/);
  const app = read('App.tsx');
  assert.match(app, /useCharacterTick\(\{/);
  assert.match(app, /enabled: worldTickOf\(manifest\) !== null/);
  assert.match(app, /onEnter: \(target\) => \{ void enterGate\(target, 'tick'\); \}/);
  assert.match(app, /onTake: \(path\) => \{ void handleTakeItem\(path\); \}/);
  // The prologue's own turn-end does not run twice in a world with tick.
  assert.match(app, /worldExperienceOf\(current\)\?\.turnEnd && !worldTickOf\(current\)/);
  const store = read('lib/tick/store.ts');
  assert.match(store, /seenSent\.has\(id\)/, 'seen is reported once per intent');
  const map = read('components/board/PictureMap.tsx');
  assert.match(map, /<MapTickLayer /);
});

test('v2 source facts: ✎ marks every generated line; real and ambient coexist (one bubble per person); prefetch at a beat\'s first sign', () => {
  const layer = read('components/canvas/TickIntentLayer.tsx');
  // The person's own words are always marked as theirs (a claim).
  assert.match(layer, /className="tick-say"[\s\S]{0,400}tick-say__mark[^>]*>✎/);
  assert.match(layer, /className="tick-said"/);
  assert.match(layer, /className="tick-invite"/);
  assert.match(layer, /setTickSpeaking\(/);
  const ambient = read('components/canvas/AmbientLayer.tsx');
  // Only a person speaking through the tick holds back their ambient bubbles; nobody else's.
  assert.match(ambient, /speaking\.has\(id\)/);
  assert.match(ambient, /if \(tickSpeaking\.has\(bubble\.actor\)\) return null;/);
  // The actor's pointer yields only while their own intent is pending (unchanged from v1).
  assert.match(ambient, /tick\.pending\.page === currentLayer \? tick\.pending\.actor : null/);
  const hook = read('lib/tick/use-character-tick.ts');
  assert.match(hook, /startOfBeat\(\);\s*coalescer\.signal\('act'\)/);
  assert.match(hook, /if \(!writing && now\) startOfBeat\(\);/);
  assert.match(read('lib/tick/store.ts'), /airpGateway\.tickPrefetch\(layer\)/);
  assert.match(read('components/AgentSettings.tsx'), /characterVoices: e\.target\.checked/);
});
