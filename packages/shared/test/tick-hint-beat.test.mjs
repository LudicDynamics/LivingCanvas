/**
 * Character tick v2 × companion hints: never a written
 * hint and a person's own line in the same beat — the hint wins when due, otherwise the people speak and the
 * hint waits a beat. Plus the small pieces that came with it: `planHint` `hold`, a chatter move's `suggest`,
 * the `story` experience kind (a counted beat without the prologue's chrome).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHintTable, planHint, parseWorldTick, worldExperienceOf, isPrologueWorld } from '../dist/index.js';

const table = parseHintTable({
  by: 'xia-cheng',
  gap: 2,
  hints: [{ id: 'h', when: { layer: 'world/a' }, say: 'Go on.' }],
}).table;
const state = { page: 'world/a', values: new Map(), paths: new Map(), characterIds: ['xia-cheng'] };

test('planHint hold: the beat is counted, nothing is said; the hint comes the beat after', () => {
  const held = planHint(table, state, { beat: 0, used: {}, since: {}, seen: [] }, { hold: true });
  assert.equal(held.hint, null);
  assert.equal(held.log.beat, 1);
  assert.equal(held.log.since.h, 1, 'its condition is still tracked');
  const next = planHint(table, state, held.log);
  assert.equal(next.hint?.id, 'h');
  // `stuck` (the player asked) is never held back.
  assert.equal(planHint(table, state, { beat: 0, used: {}, since: {}, seen: [] }, { stuck: true }).hint?.id, 'h');
});

test('tick schema: only a speak / invite chatter move may point the way (suggest)', () => {
  const base = (moves) => parseWorldTick({ actors: { a: { goal: 'g', moves } } });
  const ok = base([{ id: 'nudge', verb: 'speak', suggest: [{ card: 'world/a/README.md', option: 'go' }, { enter: 'map', label: 'Back' }] }]);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.tick.actors.a.chatter[0].suggest.length, 2);
  assert.ok(base([{ id: 'n', verb: 'note', slot: 'world/n.md', suggest: [{ enter: 'map', label: 'Back' }] }]).errors.length > 0);
  assert.ok(base([{ id: 'i', verb: 'mark', target: 'world/a', run: 'r', label: { intent: 'x', landed: 'y', stopped: 'z' }, counter: ['talk'], suggest: [{ enter: 'map', label: 'Back' }] }]).errors.length > 0);
});

test('experience kind story: a turn-end command without the prologue', () => {
  const m = { experience: { kind: 'story', turnEnd: 'turn-end' } };
  assert.equal(worldExperienceOf(m)?.turnEnd, 'turn-end');
  assert.equal(isPrologueWorld(m), false);
  assert.equal(isPrologueWorld({ experience: { kind: 'prologue' } }), true);
});
