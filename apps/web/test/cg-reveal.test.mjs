// The CG reveal on the page: which world events
// open it, the queue, how it plays under reduced motion / performance settings,
// where it sits in the depth registry, and the wiring from useWorld and App.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const {
  CG_SHOWN_DOM, CG_FRESH_MS, CG_QUEUE_MAX, CG_FADE_MS, CG_FADE_MS_LIGHT,
  cgOf, cgReplayDetail, enqueueCg, cgPresentation,
} = await jiti.import('../src/lib/cg-reveal.ts');

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const NOW = Date.parse('2026-09-27T12:00:00.000Z');
const ev = (over = {}) => ({
  id: 'evt-9', type: 'cg_shown', createdAt: '2026-09-27T11:59:50.000Z',
  detail: { path: 'assets/cg/fire.webp', caption: ' 客栈起火了。 ', first: true }, ...over,
});

test('a fresh cg_shown event becomes an item; stale, foreign or malformed ones do not', () => {
  assert.deepEqual(cgOf(ev(), NOW), { id: 'evt-9', path: 'assets/cg/fire.webp', caption: '客栈起火了。' });
  assert.equal(cgOf(ev({ createdAt: new Date(NOW - CG_FRESH_MS - 1).toISOString() }), NOW), null, 'replayed on reconnect');
  assert.equal(cgOf(ev({ type: 'story_event' }), NOW), null);
  assert.equal(cgOf(ev({ detail: { caption: 'x' } }), NOW), null);
  assert.equal(cgOf(null, NOW), null);
  assert.equal(cgOf(ev({ detail: { path: 'assets/cg/a.webp', caption: '  ' } }), NOW).caption, null);
});

test('a gallery replay is always shown, keyed by its picture', () => {
  const item = cgOf(cgReplayDetail('assets/cg/dawn.png', '黎明'), NOW + 10 * CG_FRESH_MS);
  assert.deepEqual(item, { id: 'replay:assets/cg/dawn.png', path: 'assets/cg/dawn.png', caption: '黎明' });
});

test('the queue drops duplicates (same event or same picture) and keeps the newest few', () => {
  let q = [];
  q = enqueueCg(q, { id: 'a', path: 'p/a', caption: null });
  q = enqueueCg(q, { id: 'a', path: 'p/a', caption: null });
  q = enqueueCg(q, { id: 'replay:p/a', path: 'p/a', caption: null });
  assert.equal(q.length, 1);
  for (let i = 0; i < CG_QUEUE_MAX + 3; i += 1) q = enqueueCg(q, { id: `e${i}`, path: `p/${i}`, caption: null });
  assert.equal(q.length, CG_QUEUE_MAX);
  assert.equal(q.at(-1).id, `e${CG_QUEUE_MAX + 2}`);
});

test('reduced motion never fades; the performance preset keeps it short and unblurred', () => {
  assert.deepEqual(cgPresentation(true, { backdropBlur: 'full' }), { fadeMs: 0, blur: 'full' });
  assert.deepEqual(cgPresentation(false, { backdropBlur: 'full' }), { fadeMs: CG_FADE_MS, blur: 'full' });
  assert.deepEqual(cgPresentation(false, { backdropBlur: 'off' }), { fadeMs: CG_FADE_MS_LIGHT, blur: 'off' });
  assert.deepEqual(cgPresentation(false, { backdropBlur: 'reduced' }), { fadeMs: CG_FADE_MS, blur: 'reduced' });
});

test('wiring: useWorld dispatches cg_shown after the dice gate; App mounts the reveal beside the tutorial; the gallery replays', () => {
  const useWorld = read('../src/state/useWorld.ts');
  assert.match(useWorld, /\['cg_shown'\]\.includes\(ev\.type \?\? ''\)\) deferReveal\(\(\) => \{\s*if \(isFrameCurrent\(\)\) window\.dispatchEvent\(new CustomEvent\('airp:cg-shown'/);
  assert.equal(CG_SHOWN_DOM, 'airp:cg-shown');
  const app = read('../src/App.tsx');
  const reveal = app.indexOf('<CgReveal />');
  const tutorial = app.indexOf('<ForcedTutorial');
  assert.ok(reveal > 0 && reveal < tutorial, 'rendered just before the forced tutorial, in the same parent');
  const closed = read('../src/components/chrome/ClosedRun.tsx');
  assert.match(closed, /cgReplayDetail\(cg\.path, cg\.caption\)/);
  const component = read('../src/components/chrome/CgReveal.tsx');
  assert.match(component, /e\.key === 'Escape'/);
  assert.match(component, /useStill\(\)/);
  assert.match(component, /usePerformanceSettings\(\)/);
});

test('depth: --depth-cg-reveal is registered above ui and below the forced tutorial', () => {
  const css = read('../src/index.css');
  assert.match(css, /--depth-cg-reveal: calc\(var\(--depth-ui\) \+ 20\);/);
  assert.match(css, /--depth-chrome-tutorial: calc\(var\(--depth-ui\) \+ 30\);/);
  assert.match(read('../src/components/chrome/cg-reveal.css'), /z-index: var\(--depth-cg-reveal\);/);
  const contract = JSON.parse(read('../../../tools/ux-contract.json'));
  assert.ok(contract.depth.some((r) => r.id === 'depth.cg-reveal' && r.owner === 'CgReveal'));
});

test('i18n: the reveal and gallery strings exist in zh-CN and ja', () => {
  const messages = JSON.parse(read('../src/lib/messages.json'));
  for (const key of ['Scene', 'Continue', 'Next', 'Close', 'This picture could not be loaded.', 'Scenes seen {n}']) {
    assert.ok(messages[key]?.['zh-CN'] && messages[key]?.ja, key);
  }
});
