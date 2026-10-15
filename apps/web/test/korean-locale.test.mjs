// Korean (한국어) as a fourth interface language (2026-10-03): the locale
// plumbing that decides which language, which edition and which fonts — the
// strings themselves are filled by tools/translate-messages.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const i18n = await jiti.import('../src/lib/i18n.ts');
const launcher = await jiti.import('../src/lib/world-launcher.ts');
const { regionForLocale } = await jiti.import('../src/lib/community.ts');
const { localized } = await jiti.import('../src/lib/announcements.ts');
const { tutorialFirstLine } = await jiti.import('../src/lib/forced-tutorial.ts');
const { ensureLocaleFonts, KOREAN_FONTS_HREF } = await jiti.import('../src/lib/locale-fonts.ts');
const { GREETING_LINE } = await jiti.import('../src/components/overlay/dialogue-pages.ts');

test('ko is a valid interface language; anything unknown is still English', () => {
  assert.equal(i18n.validLocale('ko'), 'ko');
  for (const value of ['ko-KR', 'kr', 'fr', null]) assert.equal(i18n.validLocale(value), 'en');
  assert.deepEqual([...i18n.LOCALES].sort(), ['en', 'ja', 'ko', 'zh-CN']);
  assert.equal(i18n.LOCALE_NAMES.ko, '한국어');
});

test('first visit follows the browser languages (Accept-Language order); the first one we speak wins', () => {
  assert.equal(i18n.detectLocale(['ko-KR', 'en-US']), 'ko');
  assert.equal(i18n.detectLocale(['fr-FR', 'ja']), 'ja');
  assert.equal(i18n.detectLocale(['zh-TW']), 'zh-CN');
  assert.equal(i18n.detectLocale(['en-GB', 'ko']), 'en');
  assert.equal(i18n.detectLocale(['de-DE']), 'en');
  assert.equal(i18n.detectLocale(undefined), 'en');
});

test('a key with no Korean yet falls back to the English key, interpolated', () => {
  assert.equal(i18n.translate('ko', 'A key nobody translated, {n}', { n: 3 }), 'A key nobody translated, 3');
});

test('every interface language picker lists 한국어', async () => {
  const sources = ['../src/components/WorldLauncher.tsx', '../src/components/CreateWorldDialog.tsx'];
  for (const file of sources) assert.match(await readFile(new URL(file, import.meta.url), 'utf8'), /LOCALES\.map/, file);
  assert.match(await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'), /<option value="ko">한국어<\/option>/);
});

test('the launcher folds -ko editions and picks them under a Korean interface; no Korean edition, no brick', () => {
  const group = (id, locale) => ({ id, name: id, templatePath: `templates/${id}`, cover: `/c/${id}`, locale, description: '', saves: [] });
  const groups = [group('wuwu', 'en'), group('wuwu-jp', 'ja'), group('wuwu-ko', 'ko'), group('first-snow', 'en')];
  const ids = (locale) => launcher.launcherWorlds(groups, locale).filter((g) => !launcher.isNewWorldBrick(g)).map((g) => g.id);
  assert.deepEqual(ids('ko'), ['wuwu-ko']);
  assert.deepEqual(ids('en'), ['wuwu', 'first-snow']);
  assert.equal(launcher.editionLabel('ko'), '한국어');
});

test('Korean players get the international community list and English announcements before zh/ja', () => {
  assert.equal(regionForLocale('ko'), 'international');
  assert.equal(localized({ zh: '维护', ja: 'メンテ', en: 'Maintenance' }, 'ko'), 'Maintenance');
  assert.equal(localized({ zh: '维护', ko: '점검' }, 'ko'), '점검');
});

test('a Korean world gets a Korean tutorial line and greeting', () => {
  const tr = (locale, key) => `${locale}:${key}`;
  assert.equal(tutorialFirstLine({ locale: 'ko' }, 'en', tr), `ko:${'Hi — I just got here. Where am I?'}`);
  assert.equal(tutorialFirstLine({ locale: 'ko', tutorial: { firstLine: { ko: '안녕하세요' } } }, 'en', tr), '안녕하세요');
  assert.match(GREETING_LINE.ko.text, /\p{Script=Hangul}/u);
});

test('Hangul fonts load once, only for Korean, as a CORS stylesheet (COEP require-corp)', () => {
  const added = [];
  const doc = {
    head: { appendChild: (el) => added.push(el) },
    getElementById: (id) => added.find((el) => el.id === id) ?? null,
    createElement: () => ({}),
  };
  assert.equal(ensureLocaleFonts('ja', doc), false);
  assert.equal(ensureLocaleFonts('ko', doc), true);
  assert.equal(ensureLocaleFonts('ko', doc), false);
  assert.equal(added.length, 1);
  assert.equal(added[0].crossOrigin, 'anonymous');
  assert.equal(added[0].href, KOREAN_FONTS_HREF);
  assert.match(KOREAN_FONTS_HREF, /Noto\+Sans\+KR/);
});

test('the font tokens name a Hangul face after the Latin + CJK families', async () => {
  const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(css, /--ux-font-ui: 'Manrope', 'Noto Sans KR'/);
  assert.match(css, /--ux-font-human: 'LXGW WenKai', 'Gowun Batang'/);
});
