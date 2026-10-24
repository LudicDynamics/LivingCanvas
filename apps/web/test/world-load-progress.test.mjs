// Opening a world shows how far it has got
// The runtime meters the bundle download
// (apps/browser-runtime/src/load-progress.ts, ≤10 updates/s, cached blobs done at once), the Worker posts it as
// `world-progress`, lib/browser-mode.ts relays it to lib/world-load-progress.ts, and components/chrome/WorldLoading
// shows a progress bar 「已下载 x / N · y / Y MB」 or a spinner for the waits nobody can measure.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const meterMod = await jiti.import('../../browser-runtime/src/load-progress.ts');
const wl = await jiti.import('../src/lib/world-load-progress.ts');
const { translate } = await jiti.import('../src/lib/translate.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const MB = 1024 * 1024;

function clock() { let t = 0; return { now: () => t, tick: (ms) => { t += ms; } }; }

test('runtime meter: cached blobs count as done in the first update; each file counts once; the last update always goes out', () => {
  const c = clock();
  const seen = [];
  const files = [{ size: 100, cached: true }, { size: 200, cached: false }, { size: 300, cached: false }, { size: 0, cached: true }];
  const m = meterMod.createLoadProgress('templates/last-train-zh', files, (p) => seen.push(p), { now: c.now });
  assert.deepEqual(seen, [{ world: 'templates/last-train-zh', phase: 'download', filesDone: 2, filesTotal: 4, bytesDone: 100, bytesTotal: 600 }]);
  c.tick(150); m.fileDone(1);
  m.fileDone(1); m.fileDone(0); m.fileDone(-1); m.fileDone(9); // repeats, cached and out-of-range files change nothing
  m.fileDone(2); // within 100 ms of the last update: held back…
  assert.equal(seen.length, 2);
  assert.equal(seen[1].filesDone, 3);
  m.finish(); // …and sent by finish, whatever the throttle says
  assert.deepEqual(seen.at(-1), { world: 'templates/last-train-zh', phase: 'download', filesDone: 4, filesTotal: 4, bytesDone: 600, bytesTotal: 600 });
  const n = seen.length;
  m.finish();
  assert.equal(seen.length, n, 'nothing new since the last update: no repeat');
});

test('runtime meter: a 114-file download over 2 s sends at most ~10 updates a second', () => {
  const c = clock();
  const seen = [];
  const files = Array.from({ length: 114 }, (_, i) => ({ size: 70_000 + i, cached: i < 6 }));
  const m = meterMod.createLoadProgress('templates/w', files, (p) => seen.push(p), { now: c.now });
  for (let i = 6; i < 114; i++) { c.tick(2000 / 108); m.fileDone(i); }
  m.finish();
  assert.ok(seen.length <= 2 + 2000 / 100, `${seen.length} updates`);
  assert.ok(seen.length >= 10, 'but it does move');
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].filesDone > seen[i - 1].filesDone && seen[i].bytesDone > seen[i - 1].bytesDone, 'never goes back');
  assert.equal(seen[0].filesDone, 6);
  assert.equal(seen.at(-1).filesDone, 114);
  assert.equal(seen.at(-1).bytesDone, seen.at(-1).bytesTotal);
});

test('page: the runtime key of a load path matches the runtime\'s (worlds.ts keyOfPath); a save has none', () => {
  assert.equal(wl.worldLoadKey('templates/last-train-zh'), 'templates/last-train-zh');
  assert.equal(wl.worldLoadKey('published/made-1'), 'published/made-1');
  assert.equal(wl.worldLoadKey('worlds/published/made-1/'), 'published/made-1');
  assert.equal(wl.worldLoadKey('worlds/last-train-zh-1'), null);
  assert.equal(wl.worldLoadKey('../templates/x'), null);
});

