// Duplicate options on a layer (tools/choice-problems.mjs, run by check:worlds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { duplicateChoiceProblems } from './choice-problems.mjs';

const card = (title, options, actions) => `---\ntype: chalk\ntitle: ${title}\nchoice:\n  options:\n${options.map(([id, label]) => `    - id: ${id}\n      label: ${label}\n`).join('')}${actions ? `choice_actions:\n${Object.entries(actions).map(([id, a]) => `  ${id}:\n    kind: ${a.kind}\n    paths:\n      - ${a.path}\n`).join('')}` : ''}---\n\nBody.\n`;

test('an opening chalk repeating the README options is reported; a different target is not', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-choice-dup-'));
  await fs.mkdir(path.join(root, 'world/sub'), { recursive: true });
  const options = [['action-1', 'Read the letter']];
  await fs.writeFile(path.join(root, 'world/README.md'), card('221B', options, { 'action-1': { kind: 'read', path: 'world/letter.md' } }));
  await fs.writeFile(path.join(root, 'world/01-opening.md'), card('221B', options, { 'action-1': { kind: 'read', path: 'world/letter.md' } }));
  // Another layer may repeat the label: a different layer is a different rail.
  await fs.writeFile(path.join(root, 'world/sub/README.md'), card('221B', options, { 'action-1': { kind: 'read', path: 'world/letter.md' } }));
  // Same layer, same label, another target: not a duplicate.
  await fs.writeFile(path.join(root, 'world/02-other.md'), card('Other', options, { 'action-1': { kind: 'read', path: 'world/other.md' } }));
  const problems = await duplicateChoiceProblems(root);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^world\/README\.md: option "Read the letter" is already declared by world\/01-opening\.md/);
  await fs.rm(root, { recursive: true, force: true });
});

test('no shipped template declares one option on two cards of a layer', async () => {
  const base = new URL('../templates/', import.meta.url);
  for (const d of await fs.readdir(base)) {
    const root = path.join(base.pathname, d);
    if (!(await fs.access(path.join(root, 'world')).then(() => true, () => false))) continue;
    assert.deepEqual(await duplicateChoiceProblems(root), [], d);
  }
});
