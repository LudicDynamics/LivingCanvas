// Korean (ko, 2026-10-03) tooling: the provisional i18n gate, the message
// translator's guards, and the -ko world editions. No API calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { entryProblems, I18N_LOCALES, PROVISIONAL_LOCALES, requiredLocales } from './lib/i18n-locales.mjs';
import { batchesOf, estimateMessages, pendingKeys, validateMessage, withTranslations } from './translate-messages.mjs';
import { allEditionLocales, editionFamilies, editionId, editionLocales, hasAnyEdition, provisionalEditionLocales } from './world-editions.mjs';
import { estimateTokens, familiesFrom, koreanDates, koreanPathParticles, parseJsonLoose, sourceLocaleOf, targetsFrom, validate } from './localize-from-zh.mjs';
import { protect } from './localize-world-editions.mjs';

test('check:i18n: zh-CN, ja and ko are all required (ko stopped being provisional once translated)', () => {
  assert.deepEqual(I18N_LOCALES, ['zh-CN', 'ja', 'ko']);
  assert.equal(PROVISIONAL_LOCALES.size, 0);
  assert.deepEqual(requiredLocales({ argv: [], env: {} }), ['zh-CN', 'ja', 'ko']);
  assert.deepEqual(requiredLocales({ argv: ['--require=ko'], env: {} }), ['zh-CN', 'ja', 'ko']);
  const entry = { 'zh-CN': '{n} 个', ja: '{n} 個' };
  assert.deepEqual(entryProblems('{n} items', entry, ['zh-CN', 'ja']), []);
  assert.deepEqual(entryProblems('{n} items', entry, ['zh-CN', 'ja', 'ko']), [{ locale: 'ko', kind: 'missing' }]);
  // A present translation is checked even for a locale that is not required (a provisional one).
  assert.deepEqual(entryProblems('{n} items', { ...entry, ko: '{count}개' }, ['zh-CN', 'ja']), [{ locale: 'ko', kind: 'placeholders' }]);
});

test('translate-messages accepts only Korean that keeps placeholders and product names', () => {
  assert.equal(validateMessage('ko', 'Saved games', '저장된 게임'), '저장된 게임');
  assert.equal(validateMessage('ko', 'Talk to {name}', '{name}에게 말 걸기'), '{name}에게 말 걸기');
  assert.throws(() => validateMessage('ko', 'Talk to {name}', '{이름}에게 말 걸기'), /placeholders/);
  assert.throws(() => validateMessage('ko', 'Worldlines AI service', '월드라인 AI 서비스'), /lost "Worldlines"/);
  assert.throws(() => validateMessage('ko', 'Saved games', '保存したゲーム'), /kana/);
  assert.throws(() => validateMessage('ko', 'Saved games', '已保存'), /Chinese/);
  assert.throws(() => validateMessage('ko', 'Saved games', 'Saved games!'), /Hangul/);
  assert.equal(validateMessage('ko', 'D&D', 'D&D'), 'D&D');
  assert.throws(() => validateMessage('ko', 'Saved games', ''), /empty/);
});

test('translate-messages writes only the new field, after the existing ones, keeping the file format', () => {
  const messages = { 'A': { 'zh-CN': '甲', ja: 'エー' }, 'B': { 'zh-CN': '乙', ja: 'ビー', ko: '비' } };
  assert.deepEqual(pendingKeys(messages, 'ko'), ['A']);
  const out = withTranslations(messages, 'ko', { A: '에이', B: 'overwritten?' });
  assert.deepEqual(Object.keys(out.A), ['zh-CN', 'ja', 'ko']);
  assert.equal(out.B.ko, '비', 'an existing translation is never overwritten');
  const before = JSON.stringify(messages, null, 2).split('\n');
  const after = JSON.stringify(out, null, 2).split('\n');
  // Pure additions: one comma on the ja line, one new ko line.
  assert.equal(after.length, before.length + 1);
  const est = estimateMessages(['A'], messages);
  assert.equal(est.keys, 1);
  assert.ok(est.input > 0 && est.output > 0);
  assert.equal(batchesOf(['A', 'B'], messages, 1).length, 2);
});

