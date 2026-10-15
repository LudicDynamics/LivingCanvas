// Ambient life: the pure clock, gate, bark choice,
// hand motion and the 「世界小动作」 switch, plus source facts that keep it a
// show-only lane (never logged, never sent). Same jiti bootstrap as agent-cursor.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '../src');
let sched = null, gate = null, barks = null, motion = null, settings = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  sched = await jiti.import('../src/lib/ambient/scheduler.ts');
  gate = await jiti.import('../src/lib/ambient/gate.ts');
  barks = await jiti.import('../src/lib/ambient/barks.ts');
  motion = await jiti.import('../src/lib/ambient/motion.ts');
  settings = await jiti.import('../src/lib/ambient/settings.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping ambient-life group:', err?.message ?? err);
}
const skip = sched && gate && barks && motion && settings ? false : 'jiti or pi-rp submodule unavailable';

const ACTORS = [
  { id: 'writer', kind: 'writer', cursor: true, speaks: false },
  { id: 'xia-cheng', kind: 'character', cursor: true, speaks: true },
  { id: 'lao-qin', kind: 'npc', cursor: true, speaks: true },
];

function input(over = {}) {
  return {
    now: 0, actors: ACTORS, cursorPause: null, bubblePause: null, reducedMotion: false,
    rng: motion.seededRng(7), playerKnown: true, canBark: () => true, chatPartners: () => [], ...over,
  };
}

/** Run the clock for `ms` at the layer's 500ms tick; return every action. */
function run(over = {}, ms = 120000, state = sched.INITIAL_SCHEDULER) {
  const rng = motion.seededRng(over.seed ?? 11);
  const all = [];
  for (let now = 0; now <= ms; now += 500) {
    const r = sched.planTick(state, input({ ...over, now, rng }));
    state = r.state;
    for (const a of r.actions) all.push({ ...a, at: now });
  }
  return { actions: all, state };
}

test('AL1 the clock gives everyone something to do, with per-actor randomised intervals', { skip }, () => {
  const { actions } = run();
  const cursors = actions.filter((a) => a.kind === 'cursor');
  const bubbles = actions.filter((a) => a.kind !== 'cursor');
  for (const id of ['writer', 'xia-cheng', 'lao-qin']) assert.ok(cursors.some((a) => a.actor === id), `${id} moves`);
  assert.ok(!bubbles.some((a) => a.actor === 'writer'), 'the writer never shows a bubble');
  for (const id of ['xia-cheng', 'lao-qin']) {
    const times = bubbles.filter((a) => a.actor === id).map((a) => a.at);
    assert.ok(times.length >= 4, `${id} bubbles over two minutes`);
    // Successive bubble beats for one person are ≥ 6s apart (the wait-for-a-speaker deferral only adds time).
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 1200, `${id} not spammy`);
  }
  // A newcomer does something within the first ten seconds ("walked into something ongoing").
  assert.ok(actions.some((a) => a.at <= 10000 && a.kind !== 'cursor'));
  assert.ok(actions.some((a) => a.at <= 5000 && a.kind === 'cursor'));
});

test('AL2 at most one speech at a time; never more than two new actions per tick', { skip }, () => {
  const { actions } = run({ chatPartners: (id) => (id === 'xia-cheng' ? ['lao-qin'] : []) }, 600000);
  const perTick = new Map();
  for (const a of actions) perTick.set(a.at, (perTick.get(a.at) ?? 0) + 1);
  assert.ok(Math.max(...perTick.values()) <= sched.MAX_ACTIONS_PER_TICK);
  const speech = actions.filter((a) => a.kind === 'bark' || a.kind === 'murmur' || a.kind === 'chat');
  assert.ok(speech.some((a) => a.kind === 'chat' && a.partner === 'lao-qin'), 'a scripted pair chats');
  for (let i = 1; i < speech.length; i++) {
    const prev = speech[i - 1];
    assert.ok(speech[i].at - prev.at >= sched.SPEECH_SLOT_MS[prev.kind], `speech at ${speech[i].at} overlaps ${prev.kind} at ${prev.at}`);
  }
});

