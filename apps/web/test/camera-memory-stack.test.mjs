import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const { createCameraMemoryStack, cameraSlot } = await jiti.import('../src/lib/camera.ts');

function fakeCamera() {
  const memory = new Map();
  let target = { x: 10, y: 20, z: 0.9 };
  return {
    save(name) { memory.set(name, { ...target }); },
    restore(name) { target = { ...(memory.get(name) ?? { x: 960, y: 540, z: 0.95 }) }; },
    getTarget() { return { ...target }; },
    setTarget(next) { target = { ...next }; },
  };
}

test('camera memory stack restores a layer caller after a nook transition', () => {
  const camera = fakeCamera();
  const layer = { projection: 'layer', identity: 'map', slot: 'layer:map' };
  const nook = { projection: 'nook', identity: 'nanami', slot: 'nook:nanami' };
  const stack = createCameraMemoryStack(camera, layer);

  camera.setTarget({ x: 321, y: 222, z: 1.1 });
  stack.pushTransition(nook);
  camera.setTarget({ x: 77, y: 88, z: 0.7 });
  const frame = stack.popTransition(layer);
  assert.ok(frame);
  stack.restoreProjection(frame);
  assert.deepEqual(camera.getTarget(), { x: 321, y: 222, z: 1.1 });
  assert.deepEqual(stack.current(), layer);
});

test('camera memory stack preserves nested dialogue caller and rejects wrong pop', () => {
  const camera = fakeCamera();
  const layer = { projection: 'layer', identity: 'map', slot: 'layer:map' };
  const nook = { projection: 'nook', identity: 'sumi', slot: 'nook:sumi' };
  const dialogue = { projection: 'dialogue', identity: 'sumi', slot: 'dialogue:sumi:nook:sumi' };
  const stack = createCameraMemoryStack(camera, layer);

  camera.setTarget({ x: 100, y: 200, z: 0.8 });
  stack.pushTransition(nook);
  camera.setTarget({ x: 400, y: 500, z: 1.3 });
  stack.pushTransition(dialogue);
  assert.equal(stack.popTransition(layer), null);
  const dialogueFrame = stack.popTransition(nook);
  assert.ok(dialogueFrame);
  stack.restoreProjection(dialogueFrame);
  assert.deepEqual(camera.getTarget(), { x: 400, y: 500, z: 1.3 });
});

test('camera slots match Canvas layer keys and clear prior-world memory', () => {
  assert.equal(cameraSlot('layer', 'map'), 'map');
  assert.equal(cameraSlot('nook', 'nanami'), 'characters/nanami');
  assert.equal(cameraSlot('dialogue', 'nanami', 'characters/nanami'), 'dialogue:nanami:characters/nanami');

  const camera = fakeCamera();
  const stack = createCameraMemoryStack(camera, { projection: 'layer', identity: 'map', slot: 'map' });
  camera.setTarget({ x: 321, y: 222, z: 1.1 });
  stack.pushTransition({ projection: 'nook', identity: 'nanami', slot: 'characters/nanami' });
  stack.clear();
  camera.restore('map');
  assert.deepEqual(camera.getTarget(), { x: 960, y: 540, z: 0.95 });
});
