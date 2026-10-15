/**
 * `editEntity`'s body arguments (doc-command/04 §3.5, `[C-6]`).
 *
 * `append_body` exists so a world command can add a line to a card the player
 * already owns without replacing its prose. It is a NEW input, so these cases
 * defend the contract rather than existing behaviour:
 *   - append joins through the SAME rule as chalk's `renderAppend`;
 *   - `body` still replaces;
 *   - passing both is REFUSED, because either resolution would silently ignore
 *     one of the caller's arguments.
 *
 * Imports built `dist/` directly, not the barrel (same reason as `move.test.mjs`).
 * Build first: `pnpm --filter @airp/shared build`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ActionError } from '../dist/actions/errors.js';
import { editEntity } from '../dist/actions/delete.js';
import { renderAppend } from '../dist/actions/chalk.js';
import { LocalWorldStore } from '../dist/store/local-store.js';

const ACTOR = { type: 'writer' };

async function tempStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-edit-body-test-'));
  const store = new LocalWorldStore(root);
  await store.writeFile(
    'world.json',
    JSON.stringify({
      id: 'proj-1',
      name: 'T',
      description: '',
      author: '',
      genre: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  );
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  return { store, root };
}

const CTX = (store) => ({ store, actor: ACTOR, turn: 'req:test' });
async function writeCard(store, body) {
  await store.writeFile('world/note.md', `---\nname: Note\ntype: note\n---\n\n${body}\n`);
}

async function readCard(store) {
  const raw = await store.readFile('world/note.md');
  // `---\n<fm>\n---\n\n<body>` — take everything after the closing delimiter
  // and drop the single blank separator line.
  const after = raw.split(/\n---\n/).slice(1).join('\n---\n');
  return after.replace(/^\n+/, '').replace(/\n+$/, '');
}


test('append_body adds to the end and leaves the original prose intact', async () => {
  const { store } = await tempStore();
  await writeCard(store, 'The first line.');
  await editEntity(CTX(store), { path: 'world/note.md', append_body: 'The second line.' });
  const body = await readCard(store);
  assert.ok(body.includes('The first line.'), body);
  assert.ok(body.includes('The second line.'), body);
  assert.ok(body.indexOf('The first line.') < body.indexOf('The second line.'), body);
});

test('append_body joins through the same rule as chalk (one join, not two)', async () => {
  const { store } = await tempStore();
  await writeCard(store, 'Existing.');
  await editEntity(CTX(store), { path: 'world/note.md', append_body: 'Added.' });
  assert.equal(await readCard(store), renderAppend('Existing.', 'Added.'));
});

test('body still REPLACES', async () => {
  const { store } = await tempStore();
  await writeCard(store, 'The original text.');
  await editEntity(CTX(store), { path: 'world/note.md', body: 'A replacement.' });
  const body = await readCard(store);
  assert.equal(body, 'A replacement.');
  assert.ok(!body.includes('original'), body);
});

test('omitting both leaves the body untouched', async () => {
  const { store } = await tempStore();
  await writeCard(store, 'Untouched.');
  await editEntity(CTX(store), { path: 'world/note.md', frontmatter: { mood: 'calm' } });
  assert.equal(await readCard(store), 'Untouched.');
});

test('passing BOTH body and append_body is refused, not silently resolved', async () => {
  const { store } = await tempStore();
  await writeCard(store, 'Original.');
  await assert.rejects(
    () => editEntity(CTX(store), { path: 'world/note.md', body: 'B', append_body: 'C' }),
    (err) => {
      assert.ok(err instanceof ActionError, String(err));
      assert.equal(err.code, 'invalid_argument');
      return true;
    }
  );
  // The refusal must not have written anything.
  assert.equal(await readCard(store), 'Original.');
});

test('append_body on a card with no body still produces the text', async () => {
  const { store } = await tempStore();
  await store.writeFile('world/bare.md', '---\nname: Bare\ntype: note\n---\n');
  await editEntity(CTX(store), { path: 'world/bare.md', append_body: 'First words.' });
  const raw = await store.readFile('world/bare.md');
  assert.ok(raw.includes('First words.'), raw);
});
