// The reveal gate. Module state only — no DOM, no React.
//
// What this proves: a refetch that arrives while a ceremony plays is held and
// released exactly once; several arrivals collapse into the last; the release is
// idempotent; and the watchdog opens the gate even when nothing ever reports
// done — because a permanently frozen canvas is worse than an early reveal.
//
// Run: node --test apps/web/test/reveal-gate.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

let gate = null;
let ceremony = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
    // Cache ON: `reveal-gate.ts` imports `dice-ceremony.ts`, and both this test and
  // the gate must share ONE module instance or the gate reads a different
  // ceremony store than the test writes to.
  const jiti = createJiti(import.meta.url);
  gate = await jiti.import('../src/lib/reveal-gate.ts');
  // ONE jiti instance with its module cache ON: `reveal-gate.ts` imports
  // `dice-ceremony.js`, so a second, uncached instance would give the test a
  // different ceremony store than the gate reads — and the gate would look
  // permanently empty.
  ceremony = await jiti.import('../src/lib/dice-ceremony.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping reveal-gate group:', err?.message ?? err);
}
const skip = gate && ceremony ? false : 'jiti or pi-rp submodule unavailable';

/** The ceremony budget the watchdog must cover: ROLL_MS + SETTLE_MS + slack. */
const CLEAN = () => {
  gate.resetRevealGateForTest();
  ceremony.resetSeenForTest();
};
const DETAILS = {
  path: 'world/london-map/04-investigation-dice.md',
  name: 'Investigation',
  dice: '1d100',
  desc: 'Spot the clue',
  expect: '13..60',
  result: 42,
  passed: true,
  rolls: [42],
  crit: false,
  fumble: false,
  forged: false,
  layer: 'world/london-map',
};

test('G1 with no ceremony playing a defer runs immediately', { skip }, () => {
  CLEAN();
  let ran = 0;
  gate.deferReveal(() => { ran += 1; });
  assert.equal(ran, 1, 'no ceremony ⇒ nothing to wait for');
  assert.equal(gate.isRevealHeld(), false);
});

test('G2 during a ceremony the defer is held, then released exactly once', { skip }, () => {
  CLEAN();
  assert.ok(ceremony.ingestPlayerRoll(DETAILS, 'k1'));
  let ran = 0;
  gate.deferReveal(() => { ran += 1; });
  assert.equal(ran, 0, 'the ceremony owns the refetch until it ends');
  assert.equal(gate.isRevealHeld(), true);

  gate.releaseReveal();
  assert.equal(ran, 1);
  assert.equal(gate.isRevealHeld(), false);

  gate.releaseReveal();
  gate.releaseReveal();
  assert.equal(ran, 1, 'release is idempotent — a second call must not refetch again');
});

test('G3 later arrivals replace earlier ones: one ceremony, one refetch', { skip }, () => {
  CLEAN();
  assert.ok(ceremony.ingestPlayerRoll(DETAILS, 'k1'));
  const order = [];
  // This is the real shape of the bug: `world_event` (~10-50ms) lands first,
  // `file_changed` (~150ms) second, both before the tumble ends.
  gate.deferReveal(() => order.push('world_event'));
  gate.deferReveal(() => order.push('file_changed'));
  gate.deferReveal(() => order.push('third'));
  assert.deepEqual(order, [], 'nothing runs while held');

  gate.releaseReveal();
  assert.deepEqual(order, ['third'], 'the last closure wins and the rest are dropped');
});

test('G4 release with nothing pending is a no-op, not a crash', { skip }, () => {
  CLEAN();
  gate.releaseReveal();
  gate.releaseReveal();
  assert.equal(gate.isRevealHeld(), false);
  assert.equal(gate.deferReveal(() => {}) === undefined, true);
});

test('G5 the watchdog releases the gate even when no ceremony reports done', { skip }, () => {
  CLEAN();
  assert.ok(ceremony.ingestPlayerRoll(DETAILS, 'k1'));
  let ran = 0;
  gate.deferReveal(() => { ran += 1; });
  // A layer switch ends the ceremony without either teardown running; nothing
  // calls release, so only the watchdog can open the gate. MUST NOT fail closed.
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (ran === 1) {
        clearInterval(poll);
        try {
          assert.equal(gate.isRevealHeld(), false);
          assert.ok(Date.now() - started >= gate.WATCHDOG_MS - 250, 'released no earlier than the watchdog window');
          resolve();
        } catch (err) { reject(err); }
        return;
      }
      if (Date.now() - started > gate.WATCHDOG_MS + 2000) {
        clearInterval(poll);
        reject(new Error('watchdog never released the gate — the canvas would be frozen forever'));
      }
    }, 25);
  });
});

test('G6 a defer after the ceremony ended runs at once (the gate does not latch)', { skip }, () => {
  CLEAN();
  assert.ok(ceremony.ingestPlayerRoll(DETAILS, 'k1'));
  let first = 0;
  let second = 0;
  gate.deferReveal(() => { first += 1; });
  ceremony.clearCeremony();
  gate.releaseReveal();
  assert.equal(first, 1);

  gate.deferReveal(() => { second += 1; });
  assert.equal(second, 1, 'a later refetch is not held by a finished ceremony');
  assert.equal(gate.isRevealHeld(), false);
});

test('G7 the watchdog window covers ROLL_MS + SETTLE_MS from the source', { skip }, async () => {
  // The 3500 is a literal only because those constants live in a .tsx module
  // this one must not import — so pin the inequality to the source of truth.
  const src = await readFile(new URL('../src/components/narrative/DiceRoller.tsx', import.meta.url), 'utf8');
  const roll = Number(/ROLL_MS = (\d[\d_]*)/.exec(src)?.[1]?.replace(/_/g, ''));
  const settle = Number(/SETTLE_MS = (\d[\d_]*)/.exec(src)?.[1]?.replace(/_/g, ''));
  assert.ok(Number.isFinite(roll) && Number.isFinite(settle), 'the ceremony timings must stay readable');
  assert.ok(
    gate.WATCHDOG_MS > roll + settle,
    `WATCHDOG_MS (${gate.WATCHDOG_MS}) must exceed ROLL_MS + SETTLE_MS (${roll + settle})`,
  );
});

test('G8 the gate is the only holder of a refetch: no queue grows', { skip }, () => {
  CLEAN();
  assert.ok(ceremony.ingestPlayerRoll(DETAILS, 'k1'));
  let ran = 0;
  for (let i = 0; i < 25; i += 1) gate.deferReveal(() => { ran += 1; });
  gate.releaseReveal();
  assert.equal(ran, 1, '25 frames collapse into one refetch, not 25 requests');
});