test('AL3 a paused gate schedules nothing, and resuming waits a beat first', { skip }, () => {
  let state = sched.INITIAL_SCHEDULER;
  const rng = motion.seededRng(3);
  for (let now = 0; now <= 60000; now += 500) {
    const r = sched.planTick(state, input({ now, rng, cursorPause: 'typing', bubblePause: 'typing' }));
    assert.deepEqual(r.actions, [], `paused at ${now}`);
    state = r.state;
  }
  assert.equal(state.paused, true);
  const resumed = sched.planTick(state, input({ now: 60500, rng }));
  assert.deepEqual(resumed.actions, [], 'first tick after the pause is quiet');
  for (const clock of Object.values(resumed.state.clocks)) {
    assert.ok(clock.cursorAt >= 60500 + sched.RESUME_DELAY[0] && clock.bubbleAt >= 60500 + sched.RESUME_DELAY[0]);
  }
});

test('AL4 writer generating: bubbles stop, pointers keep idling', { skip }, () => {
  const { actions } = run({ bubblePause: 'writer' });
  assert.ok(actions.length > 0);
  assert.ok(actions.every((a) => a.kind === 'cursor'));
});

test('AL5 reduced motion: no pointer moves at all, emotes only, about three times rarer', { skip }, () => {
  const normal = run({}, 600000).actions.filter((a) => a.kind !== 'cursor').length;
  const { actions } = run({ reducedMotion: true }, 600000);
  assert.ok(actions.every((a) => a.kind === 'emote'), 'emotes only');
  assert.ok(actions.length > 0 && actions.length * 2 < normal, `${actions.length} vs ${normal}`);
});

test('AL6 point-player only when the player pointer is known; point-actor names someone else', { skip }, () => {
  const { actions } = run({ playerKnown: false }, 600000);
  assert.ok(!actions.some((a) => a.move === 'point-player'));
  const pointing = run({}, 600000).actions.filter((a) => a.move === 'point-actor');
  assert.ok(pointing.length > 0);
  for (const a of pointing) assert.ok(a.other && a.other !== a.actor);
  const lonely = run({ actors: [ACTORS[0]] }, 600000).actions;
  assert.ok(!lonely.some((a) => a.move === 'point-actor'));
});

test('AL7 gate: hard pauses stop pointers and bubbles; agent work stops bubbles only', { skip }, () => {
  const probe = { enabled: true, hidden: false, typing: false, dragging: false, dialog: false, ceremony: false, tutorial: false, writerBusy: false, agentBusy: false };
  assert.equal(gate.cursorPauseOf(probe), null);
  assert.equal(gate.bubblePauseOf(probe), null);
  for (const [key, reason] of [['hidden', 'hidden'], ['typing', 'typing'], ['dragging', 'dragging'], ['dialog', 'dialog'], ['ceremony', 'ceremony'], ['tutorial', 'tutorial']]) {
    assert.equal(gate.cursorPauseOf({ ...probe, [key]: true }), reason);
    assert.equal(gate.bubblePauseOf({ ...probe, [key]: true }), reason);
  }
  assert.equal(gate.cursorPauseOf({ ...probe, enabled: false }), 'off');
  assert.equal(gate.cursorPauseOf({ ...probe, writerBusy: true }), null);
  assert.equal(gate.bubblePauseOf({ ...probe, writerBusy: true }), 'writer');
  assert.equal(gate.bubblePauseOf({ ...probe, agentBusy: true }), 'agent');
});

test('AL8 typing = a focused field with a recent key, or a draft touched in the last 20 s; a pre-filled or empty box is not', { skip }, () => {
  const field = (value) => ({ closest: (sel) => (sel.includes('textarea') ? {} : null), value });
  assert.equal(gate.isTyping(field(''), 0, 100000), false, 'autofocused empty box');
  assert.equal(gate.isTyping(field('suggested reply'), 0, 100000), false, 'pre-filled, never touched');
  assert.equal(gate.isTyping(field(''), 99000, 100000), true, 'a key just went in');
  assert.equal(gate.isTyping(field('half a sente'), 90000, 100000), true, 'thinking mid-sentence');
  assert.equal(gate.isTyping(field('old draft'), 70000, 100000), false, 'a stale draft');
  assert.equal(gate.isTyping({ closest: () => null, value: 'x' }, 99000, 100000), false);
  assert.equal(gate.isTyping(null, 99000, 100000), false);
});

