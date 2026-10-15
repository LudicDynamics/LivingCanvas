// check:worlds — the character-tick gate (tools/tick-problems.mjs, the design notes, §7.5).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as nodeTest } from 'node:test';
import { testsNeeding } from './shipped-worlds.mjs';
// The tick gate's fixtures are 最后的证人 and 赝作师; skipped where this copy does not carry them.
const test = testsNeeding(nodeTest, 'last-witness', 'last-witness-jp', 'last-witness-zh', 'last-witness-ko', 'forger');
import { fileURLToPath } from 'node:url';
import { tickProblems, keyClues } from './tick-problems.mjs';

const templateOf = (id) => fileURLToPath(new URL(`../templates/${id}`, import.meta.url));

async function copy(id) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tick-gate-'));
  await fs.cp(templateOf(id), root, { recursive: true });
  return root;
}
const manifestOf = async (root) => JSON.parse(await fs.readFile(path.join(root, 'world.json'), 'utf8'));

test('every shipped edition of 最后的证人 passes; a world without tick has nothing to say', async () => {
  for (const id of ['last-witness', 'last-witness-jp', 'last-witness-zh', 'last-witness-ko']) {
    assert.deepEqual(await tickProblems(templateOf(id), await manifestOf(templateOf(id))), [], id);
  }
  assert.deepEqual(await tickProblems(templateOf('forger'), await manifestOf(templateOf('forger'))), []);
});

test('key clues: trigger clues and debrief answers', async () => {
  const keys = keyClues(await manifestOf(templateOf('last-witness')));
  for (const c of ['world/study/study-trace.md', 'world/stables/torn-glove.md', 'world/great-hall/study-key.md']) assert.ok(keys.has(c), c);
});

test('the gate refuses: missing command, off-page target, wrong counter, undeclared state, unknown cap, key clue taken / moved, direct costs', async () => {
  const root = await copy('last-witness');
  try {
    const m = await manifestOf(root);
    const ross = (m.tick.actors.ross.moves = m.tick.actors.ross.moves.slice(0, 2));
    ross.push(
      { id: 'no-cmd', verb: 'mark', target: 'world/study', run: 'tick-nowhere', label: { intent: 'x', landed: 'x', stopped: 'x' }, counter: ['guard'] },
      { id: 'off-page', verb: 'mark', target: 'world/study/ledger.md', run: 'tick-ross-visit-study', label: { intent: 'x', landed: 'x', stopped: 'x' }, counter: ['guard'] },
      { id: 'bad-counter', verb: 'mark', target: 'world/lamp.md', run: 'tick-ross-visit-study', label: { intent: 'x', landed: 'x', stopped: 'x' }, counter: ['enter'] },
      { id: 'bad-state', verb: 'mark', target: 'world/study', if: 'world.mood == "x"', run: 'tick-ross-visit-study', label: { intent: 'x', landed: 'x', stopped: 'x' }, counter: ['guard'] },
      { id: 'bad-cap', verb: 'mark', target: 'world/study', cap: 'nope', run: 'tick-ross-visit-study', label: { intent: 'x', landed: 'x', stopped: 'x' }, counter: ['guard'] },
      { id: 'grab-key', verb: 'take', target: 'world/great-hall/study-key.md', run: 'tick-ross-visit-study', label: { intent: 'x', landed: 'x', stopped: 'x' }, counter: ['guard'] },
      { id: 'burn', verb: 'mark', target: 'world/study', run: 'tick-burn', label: { intent: 'x', landed: 'x', stopped: 'x' }, counter: ['guard'] },
      { id: 'eat', verb: 'mark', target: 'world/study', run: 'tick-eat', label: { intent: 'x', landed: 'x', stopped: 'x' }, counter: ['guard'] },
    );
    await fs.writeFile(path.join(root, 'command/tick-burn.yaml'), 'name: Burn\ndo:\n  - action: tick\n    with:\n      by: "-1"\n');
    await fs.writeFile(path.join(root, 'command/tick-eat.yaml'), 'name: Eat\ndo:\n  - action: move\n    with:\n      from: world/study/study-trace.md\n      to: world/gone.md\n');
    const problems = (await tickProblems(root, m)).join('\n');
    for (const needle of [
      /no-cmd: run "tick-nowhere"/,
      /off-page: target world\/study\/ledger\.md is not on ross's page/,
      /bad-counter: counter "enter" needs a door target/,
      /bad-state\.if: "world\.mood" is not a declared state/,
      /bad-cap: cap "nope" is not in tick\.caps/,
      /grab-key: take of key clue world\/great-hall\/study-key\.md must name its recovery path/,
      /tick-burn\.yaml do\[0\] tick: a direct clock/,
      /tick-eat\.yaml do\[0\] move: a character tick never moves a key clue/,
    ]) assert.match(problems, needle);
    // costs: only a trpg world may opt in.
    const story = { ...m, intro: { ...m.intro, category: 'story' }, tick: { ...m.tick, costs: true } };
    assert.match((await tickProblems(root, story)).join('\n'), /only a trpg world/);
    // A malformed block is reported as such.
    assert.ok((await tickProblems(root, { ...m, tick: { actors: {} } })).length > 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
