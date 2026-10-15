import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blindCopyKeyReads, compareBlindKeys, englishCopyValues, translationCalls } from './lib/i18n-call-keys.mjs';

test('i18n scanner excludes interpolation values and unrelated literals', () => {
  const source = `const value = t('Selected: {action}.', { action: text.split('\\n')[0] });
// t('not a call')
const note = "t('also not a call')";
const jsx = <p title={t('Service URL')}>Visible text</p>;`;
  assert.deepEqual(translationCalls('sample.tsx', source), [
    { key: 'Selected: {action}.', line: 1 }, { key: 'Service URL', line: 4 },
  ]);
});

test('i18n scanner handles key alternatives without treating conditions as keys', () => {
  const source = `t(status === 'ready' ? 'Ready' : (failed ? 'Failed' : 'Waiting'));
t('A (balanced) label');
t(dynamicKey);`;
  assert.deepEqual(translationCalls('sample.ts', source).map(hit => hit.key), ['Ready', 'Failed', 'Waiting', 'A (balanced) label']);
});

const COPY_SOURCE = `en: {
  liveCallStart: 'Speak aloud',
  liveCallStop: 'Hang up',
},
ja: {
  liveCallStart: '声を出す',
},`;
const copyValues = englishCopyValues(COPY_SOURCE);

test('i18n dynamic guard reports a blind UI_COPY value and passes a translated one', () => {
  const translated = { 'Speak aloud': { 'zh-CN': '大声说出来', ja: '声を出す' } };
  const blind = blindCopyKeyReads('const a = copy.liveCallStart;', 'copy', copyValues, {});
  assert.deepEqual(blind, [{ key: 'liveCallStart', value: 'Speak aloud' }]);
  // Control: the SAME read is no longer blind once messages.json carries the value.
  assert.deepEqual(blindCopyKeyReads('const a = copy.liveCallStart;', 'copy', copyValues, translated), []);
});

test('i18n dynamic guard distinguishes a new blind key from a stale baseline entry', () => {
  const baseline = new Set(['liveCallStart']);
  const fresh = [{ key: 'liveCallStop', value: 'Hang up' }];
  const problems = compareBlindKeys(fresh, baseline);
  assert.ok(problems.some((p) => p.includes('NEW blind key') && p.includes('copy.liveCallStop')));
  // Control: shrinking is enforced — the fixed key cannot stay in the baseline.
  assert.ok(problems.some((p) => p.includes('shrink it') && p.includes('liveCallStart')));
  assert.deepEqual(compareBlindKeys(fresh, new Set(['liveCallStop'])), []);
});

test('i18n dynamic guard ignores non-UI_COPY reads (import specifiers, lookalikes)', () => {
  assert.deepEqual(blindCopyKeyReads("import { copy } from './copy.js';", 'copy', copyValues, {}), []);
  assert.deepEqual(blindCopyKeyReads('const copy = { mine: 1 }; void copy.mine;', 'copy', copyValues, {}), []);
});
