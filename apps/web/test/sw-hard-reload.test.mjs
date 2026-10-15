// Cmd/Ctrl+Shift+R loads the page past an already-active Service Worker, so the
// page starts uncontrolled and `activate` (with its clients.claim()) is long past.
// Browser mode used to wait for a controllerchange that never came and hung on
//. Checked in headless Chromium with
// CDP Page.reload { ignoreCache: true }: before = uncontrolled, the claim message
// takes the page back.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

const read = (p) => fs.readFile(new URL(p, import.meta.url), 'utf8');

test('the worker claims on request (a hard-reloaded page asks for it)', async () => {
  const sw = await read('../public/airp-runtime-sw.js');
  assert.match(sw, /addEventListener\('message'[\s\S]{0,120}airp-claim[\s\S]{0,80}clients\.claim\(\)/);
});

test('the page never waits for control without a way out: claim, then one plain reload, then an error', async () => {
  const src = await read('../src/lib/browser-mode.ts');
  assert.ok(!/if \(!navigator\.serviceWorker\.controller\) await new Promise\(\(r\) => navigator\.serviceWorker\.addEventListener\('controllerchange', r/.test(src), 'the old unbounded wait is gone');
  assert.match(src, /postMessage\(\{ type: 'airp-claim' \}\)/);
  assert.match(src, /setTimeout\(\(\) => r\(false\), 3000\)/);
  assert.match(src, /window\.location\.reload\(\)/);
  assert.match(src, /SW_RELOAD_MARK/, 'the reload happens at most once per tab');
});