test('AL9 overlays: dialogs, dice/CG/milestone and the tutorial are detected by selector', { skip }, () => {
  const root = (hit) => ({ querySelectorAll: (sel) => (sel.split(',').some((s) => s.trim() === hit) ? [{}] : []) });
  assert.deepEqual(gate.probeOverlays(root('[aria-modal="true"]')), { dialog: true, ceremony: false, tutorial: false });
  assert.deepEqual(gate.probeOverlays(root('.dice-ceremony-overlay')), { dialog: false, ceremony: true, tutorial: false });
  assert.deepEqual(gate.probeOverlays(root('.forced-tutorial:not(.forced-tutorial--paused)')), { dialog: false, ceremony: false, tutorial: true });
  assert.deepEqual(gate.probeOverlays(root('.nothing')), { dialog: false, ceremony: false, tutorial: false });
});

test('AL9b overlays: only RENDERED matches pause — a display:none RotateHint on desktop does not hold the world still', { skip }, () => {
  // RotateHint is in the DOM for the whole play view; CSS shows it only on upright touch phones.
  const el = (boxes) => ({ getClientRects: () => ({ length: boxes }) });
  const root = (els) => ({ querySelectorAll: (sel) => (sel.includes('.rotate-hint') ? els : []) });
  assert.equal(gate.probeOverlays(root([el(0)])).dialog, false, 'hidden by CSS (desktop)');
  assert.equal(gate.probeOverlays(root([el(0), el(1)])).dialog, true, 'one of them is on screen');
  assert.equal(gate.probeOverlays(root([el(1)])).dialog, true, 'shown (phone held upright)');
  // The tutorial's paused form (just the way-out buttons) is not a tutorial on screen.
  assert.ok(!gate.TUTORIAL_SELECTOR.split(',').some((s) => s.trim() === '.forced-tutorial'));
  assert.match(gate.TUTORIAL_SELECTOR, /:not\(\.forced-tutorial--paused\)/);
});

const CTX = { locale: 'en', layer: 'world/cab', hour: 23, cardPaths: new Set(['world/cab/notice.md']) };

test('AL10 bark choice: interface locale for per-locale maps, else the edition list', { skip }, () => {
  const rng = () => 0;
  const map = { barks: { en: ['Hello'], ja: ['やあ'], 'zh-CN': ['你好'] } };
  assert.equal(barks.pickBark(map, { ...CTX, locale: 'ja' }, rng), 'やあ');
  assert.equal(barks.pickBark(map, { ...CTX, locale: 'ko' }, rng), 'Hello', 'missing locale falls back to English');
  assert.equal(barks.pickBark({ barks: ['Edition line'] }, { ...CTX, locale: 'ja' }, rng), 'Edition line');
  assert.equal(barks.pickBark(undefined, CTX, rng), null);
  assert.equal(barks.pickBark({ emotes: ['dots'] }, CTX, rng), null);
});

test('AL11 conditions: layer (and below), time of day, a card on the canvas', { skip }, () => {
  const entry = {
    barks: ['general'],
    when: [
      { layer: 'world/cab', barks: ['cab'] },
      { layer: 'world/sleeper', barks: ['sleeper'] },
      { time: 'morning', barks: ['morning'] },
      { card: 'world/cab/notice.md', barks: ['notice'] },
      { card: 'world/cab/gone.md', barks: ['gone'] },
    ],
  };
  const { conditional, general } = barks.eligibleBarks(entry, CTX);
  assert.deepEqual(conditional.sort(), ['cab', 'notice']);
  assert.deepEqual(general, ['general']);
  assert.deepEqual(barks.eligibleBarks(entry, { ...CTX, layer: 'world/cab/inner', hour: 7 }).conditional.sort(), ['cab', 'morning', 'notice']);
  assert.equal(barks.layerMatches('map', 'world/cab'), false);
  assert.equal(barks.layerMatches('map', 'map'), true);
  assert.equal(barks.timeOfDay(6), 'morning');
  assert.equal(barks.timeOfDay(12), 'day');
  assert.equal(barks.timeOfDay(18), 'evening');
  assert.equal(barks.timeOfDay(2), 'night');
  // A matching condition wins two times in three.
  const rng = motion.seededRng(5);
  let fromCondition = 0;
  for (let i = 0; i < 300; i++) if (barks.pickBark(entry, CTX, rng) !== 'general') fromCondition++;
  assert.ok(fromCondition > 160 && fromCondition < 240, String(fromCondition));
});

