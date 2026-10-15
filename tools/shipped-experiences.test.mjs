// Current Git-distributed editions, not the archived content compiler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { filesUnder } from './localize-world-editions.mjs';
import { editionId, editionLocales, shippedFamilies } from './world-editions.mjs';
const repo = fileURLToPath(new URL('../', import.meta.url));

test('every edition and every dependency are tracked, without save data', async () => {
  const tracked = new Set(execFileSync('git', ['ls-files', '-z', '--', 'templates'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean));
  for (const family of shippedFamilies()) for (const locale of editionLocales) {
    const prefix = `templates/${editionId(family, locale)}`;
    for (const file of await filesUnder(path.join(repo, prefix))) assert.ok(tracked.has(`${prefix}/${file}`), `Untracked dependency: ${prefix}/${file}`);
    const shipped = [...tracked].filter(f => f.startsWith(prefix + '/'));
    assert.ok(!shipped.some(f => /\/(?:\.airpworld|\.pi)\/|\/\.env(?:\.|$)|\.jsonl$/.test(f)), 'No local runtime configuration');
    assert.ok(shipped.filter(f => f.includes('/player/')).every(f => f.endsWith('/player/README.md')), 'No pre-earned rewards or player progress');
  }
});

test('save data and experimental playtest directories remain ignored', () => {
  const ignored = f => spawnSync('git', ['check-ignore', '--no-index', '-q', f], { cwd: repo }).status;
  for (const f of ['worlds/example/world.json', '.env.local', 'templates/wuwu-playtest/world.json', 'templates/wuwu-playtest-scratch/world.json', 'templates/wuwu/.airpworld/sessions/test.jsonl']) assert.equal(ignored(f), 0, f);
  assert.equal(ignored('templates/wuwu/world.json'), 1);
});
