// Dice card prose vs the roll actually made (tools/dice-text-problems.mjs, run by check:worlds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { diceTextCardProblems, diceTextProblems } from './dice-text-problems.mjs';

const BANDS_60 = '96–100: fumble.\n61–95: half a thread.\n13–60: the thread.\n1–12: the thread, no tide.';

test('a plain card naming another die than its roll is reported; the same die in any spelling is not', () => {
  assert.deepEqual(diceTextCardProblems('a.md', ['Roll 2d10; 11 or more passes.'], '2d10'), []);
  assert.deepEqual(diceTextCardProblems('a.md', ['1d100 (Navigate 60): roll at or under your skill.'], '2d10'), ['a.md: the text names 1d100, but the player rolls 2d10']);
  assert.deepEqual(diceTextCardProblems('a.md', ['掷 d100（导航 60）'], '2d10'), ['a.md: the text names 1d100, but the player rolls 2d10']);
  assert.deepEqual(diceTextCardProblems('a.md', ['A d20 roll.'], '1d100'), ['a.md: the text names 1d20, but the player rolls 1d100']);
  assert.deepEqual(diceTextCardProblems('a.md', ['A d100 roll.'], '1d100'), []);
  // Advantage is still a d20; words like "add10" or "3D" are not dice.
  assert.deepEqual(diceTextCardProblems('a.md', ['d20 + Arcana', 'add10 to the 3D view'], '2d20kh1'), []);
});

test('a coc skill card: the written value and the four bands must fit the sheet', () => {
  assert.deepEqual(diceTextCardProblems('a.md', [`1d100 (Stealth 60): roll at or under.\n${BANDS_60}`], '1d100', 60), []);
  const wrong = diceTextCardProblems('a.md', [`1d100 (Stealth 60): roll at or under.\n${BANDS_60}`], '1d100', 45);
  assert.equal(wrong.length, 2, wrong.join('\n'));
  assert.match(wrong[0], /the text says the skill is 60, but the sheet says 45/);
  assert.match(wrong[1], /the written bands miss 1-9, 10-45, 46-95/);
  // CJK brackets read too.
  assert.match(diceTextCardProblems('a.md', ['1d100（机械维修 50）'], '1d100', 60)[0], /skill is 50, but the sheet says 60/);
});

async function world(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-dice-text-'));
  for (const [f, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, f)), { recursive: true });
    await fs.writeFile(path.join(root, f), text);
  }
  return root;
}
const sheet = '---\nname: You\nsheet:\n  skills:\n    - id: stealth\n      label: Stealth\n      value: 60\n---\n';
const spot = (skill, prose) => `---\ntype: gate\nname: Berth\nsearch:\n  - id: scene\n${skill ? `    skill: ${skill}\n` : ''}    label: Sneak aboard (roll dice)\n    body: |-\n${prose.split('\n').map((l) => `      ${l}`).join('\n')}\n    roll_dice:\n      type: 2d10\n      desc: Sneak aboard\n      expect: ">=11"\n    dice_outcomes:\n      - { min: 2, max: 4, text: Caught. }\n      - { min: 5, max: 10, text: Half. }\n      - { min: 11, max: 17, text: In. }\n      - { min: 18, max: 20, text: In fast. }\n---\n\nThe berth.\n`;

test('a search with a sheet skill rolls the sheet (1d100), so 1d100 prose over a 2d10 base is right', async () => {
  const prose = `1d100 (Stealth 60): roll at or under your skill.\n${BANDS_60}`;
  const root = await world({ 'player/README.md': sheet, 'world/berth/README.md': spot('stealth', prose) });
  assert.deepEqual(await diceTextProblems(root, { rules: { system: 'coc' } }), []);
  // Without rules the authored 2d10 is what is rolled: the same prose is wrong.
  assert.deepEqual(await diceTextProblems(root, {}), ['world/berth/README.md#scene: the text names 1d100, but the player rolls 2d10']);
  // A skill the sheet lacks also falls back to the authored dice.
  const other = await world({ 'player/README.md': sheet, 'world/berth/README.md': spot('climb', prose) });
  assert.deepEqual(await diceTextProblems(other, { rules: { system: 'coc' } }), ['world/berth/README.md#scene: the text names 1d100, but the player rolls 2d10']);
  await Promise.all([root, other].map((r) => fs.rm(r, { recursive: true, force: true })));
});

test('no shipped template names a die its players do not roll', async () => {
  const base = new URL('../templates/', import.meta.url);
  for (const d of await fs.readdir(base)) {
    const root = path.join(base.pathname, d);
    const manifest = await fs.readFile(path.join(root, 'world.json'), 'utf8').then(JSON.parse, () => null);
    if (!manifest) continue;
    assert.deepEqual(await diceTextProblems(root, manifest), [], d);
  }
});
