import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';
const jiti = createJiti(import.meta.url);
const { diceStageDisplay } = await jiti.import('../src/lib/d10-display.ts');
const { simulateD10Throw, readD6Top, readTopFace } = await jiti.import('../src/lib/d10-physics.ts');
const { Quaternion } = await jiti.import('../node_modules/three/build/three.module.js');
test('two D10 are ordinary dice, not percentile digits', () => {
  const d = diceStageDisplay('2d10', [10, 8]);
  assert.deepEqual(d.digits, [0, 8]); assert.equal(d.percentile, false); assert.equal(d.reading, '10 + 8');
  assert.equal(diceStageDisplay('2d10', [11, 3]), null);
  assert.deepEqual(diceStageDisplay('2d6', [1, 6]).digits, [1, 6]);
});
for (const [faces, values] of [[6, [1, 6]], [10, [0, 8]]]) test(`D${faces} physics finishes on the supplied faces`, async () => {
  let frames;
  for (let seed = 1; seed <= 5; seed++) { try { frames = await simulateD10Throw(values, seed, () => false, faces); break; } catch {} }
  assert.ok(frames?.length > 10);
  const read = faces === 6 ? readD6Top : readTopFace;
  assert.deepEqual(frames.at(-1).map(p => read(new Quaternion(...p.rotation))), values);
});
