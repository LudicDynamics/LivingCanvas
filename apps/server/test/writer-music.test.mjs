// The writer knows about music: `set_music` is registered,
// the writer instruction carries a short [Music] section with the catalog ids and
// tags, and the workshop brief + skill say when to use it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MUSIC_CATALOG, AMBIENT_CATALOG, musicCatalogSummary } from '@airp/shared';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

test('set_music is a registered writer tool whose shell calls the shared action and lists the catalog', () => {
  const tools = read('extensions/tools.ts');
  assert.match(tools, /\{ name: 'set_music', tool: setMusicTool \}/);
  const shell = read('extensions/toolkit/music.ts');
  assert.match(shell, /name: 'set_music'/);
  assert.match(shell, /getActionService\(ctx\)\.setMusic\(/);
  assert.match(shell, /musicCatalogLines\(\)\.join\('\\n'\)/);
});

test('the writer instruction has a short [Music] section with every id, inside WRITER_INSTRUCTION', () => {
  const src = read('extensions/instructions.ts');
  assert.match(src, /export const MUSIC_GUIDANCE = `\[Music\]/);
  assert.match(src, /\$\{musicCatalogSummary\(\)\}/);
  const writer = src.slice(src.indexOf('export const WRITER_INSTRUCTION'), src.indexOf('export const CHARACTER_INSTRUCTION'));
  assert.match(writer, /\$\{MUSIC_GUIDANCE\}/);
  const section = src.slice(src.indexOf('export const MUSIC_GUIDANCE'), src.indexOf('export const WRITER_INSTRUCTION'));
  assert.match(section, /rarely/);
  assert.match(section, /discovery, danger, grief/);
  assert.ok(section.split('\n').length <= 10, 'short');
  const summary = musicCatalogSummary();
  for (const t of [...MUSIC_CATALOG, ...AMBIENT_CATALOG]) assert.ok(summary.includes(t.id));
});

test('the workshop brief and skill tell the builder when to set music', () => {
  assert.match(read('apps/server/src/world-workshop.ts'), /'- Music: keep the type theme unless the premise wants another \(set_music layer "world"\)/);
  assert.match(read('skills/world-workshop/SKILL.md'), /\*\*Music\*\*: .*`set_music` with `layer: "world"`/);
});
