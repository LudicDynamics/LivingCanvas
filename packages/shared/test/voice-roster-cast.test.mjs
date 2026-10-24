// Voice casting against worldlines-play's voice roster. Same vectors as
// worldlines-play core/voice-cast-core.test.ts — this file's rules are a port of that one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALIAS_DESCRIPTORS, ROSTER_AGES, nearestInProvider, VOICES, VOICE_ROSTER, ageMismatch, castRosterTtsVoice, castRosterVoice, castWorldVoice,
  inferVoiceProfile, rosterAllows, rosterDeclaration, rosterFallback, speaks, statedAge, worldFamilyOf,
} from '../dist/index.js';

const id = (g, age, i) => `${g}${age}${i}`.padEnd(32, '0');
/** A small roster: three voices a cell, tagged so aliases have something to match. */
function fixture() {
  const voices = [];
  for (const age of ROSTER_AGES) for (const gender of ['female', 'male']) for (let i = 0; i < 3; i++) {
    voices.push({ provider: 'fish', id: id(gender[0], age, i), title: `${gender}-${age}-${i}`, gender, age, mood: i === 2 ? ['慈祥', '沉稳'] : i === 1 ? ['冷静'] : ['阳光'], timbre: [], roles: [], status: 'candidate' });
  }
  const fallback = {};
  for (const g of ['female', 'male']) for (const a of ['young', 'middle', 'old']) fallback[`${g}/${a}`] = id(g[0], a, 0);
  voices.push({ provider: 'dashscope', id: 'Eldric Sage', title: 'Eldric Sage', gender: 'male', age: 'old', mood: ['慈祥', '沉稳'], timbre: [], roles: [], status: 'candidate' });
  voices.push({ provider: 'dashscope', id: 'Jennifer', title: 'Jennifer', gender: 'female', age: 'young', only: 'en', mood: [], timbre: [], roles: [], status: 'candidate' });
  return { schema: 'worldlines.voice-roster/2', generatedAt: 'x', voices, fallback, banned: [], assignments: { islet: { mio: id('f', 'child', 1) } } };
}
const roster = fixture();

test('castRosterVoice: assigned, declared reference_id, old aliases by tags, fallbacks', () => {
  assert.equal(castRosterVoice(roster, { family: 'islet', character: 'mio' }).via, 'assigned');
  assert.equal(castRosterVoice(roster, { family: 'islet', character: 'mio' }).voice.id, id('f', 'child', 1));
  assert.equal(castRosterVoice(roster, { declared: id('m', 'middle', 1) }).voice.id, id('m', 'middle', 1));
  assert.equal(castRosterVoice(roster, { declared: 'wise-elder' }).voice.id, id('m', 'old', 2), 'wise-elder → old man, 慈祥 · 沉稳 (first of the tie: Fish listed first)');
  assert.equal(castRosterVoice(roster, { declared: 'Eldric Sage' }).voice.provider, 'dashscope', 'a qwen voice by its own id');
  assert.notEqual(castRosterVoice(roster, { declared: 'Jennifer', language: 'zh' }).voice.id, 'Jennifer', 'English-only voice not in a Chinese world');
  assert.equal(castRosterVoice(roster, { declared: 'Jennifer', language: 'en' }).voice.id, 'Jennifer');
  assert.equal(nearestInProvider(roster, roster.voices.find((v) => v.id === id('m', 'old', 2)), 'dashscope').id, 'Eldric Sage', 'cross-provider: nearest qwen voice');
  assert.equal(castRosterVoice(roster, { declared: 'cool-composed' }).voice.id, id('m', 'young', 1), 'cool-composed → young man, 冷静');
  assert.equal(castRosterVoice(roster, { declared: 'Eldric' }).via, 'fallback-unknown');
  assert.equal(castRosterVoice(roster, {}).voice.id, roster.fallback['female/young']);
  for (const alias of Object.keys(ALIAS_DESCRIPTORS)) assert.ok(rosterAllows(roster, castRosterVoice(roster, { declared: alias }).voice.id), alias);
});

test('every palette alias of rules/voices.ts has a descriptor of the same gender', () => {
  for (const v of VOICES) {
    assert.ok(ALIAS_DESCRIPTORS[v.alias], v.alias);
    assert.equal(ALIAS_DESCRIPTORS[v.alias].gender, v.gender, v.alias);
  }
  assert.equal(Object.keys(ALIAS_DESCRIPTORS).length, VOICES.length);
});

