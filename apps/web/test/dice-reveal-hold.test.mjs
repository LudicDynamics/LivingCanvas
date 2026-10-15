// A card keeps its roll hidden until the dice ceremony has shown it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const dice = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/dice-ceremony.ts');

const details = (path) => ({
  path, name: 'Search', dice: '1d100', desc: 'Search the desk', expect: '<=50',
  result: 42, passed: true, rolls: [42], crit: false, fumble: false, forged: false, layer: 'world/a',
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a requested roll stays hidden until its ceremony ends', () => {
  dice.resetSeenForTest();
  const path = 'world/a/roll.md';
  dice.holdReveal(path);
  assert.equal(dice.isRevealHeld(path), true);
  assert.ok(dice.ingestPlayerRoll(details(path), 'key-1'));
  dice.settleReveal(path);
  assert.equal(dice.isRevealHeld(path), true, 'the staged ceremony owns the hold');
  dice.clearCeremony();
  assert.equal(dice.isRevealHeld(path), false);
});

test('a failed request lifts the hold at once; a frameless one after the grace period', async () => {
  dice.resetSeenForTest();
  const path = 'world/a/other.md';
  dice.holdReveal(path);
  dice.settleReveal(path, 0);
  assert.equal(dice.isRevealHeld(path), false);
  dice.holdReveal(path);
  dice.settleReveal(path, 10);
  assert.equal(dice.isRevealHeld(path), true);
  await wait(40);
  assert.equal(dice.isRevealHeld(path), false);
});

test('a ceremony that arrives during the grace period takes over the hold', async () => {
  dice.resetSeenForTest();
  const path = 'world/a/late.md';
  dice.holdReveal(path);
  dice.settleReveal(path, 10);
  assert.ok(dice.ingestPlayerRoll(details(path), 'key-2'));
  await wait(40);
  assert.equal(dice.isRevealHeld(path), true);
  dice.clearCeremony();
  assert.equal(dice.isRevealHeld(path), false);
});

test('a replaced ceremony releases the previous card', () => {
  dice.resetSeenForTest();
  dice.holdReveal('world/a/first.md');
  assert.ok(dice.ingestPlayerRoll(details('world/a/first.md'), 'key-3'));
  assert.ok(dice.ingestPlayerRoll(details('world/a/second.md'), 'key-4'));
  assert.equal(dice.isRevealHeld('world/a/first.md'), false);
  assert.equal(dice.isRevealHeld('world/a/second.md'), true);
  dice.clearCeremony();
});
