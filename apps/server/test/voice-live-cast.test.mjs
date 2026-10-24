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

import os from 'node:os';

// play's answers are kept on disk (play-voice.ts): never this machine's real cache file.
process.env.AIRP_PLAY_CACHE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'live-cast-play-')), 'cache.json');
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { BUILTIN_ASSIGNED, BUILTIN_VOICES } = await jiti.import('../src/builtin-voices.ts');
/** A built-in voice of this provider × language, and its sex. */
const builtinSex = (provider, lang, id) => Object.entries(BUILTIN_VOICES[provider][lang] ?? {}).find(([, ages]) => Object.values(ages).includes(id))?.[0];
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
      // Signed out (no token): play is not asked, so the built-in table speaks — a native voice of his sex where the
      // language has one, else the per-language voice the call always had (a call cannot refuse).
      const language = worldLanguageOf(locale);
      const sex = builtinSex('dashscope', language, got.voice);
      if (sex) assert.equal(sex, 'male', `${world}/${id}: ${got.voice}`);
      else assert.equal(got.voice, resolveVoiceFor(declared, language), `${world}/${id} keeps the voice normal TTS keeps`);
    }
    const watson = await resolveVoiceLiveCast(templateStore('whitechapel'), 'watson');
    assert.equal(builtinSex('dashscope', 'en', watson.voice) ?? voiceEntry(watson.voice)?.gender, 'male');
  } finally {
    if (saved !== undefined) process.env.AIRP_TTS_LOCAL_BASE_URL = saved;
  }
});

