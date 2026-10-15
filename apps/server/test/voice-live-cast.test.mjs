// Duplex calls speak in the character's own voice
// Two layers, both pinned here:
//   1. voice-live (the dev duplex path) is told who is on the call and which
//      DashScope voice to use — the same resolution normal TTS does;
//   2. GPT Live (the production path) never casts an alias on a voice of the
//      other gender, nor on the androgynous `alloy`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { skipUnlessShipped, templateShipped } from '../../../tools/shipped-worlds.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';
import {
  LIVE_VOICE_GENDER,
  VOICES,
  liveVoiceForAlias,
  parseFrontmatter,
  resolveLiveVoice,
  resolveVoiceFor,
  voiceEntry,
  worldLanguageOf,
} from '../../../packages/shared/dist/index.js';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const cast = await jiti.import('../src/engine/voice-live-cast.ts');
const { resolveVoiceLiveCast, voiceLiveCharacterOf, voiceLiveSavePathOf, voiceLiveSessionUrl } = cast;

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** A store over one template world's files — only what the cast reads. */
function templateStore(world) {
  const root = path.join(REPO, 'templates', world);
  return {
    worldRoot: root,
    readFile: async (rel) => fs.promises.readFile(path.join(root, rel), 'utf8'),
    getManifest: async () => JSON.parse(fs.readFileSync(path.join(root, 'world.json'), 'utf8')),
  };
}

test('the browser names the character; only a valid id is accepted', () => {
  assert.equal(voiceLiveCharacterOf('/ws/voice-live?character=blackburn'), 'blackburn');
  assert.equal(voiceLiveCharacterOf('/ws/voice-live'), undefined);
  assert.equal(voiceLiveCharacterOf('/ws/voice-live?character=../etc'), undefined);
});

test('the proxy requires an explicit captured save root, decoded exactly from the websocket query', () => {
  assert.equal(voiceLiveSavePathOf('/ws/voice-live?character=vera&savePath=%2Fsaves%2Fa'), '/saves/a');
  assert.equal(voiceLiveSavePathOf('/ws/voice-live?character=vera'), null);
  assert.equal(voiceLiveSavePathOf('/ws/voice-live?savePath=%2Fsaves%2Fb'), '/saves/b');
});

test('the cast rides the upstream URL as query parameters', () => {
  assert.equal(
    voiceLiveSessionUrl('ws://127.0.0.1:8777/ws', { character: 'blackburn', voice: 'Eldric Sage' }),
    'ws://127.0.0.1:8777/ws?character=blackburn&voice=Eldric+Sage',
  );
  assert.equal(
    voiceLiveSessionUrl('ws://h/ws', { character: 'vera', voice: 'Cherry', language: 'Chinese' }),
    'ws://h/ws?character=vera&voice=Cherry&language=Chinese',
  );
  assert.equal(voiceLiveSessionUrl('ws://127.0.0.1:8777/ws', {}), 'ws://127.0.0.1:8777/ws');
});

test('a male character is cast in the same male voice normal TTS gives him', async () => {
  const saved = process.env.AIRP_TTS_LOCAL_BASE_URL;
  delete process.env.AIRP_TTS_LOCAL_BASE_URL;
  try {
    // Watson (华生) declares `scholarly-narrator` — the reported case.
    // 漫动部 is not in the open-source copy; Watson always is.
    for (const [world, id] of [['mandongbu', 'wataru'], ['mandongbu', 'guyan'], ['whitechapel', 'watson']].filter(([w]) => templateShipped(w))) {
      const readme = fs.readFileSync(path.join(REPO, 'templates', world, 'characters', id, 'README.md'), 'utf8');
      const declared = parseFrontmatter(readme).frontmatter.voice;
      const got = await resolveVoiceLiveCast(templateStore(world), id);
      assert.equal(got.character, id);
      const locale = JSON.parse(fs.readFileSync(path.join(REPO, 'templates', world, 'world.json'), 'utf8')).locale;
      assert.equal(got.voice, resolveVoiceFor(declared, worldLanguageOf(locale)), `${world}/${id} must match normal TTS`);
    }
    const watson = await resolveVoiceLiveCast(templateStore('whitechapel'), 'watson');
    assert.equal(voiceEntry(watson.voice).gender, 'male');
  } finally {
    if (saved !== undefined) process.env.AIRP_TTS_LOCAL_BASE_URL = saved;
  }
});

