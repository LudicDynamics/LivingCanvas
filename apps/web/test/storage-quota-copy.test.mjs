// Storage quotas by plan: the refusals and the near-limit notice
// read in the player's language, and say that play / edits on this device are unaffected.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url); // one module cache: remote-sync reads the same locale the test sets
const i18n = await jiti.import('../src/lib/i18n.ts');
const sync = await jiti.import('../src/lib/remote-sync.ts');
const messages = JSON.parse(await readFile(new URL('../src/lib/messages.json', import.meta.url), 'utf8'));
const refusal = (code) => Object.assign(new Error(code), { payload: { code, error: 'English from the server' } });

test('quota / publish-limit refusals are translated by code (zh-CN / ja / ko / en), other codes keep the server sentence', () => {
  for (const [code, key] of Object.entries(sync.REMOTE_CODE_TEXT)) {
    for (const locale of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[locale], `${code} ${locale}`);
    i18n.setLocale('zh-CN');
    assert.equal(sync.remoteErrorText(refusal(code), 'x'), messages[key]['zh-CN']);
    i18n.setLocale('en');
    assert.equal(sync.remoteErrorText(refusal(code), 'x'), key);
  }
  assert.match(messages[sync.REMOTE_CODE_TEXT.quota_bytes_exceeded]['zh-CN'], /本机上的内容都在/);
  assert.match(messages[sync.REMOTE_CODE_TEXT.quota_count_exceeded].ja, /この端末のセーブはそのまま/);
  assert.equal(sync.remoteErrorText(refusal('busy'), 'x'), 'English from the server');
});

test('near-limit notice: bytes with the percent, else the saves sentence; nothing below the threshold', () => {
  i18n.setLocale('ja');
  assert.equal(sync.quotaNoticeText(null), null);
  assert.equal(sync.quotaNoticeText({ bytesPercent: 40, countPercent: null, warnings: [] }), null);
  assert.match(sync.quotaNoticeText({ bytesPercent: 86, countPercent: null, warnings: ['quota_bytes_near_limit'] }), /86%/);
  i18n.setLocale('ko');
  assert.match(sync.quotaNoticeText({ bytesPercent: 10, countPercent: 90, warnings: ['quota_count_near_limit'] }), /클라우드 세이브/);
  i18n.setLocale('en');
});
