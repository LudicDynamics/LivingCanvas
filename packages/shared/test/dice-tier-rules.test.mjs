/**
 * check:worlds' four-tier rules for authored dice.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diceTierProblems, conditionMayHold } from '../dist/index.js';

const opt = [{ id: 'n', label: 'n', action: { kind: 'writer', prompt: 'x' } }];
const band = (min, max, extra = {}) => ({ min, max, text: 't', options: opt, ...extra });
const KEY = 'world/clue.md';
const keys = new Set([KEY]);
const none = new Map();
const d100 = (bands) => ({ roll_dice: { type: '1d100', desc: 'd', expect: '<=60' }, dice_outcomes: bands });

test('every tier gives the key clue → fail and crit_fail are flagged', () => {
  const r = { rewards: [{ path: KEY, title: 'Clue', body: 'b' }] };
  const p = diceTierProblems('x', d100([band(1, 12, r), band(13, 60, r), band(61, 95, r), band(96, 100, { ...r, harm: 'light' })]), keys, none);
  assert.equal(p.filter((m) => /hands over the key clue/.test(m)).length, 2);
  assert.ok(p.some((m) => /crit_success gives nothing/.test(m)));
});

test('the fixed shape passes: half clue on failure, cost on crit fail, extra on crit success', () => {
  const clue = { path: KEY, title: 'Clue', body: 'b' };
  const half = { path: 'world/clue-half.md', title: 'Half', body: 'b', partial: true };
  const card = d100([
    band(1, 12, { rewards: [clue], bonus: { clock: 1 } }),
    band(13, 60, { rewards: [clue] }),
    band(61, 95, { rewards: [half], cost: { clock: -1 } }),
    band(96, 100, { rewards: [half], cost: { clock: -2 } }),
  ]);
  assert.deepEqual(diceTierProblems('x', card, keys, none), []);
});

test('a crit fail whose only cost is the success\'s cost is flagged; story worlds skip cost / bonus rules', () => {
  const tick = new Map([['step', { steps: [{ action: 'tick', args: { by: '-1' } }] }]]);
  const card = { ...d100([band(1, 12), band(13, 60), band(61, 95), band(96, 100)]), on: { roll_resolved: [{ run: 'step' }] } };
  const p = diceTierProblems('x', card, keys, tick);
  assert.ok(p.some((m) => /crit_fail has no cost/.test(m)));
  assert.deepEqual(diceTierProblems('x', card, keys, tick, false), []);
});

test('rank-gated commands count per tier (雾坞 pattern)', () => {
  const commands = new Map([
    ['evidence', { steps: [{ action: 'give', args: { path: KEY } }] }],
    ['tide-step', { steps: [{ action: 'tick', args: { by: '-1' } }] }],
    ['tide-surge', { steps: [{ action: 'tick', args: { by: '-1' } }] }],
  ]);
  const card = {
    roll_dice: { type: '2d10', desc: 'd', expect: '>=11' },
    on: { roll_resolved: [{ when: 'roll.rank >= 3', run: 'evidence' }, { when: 'roll.rank <= 3', run: 'tide-step' }, { when: 'roll.rank == 1', run: 'tide-surge' }] },
  };
  assert.deepEqual(diceTierProblems('x', card, keys, commands), []);
});

test('conditions are judged by their roll atoms; other atoms may hold', () => {
  assert.equal(conditionMayHold('roll.rank >= 3', 2), false);
  assert.equal(conditionMayHold('roll.passed == false', 2), true);
  assert.equal(conditionMayHold('roll.passed == false', 3), false);
  assert.equal(conditionMayHold('roll.rank == 1 && has("player/x.md")', 1), true);
  assert.equal(conditionMayHold('roll.outcome == "crit_success"', 4), true);
  assert.equal(conditionMayHold('roll.grade == "great"', 3), false);
});

test('no tiers at all is flagged; dice_tiers: inherit is accepted', () => {
  const bare = { roll_dice: { type: '2d10', desc: 'd', expect: '>=11' }, dice_outcomes: [] };
  assert.match(diceTierProblems('x', bare, keys, none)[0], /declare all four tiers/);
  assert.deepEqual(diceTierProblems('x', { ...bare, dice_tiers: 'inherit' }, keys, none), []);
});