test('other sex / too far in age → one of the six; banned never speaks', () => {
  const martel = castRosterVoice(roster, { declared: 'cool-composed', profile: { gender: 'female', age: 'middle' } });
  assert.equal(martel.via, 'fallback-gender');
  assert.equal(martel.voice.id, roster.fallback['female/middle']);
  const po = castRosterVoice(roster, { declared: 'mature-elegant', profile: { gender: 'female', age: 'old' } });
  assert.equal(po.via, 'fallback-age');
  assert.equal(po.voice.id, roster.fallback['female/old']);
  assert.equal(castRosterVoice(roster, { declared: 'hoarse-weathered', profile: { age: 'old' } }).voice.id, roster.fallback['male/old']);
  assert.equal(castRosterVoice(roster, { declared: 'sassy-spunky', profile: { gender: 'female', age: 'child' } }).via, 'declared');
  assert.equal(castRosterVoice(roster, { declared: 'child-innocent', profile: { gender: 'female', age: 'young' } }).via, 'fallback-age');
  assert.ok(ageMismatch('young', 'old'));
  assert.ok(!ageMismatch('middle', 'young'));
  assert.equal(rosterFallback(roster, { gender: 'male', age: 'child' }).id, roster.fallback['male/young']);
  const banned = { ...roster, banned: [id('m', 'old', 2), roster.fallback['male/old']] };
  assert.notEqual(castRosterVoice(banned, { declared: 'wise-elder' }).voice.id, id('m', 'old', 2));
  assert.equal(castRosterVoice(banned, { profile: { gender: 'male', age: 'old' } }).voice.id, roster.fallback['male/middle'], 'banned fallback → next nearest');
});

test('inference vectors (shared with play)', () => {
  assert.equal(statedAge('二十四岁的列车员'), 24);
  assert.equal(statedAge('五十出头'), 53);
  assert.equal(statedAge('in her early fifties'), 52);
  assert.equal(statedAge('五十を少し過ぎた、厳しい女性'), 53);
  assert.equal(statedAge('쉰을 갓 넘긴 여성'), 52);
  assert.equal(statedAge('일흔여섯 살'), 76);
  assert.equal(statedAge('a 68-year-old harbour master'), 68);
  assert.equal(statedAge('A Hakka girl of about nineteen in an indigo blouse'), 19);
  assert.equal(statedAge('a fisherman aged 61'), 61);
  assert.equal(statedAge('a box of nineteen letters'), undefined);
  assert.deepEqual(inferVoiceProfile('守灯塔的老婆婆，七十六岁，她说了算。'), { gender: 'female', years: 76, age: 'old' });
  assert.deepEqual(inferVoiceProfile('高一（1）班，他自称导演。'), { gender: 'male', age: 'child' });
  assert.deepEqual(inferVoiceProfile('十七岁的渔家少女，她嘴硬。'), { gender: 'female', years: 17, age: 'child' });
  assert.equal(inferVoiceProfile('A librarian who keeps loans.').gender, undefined);
  assert.equal(inferVoiceProfile('Business partner.', 'male').gender, 'male');
  assert.equal(castRosterTtsVoice(roster, { text: '韩姨，七号楼的老住户，六十三岁。她是第一时间敲门的人。' }).voice.id, roster.fallback['female/old']);
  assert.equal(castRosterTtsVoice(roster, { text: '石津镇车马行的把式，四十出头。他的马车常停在旅店后院。' }).voice.id, roster.fallback['male/middle']);
});

test('this repo\'s bridge: raw DashScope ids and studio voices become aliases; world families', () => {
  assert.equal(rosterDeclaration('Eldric Sage', roster), 'Eldric Sage', 'a qwen id on the roster is taken as is');
  assert.equal(rosterDeclaration('Cherry', roster), 'warm-cheerful', 'off the roster: its effect alias');
  assert.equal(rosterDeclaration('setsuna', roster), 'shy-sweet');
  assert.equal(rosterDeclaration(id('f', 'old', 0), roster), id('f', 'old', 0));
  assert.equal(worldFamilyOf('last-train-zh'), 'last-train');
  assert.equal(worldFamilyOf('islet'), 'islet');
  assert.equal(castWorldVoice('Bellona', { gender: 'male', age: 'middle' }, {}, roster).voice.id, roster.fallback['male/middle']);
  assert.equal(castWorldVoice(undefined, {}, { worldId: 'islet-jp', character: 'mio' }, roster).via, 'assigned');
});

test('the shipped snapshot is a valid roster: six fallbacks in it, nothing banned in it', () => {
  assert.equal(VOICE_ROSTER.schema, 'worldlines.voice-roster/2');
  assert.ok(VOICE_ROSTER.voices.every((v) => v.provider === 'fish' || v.provider === 'dashscope'));
  for (const banned of ['Elias', 'Jada', 'Roy']) assert.ok(!rosterAllows(VOICE_ROSTER, banned), `${banned} is banned`);
  assert.ok(VOICE_ROSTER.voices.length > 0);
  for (const g of ['female', 'male']) for (const a of ['young', 'middle', 'old']) assert.ok(rosterAllows(VOICE_ROSTER, VOICE_ROSTER.fallback[`${g}/${a}`]), `${g}/${a}`);
  for (const b of VOICE_ROSTER.banned) assert.ok(!VOICE_ROSTER.voices.some((v) => v.id === b));
  for (const v of VOICES) assert.ok(castWorldVoice(v.alias).voice, v.alias);
});