test('AL12 recent lines are avoided while others remain; durations are 2–4 s', { skip }, () => {
  const entry = { barks: ['a', 'b', 'c'] };
  const rng = motion.seededRng(9);
  for (let i = 0; i < 50; i++) assert.equal(barks.pickBark(entry, CTX, rng, ['a', 'b']), 'c');
  assert.ok(['a', 'b', 'c'].includes(barks.pickBark(entry, CTX, rng, ['a', 'b', 'c'])));
  assert.equal(barks.barkDurationMs('hi'), 2000);
  assert.equal(barks.barkDurationMs('x'.repeat(40)), 4000);
});

test('AL13 emotes fall back to the wordless built-ins; chats alternate and start with the opener', { skip }, () => {
  const rng = motion.seededRng(1);
  for (let i = 0; i < 40; i++) assert.ok(barks.ALL_EMOTES.includes(barks.pickEmote(undefined, rng)));
  for (let i = 0; i < 40; i++) assert.ok(['dots', 'sigh'].includes(barks.pickEmote({ emotes: ['dots', 'sigh'] }, rng)));
  for (const e of barks.ALL_EMOTES) assert.ok(barks.EMOTE_GLYPH[e]);
  const a = { chats: [{ with: 'lao-qin', barks: ['Holding up?', 'Ask me at five.', 'Hot water, then.'] }] };
  assert.deepEqual(barks.chatLines('xia-cheng', a, 'lao-qin', CTX, rng), [
    { by: 'xia-cheng', text: 'Holding up?' },
    { by: 'lao-qin', text: 'Ask me at five.' },
    { by: 'xia-cheng', text: 'Hot water, then.' },
  ]);
  assert.equal(barks.chatLines('xia-cheng', a, 'zhou-zihang', CTX, rng), null);
  assert.deepEqual(barks.chatPairs({ 'xia-cheng': a }, ['xia-cheng', 'lao-qin']), [['xia-cheng', 'lao-qin']]);
  assert.deepEqual(barks.chatPairs({ 'xia-cheng': a }, ['xia-cheng']), []);
});

test('AL14 hand motion: finite frames, monotonic offsets, overshoot, lands exactly on target', { skip }, () => {
  const rng = motion.seededRng(4);
  const from = { x: 100, y: 100 };
  const to = { x: 700, y: 400 };
  const plan = motion.glidePath(from, to, rng);
  assert.ok(plan.durationMs >= motion.GLIDE_MIN_MS && plan.durationMs <= motion.GLIDE_MAX_MS);
  assert.deepEqual({ x: plan.frames[0].x, y: plan.frames[0].y }, from);
  assert.deepEqual({ x: plan.frames.at(-1).x, y: plan.frames.at(-1).y }, to);
  assert.equal(plan.frames.at(-1).offset, 1);
  for (let i = 1; i < plan.frames.length; i++) assert.ok(plan.frames[i].offset > plan.frames[i - 1].offset);
  for (const f of plan.frames) assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y));
  // The last travel frame is past the target along the direction of travel (overshoot).
  const past = plan.frames.at(-2);
  const dir = { x: (to.x - from.x), y: (to.y - from.y) };
  assert.ok((past.x - to.x) * dir.x + (past.y - to.y) * dir.y > 0, 'overshoots');
  // Not a straight line: the midpoint bows away from the chord.
  const mid = plan.frames[Math.floor(plan.frames.length / 2)];
  const cross = Math.abs((mid.x - from.x) * dir.y - (mid.y - from.y) * dir.x) / Math.hypot(dir.x, dir.y);
  assert.ok(cross > 5, `bow ${cross}`);
  assert.equal(motion.glidePath(from, from, rng).frames.length, 2);
  assert.ok(motion.handEase(0) === 0 && motion.handEase(1) === 1 && Math.abs(motion.handEase(0.5) - 0.5) < 1e-9);
  const nudge = motion.nudgeOffsets(rng);
  assert.deepEqual(nudge.at(-1), { x: 0, y: 0 }, 'a nudged card always goes back');
});

