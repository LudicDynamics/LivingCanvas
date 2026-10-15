/**
 * R0 acceptance: the protocol anchor module.
 *
 * These five checks are the R0 half of the B6 batch. They are deliberately
 * narrow: closeKind's full value domain, the WS_COMMANDS/implementation
 * equality (the "constant must not be a lie" scan), the banned state-namespace
 * names, the module's zero-Node-dependency invariant, and the version literal.
 *
 * The non-nullity experiment for closeKind lives below as a comment: flipping
 * the default branch to 'session' must make test 1 red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  closeKind, WS_COMMANDS, GATEWAY_EVENTS, PROTOCOL_VERSION,
  REPLAY_FRAME_ALLOWLIST, REPLAY_BUFFER_KEEP, REPLAY_TURNS,
} from '@airp/shared';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');


test('R0-1: closeKind covers the whole value domain', () => {
  assert.equal(closeKind(4400), 'protocol');
  assert.equal(closeKind(4401), 'auth');
  assert.equal(closeKind(4404), 'session');
  assert.equal(closeKind(1001), 'session');
  // Not ours → null (deliberate "network blip, retry allowed" verdict).
  for (const code of [undefined, null, 0, 1005, 1006, 9999, -1]) {
    assert.equal(closeKind(code), null, `closeKind(${String(code)}) must be null`);
  }
});

test('R0-2: WS_COMMANDS equals the real dispatch branches in index.ts', () => {
  const src = readFileSync(join(REPO, 'apps/server/src/index.ts'), 'utf8');
  const found = new Set();
  for (const m of src.matchAll(/data\.type === '([a-z_]+)'/g)) found.add(m[1]);
  // `writer_abort` and `abort` share one branch, so the source yields both
  // literals; compare as sets, order-independent.
  assert.deepEqual([...WS_COMMANDS].sort(), [...found].sort(),
    'WS_COMMANDS must be exactly the set of data.type literals in index.ts');
});

test('R0-3: WS_COMMANDS never carries a state namespace', () => {
  const banned = ['get_state', 'set_state', 'state_update', 'watch_state'];
  for (const name of banned) {
    assert.ok(!WS_COMMANDS.includes(name), `${name} is banned by AGENTS.md §2`);
  }
});

test('R0-4: the protocol module has no Node or ws dependency', () => {
  const src = readFileSync(join(REPO, 'packages/shared/src/protocol/ws.ts'), 'utf8');
  assert.doesNotMatch(src, /from ['"]node:/);
  assert.doesNotMatch(src, /from ['"]ws['"]/);
});

test('R0-5: protocol version and replay constants are frozen literals', () => {
  assert.equal(PROTOCOL_VERSION, '1');
  assert.deepEqual([...GATEWAY_EVENTS], ['replay_done']);
  assert.deepEqual([...REPLAY_FRAME_ALLOWLIST],
    ['chalk_writing', 'chalk_landed', 'card_writing', 'writer_message', 'writer_idle']);
  assert.equal(REPLAY_BUFFER_KEEP, 4000);
  assert.equal(REPLAY_TURNS, 5);
  // No `*_delta`, no ritual frame, no meta frame may sneak into the ring.
  for (const f of REPLAY_FRAME_ALLOWLIST) {
    assert.ok(!f.endsWith('_delta'), `${f} must not be a delta frame (decision D)`);
  }
  assert.ok(!REPLAY_FRAME_ALLOWLIST.includes('dice_result'));
  assert.ok(!REPLAY_FRAME_ALLOWLIST.includes('show_frame'));
  assert.ok(!REPLAY_FRAME_ALLOWLIST.includes('world_event'));
  assert.ok(!REPLAY_FRAME_ALLOWLIST.includes('error'));
});