test('归乡: xiulian (Lianmei; after the reveal only her name changes) is cast as a young woman in every edition', () => {
  const zh = inferVoiceProfile('十九岁上下的客家姑娘，靛蓝大襟衫，头发和袖口总是湿的，说自己是守豫章堂的。她认得老井的声音。');
  const en = inferVoiceProfile('A Hakka girl of about nineteen in an indigo side-fastened blouse, her hair and cuffs always wet; she says she keeps Yuzhang Hall.');
  for (const profile of [zh, en]) {
    assert.deepEqual([profile.gender, profile.age], ['female', 'young']);
    const cast = castWorldVoice('gentle-calm', profile, { worldId: 'guixiang-zh', character: 'xiulian' });
    assert.ok(['declared', 'assigned'].includes(cast.via), cast.via);
    assert.deepEqual([cast.voice.gender, cast.voice.age], ['female', 'young']);
  }
});

test('assignments are 1 → 4 (family/character → { zh, ja, en, ko }); an assigned character never uses the default rules', () => {
  const native = (key, only) => ({ provider: 'fish', id: key.padEnd(32, '0'), title: key, gender: 'female', age: 'child', only, mood: ['慈祥', '沉稳'], timbre: [], roles: [], status: 'candidate' });
  const base = fixture();
  const zh = id('f', 'child', 1);
  const [ja, en, ko] = ['ja-girl', 'en-girl', 'ko-girl'].map((k) => k.padEnd(32, '0'));
  const r = { ...base, voices: [...base.voices, native('ja-girl', 'ja'), native('en-girl', 'en'), native('ko-girl', 'ko')], assignments: { islet: { mio: zh } }, assignedVoices: { islet: { mio: { zh, ja, en, ko } } } };
  const cast = (language) => castWorldVoice(undefined, {}, { worldId: 'islet-jp', character: 'mio' }, r, language);
  assert.equal(cast('ja').voice.id, ja);
  assert.equal(cast('en').voice.id, en);
  assert.equal(cast('ko').voice.id, ko);
  assert.equal(cast('zh').voice.id, zh);
  assert.equal(cast(undefined).voice.id, zh, 'unknown language → zh');
  assert.equal(cast('ko').via, 'assigned');
  assert.equal(castWorldVoice('wise-elder', {}, { worldId: 'islet-ko', character: 'mio' }, r, 'ko').voice.id, ko, 'a declaration does not override the assignment');
  assert.equal(castWorldVoice('wise-elder', {}, { worldId: 'islet-ko', character: 'kai' }, r, 'ko').via, 'declared', 'unassigned: default rules');
  const broken = { ...r, banned: [ko] };
  assert.deepEqual(castRosterVoice(broken, { family: 'islet', character: 'mio', language: 'ko', declared: 'wise-elder' }), { voice: undefined, via: 'assigned-unavailable' }, 'never a substitute');
  assert.equal(castRosterVoice(roster, { family: 'islet', character: 'mio', language: 'ja' }).voice.id, zh, 'an old roster without assignedVoices: the zh assignment');
});

test('native-only voices: a Fish voice without zh speaks only the world languages it is tagged with (one = string, several = array)', () => {
  assert.ok(speaks({ only: 'ja' }, 'ja') && !speaks({ only: 'ja' }, 'zh') && !speaks({ only: 'ja' }, undefined));
  assert.ok(speaks({ only: ['en', 'ko'] }, 'ko') && !speaks({ only: ['en', 'ko'] }, 'zh') && speaks({}, 'ko'));
  const base = fixture();
  const old = (key, only, mood) => ({ provider: 'fish', id: key.padEnd(32, '0'), title: key, gender: 'male', age: 'old', only, mood, timbre: [], roles: [], status: 'picked' });
  const r = { ...base, voices: [old('ja-old', 'ja', ['慈祥', '沉稳']), old('enko-old', ['en', 'ko'], ['慈祥', '沉稳']), ...base.voices] };
  for (const language of ['zh', undefined]) assert.ok(!['ja-old', 'enko-old'].map((k) => k.padEnd(32, '0')).includes(castRosterVoice(r, { declared: 'wise-elder', language }).voice.id), `alias in ${language ?? 'unknown'}`);
  assert.equal(castRosterVoice(r, { declared: 'wise-elder', language: 'ja' }).voice.id, 'ja-old'.padEnd(32, '0'), 'picked + tags win in its own language');
  assert.equal(castRosterVoice(r, { declared: 'wise-elder', language: 'ko' }).voice.id, 'enko-old'.padEnd(32, '0'));
  assert.notEqual(castRosterVoice(r, { declared: 'enko-old'.padEnd(32, '0'), language: 'ja' }).voice.id, 'enko-old'.padEnd(32, '0'));
});
