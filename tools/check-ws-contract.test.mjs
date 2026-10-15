/**
 * tools/check-ws-contract.test.mjs — non-emptiness proof for the WS contract gate.
 *
 * The gate compares three frame-name sets (server emits / browser consumes /
 * the design notes contracts) and reports four drift classes. A gate that
 * can never go red — or never go green — is worse than no gate: it reads as
 * coverage while checking nothing.
 *
 * So each class gets a case here that drives the PURE `compare()` with
 * synthetic maps, proving the detector fires exactly when it should. These are
 * the assertions that make `pnpm check:ws` trustworthy.
 *
 * Run:  node --test tools/check-ws-contract.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compare } from './check-ws-contract.mjs';

/** Build the three maps from plain arrays; line numbers are fake but stable. */
const maps = ({ emitted = [], consumed = [], contract = [] }) => ({
  emitted: new Map(emitted.map((f, i) => [f, { file: 'srv.ts', line: i + 1 }])),
  consumed: new Map(consumed.map((f, i) => [f, { file: 'web.ts', line: i + 1 }])),
  contract: new Map(contract.map((f, i) => [f, i + 1])),
});

const kinds = (findings) => findings.map((f) => f.check);

test('fully aligned sets produce no findings (the gate can go green)', () => {
  const findings = compare(maps({ emitted: ['a', 'b'], consumed: ['a', 'b'], contract: ['a', 'b'] }));
  assert.deepEqual(findings, []);
});

test('GHOST: a listener with no emitter fires (the item_moved bug)', () => {
  // Server emits nothing; the browser listens for `item_moved`. Exactly the
  // real defect this gate was built after.
  const findings = compare(maps({ emitted: [], consumed: ['item_moved'], contract: [] }));
  assert.deepEqual(kinds(findings), ['ghost']);
  assert.match(findings[0].message, /item_moved/);
});

test('DARK: an emitter with no consumer fires (the world_event bug)', () => {
  const findings = compare(maps({ emitted: ['world_event'], consumed: [], contract: ['world_event'] }));
  assert.deepEqual(kinds(findings), ['dark']);
});

test('UNDECLARED: an emitted frame missing from the contract fires', () => {
  // Emitted and consumed, but the contract never names it → the contract has
  // stopped being the truth.
  const findings = compare(maps({ emitted: ['brand_new'], consumed: ['brand_new'], contract: [] }));
  assert.deepEqual(kinds(findings), ['undeclared']);
});

test('MISSING: a contracted frame nobody emits fires', () => {
  const findings = compare(maps({ emitted: [], consumed: [], contract: ['chalk_landed'] }));
  assert.deepEqual(kinds(findings), ['missing']);
});

test('intentionallyUnconsumed suppresses DARK, and only DARK', () => {
  const intentionallyUnconsumed = new Map([['connected', 'handshake marker']]);
  const findings = compare({
    ...maps({ emitted: ['connected'], consumed: [], contract: ['connected'] }),
    intentionallyUnconsumed,
  });
  assert.deepEqual(findings, []);
});

test('the real repo drift is reproducible in the pure function', () => {
  // Mirrors the live defect shape: server emits `world_event`, browser still
  // listens for the deleted `item_moved`, and `world_event` is contracted.
  const findings = compare(
    maps({ emitted: ['world_event'], consumed: ['item_moved'], contract: ['world_event'] })
  );
  assert.deepEqual(kinds(findings).sort(), ['dark', 'ghost']);
});
