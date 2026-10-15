// dice-ceremony boundary guards, layer filter, dedup and store contract
//. Pure functions only — no DOM, no React.
// Run: node --test apps/web/test/dice-ceremony.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

// jiti lets us import the TS source directly. apps/web/test/ → repo root is 3 up.
let mod = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/dice-ceremony.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping dice-ceremony group:', err?.message ?? err);
}

const skip = mod ? false : 'jiti or pi-rp submodule unavailable';

/** A complete, well-formed frame (2d6 → two faces, sum 11). */
const FRAME = {
  type: 'dice_result',
  source: 'writer',
  path: 'world/baker-street/evening.md',
  name: 'Evening Check',
  dice: '2d6+3',
  desc: 'Perception',
  expect: '>10',
  result: 14,
  passed: true,
  rolls: [5, 6],
  crit: true,
  fumble: false,
  layer: 'world/baker-street',
  timestamp: '2026-09-13T00:00:00.000Z',
};

test('D1 parseDiceFrame keeps the per-die rolls verbatim', { skip }, () => {
  const v = mod.parseDiceFrame(FRAME);
  assert.ok(v);
  assert.deepEqual(v.rolls, [5, 6]);
  assert.equal(v.result, 14);
  assert.equal(v.crit, true);
  assert.equal(v.layer, 'world/baker-street');
});

test('D2 rolls as a string is rejected (non-emptiness)', { skip }, () => {
  // Without the Array.isArray guard, "[62]" would flow into .map() and render
  // three character tiles (or throw).
  assert.equal(mod.parseDiceFrame({ ...FRAME, rolls: '[62]' }), null);
});

test('D3 rolls containing a non-number is rejected', { skip }, () => {
  assert.equal(mod.parseDiceFrame({ ...FRAME, rolls: [1, '2'] }), null);
});

test('D4 an empty rolls array is rejected', { skip }, () => {
  // A ceremony with zero dice has nothing to show; never fall back to [result].
  assert.equal(mod.parseDiceFrame({ ...FRAME, rolls: [] }), null);
});

test('D5 passed must be a real boolean', { skip }, () => {
  assert.equal(mod.parseDiceFrame({ ...FRAME, passed: 'true' }), null);
});

test('D6 missing crit/fumble settle to false — no 95/5 heuristic', { skip }, () => {
  const { crit, fumble, ...rest } = FRAME;
  const v = mod.parseDiceFrame(rest);
  assert.ok(v);
  assert.equal(v.crit, false);
  assert.equal(v.fumble, false);
});

test('D7 missing copy fields fall back to empty strings, never drop the frame', { skip }, () => {
  const v = mod.parseDiceFrame({ source: 'writer', path: 'a.md', result: 3, passed: false, rolls: [3] });
  assert.ok(v);
  assert.equal(v.desc, '');
  assert.equal(v.expect, '');
  assert.equal(v.dice, '');
  assert.equal(v.name, '');
});

test('D8 missing layer means no filter', { skip }, () => {
  const v = mod.parseDiceFrame({ source: 'writer', path: 'a.md', result: 3, passed: false, rolls: [3] });
  assert.ok(v);
  assert.equal(v.layer, null);
  assert.equal(mod.shouldPlayFrame(v, 'world/a'), true);
});

test('D9 a frame for another layer is filtered out', { skip }, () => {
  const v = mod.parseDiceFrame({ ...FRAME, path: 'other.md', layer: 'world/b' });
  assert.ok(v);
  assert.equal(mod.shouldPlayFrame(v, 'world/a'), false);
});

test('D10 layer:null (backpack / nook) plays on every layer', { skip }, () => {
  const v = mod.parseDiceFrame({ ...FRAME, path: 'null-layer.md', layer: null });
  assert.ok(v);
  assert.equal(v.layer, null);
  assert.equal(mod.shouldPlayFrame(v, 'world/a'), true);
});

test('D11 the same path does not replay inside the dedup window', { skip }, () => {
  mod.resetSeenForTest();
  const v = mod.parseDiceFrame(FRAME);
  assert.ok(v);
  assert.equal(mod.shouldPlayFrame(v, 'world/baker-street'), true);
  mod.markPlayed(v.path);
  assert.equal(mod.shouldPlayFrame(v, 'world/baker-street'), false);
});

test('D12 different paths both play', { skip }, () => {
  mod.resetSeenForTest();
  const a = mod.parseDiceFrame({ ...FRAME, path: 'a.md' });
  const b = mod.parseDiceFrame({ ...FRAME, path: 'b.md' });
  assert.ok(a && b);
  mod.markPlayed(a.path);
  assert.equal(mod.shouldPlayFrame(a, 'world/baker-street'), false);
  assert.equal(mod.shouldPlayFrame(b, 'world/baker-street'), true);
});

test('D13 the dedup window is FIFO-capped (51 paths evict the oldest)', { skip }, () => {
  mod.resetSeenForTest();
  for (let i = 0; i < 51; i++) mod.markPlayed(`p${i}.md`);
  const first = mod.parseDiceFrame({ ...FRAME, path: 'p0.md' });
  assert.ok(first);
  assert.equal(mod.shouldPlayFrame(first, 'world/baker-street'), true); // evicted → free to play
});

test('D14 a re-played path refreshes the window instead of growing the map', { skip }, () => {
  mod.resetSeenForTest();
  mod.markPlayed('a.md', 0);
  for (let i = 0; i < 50; i++) mod.markPlayed(`q${i}.md`, 0);
  // 'a.md' was evicted by the cap; re-registering it must not resurrect a
  // duplicate key (Map size stays bounded).
  mod.markPlayed('a.md', 0);
  assert.equal(mod.shouldPlayFrame({ ...FRAME, path: 'a.md' }, 'x', 0), false);
});

