// Narration is shown, not spoken. Two contracts:
//   1. every character / NPC TTS request goes through the ONE extractor
//      (`sanitiseTtsText` in @airp/shared/tts-text), client and server;
//   2. every character prompt carries the marker convention the extractor reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (rel) => readFile(new URL(rel, root), 'utf8');

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const next = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) await walk(next, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(next);
  }
  return out;
}

test('every browser TTS request is built from sanitiseTtsText, with the speaker name', async () => {
  const callers = [];
  for (const file of await walk(new URL('apps/web/src/', root))) {
    const text = await readFile(file, 'utf8');
    if (!/\bfetchVoiceUrl\(|\.fetchVoice\(/.test(text) || /export async function fetchVoiceUrl/.test(text)) continue;
    callers.push(file.pathname.replace(/^.*apps\/web\/src\//, ''));
    assert.match(text, /import \{ sanitiseTtsText \} from '@airp\/shared\/tts-text';/, `${file.pathname} imports the extractor`);
    assert.match(text, /sanitiseTtsText\([^)]*\{ names(?::| \})/, `${file.pathname} passes the speaker's names`);
  }
  // The modal (classic), the dock / NPC queue, and the dock's warm-up.
  assert.deepEqual(callers.sort(), ['components/overlay/CharacterModal.tsx', 'lib/speaker-voice.ts', 'lib/use-spoken-lines.ts']);
  // The request function itself refuses empty text — an all-narration line is never sent.
  assert.match(await read('apps/web/src/lib/tts-request.ts'), /if \(text === ''\) return FAILED;/);
});

test('the server cleans again before synthesis (and before the voice-live commentary)', async () => {
  const route = await read('apps/server/src/routes/tts.ts');
  assert.match(route, /const cleanedText = sanitiseTtsText\(rawText\);/);
  assert.ok(route.indexOf('sanitiseTtsText(rawText)') < route.indexOf('MAX_TEXT_CHARS) {'), 'clean before truncation / hashing');
  const live = await read('apps/server/src/engine/live-session.ts');
  assert.match(live, /const clean = sanitiseTtsText\(text\);/);
});

test('the character prompt carries the marker convention for all four languages', async () => {
  const src = await read('extensions/instructions.ts');
  const start = src.indexOf('export const CHARACTER_INSTRUCTION');
  const body = src.slice(start, src.indexOf('export const SCENE_INIT_INSTRUCTION'));
  assert.match(body, /\[Action is marked, speech is not\]/);
  assert.match(body, /Chinese, Japanese and Korean worlds: full-width parentheses/);
  assert.match(body, /English worlds: \*asterisks\*/);
  assert.match(body, /Never write yourself in the third person outside a marker/);
  assert.match(body, /never spoken/);
  // the "held beat" line uses the marker too, instead of "a bare line of action"
  assert.doesNotMatch(body, /one bare line of action/);
});

test('every character preset renders that prompt (or, for a self-prompted world, says the same)', async () => {
  const presets = ['presets/character.json'];
  for (const world of await readdir(new URL('templates/', root), { withFileTypes: true })) {
    if (!world.isDirectory()) continue;
    const chars = new URL(`templates/${world.name}/characters/`, root);
    if (!existsSync(chars)) continue;
    for (const c of await readdir(chars, { withFileTypes: true })) {
      if (c.isDirectory() && existsSync(new URL(`templates/${world.name}/characters/${c.name}/preset.json`, root))) {
        presets.push(`templates/${world.name}/characters/${c.name}/preset.json`);
      }
    }
  }
  assert.ok(presets.length > 20, `found ${presets.length} presets`);
  for (const rel of presets) {
    const preset = JSON.parse(await read(rel));
    const rendersInstruction = preset.items.some((item) => item.kind === 'slot' && (item.slot === 'system-char' || item.slot === 'char-instruction'));
    // fpal's memory characters carry their own prompt; it must say the same thing.
    const ownPrompt = preset.items.map((item) => item.content ?? '').join('\n');
    const saysSo = /不要用第三人称描写自己/.test(ownPrompt);
    assert.ok(rendersInstruction || saysSo, `${rel} carries the narration convention`);
  }
});

test('the NPC brief carries the same convention', async () => {
  const { buildNpcBrief } = await import(new URL('packages/shared/dist/rules/npc.js', root));
  const brief = buildNpcBrief({
    path: 'world/conductor.md',
    npc: { name: '列车长', persona: '寡言', knows: [], gives: [] },
    knows: [], history: [], line: '你好', language: 'zh',
  });
  assert.match(brief, /full-width parentheses （…） in Chinese, Japanese or Korean, \*asterisks\* in English/);
  assert.match(brief, /never narrate 列车长 in the third person outside it/);
});
