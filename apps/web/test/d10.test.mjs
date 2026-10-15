import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const display = await jiti.import('../src/lib/d10-display.ts');
const pose = await jiti.import('../src/lib/d10-pose.ts');
const physics = await jiti.import('../src/lib/d10-physics.ts');
const { Quaternion } = await import('../node_modules/three/build/three.module.js');

test('display maps D10 boundaries without changing supplied values', () => {
  assert.deepEqual(display.d10Display('1d10', [1]).digits, [1]);
  assert.deepEqual(display.d10Display('1d10', [10]).digits, [0]);
  assert.deepEqual(display.d10Display('1d10+5', [10]).digits, [0]);
  assert.equal(display.d10Display('1d10', [0]), null);
  assert.equal(display.d10Display('1d10', [11]), null);
  assert.equal(display.d10Display('2d10', [4]), null);
});

test('percentile display maps 1, 10, 99 and 100 to tens and units', () => {
  assert.deepEqual(display.d10Display('1d100', [1]).digits, [0, 1]);
  assert.deepEqual(display.d10Display('1d100', [10]).digits, [1, 0]);
  assert.deepEqual(display.d10Display('1d100', [99]).digits, [9, 9]);
  assert.deepEqual(display.d10Display('1d100', [100]).digits, [0, 0]);
  assert.equal(display.d10Display('1d100', [101]), null);
  assert.equal(display.d10Display('2d100', [10, 20]), null);
});

test('D6, D10 pair and unsupported dice select the renderer explicitly', () => {
  assert.deepEqual(display.diceStageDisplay('1d6', [6]).digits, [6]);
  assert.deepEqual(display.diceStageDisplay('2d6', [1, 6]).digits, [1, 6]);
  assert.deepEqual(display.diceStageDisplay('2d10', [10, 8]).digits, [0, 8]);
  assert.equal(display.diceStageDisplay('3d6', [1, 2, 3]), null);
  assert.equal(display.diceStageDisplay('1d20', [20]), null);
});

test('each D10 landing pose faces the camera and stays upright', () => {
  for (let digit = 0; digit < 10; digit += 1) {
    const basis = pose.d10FaceBasis(digit);
    const landing = pose.d10Landing(digit);
    basis.normal.applyQuaternion(landing);
    basis.up.applyQuaternion(landing);
    assert.ok(Math.abs(basis.normal.z - 1) < 1e-10, `${digit}: normal`);
    assert.ok(Math.abs(basis.up.y - 1) < 1e-10, `${digit}: up`);
  }
});

test('trajectory cancellation rejects before doing work', async () => {
  await assert.rejects(
    physics.simulateD10Throw([0], 42, () => true),
    /Throw cancelled/,
  );
});

test('D6 and D10 trajectories finish on supplied authoritative faces', async () => {
  for (const [faces, values] of [[6, [1, 6]], [10, [0, 8]]]) {
    let frames;
    for (let seed = 1; seed <= 5 && !frames; seed += 1) {
      try {
        frames = await physics.simulateD10Throw(values, seed, () => false, faces);
      } catch {
        // A physically invalid edge landing is a renderer fallback, not a new roll.
      }
    }
    assert.ok(frames?.length > 10);
    const read = faces === 6 ? physics.readD6Top : physics.readTopFace;
    assert.deepEqual(frames.at(-1).map((item) => read(new Quaternion(...item.rotation))), values);
  }
});