test('a missing README or no store degrades gracefully, never throws', { skip: skipUnlessShipped('mandongbu') }, async () => {
  const saved = process.env.AIRP_TTS_DEFAULT_VOICE;
  delete process.env.AIRP_TTS_DEFAULT_VOICE;
  try {
    // mandongbu is Chinese: an unknown character still gets a Chinese-capable default.
    assert.deepEqual(await resolveVoiceLiveCast(templateStore('mandongbu'), 'no-such-person'),
      { character: 'no-such-person', language: 'Chinese', voice: 'Cherry' });
    assert.deepEqual(await resolveVoiceLiveCast(null, 'wataru'), { character: 'wataru' });
    assert.deepEqual(await resolveVoiceLiveCast(templateStore('mandongbu'), undefined), {});
  } finally {
    if (saved !== undefined) process.env.AIRP_TTS_DEFAULT_VOICE = saved;
  }
});

test('the world language travels with the call, and a language-bound voice is re-cast', { skip: skipUnlessShipped('mandongbu') }, async () => {
  const saved = process.env.AIRP_TTS_LOCAL_BASE_URL;
  delete process.env.AIRP_TTS_LOCAL_BASE_URL;
  try {
    const vera = await resolveVoiceLiveCast(templateStore('wuwu-zh'), 'vera');
    assert.deepEqual(vera, { character: 'vera', language: 'Chinese', voice: 'Cherry' });
    const store = { ...templateStore('mandongbu'), getManifest: async () => ({ id: 'mandongbu-en', locale: 'en' }) };
    const lixiang = await resolveVoiceLiveCast(store, 'lixiang'); // beijing-youth (Beijing dialect)
    assert.equal(lixiang.language, 'English');
    assert.equal(lixiang.voice, 'Ethan');
  } finally {
    if (saved !== undefined) process.env.AIRP_TTS_LOCAL_BASE_URL = saved;
  }
});

test('Vera keeps the Japanese studio voice only in the Japanese edition', async () => {
  const keys = ['AIRP_TTS_LOCAL_BASE_URL', 'AIRP_TTS_CHARACTER_VOICES', 'AIRP_LOCAL_TTS'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { AIRP_TTS_LOCAL_BASE_URL: 'http://127.0.0.1:1', AIRP_TTS_CHARACTER_VOICES: 'vera=setsuna', AIRP_LOCAL_TTS: '1' });
  try {
    const jp = await resolveVoiceLiveCast(templateStore('wuwu-jp'), 'vera');
    assert.deepEqual(jp, { character: 'vera', language: 'Japanese' }, 'no voice → voice-live keeps its studio voice');
    const zh = await resolveVoiceLiveCast(templateStore('wuwu-zh'), 'vera');
    assert.equal(zh.voice, 'Cherry');
    assert.equal(zh.language, 'Chinese');
  } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

test('GPT Live: every alias is cast on a voice of its own gender (L4)', () => {
  for (const { alias, gender } of VOICES) {
    const live = liveVoiceForAlias(alias);
    assert.equal(LIVE_VOICE_GENDER[live], gender, `${alias} (${gender}) → ${live}`);
    assert.notEqual(live, 'alloy', `${alias} must not use the androgynous alloy`);
  }
  // The reported case: Watson-style `scholarly-narrator` was `alloy` (read female).
  assert.equal(LIVE_VOICE_GENDER[resolveLiveVoice('scholarly-narrator')], 'male');
  assert.equal(LIVE_VOICE_GENDER[resolveLiveVoice('Elias')], 'male');
});