test('-ko editions: suffix, published, and the provisional mechanism', () => {
  assert.deepEqual(allEditionLocales, ['en', 'ja', 'zh-CN', 'ko']);
  assert.deepEqual(editionLocales, ['en', 'ja', 'zh-CN', 'ko']);
  assert.deepEqual(provisionalEditionLocales, []);
  assert.equal(editionId(editionFamilies.find((f) => f.base === 'firstsnow'), 'ko'), 'first-snow-ko');
  for (const f of editionFamilies) assert.match(f.ko, /\p{Script=Hangul}/u, `${f.base}: Korean title`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-ko-'));
  assert.equal(hasAnyEdition('ko', tmp), false);
  fs.mkdirSync(path.join(tmp, 'wuwu-ko'));
  fs.writeFileSync(path.join(tmp, 'wuwu-ko', 'world.json'), '{}');
  assert.equal(hasAnyEdition('ko', tmp), true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('localize-from-zh --to ko covers every family from its own source edition', () => {
  assert.deepEqual(targetsFrom([]), ['en', 'ja']);
  assert.deepEqual(targetsFrom(['--to', 'ko']), ['ko']);
  assert.throws(() => targetsFrom(['--to', 'fr']), /Unknown target/);
  assert.equal(familiesFrom(['--to', 'ko']).length, editionFamilies.length);
  assert.deepEqual(familiesFrom(['--to', 'ko', 'guixiang', '--max-usd', '5']).map((f) => f.base), ['guixiang']);
  assert.deepEqual(familiesFrom([]).map((f) => f.base).sort(), ['forger', 'guixiang', 'islet', 'last-train', 'last-train-prologue', 'last-witness', 'wuwu']);
  const fam = (b) => editionFamilies.find((f) => f.base === b);
  assert.equal(sourceLocaleOf(fam('guixiang'), 'ko'), 'zh-CN');
  assert.equal(sourceLocaleOf(fam('whitechapel'), 'ko'), 'en');
  assert.equal(sourceLocaleOf(fam('guixiang'), 'en'), 'zh-CN');
  const { input, output } = estimateTokens(1000, 'en', ['ko']);
  assert.ok(input > 0 && output > 0);
});

test('a Korean world translation keeps protected tokens and has no hanja or kana', () => {
  const unit = protect('Read world/test/README.md and roll 2d10, >=11.');
  const ok = '⟪0⟫를 읽고 ⟪1⟫을 굴린다. ⟪2⟫ 이상.';
  assert.match(validate('ko', unit, ok), /world\/test\/README\.md/);
  assert.throws(() => validate('ko', unit, '⟪0⟫ を読み ⟪1⟫ ⟪2⟫'), /kana/);
  assert.throws(() => validate('ko', unit, '⟪0⟫를 읽고 ⟪1⟫을 굴린다. ⟪2⟫ 以上.'), /Chinese characters/);
  assert.throws(() => validate('ko', unit, '⟪0⟫를 읽는다.'), /protected/);
});

test('Korean builds put dates in Korean order and survive a stray tail after the JSON answer', () => {
  assert.equal(koreanDates('12월 31일, 1994일 · 수리 맡긴 날'), '1994년 12월 31일 · 수리 맡긴 날');
  assert.equal(koreanDates('마을, 31년 12월 1994일'), '마을, 1994년 12월 31일');
  assert.equal(koreanDates('1월 1일 오전 1995시 9분.'), '1995년 1월 1일 오전 9시.');
  assert.equal(koreanDates('1월 1일 오전 10시 1995분에'), '1995년 1월 1일 오전 10시에');
  assert.equal(koreanDates('내일 8:30시에'), '내일 8:30에');
  assert.equal(koreanDates('1995년 1월 1일 오후 8시'), '1995년 1월 1일 오후 8시', 'already Korean: unchanged');
  assert.deepEqual(parseJsonLoose('{"a":"b"}\n}'), { a: 'b' });
  assert.throws(() => parseJsonLoose('{"a":'));
});

test('an author-only asset note may come back as paths and English prompt words', () => {
  const unit = { ...protect('- assets/scenes/intro.webp ← divergence opening'), file: 'assets/README.md' };
  assert.match(validate('ko', unit, '- ⟪0⟫ ← divergence opening'), /intro\.webp/);
  assert.throws(() => validate('ko', { ...unit, file: 'world/README.md' }, '- ⟪0⟫ ← divergence opening scene for players'), /Hangul/);
});

test('koreanPathParticles: a particle after a file path goes through 파일, so it agrees however the path is read', () => {
  assert.equal(koreanPathParticles('collection-slip.md과 route-note.md을 바탕으로'), 'collection-slip.md 파일과 route-note.md 파일을 바탕으로');
  assert.equal(koreanPathParticles('player/fax-draft.md이 없으면'), 'player/fax-draft.md 파일이 없으면');
  assert.equal(koreanPathParticles('world/clockwork-frog.md을 player/clockwork-frog.md.로 옮긴다'), 'world/clockwork-frog.md 파일을 player/clockwork-frog.md 파일로 옮긴다');
  assert.equal(koreanPathParticles('README.md와 epilogue.md 경로'), 'README.md 파일과 epilogue.md 경로');
  assert.equal(koreanPathParticles('intervention.md에 기록한다. 배경은 future.webp이다.'), 'intervention.md에 기록한다. 배경은 future.webp이다.', '에 / copula: unchanged');
  assert.equal(koreanPathParticles('README.md 파일과'), 'README.md 파일과', 'idempotent');
});

test('no -ko world template has a bare particle right after a file path', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const root = new URL('../templates/', import.meta.url);
  const bad = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const f = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) await walk(f);
      else if (/\.(md|json|ya?ml)$/.test(e.name)) {
        const text = await readFile(f, 'utf8');
        if (koreanPathParticles(text) !== text) bad.push(f.pathname);
      }
    }
  };
  for (const d of await readdir(root)) if (d.endsWith('-ko')) await walk(new URL(`${d}/`, root));
  assert.deepEqual(bad, []);
});