test("a Fish call speaks niko's assigned voice for the edition's language (islet editions, kenta)", { skip: skipUnlessShipped('islet') }, async () => {
  const saved = process.env.AIRP_TTS_LOCAL_BASE_URL;
  delete process.env.AIRP_TTS_LOCAL_BASE_URL;
  try {
    for (const [world, lang] of [['islet', 'en'], ['islet-jp', 'ja'], ['islet-ko', 'ko'], ['islet-zh', 'zh']].filter(([w]) => templateShipped(w))) {
      assert.equal((await resolveVoiceLiveCast(templateStore(world), 'kenta', { fish: true })).voice, BUILTIN_ASSIGNED.islet.kenta[lang], world);
      assert.notEqual((await resolveVoiceLiveCast(templateStore(world), 'kenta', { fish: false })).voice, BUILTIN_ASSIGNED.islet.kenta[lang], `${world}: DashScope-only call keeps a qwen voice`);
    }
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
    // a Chinese voice never reads English (只说母语): the built-in English male voice
    assert.equal(builtinSex('dashscope', 'en', lixiang.voice), 'male', lixiang.voice);
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

// The call's voice is chosen like the dialogue's TTS (routes/tts.ts step 6b): worldlines-play's candidates for the
// providers the call can speak → play's last answer → the built-in table; native speakers only, never a refusal.
function memoryStore(manifest, readme) {
  return { worldRoot: '/saves/x', readFile: async () => readme, getManifest: async () => manifest };
}
const FISH_NAGI_JA = 'a1bc0dd7625243b4b402db009e293d91';
function fakePlay(answer) {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, request };
}
const isletNagi = (locale, id) => memoryStore({ id, locale, characters: [{ id: 'nagi', description: 'a girl of sixteen' }] }, '---\nname: Nagi\ngender: female\n---\n');

test('a ticketed call asks play for Fish + DashScope and speaks its first candidate', async () => {
  const play = fakePlay({ candidates: [{ provider: 'fish', voiceId: FISH_NAGI_JA, via: 'pinned' }, { provider: 'dashscope', voiceId: 'Ono Anna', via: 'cell' }] });
  const got = await resolveVoiceLiveCast(isletNagi('ja', 'islet-jp'), 'nagi', { fish: true, token: 'tok', request: play.request });
  assert.deepEqual(got, { character: 'nagi', language: 'Japanese', voice: FISH_NAGI_JA });
  assert.equal(play.calls.length, 1);
  assert.match(play.calls[0].url, /\/v1\/voice\/cast$/);
  assert.equal(play.calls[0].headers.authorization, 'Bearer tok');
  assert.deepEqual({ ...play.calls[0].body, traits: undefined, description: undefined },
    { product: 'livingcanvas', family: 'islet', character: 'nagi', lang: 'ja', providers: ['fish', 'dashscope'], traits: undefined, description: undefined });
});

test('a call without Fish asks for DashScope only, and never carries a Fish id play might still send', async () => {
  const play = fakePlay({ candidates: [{ provider: 'fish', voiceId: FISH_NAGI_JA, via: 'pinned' }, { provider: 'dashscope', voiceId: 'Cherry', via: 'cell' }] });
  const got = await resolveVoiceLiveCast(isletNagi('zh-CN', 'islet-zh'), 'nagi', { token: 'tok', request: play.request });
  assert.deepEqual(play.calls[0].body.providers, ['dashscope']);
  assert.equal(got.voice, 'Cherry');
});

test('signed out, play is not asked: the built-in table, a native voice of her sex', async () => {
  const play = fakePlay({ candidates: [] });
  for (const [locale, lang, fish] of [['zh-CN', 'zh', true], ['ja', 'ja', true], ['zh-CN', 'zh', false], ['en', 'en', false]]) {
    // a family play was never asked about (an earlier test's answer for islet would be served from the cache)
    const got = await resolveVoiceLiveCast(isletNagi(locale, `quiet-${lang}`), 'nagi', { fish, request: play.request });
    assert.equal(builtinSex(fish ? 'fish' : 'dashscope', lang, got.voice), 'female', `${lang} fish=${fish}: ${got.voice}`);
  }
  assert.equal(play.calls.length, 0);
});

test('play unreachable: its last answer for the same question, else the built-in table', async () => {
  const store = isletNagi('ko', 'islet-ko');
  const first = fakePlay({ candidates: [{ provider: 'fish', voiceId: 'e1b08ec6597d4770aff6fec0f1908572', via: 'pinned' }] });
  await resolveVoiceLiveCast(store, 'nagi', { fish: true, token: 'tok', request: first.request });
  const down = fakePlay(new TypeError('fetch failed'));
  const again = await resolveVoiceLiveCast(store, 'nagi', { fish: true, token: 'tok', request: down.request });
  assert.equal(again.voice, 'e1b08ec6597d4770aff6fec0f1908572', 'the cached answer');
  const other = await resolveVoiceLiveCast(isletNagi('en', 'islet-en'), 'nagi', { fish: true, token: 'tok', request: down.request });
  assert.equal(other.voice, BUILTIN_ASSIGNED.islet.nagi.en, "nothing cached: the built-in answer — niko's assigned voice for nagi in English");
});

test('no native voice anywhere: the call keeps its per-language voice rather than refusing', async () => {
  // DashScope has no built-in Japanese male voice (qwen speaks only its own language), and play is not asked
  const store = memoryStore({ id: 'nowhere-jp', locale: 'ja', characters: [{ id: 'old-man', description: 'an old man of seventy' }] }, '---\nname: Gen\ngender: male\n---\n');
  const got = await resolveVoiceLiveCast(store, 'old-man');
  assert.equal(got.language, 'Japanese');
  assert.ok(got.voice && !/^[0-9a-f]{32}$/.test(got.voice), got.voice);
});

test('a self-run voice-live speaks Fish only when VOICE_LIVE_FISH=1', () => {
  const { proxiedVoiceLiveSpeaksFish } = cast;
  assert.equal(proxiedVoiceLiveSpeaksFish({}), false);
  assert.equal(proxiedVoiceLiveSpeaksFish({ VOICE_LIVE_FISH: '1' }), true);
});