test('AL15 「世界小动作」 defaults on, toggles and persists in its own key', { skip }, () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    settings.resetAmbientLifeForTest();
    assert.equal(settings.readAmbientLife(), true);
    settings.setAmbientLife(false);
    assert.equal(store.get(settings.AMBIENT_LIFE_KEY), 'off');
    settings.resetAmbientLifeForTest();
    assert.equal(settings.readAmbientLife(), false);
    settings.setAmbientLife(true);
    assert.equal(store.get(settings.AMBIENT_LIFE_KEY), 'on');
    assert.ok(!settings.AMBIENT_LIFE_KEY.includes('performance'), 'not a performance-settings field');
  } finally {
    delete globalThis.localStorage;
    settings.resetAmbientLifeForTest();
  }
});

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const AMBIENT_SOURCES = ['components/canvas/AmbientLayer.tsx', ...fs.readdirSync(path.join(SRC, 'lib/ambient')).map((f) => `lib/ambient/${f}`)];

test('AL16 show only: no model call, no write, nothing logged or sent', () => {
  for (const rel of AMBIENT_SOURCES) {
    const text = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(text, /method:\s*['"](?:POST|PUT|PATCH|DELETE)/i, `${rel}: no write request`);
    assert.doesNotMatch(text, /dispatchEvent|CustomEvent|sendPrompt|submitWriter|appendHistory|useWorld\(|WebSocket|\.send\(/, `${rel}: no frame, event or log`);
    for (const m of text.matchAll(/fetch\(\s*([^,)]+)/g)) assert.equal(m[1].trim(), "'/api/ambient'", `${rel}: the only request is the read of /api/ambient`);
  }
});

test('AL17 wiring: only the play canvas turns ambient on; real pointers win; the toggle is in settings', () => {
  const canvas = read('components/canvas/Canvas.tsx');
  assert.match(canvas, /\{ambient && <AmbientLayer /);
  assert.match(canvas, /ambient = false/);
  assert.equal((read('App.tsx').match(/^\s+ambient$/gm) ?? []).length, 1, 'App passes ambient once (the play canvas)');
  // TRPG worlds open on the picture map: the same engine runs there, under the real pointers.
  const map = read('components/board/PictureMap.tsx');
  assert.match(map, /<MapAmbientLayer [^\n]*\n\s*<MapCursors /);
  assert.doesNotMatch(read('components/nook/NookView.tsx'), /^\s+ambient(?:=\{[^}]*\})?$/m, 'the nook canvas stays still');
  const layer = read('components/canvas/AmbientLayer.tsx');
  assert.match(layer, /useAgentCursors\(\)/);
  assert.match(layer, /data-yielded/);
  assert.match(layer, /pointer-events|aria-hidden/);
  assert.match(read('components/canvas/ambient-layer.css'), /\.ambient-layer \{[^}]*pointer-events: none/);
  assert.match(read('components/canvas/ambient-layer.css'), /prefers-reduced-motion: reduce/);
  assert.match(read('components/PerformanceSettings.tsx'), /setAmbientLife\(event\.currentTarget\.checked\)/);
  assert.match(read('components/PerformanceSettings.tsx'), /t\('World life'\)/);
  // Pointer colours are one table, shared with the real pointers.
  assert.match(read('components/canvas/AgentCursorLayer.tsx'), /characterHue\(cursor\.characterId\)/);
});
