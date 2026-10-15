// Korean (ko, 2026-10-03) in the shared rules: a `ko` world speaks Korean,
// is cast on voices that speak Korean, and its theme copy is Korean.
// Runs against built dist: `pnpm build`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  worldLanguageOf, castVoice, voiceTableFor, VOICES, WORLD_LANGUAGES,
  RULE_PACKS, WORLD_TYPES, STRUCTURE_FLAGS, THEME_STRUCTURES, DICE_CONVENTIONS,
  themeStateDecls, themeLocaleOf, worldIntroOf, themeTitle, debriefWriterNote, LIVE_LANGUAGES,
} from '../dist/index.js';

const hangul = /\p{Script=Hangul}/u;

test('a ko world speaks Korean', () => {
  assert.ok(WORLD_LANGUAGES.includes('ko'));
  for (const v of ['ko', 'ko-KR', 'KO', 'kr']) assert.equal(worldLanguageOf(v), 'ko', v);
  assert.equal(worldLanguageOf('zh-CN'), 'zh');
  assert.ok(LIVE_LANGUAGES.includes('ko'));
});

test('every Korean cast is a voice that speaks Korean, of the declared gender', () => {
  const table = voiceTableFor('ko');
  for (const v of VOICES) {
    const cast = castVoice(v.alias, 'ko');
    assert.ok(cast, `${v.alias} has a Korean cast`);
    assert.equal(cast.gender, v.gender, v.alias);
    assert.ok(cast.native === undefined || cast.native === 'ko', `${v.alias} → ${cast.id} is bound to ${cast.native}`);
    assert.equal(table[v.alias], cast.id);
  }
  // A language-bound voice is re-cast, exactly as for Japanese.
  assert.equal(castVoice('cinematic-american', 'ko').alias, castVoice('cinematic-american', 'ja').alias);
  assert.equal(castVoice('beijing-youth', 'ko').alias, 'warm-energetic');
});

test('every localized theme string has Korean (labels, blurbs, state prose, intros)', () => {
  const seen = [];
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.en === 'string' && typeof value.ja === 'string') { seen.push(value); return; }
    for (const v of Object.values(value)) walk(v);
  };
  walk([RULE_PACKS, WORLD_TYPES, STRUCTURE_FLAGS, THEME_STRUCTURES, DICE_CONVENTIONS]);
  assert.ok(seen.length > 100, `walked ${seen.length} localized strings`);
  // Proper names written in Latin letters in every language (D&D) stay so in Korean too.
  for (const l of seen) assert.ok(typeof l.ko === 'string' && (hangul.test(l.ko) || l.ko === l.ja), `no Korean for "${l.en}"`);
});

test('a Korean world gets Korean state declarations, intro and theme title', () => {
  assert.equal(themeLocaleOf('ko'), 'ko');
  const decls = themeStateDecls({ type: 'trpg', rules: 'coc' }, 'ko');
  assert.equal(decls.player.find((s) => s.id === 'sanity').label, '이성');
  for (const s of [...decls.player, ...decls.character]) assert.match(s.label, hangul, s.id);
  const intro = worldIntroOf({ name: '막차', locale: 'ko', theme: { type: 'trpg' } });
  for (const line of intro.lines) assert.match(line, hangul);
  assert.match(themeTitle({ players: 'single', type: 'story', rules: 'narrative', structure: { endings: true, mysteries: false, clock: false, puzzles: false } }, 'ko'), /스토리/);
});

test('the debrief note for the writer is in Korean in a Korean world', () => {
  const note = debriefWriterNote([{ id: 'a', question: '누가 범인인가?', options: [] }], 'ko');
  assert.match(note, /^## 복기/);
  assert.match(note, /누가 범인인가\?/);
});
