// The known-good pi-rp model data (tools/pi-model-data) and the moves around it (tools/pi-model-snapshot.mjs):
// a fresh worktree builds on the snapshot instead of whatever models.dev says today.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { dataFiles, matchesSnapshot, replaceData, SNAPSHOT_DIR, snapshotDate } from './pi-model-snapshot.mjs';

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-model-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

test('the snapshot is a complete generator output: every file its manifest names, and nothing else', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, '.manifest.json'), 'utf8'));
  assert.deepEqual(dataFiles(SNAPSHOT_DIR), ['.manifest.json', ...Object.keys(manifest.files)].sort());
  assert.match(snapshotDate(), /^\d{4}-\d{2}-\d{2}T/);
});

test('the snapshot predates the model that broke the build (opencode-go google-generative-ai, 10-19)', () => {
  const opencodeGo = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, 'opencode-go.json'), 'utf8'));
  assert.equal(opencodeGo['google-generative-ai'], undefined);
});

test('matchesSnapshot is byte-exact over the whole file list', () => {
  const snap = folder({ '.manifest.json': '{"generatedAt":"2026-10-10"}', 'a.json': '1' });
  assert.equal(matchesSnapshot(folder({ '.manifest.json': '{"generatedAt":"2026-10-10"}', 'a.json': '1' }), snap), true);
  assert.equal(matchesSnapshot(folder({ '.manifest.json': '{"generatedAt":"2026-10-10"}', 'a.json': '2' }), snap), false);
  assert.equal(matchesSnapshot(folder({ '.manifest.json': '{"generatedAt":"2026-10-10"}', 'a.json': '1', 'b.json': '{}' }), snap), false);
  assert.equal(matchesSnapshot(path.join(os.tmpdir(), 'pi-model-missing-dir'), snap), false);
});

test('replaceData installs the snapshot over newer data, dropping files it does not have', () => {
  const snap = folder({ '.manifest.json': '{"generatedAt":"2026-10-10"}', 'a.json': 'old' });
  const data = folder({ '.manifest.json': '{"generatedAt":"2026-10-19"}', 'a.json': 'new', 'extra.json': '{}', 'keep.txt': 'not data' });
  assert.equal(replaceData(snap, data), 2);
  assert.equal(matchesSnapshot(data, snap), true);
  assert.ok(fs.existsSync(path.join(data, 'keep.txt')), 'only data files are touched');
  assert.equal(snapshotDate(data), '2026-10-10');
});

test('replaceData refuses a folder that is not model data', () => {
  assert.throws(() => replaceData(folder({ 'a.json': '1' }), folder({})), /manifest/);
});