test('page: phases in order — opening (spinner) → download (bar) → prepare (spinner) → enter (spinner); other worlds\' updates are ignored', () => {
  const path = 'templates/last-train-zh';
  let s = { path, progress: null, entering: false };
  assert.deepEqual(wl.worldLoadPhase(s), { kind: 'opening' });
  assert.equal(wl.withRuntimeProgress(s, { world: 'templates/other', phase: 'prepare' }), s, 'another world');
  s = wl.withRuntimeProgress(s, { world: path, phase: 'download', filesDone: 12, filesTotal: 114, bytesDone: 3.1 * MB, bytesTotal: 8 * MB });
  const d = wl.worldLoadPhase(s);
  assert.equal(d.kind, 'download');
  assert.equal(d.percent, 38);
  s = wl.withRuntimeProgress(s, { world: path, phase: 'prepare' });
  assert.deepEqual(wl.worldLoadPhase(s), { kind: 'prepare' });
  assert.equal(wl.withRuntimeProgress(s, { world: path, phase: 'download', filesDone: 114, filesTotal: 114, bytesDone: 8 * MB, bytesTotal: 8 * MB }), s, 'a late download update never takes it back');
  assert.deepEqual(wl.worldLoadPhase({ ...s, entering: true }), { kind: 'enter' });
  assert.deepEqual(wl.worldLoadPhase(null), { kind: 'opening' });
});

test('page: the bar reaches 100 only with every file in; bad numbers are clamped', () => {
  const at = (p) => wl.worldLoadPhase({ path: 'templates/w', entering: false, progress: { world: 'templates/w', phase: 'download', ...p } });
  assert.equal(at({ filesDone: 113, filesTotal: 114, bytesDone: 8 * MB - 1, bytesTotal: 8 * MB }).percent, 99);
  assert.equal(at({ filesDone: 114, filesTotal: 114, bytesDone: 8 * MB, bytesTotal: 8 * MB }).percent, 100);
  assert.equal(at({ filesDone: 0, filesTotal: 4, bytesDone: 0, bytesTotal: 0 }).percent, 0, 'empty files go by count');
  assert.equal(at({ filesDone: 2, filesTotal: 4, bytesDone: 0, bytesTotal: 0 }).percent, 50);
  const wild = at({ filesDone: 9, filesTotal: 4, bytesDone: -5, bytesTotal: 10 });
  assert.equal(wild.filesDone, 4);
  assert.equal(wild.bytesDone, 0);
  assert.equal(wild.percent, 100);
});

test('page: the label 「已下载 x / N · y / Y MB」 in all four languages', () => {
  const phase = wl.worldLoadPhase({ path: 'templates/w', entering: false, progress: { world: 'templates/w', phase: 'download', filesDone: 12, filesTotal: 114, bytesDone: 3.1 * MB, bytesTotal: 8 * MB } });
  const label = (locale) => wl.downloadLabel(phase, (k, v) => translate(locale, k, v));
  assert.equal(label('zh-CN'), '已下载 12 / 114 · 3.1 / 8.0 MB');
  assert.equal(label('en'), 'Downloaded 12 / 114 · 3.1 / 8.0 MB');
  assert.match(label('ja'), /^ダウンロード済み 12 \/ 114 · 3\.1 \/ 8\.0 MB$/);
  assert.match(label('ko'), /12 \/ 114 · 3\.1 \/ 8\.0 MB$/);
  assert.equal(wl.formatMegabytes(0), '0.0');
  assert.equal(wl.formatMegabytes(2000), '0.1', 'a started download never reads 0.0');
  for (const locale of ['zh-CN', 'ja', 'ko', 'en']) {
    for (const kind of ['opening', 'download', 'prepare', 'enter']) {
      const text = wl.phaseHeadline({ kind }, (k, v) => translate(locale, k, v));
      assert.ok(text && !/\{\w+\}/.test(text), `${locale} ${kind}: ${text}`);
      if (locale !== 'en') assert.ok(/[^\x00-\x7f]/.test(text), `${locale} ${kind} is translated: ${text}`);
    }
  }
  assert.equal(wl.phaseHeadline({ kind: 'prepare' }, (k, v) => translate('zh-CN', k, v)), '正在准备存档…');
});

