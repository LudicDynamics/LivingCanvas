// The writer's turn ends with a 大失败 unpaid → the engine applies the world's
// default and logs it; a player roll made
// while the writer was mid-turn waits for the next turn end; the composition
// root feeds writer events to the settler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalWorldStore, createActionService, clockLeft, parseFrontmatter } from '@airp/shared';
import { DiceSettler } from '../dist/engine/dice-settle.js';

async function world() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-settle-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'w', name: 'W', description: '', author: '', genre: 't', characters: [], locale: 'en', intro: { category: 'trpg' },
    clock: { path: 'world/tide.md', key: 'left', start: 8, label: 'Tide' },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  await store.writeFile('world/README.md', '---\nname: H\ntype: readme\n---\n\n# H\n');
  await store.writeFile('world/tide.md', '---\nname: Tide\ntype: note\nstatus:\n  data:\n    left: 6\n---\n\nx\n');
  for (const n of ['a', 'b']) await store.writeFile(`world/${n}.md`, `---\ntype: chalk\ntitle: ${n}\nroll_dice:\n  type: 2d10\n  desc: ${n}\n  expect: ">=11"\n---\n\n${n}\n`);
  return store;
}

test('agent_settled after an unpaid writer-side 大失败 applies the default and logs it', async () => {
  const store = await world();
  const lines = [];
  const settler = new DiceSettler((root) => (root === store.worldRoot ? store : null), (l) => lines.push(l));
  await settler.onWriterEvent('agent_start', store.worldRoot);
  await new Promise((r) => setTimeout(r, 20));
  // The writer rolls during its own turn: 1 + 1 = 2 → 大失败, and pays nothing.
  const r = await createActionService(store, { type: 'writer' }, { rng: () => 0 }).rollDice({ path: 'world/a.md' });
  assert.equal(r.details.outcome, 'crit_fail');
  await settler.onWriterEvent('agent_settled', store.worldRoot);
  assert.equal(await clockLeft(store), 5);
  assert.match(lines.join('\n'), /engine default applied/);
  const rec = parseFrontmatter(await store.readFile('world/a.md')).frontmatter.dice_consequence;
  assert.equal(rec.applied[0].by, 'default');
  store.close();
});

test('a player roll that lands mid-turn waits for the next turn end', async () => {
  const store = await world();
  const settler = new DiceSettler(() => store, () => {});
  await settler.onWriterEvent('agent_start', store.worldRoot);
  await new Promise((r) => setTimeout(r, 20));
  await createActionService(store, { type: 'player' }, { rng: () => 0 }).rollDice({ path: 'world/b.md' });
  await settler.onWriterEvent('agent_settled', store.worldRoot);
  assert.equal(await clockLeft(store), 6, 'the writer never saw it');
  await settler.onWriterEvent('agent_start', store.worldRoot);
  await new Promise((r) => setTimeout(r, 20));
  await settler.onWriterEvent('agent_settled', store.worldRoot);
  assert.equal(await clockLeft(store), 5);
  store.close();
});

test('index.ts feeds writer engine events to the settler', async () => {
  const src = await fs.readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(src, /source === 'writer' && savePath\) void diceSettler\.onWriterEvent\(event\.type, savePath\)/);
});
