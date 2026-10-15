// Korean (ko, 2026-10-03): every user-facing locale table carries ko, and no Japanese-only inline branch is left
// for a Korean (or Chinese) player to see English where a Japanese player sees Japanese. the design notes
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const src = new URL('../src/', import.meta.url);
const read = (p) => readFile(new URL(p, src), 'utf8');

async function sources(dir = src) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const f = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) out.push(...(await sources(f)));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(f);
  }
  return out;
}

test('messages.json: every entry has zh-CN, ja and ko', async () => {
  const messages = JSON.parse(await read('lib/messages.json'));
  const missing = Object.entries(messages).filter(([, v]) => !v.ko || !v.ja || !v['zh-CN']).map(([k]) => k);
  assert.deepEqual(missing, []);
});

test('no Japanese-only inline branch: a line that tests for ja either names ko too or reads messages.json for the rest', async () => {
  // The two legacy UI_COPY consumers keep the hand-written Japanese table and translate() every other language.
  const translateRest = new Set(['components/nook/NookView.tsx', 'lib/live-call-store.ts']);
  const bad = [];
  for (const f of await sources()) {
    const rel = f.pathname.slice(src.pathname.length);
    const lines = (await readFile(f, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (!/===\s*'ja'\s*\?/.test(line)) return;
      if (line.includes("'ko'") || (translateRest.has(rel) && line.includes('translate('))) return;
      bad.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('the nook gets the real interface language (it was handed en for every non-Japanese player)', async () => {
  const app = await read('App.tsx');
  assert.doesNotMatch(app, /locale=\{locale === 'ja' \? 'ja' : 'en'\}/);
});

test('live-call errors and the nook copy read in Korean', async () => {
  const { translate } = await jiti.import('../src/lib/translate.ts');
  const { UI_COPY } = await jiti.import('../src/lib/legacy-ui-copy.ts');
  for (const key of ['liveCallStart', 'liveCallModalBlocked', 'liveErrorUnconfigured', 'liveErrorMicUnsupported', 'liveErrorConnection', 'liveErrorWorld', 'liveErrorRequest', 'liveErrorVoice', 'liveErrorOffer', 'liveErrorGeneric', 'nookEmptyPrompt']) {
    const ko = translate('ko', UI_COPY.en[key]);
    assert.notEqual(ko, UI_COPY.en[key], key);
    assert.match(ko, /[가-힣]/, key);
  }
});

test('billing links and redemptions pass ko through (billing speaks ko since platform feat/korean)', async () => {
  const { billingLinks } = await jiti.import('../src/lib/plans.ts');
  assert.equal(billingLinks('https://b.test', null, 'ko').subscribe, 'https://b.test/subscribe?lang=ko');
  const accountData = await readFile(new URL('../../server/src/sync/account-data.ts', import.meta.url), 'utf8');
  assert.match(accountData, /const REDEEM_LOCALE: Record<string, string> = \{[^}]*\bko: 'ko'/);
});

test('Korean particles never follow a {placeholder} bare (와/과, 을/를, 이/가 depend on the name): use 님과, 을(를) or restructure', async () => {
  const messages = JSON.parse(await read('lib/messages.json'));
  const bare = Object.entries(messages).filter(([, v]) => /\}(와|과|을|를|이|가|은|는|로|으로)(?![가-힣(])/.test(v.ko)).map(([k, v]) => `${k} → ${v.ko}`);
  assert.deepEqual(bare, []);
});