test('page store: a new open replaces the last; updates for it land; an old open\'s end leaves a newer one alone', () => {
  const s = wl.worldLoadStore;
  let calls = 0;
  const off = s.subscribe(() => { calls++; });
  s.begin('templates/a');
  s.runtime({ world: 'templates/a', phase: 'download', filesDone: 1, filesTotal: 2, bytesDone: 1, bytesTotal: 2 });
  assert.equal(s.get().progress.filesDone, 1);
  s.begin('templates/b');
  assert.equal(s.get().progress, null);
  s.runtime({ world: 'templates/a', phase: 'prepare' });
  assert.equal(s.get().progress, null, 'the left-behind open does not move the bar');
  s.end('templates/a');
  assert.equal(s.get().path, 'templates/b');
  s.entering('templates/b');
  assert.equal(s.get().entering, true);
  s.end('templates/b');
  assert.equal(s.get(), null);
  off();
  assert.ok(calls >= 5);
});

test('source: the Worker posts world-progress, the page relays it, App drives the indicator, the markup is accessible', async () => {
  const worker = await src('../../browser-runtime/src/worker.ts');
  assert.match(worker, /library\.onProgress = \(progress\) => post\(\{ type: 'world-progress', progress \}\)/);
  const worlds = await src('../../browser-runtime/src/worlds.ts');
  const materialise = worlds.slice(worlds.indexOf('private async materialise'), worlds.indexOf('intercept('));
  assert.match(materialise, /createLoadProgress\(key, bundle\.files\.map/, 'metered over the whole bundle (what is downloaded is unchanged)');
  assert.match(materialise, /meter\.fileDone\(i\)/);
  assert.match(materialise, /meter\.finish\(\)/);
  const prefetch = worlds.slice(worlds.indexOf('async prefetch('), worlds.indexOf('ensure(key'));
  assert.doesNotMatch(prefetch, /onProgress|createLoadProgress/, 'a card prefetch is not an open');
  assert.match(worlds, /this\.onProgress\(\{ world: key, phase: 'prepare' \}\)/);
  const mode = await src('../src/lib/browser-mode.ts');
  assert.match(mode, /m\.type === 'world-progress'\) \{ worldLoadStore\.runtime\(m\.progress\); return; \}/);
  const app = await src('../src/App.tsx');
  assert.match(app, /setLoadingWorld\(worldPath\);\n\s*worldLoadStore\.begin\(worldPath\);/);
  assert.match(app, /worldLoadStore\.entering\(worldPath\);/);
  assert.match(app, /setLoadingWorld\(null\); worldLoadStore\.end\(worldPath\);/);
  assert.match(app, /\{loadingWorld && <WorldLoading \/>\}/);
  assert.doesNotMatch(app, /prototype-world-loading/, 'the old full-screen 「 · 正在打开……」 is gone');
  const view = await src('../src/components/chrome/WorldLoading.tsx');
  for (const s of ['role="progressbar"', 'aria-valuenow={phase.percent}', 'aria-valuemin={0}', 'aria-valuemax={100}', 'aria-valuetext=', 'aria-live="polite"', 'aria-busy="true"']) assert.ok(view.includes(s), s);
  const css = await src('../src/components/chrome/world-loading.css');
  assert.match(css, /z-index: var\(--depth-world-loading\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.world-loading__spinner \{ animation: none; \}/);
  assert.match(css, /width: min\(360px, 100%\)/, 'fits a phone');
  assert.match(css, /var\(--ux-glass-panel\)/, 'the launcher glass');
  assert.match(await src('../src/index.css'), /--depth-world-loading: calc\(var\(--depth-ui\) \+ \d+\);/);
});
