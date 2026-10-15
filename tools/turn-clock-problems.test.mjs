import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { turnClockProblems } from './turn-clock-problems.mjs';
import { triggerProblems } from './trigger-problems.mjs';

async function world(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-turn-clock-check-'));
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  }
  return root;
}

const CLOCK = (perTurns, extra = {}) => ({ clock: { path: 'world/days.md', key: 'left', start: 9, label: '时辰', perTurns, ...extra } });
const DAYS = '---\ntype: chalk\ntitle: Days\nstates:\n- { id: turns, label: 这个时辰, type: number, initial: 0, range: [0, 5] }\nstatus:\n  data:\n    left: 9\n    turns: 0\n---\n';

test('check:worlds: a clean clock that moves by turns, and a clock without perTurns', async () => {
  const root = await world({ 'world/days.md': DAYS });
  assert.deepEqual(await turnClockProblems(root, CLOCK(6)), []);
  assert.deepEqual(await turnClockProblems(root, { clock: { path: 'world/days.md', key: 'left', start: 9, label: 'h' } }), []);
  assert.deepEqual(await turnClockProblems(root, {}), []);
});

test('check:worlds reports every turn-clock authoring mistake', async () => {
  assert.match((await turnClockProblems(await world({}), CLOCK(0))).join('\n'), /perTurns must be a whole number/);
  assert.match((await turnClockProblems(await world({}), CLOCK(6))).join('\n'), /does not exist/);
  assert.match((await turnClockProblems(await world({ 'world/days.md': '---\ntype: chalk\nintent: a: b: c\n  - x\n---\n' }), CLOCK(6))).join('\n'), /does not parse/);
  const root = await world({
    'world/days.md': '---\ntype: chalk\ntitle: Days\nstates:\n- { id: turns, label: x, type: number, initial: 1, range: [0, 9] }\nstatus:\n  data:\n    left: 9\n    turns: 7\nchoice:\n  options:\n  - { id: pass, label: 让时间过去 }\n\'on\':\n  choice_selected:\n  - run: pass-segment\n---\n',
    'command/pass-segment.yaml': 'name: pass\ndo:\n- action: tick\n  with:\n    by: \'-1\'\n',
  });
  const problems = (await turnClockProblems(root, CLOCK(6))).join('\n');
  assert.match(problems, /status\.data\.turns must start as a whole number from 0 to 5/);
  assert.match(problems, /starts at 0/);
  assert.match(problems, /range is \[0, 5\]/);
  assert.match(problems, /runs command\/pass-segment\.yaml, which ticks/);
  assert.match((await turnClockProblems(await world({ 'world/days.md': DAYS }), CLOCK(6, { key: 'turns' }))).join('\n'), /clock\.key cannot be "turns"/);
});

test('check:worlds: clock.turns in a state trigger needs clock.perTurns', async () => {
  const files = {
    'world/days.md': DAYS,
    'world/README.md': '---\ntype: readme\nname: Map\n---\n',
    'player/README.md': '---\ntype: readme\ntitle: You\n---\n',
    'command/warn.yaml': 'name: warn\ndo:\n- action: event\n  with:\n    target: map\n    title: Last\n    text: The last step.\n',
  };
  const trigger = { id: 'last-step', kind: 'state', when: 'clock.left <= 1 && clock.turns >= 5', do: 'warn' };
  const ok = await triggerProblems(await world(files), { mode: 'closed', ...CLOCK(6), triggers: [trigger] });
  assert.deepEqual(ok, []);
  const bad = await triggerProblems(await world(files), { mode: 'closed', clock: { path: 'world/days.md', key: 'left', start: 9, label: 'h' }, triggers: [trigger] });
  assert.match(bad.join('\n'), /clock\.turns needs world\.json clock\.perTurns/);
});
