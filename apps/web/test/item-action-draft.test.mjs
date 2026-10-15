import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

let mod = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/item-action-draft.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping item-action-draft tests:', err?.message ?? err);
}
const skip = mod ? false : 'jiti or pi-rp submodule unavailable';
const translate = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
const frog = { path: 'player/clockwork frog (old).md', filename: 'clockwork-frog.md', frontmatter: { title: '[Clockwork]\nFrog' } };
const twin = { path: 'player/clockwork-frog.md', filename: 'frog.md', frontmatter: { title: '[Clockwork]\nFrog' } };

test('empty draft gets an encoded, editable exact-path reference without mutating item', { skip }, () => {
  const before = structuredClone(frog);
  const draft = mod.appendItemAction('', frog, translate);
  assert.match(draft, /\[Clockwork Frog\]\(player\/clockwork%20frog%20%28old%29\.md\)/);
  assert.deepEqual(frog, before);
});

test('same path is idempotent while same title with another path remains distinct', { skip }, () => {
  const first = mod.appendItemAction('', frog, translate);
  assert.equal(mod.appendItemAction(first, frog, translate), first);
  const both = mod.appendItemAction(first, twin, translate);
  assert.deepEqual(mod.referencedItemPaths(both, [frog, twin]), [frog.path, twin.path]);
});

test('send projection only includes currently carried links in first-seen order', { skip }, () => {
  const draft = `Try ${mod.itemDraftReference(twin)} then ${mod.itemDraftReference(frog)}`;
  const prompt = mod.buildItemActionPrompt(draft, [frog, twin]);
  assert.deepEqual(mod.referencedItemPaths(draft, [frog, twin]), [twin.path, frog.path]);
  assert.match(prompt, /player\/clockwork-frog\.md/);
  assert.match(prompt, /player\/clockwork frog \(old\)\.md/);
  assert.match(prompt, /full current scene README/);
  assert.match(prompt, /do not mean automatically consume, combine, move/);
  const deleted = mod.buildItemActionPrompt(`Try ${mod.itemDraftReference(frog)}`, [frog]);
  assert.doesNotMatch(deleted, /player\/clockwork-frog\.md/);
  assert.match(deleted, /player\/clockwork frog \(old\)\.md/);
});
test('whitespace and damaged links do not invent an action or throw', { skip }, () => {
  assert.equal(mod.buildItemActionPrompt('  ', [frog]), '  ');
  assert.deepEqual(mod.referencedItemPaths('[x](%E0%A4%A)', [frog]), []);
  assert.deepEqual(mod.referencedItemPaths('[x](player/unknown.md)', [frog]), []);
});

test('draft helper remains a pure module without transport or gateway dependencies', { skip }, async () => {
  const source = await readFile(new URL('../src/lib/item-action-draft.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch|airpGateway|WebSocket/);
});
