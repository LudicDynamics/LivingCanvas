import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readOpening, writeOpening } from '../dist/engine/opening.js';

/**
 * The first-act marker. It answers ONE question — "has this
 * save had its opening?" — and must fail soft: a hand-edited or truncated file
 * replays a greeting, which is harmless, rather than wedging `/api/opening`.
 */
test('a save with no marker has not had its opening', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-opening-'));
  try {
    assert.deepEqual(readOpening(root), { shown: false });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('marking is atomic, readable back, and reversible for the replay control', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-opening-'));
  try {
    const marked = writeOpening(root, true);
    assert.equal(marked.shown, true);
    assert.match(marked.at ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(readOpening(root).shown, true);
    // No `.tmp` left behind: the write renames into place.
    const dir = await fs.readdir(path.join(root, '.airpworld'));
    assert.deepEqual(dir, ['opening.json']);
    // The settings panel's "replay" posts `shown: false`.
    assert.deepEqual(writeOpening(root, false), { shown: false });
    assert.equal(readOpening(root).shown, false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a malformed marker reads as "not shown" instead of throwing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-opening-'));
  try {
    await fs.mkdir(path.join(root, '.airpworld'), { recursive: true });
    for (const bad of ['', 'not json', 'null', '[]', '{"shown":"yes"}']) {
      await fs.writeFile(path.join(root, '.airpworld/opening.json'), bad);
      assert.deepEqual(readOpening(root), { shown: false }, bad);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
