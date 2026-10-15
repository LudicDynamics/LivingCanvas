// 浏览器太旧 (lib/browser-support.ts): the runtime's floor is checked before the Worker starts, and every boot failure
// says what to do (update / reload) instead of a dead Worker (chronicle 2026-10-06 / 10-07, Safari 16 + RegExp `v`).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const S = await jiti.import('../src/lib/browser-support.ts');
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('this Node (+ a Worker) passes; each missing feature is named', () => {
  const old = { ...Object.fromEntries(['RegExp', 'Intl', 'structuredClone', 'Array', 'Object', 'WebAssembly'].map((k) => [k, globalThis[k]])), Worker: function Worker() {} };
  assert.deepEqual(S.missingRuntimeFeatures(old), []);
  const noLookbehind = { ...old, RegExp: function RE(src) { if (src.includes('(?<')) throw new SyntaxError('Invalid regular expression: invalid group specifier name'); return /x/; } };
  assert.deepEqual(S.missingRuntimeFeatures(noLookbehind), ['regex-lookbehind']);
  assert.deepEqual(S.missingRuntimeFeatures({ ...old, Intl: {}, structuredClone: undefined, Worker: undefined }), ['Intl.Segmenter', 'structuredClone', 'Worker']);
  assert.deepEqual(S.missingRuntimeFeatures({ ...old, Array: function () {}, Object: {}, WebAssembly: undefined }), ['Array.prototype.at', 'Object.hasOwn', 'WebAssembly']);
});

test('too old → 「你的浏览器版本太旧，请更新 Safari / Chrome」 with the minimum versions', () => {
  const f = S.bootFailure(new S.OutdatedBrowserError(['regex-lookbehind']), 'zh-CN');
  assert.equal(f.outdated, true);
  assert.equal(f.title, '启动失败 — 你的浏览器版本太旧，请更新 Safari / Chrome');
  // No language given: English (the default), never Chinese.
  assert.equal(S.bootFailure(new S.OutdatedBrowserError(['x'])).title, 'Could not start — Your browser is too old — please update Safari or Chrome');
  assert.equal(S.OUTDATED_MESSAGE, 'Your browser is too old — please update Safari or Chrome');
  assert.match(f.hint, /Safari \/ iOS 16\.4, Chrome 98, Firefox 125/);
  assert.equal(S.bootFailure(new S.OutdatedBrowserError(['x']), 'en').title, 'Could not start — Your browser is too old — please update Safari or Chrome');
  // the engine errors only an old browser produces, as they arrive from the Worker
  for (const m of [
    "server exited before listen(): SyntaxError: Invalid flags supplied to RegExp constructor 'v'",
    'runtime worker failed: Invalid regular expression: invalid group specifier name',
    'SyntaxError: invalid regular expression flags',
  ]) assert.equal(S.bootFailure(new Error(m)).outdated, true, m);
});

test('any other failure → reload hint, raw detail kept small, never "undefined"', () => {
  const f = S.bootFailure(new Error('server has not called listen()\n    at worker.js:1:2'), 'zh-CN');
  assert.equal(f.outdated, false);
  assert.match(f.title, /^启动失败 — /);
  assert.match(f.hint, /重新加载/);
  assert.match(S.bootFailure(new Error('x')).hint, /Reload/);
  assert.equal(f.detail, 'server has not called listen()');
  assert.equal(S.bootFailure(undefined).detail, '');
});

test('the boot screen and the early runtime use it', () => {
  const main = read('../src/main.tsx');
  assert.match(main, /const f = bootFailure\(e, bootLocale\);/);
  assert.match(main, /retry\.textContent = bootText\(bootLocale, 'reload'\);[\s\S]*location\.reload\(\)/);
  const mode = read('../src/lib/browser-mode.ts');
  assert.match(mode, /const missing = missingRuntimeFeatures\(\);\n\s*if \(missing\.length\) \{[\s\S]*?throw new OutdatedBrowserError\(missing\);/);
  // before the Service Worker registers and before any Worker is made by the bundle
  assert.ok(mode.indexOf('missingRuntimeFeatures()') < mode.indexOf('adoptEarlyRuntime(workerUrl) ??'));
  const html = read('../index.html');
  assert.match(html, /new RegExp\('\(\?<=a\)b'\)\.test\('ab'\)[^\n]*Intl\.Segmenter\) return;/);
});

test('error scrubbing has no lookbehind (it must run on the old browsers it reports)', async () => {
  const src = read('../src/lib/analytics.ts');
  assert.ok(!/\(\?<[=!]/.test(src));
  const A = await jiti.import('../src/lib/analytics.ts');
  assert.equal(A.scrubText('k=abcdefghijklmnop0123456789ABCDEFGH done'), 'k=[token] done');
  assert.equal(A.scrubText('abcdefghijklmnop0123456789ABCDEFGH'), '[token]');
  assert.equal(A.scrubText('x_abcdefghijklmnopqrstuvwxyzABCDEFGH'), 'x_abcdefghijklmnopqrstuvwxyzABCDEFGH');
});
