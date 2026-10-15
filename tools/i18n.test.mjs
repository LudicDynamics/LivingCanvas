import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';
const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const { translate, validLocale, setLocale } = await jiti.import('../apps/web/src/lib/i18n.ts');
const messages = JSON.parse(await readFile(new URL('../apps/web/src/lib/messages.json', import.meta.url), 'utf8'));

test('English is the default; unsupported or missing preferences safely fall back', () => {
  for (const value of [null, undefined, '', 'fr', 'en']) assert.equal(validLocale(value), 'en');
  assert.equal(validLocale('zh-CN'), 'zh-CN');
  assert.equal(validLocale('ja'), 'ja');
  assert.equal(validLocale('ko'), 'ko');
  assert.doesNotThrow(() => setLocale('ja'));
});
test('all translated messages retain the same interpolation fields', () => {
  const fields = value => [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const [key, translations] of Object.entries(messages)) {
    for (const locale of ['zh-CN', 'ja']) {
      assert.ok(translations[locale]?.trim(), `${key}: missing ${locale}`);
      assert.deepEqual(fields(translations[locale]), fields(key), `${key}: ${locale}`);
    }
    // Korean is provisional until the overnight run (tools/lib/i18n-locales.mjs): when present it must keep the fields too.
    if (translations.ko !== undefined) assert.deepEqual(fields(translations.ko), fields(key), `${key}: ko`);
  }
});
test('translations interpolate values and fall back without changing authored text', () => {
  assert.equal(translate('en', 'Worlds'), 'Worlds');
  assert.equal(translate('zh-CN', 'Worlds'), '世界');
  assert.equal(translate('ja', 'Worlds'), 'ワールド');
  assert.equal(translate('zh-CN', '{count} choices', { count: 3 }), '3 个选项');
  assert.equal(translate('ja', 'An authored story'), 'An authored story');
  assert.equal(translate('en', 'Talk to {name}', { name: '<Watson>' }), 'Talk to <Watson>');
});
