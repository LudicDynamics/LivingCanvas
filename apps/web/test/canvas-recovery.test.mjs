import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { createCameraDrivers } = await jiti.import('../src/lib/camera-drivers.ts');
const { createFootprintScheduler } = await jiti.import('../src/lib/footprint.ts');
const { seatSpiral, SEAT_ANCHOR } = await jiti.import('../src/lib/seat.ts');
const { makeBox, overlap } = await jiti.import('../src/lib/collide.ts');
const { fitPhantom } = await jiti.import('../src/lib/phantom-seat.ts');

test('a crowded phantom search falls outside occupied bounds, never back to centre', () => {
  const occupied = [makeBox(-10000, -10000, 20000, 20000)];
  const seat = seatSpiral(SEAT_ANCHOR, occupied, 460, 800);
  assert.equal(overlap(makeBox(seat.x, seat.y, 460, 800), occupied[0]), false);
});

test('full-height draft moves only itself away from a real card', () => {
  const card = { offsetLeft: 730, offsetTop: 445, offsetWidth: 460, offsetHeight: 500 };
  const el = { offsetLeft: 730, offsetTop: 445, offsetWidth: 460, offsetHeight: 900, style: {} };
  el.parentElement = { querySelectorAll: () => [card, el] };
  fitPhantom(el);
  assert.equal(overlap(makeBox(parseFloat(el.style.left), parseFloat(el.style.top), 460, 900), makeBox(730, 445, 460, 500)), false);
  assert.equal(card.offsetLeft, 730);
  assert.equal(card.offsetTop, 445);
});

test('closing a secondary canvas restores the main camera driver', () => {
  const registry = createCameraDrivers();
  const calls = [];
  const main = () => calls.push('main');
  const nook = () => calls.push('nook');
  const closeMain = registry.register(main);
  const closeNook = registry.register(nook);
  assert.equal(registry.isActive(main), false);
  registry.wake();
  closeNook();
  assert.equal(registry.isActive(main), true);
  registry.wake();
  assert.deepEqual(calls, ['main', 'nook', 'nook', 'main', 'main']);
  closeMain();
  registry.wake();
  assert.equal(calls.length, 5);
});

test('out-of-order cleanup does not discard the foreground driver', () => {
  const registry = createCameraDrivers();
  const main = () => {};
  const nook = () => {};
  const closeMain = registry.register(main);
  const closeNook = registry.register(nook);
  closeMain();
  closeMain();
  assert.equal(registry.isActive(nook), true);
  closeNook();
  assert.equal(registry.isActive(nook), false);
});

test('an omitted hovered card does not starve a new chalk; retry it after hover ends', async () => {
  const sent = [];
  let heights = new Map([['chalk', 600]]);
  let tick;
  const scheduler = createFootprintScheduler({
    layer: () => 'world/test',
    widths: () => new Map([['old', 460], ['chalk', 460]]),
    measure: () => heights,
    post: async (_layer, boxes) => { sent.push(boxes); return { updated: 1, unchanged: 0 }; },
    isBusy: () => false, isDragging: () => false, isHidden: () => false,
    setTimeout: callback => { tick = callback; return 1; }, clearTimeout: () => {},
  });
  scheduler.notify(); tick();
  await Promise.resolve();
  assert.deepEqual(sent[0], [{ path: 'chalk', w: 460, h: 600 }]);
  heights = new Map([['old', 200], ['chalk', 600]]);
  tick(); await Promise.resolve();
  assert.equal(sent[1].length, 2);
  scheduler.dispose();
});

test('the default footprint gate waits until every hovered card leaves', async () => {
  const sent = [];
  let tick;
  const priorDocument = globalThis.document;
  globalThis.document = { querySelector: () => ({}) };
  const scheduler = createFootprintScheduler({
    layer: () => 'world/test',
    widths: () => new Map([['card', 200]]),
    measure: () => new Map([['card', 210]]),
    post: async (_layer, boxes) => { sent.push(boxes); return { updated: 1, unchanged: 0 }; },
    isBusy: () => false,
    isDragging: () => false,
    setTimeout: callback => { tick = callback; return 1; },
    clearTimeout: () => {},
  });
  try {
    scheduler.notify();
    tick();
    await Promise.resolve();
    assert.equal(sent.length, 0);
    globalThis.document = { querySelector: () => null };
    tick();
    await Promise.resolve();
    assert.equal(sent.length, 1);
  } finally {
    scheduler.dispose();
    globalThis.document = priorDocument;
  }
});
