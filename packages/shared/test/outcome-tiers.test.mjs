/**
 * The four outcome tiers: every rule system's
 * result lands on exactly one of crit_success / success / fail / crit_fail, and
 * the consequence vocabulary (effects, bounds, per-category defaults) is strict.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkSpec, resolveCheck, DICE_CONVENTIONS, diceGradeOf,
  outcomeOfGrade, outcomeOfRoll, outcomeRank, parseEffect, effectAllowed, effectDirection,
  diceConsequencesOf, diceEnforced, diceConfigProblems, outcomeLabel, consequenceLine,
} from '../dist/index.js';

const tierOfConvention = (id, score) => outcomeOfGrade(diceGradeOf(DICE_CONVENTIONS[id], score));

test('2d10 >=11: 2–4 crit_fail, 5–10 fail, 11–17 success, 18–20 crit_success', () => {
  assert.deepEqual([2, 4, 5, 10, 11, 17, 18, 20].map((n) => tierOfConvention('standard-2d10', n)),
    ['crit_fail', 'crit_fail', 'fail', 'fail', 'success', 'success', 'crit_success', 'crit_success']);
});

test('d100 <=60 (roll-under): 1–12 crit_success, 13–60 success, 61–95 fail, 96–100 crit_fail', () => {
  assert.deepEqual([1, 12, 13, 60, 61, 95, 96, 100].map((n) => tierOfConvention('percentile-d100', n)),
    ['crit_success', 'crit_success', 'success', 'success', 'fail', 'fail', 'crit_fail', 'crit_fail']);
});

test('d20+2 >=12: 3–6 crit_fail, 7–11 fail, 12–19 success, 20–22 crit_success', () => {
  assert.deepEqual([3, 6, 7, 11, 12, 19, 20, 22].map((n) => tierOfConvention('d20-dc', n)),
    ['crit_fail', 'crit_fail', 'fail', 'fail', 'success', 'success', 'crit_success', 'crit_success']);
});

test('CoC: critical / extreme → crit_success, hard / regular → success, failure → fail, fumble → crit_fail', () => {
  const spec = checkSpec({ system: 'coc', value: 60 });
  const tier = (n) => outcomeOfGrade(resolveCheck(spec, n).grade);
  assert.equal(tier(1), 'crit_success'); // critical
  assert.equal(tier(12), 'crit_success'); // extreme (≤ 1/5)
  assert.equal(tier(30), 'success'); // hard
  assert.equal(tier(60), 'success'); // regular
  assert.equal(tier(61), 'fail');
  assert.equal(tier(96), 'crit_fail');
  // A hard check: a regular-only success is a FAILURE, an extreme is just a success.
  const hard = checkSpec({ system: 'coc', value: 60, difficulty: 'hard' });
  assert.equal(outcomeOfGrade(resolveCheck(hard, 45).grade), 'fail');
  const extreme = checkSpec({ system: 'coc', value: 60, difficulty: 'extreme' });
  assert.equal(outcomeOfGrade(resolveCheck(extreme, 10).grade), 'success');
});

test('D&D: nat 20 / beat by 10 → crit_success, nat 1 / miss by 10 → crit_fail', () => {
  const spec = checkSpec({ system: 'dnd', value: 3, difficulty: 12 });
  const tier = (n) => outcomeOfGrade(resolveCheck(spec, n).grade);
  assert.equal(tier(20), 'crit_success');
  assert.equal(tier(19), 'crit_success'); // 22 ≥ DC+10
  assert.equal(tier(9), 'success');
  assert.equal(tier(8), 'fail');
  assert.equal(tier(1), 'crit_fail');
});

test('a plain NdM roll reads its booleans; a grade always wins', () => {
  assert.equal(outcomeOfRoll({ passed: true, crit: true }), 'crit_success');
  assert.equal(outcomeOfRoll({ passed: true }), 'success');
  assert.equal(outcomeOfRoll({ passed: false }), 'fail');
  assert.equal(outcomeOfRoll({ passed: false, fumble: true }), 'crit_fail');
  assert.equal(outcomeOfRoll({ grade: 'great', passed: false }), 'crit_success');
  assert.equal(outcomeOfGrade('great-success'), 'crit_success');
  assert.deepEqual(['crit_fail', 'fail', 'success', 'crit_success'].map(outcomeRank), [1, 2, 3, 4]);
});

test('labels and chip lines in four languages', () => {
  assert.equal(outcomeLabel('crit_fail', 'zh-CN'), '大失败');
  assert.equal(outcomeLabel('crit_success', 'ja'), '大成功');
  assert.equal(outcomeLabel('fail', 'ko'), '실패');
  assert.equal(outcomeLabel('success', 'en'), 'Success');
  assert.equal(consequenceLine('cost', '潮水 −1', 'zh-CN'), '代价：潮水 −1');
  assert.equal(consequenceLine('bonus', 'a note', 'en'), 'Extra: a note');
});

test('effects parse strictly, and the tier bounds what may be paid', () => {
  assert.equal(parseEffect({ clock: -1 }).ok, true);
  assert.equal(parseEffect({ clock: 0 }).ok, false);
  assert.equal(parseEffect({ clock: -4 }).ok, false);
  assert.equal(parseEffect({ clock: -1, harm: 'light' }).ok, false);
  assert.equal(parseEffect({ state: { target: 'player', id: 'hp', by: -2 } }).ok, true);
  assert.equal(parseEffect({ teleport: 1 }).ok, false);
  const e = (raw) => parseEffect(raw).value;
  assert.equal(effectDirection(e({ harm: 'light' })), 'cost');
  assert.equal(effectDirection(e({ clock: 1 })), 'bonus');
  assert.match(effectAllowed('success', e({ clock: -1 })), /owes no extra/);
  assert.equal(effectAllowed('crit_fail', e({ clock: -2 })), null);
  assert.match(effectAllowed('crit_fail', e({ clock: 1 })), /cost, never a bonus/);
  assert.match(effectAllowed('fail', e({ clock: -2 })), /at most 1/);
  assert.match(effectAllowed('fail', e({ harm: 'serious' })), /lightly/);
  assert.equal(effectAllowed('crit_success', e({ reveal: { title: 'x', body: 'y' } })), null);
  assert.match(effectAllowed('crit_success', e({ state: { target: 'player', id: 'hp', by: 3 } })), /at most 2/);
});

test('defaults per category; only 跑团 worlds (or an explicit dice.consequences) are enforced', () => {
  const trpg = { intro: { category: 'trpg' } };
  assert.deepEqual(diceConsequencesOf(trpg).crit_fail[0], { clock: -1 });
  assert.deepEqual(diceConsequencesOf(trpg).crit_success[0], { clock: 1 });
  assert.equal(diceEnforced(trpg), true);
  assert.equal(diceEnforced({ intro: { category: 'story' } }), false);
  assert.equal(diceEnforced({ intro: { category: 'free' } }), false);
  assert.deepEqual(diceConsequencesOf({ intro: { category: 'story' } }).crit_fail, []);
  const own = { intro: { category: 'story' }, dice: { consequences: { crit_fail: [{ harm: 'light' }] } } };
  assert.equal(diceEnforced(own), true);
  assert.deepEqual(diceConsequencesOf(own).crit_fail, [{ harm: 'light' }]);
  assert.deepEqual(diceConfigProblems(own), []);
  assert.equal(diceConfigProblems({ dice: { consequences: { crit_fail: { clock: 1 } } } }).length, 1);
  assert.equal(diceConfigProblems({ dice: { consequences: { fail: { clock: -1 } } } }).length, 1);
});