test('D15 getCeremonySnapshot is reference-stable with no change', { skip }, () => {
  const a = mod.getCeremonySnapshot();
  const b = mod.getCeremonySnapshot();
  assert.equal(a, b); // useSyncExternalStore requires Object.is stability
  assert.equal(a, null);
});

test('D16 playCeremony swaps the snapshot and bumps the key', { skip }, () => {
  const v = mod.parseDiceFrame(FRAME);
  assert.ok(v);
  mod.playCeremony(v);
  const first = mod.getCeremonySnapshot();
  assert.equal(first.verdict, v);
  mod.playCeremony(v);
  const second = mod.getCeremonySnapshot();
  assert.notEqual(second, first); // new reference → React re-reads
  assert.equal(second.key, first.key + 1); // remount → animations restart
  mod.clearCeremony();
  assert.equal(mod.getCeremonySnapshot(), null);
});

test('D17 rollingFace is deterministic and in range', { skip }, () => {
  // d6 face values cycle 1..6; 1d100 faces cycle 1..100.
  for (let i = 0; i < 5; i++) {
    for (let t = 0; t < 7; t++) {
      const six = mod.rollingFace(i, t, 4);
      assert.ok(six >= 1 && six <= 6);
      const hundred = mod.rollingFace(i, t, 62);
      assert.ok(hundred >= 1 && hundred <= 100);
    }
  }
  assert.equal(mod.rollingFace(0, 0, 4), mod.rollingFace(0, 0, 4));
});


const DETAILS = {
  path: 'world/baker-street/evening.md',
  name: 'Evening Check',
  dice: '2d6+3',
  desc: 'Perception',
  expect: '>10',
  result: 14,
  passed: true,
  rolls: [5, 6],
  crit: true,
  fumble: false,
  forged: false,
  layer: 'world/baker-street',
};

test('D18 canonical allocator deduplicates without advancing sourceSeq', { skip }, () => {
  mod.resetSeenForTest();
  const first = mod.allocate('canonical:one');
  const duplicate = mod.allocate('canonical:one');
  const next = mod.allocate('canonical:two');
  assert.equal(first.isDuplicate, false);
  assert.equal(duplicate.isDuplicate, true);
  assert.equal(duplicate.sourceSeq, first.sourceSeq);
  assert.equal(next.sourceSeq, first.sourceSeq + 1);
});

test('D19 each source and character identity gets a distinct fingerprint', { skip }, () => {
  mod.resetSeenForTest();
  const writer = mod.parseDiceFrame({ ...FRAME, source: 'writer' });
  const character = mod.parseDiceFrame({ ...FRAME, source: 'character', characterId: 'char-1' });
  assert.ok(writer && character);
  const writerInput = mod.toDiceCeremonyInput(writer, 'writer-frame');
  const characterInput = mod.toDiceCeremonyInput(character, 'character-frame');
  assert.ok(writerInput && characterInput);
  assert.notEqual(writerInput.fingerprint, characterInput.fingerprint);
  assert.notEqual(writerInput.sourceSeq, characterInput.sourceSeq);
  assert.equal(mod.toDiceCeremonyInput({ ...FRAME, source: 'character' }, 'character-frame'), null);
});

test('D20 incomplete frame never becomes a ceremony input', { skip }, () => {
  const incomplete = mod.parseDiceFrame({ ...FRAME, desc: undefined });
  assert.ok(incomplete);
  assert.equal(mod.toDiceCeremonyInput(incomplete, 'writer-frame'), null);
  assert.equal(mod.parseRollDiceDetails({ ...DETAILS, expect: undefined }), null);
});

test('D21 HTTP 2xx with domain failure is not authoritative', { skip }, () => {
  assert.equal(
    mod.parsePlayerDiceResponse({ ok: true, code: 'conflict', error: 'already rolled' }, true),
    null,
  );
  assert.ok(mod.parsePlayerDiceResponse({ ok: true, details: DETAILS }, true));
  assert.equal(mod.parsePlayerDiceResponse({ ok: true, details: { code: 'conflict' } }, true), null);
  assert.equal(mod.parsePlayerDiceResponse({ ok: false, ...DETAILS }, true), null);
  assert.ok(mod.parsePlayerDiceResponse({ ok: true, ...DETAILS }, true));
});

test('D22 player details enter the same single ceremony and replay once only', { skip }, () => {
  mod.resetSeenForTest();
  const first = mod.ingestPlayerRoll(DETAILS, 'action-key-1');
  assert.ok(first);
  assert.equal(first.source, 'player-http');
  assert.equal(first.sourceId, 'action-key-1');
  assert.equal(mod.getCeremonySnapshot().input, first);
  assert.equal(mod.ingestPlayerRoll(DETAILS, 'action-key-1'), null);
});

test('D23 frame source is mandatory and character frames require identity', { skip }, () => {
  assert.equal(mod.parseDiceFrame({ ...FRAME, source: undefined }), null);
  assert.equal(mod.parseDiceFrame({ ...FRAME, source: 'character', characterId: undefined }), null);
  assert.equal(mod.parseDiceFrame({ ...FRAME, source: 'character', characterId: '' }), null);
  assert.ok(mod.parseDiceFrame({ ...FRAME, source: 'character', characterId: 'char-1' }));
});