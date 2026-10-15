/**
 * Frontend contract for the gateway batch.
 *
 * These are SOURCE assertions, matching the convention of
 * `use-world-writer.test.mjs`: `useWorld.ts` is a hook with a socket effect, and
 * the things that matter here are structural guarantees that a behavioural unit
 * test cannot reach without a browser. Each assertion names the failure it
 * prevents. The mechanical acceptance for the server half lives in
 * `apps/server/test/gateway-replay.test.mjs` and `gateway-stt-upgrade.test.mjs`.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const useWorld = await readFile(new URL('../src/state/useWorld.ts', import.meta.url), 'utf8');
const gateway = await readFile(new URL('../src/lib/airp-gateway.ts', import.meta.url), 'utf8');

test('the socket carries the protocol version (03 §3.1)', () => {
  // Without `?v=`, the server closes the connection with 4400 and the app is dead
  // on arrival. This is the client half of the version gate.
  assert.match(gateway, /\/ws\?v=\$\{PROTOCOL_VERSION\}/,
    'the /ws URL must carry ?v=${PROTOCOL_VERSION}');
});

test('replaying is armed on open and cleared by replay_done (02 §6.2)', () => {
  // Armed in onopen…
  const onopen = useWorld.match(/ws\.onopen = \(\) => \{[\s\S]*?\n      \};/)?.[0] ?? '';
  assert.match(onopen, /replayingRef\.current = true/, 'onopen must set replayingRef');
  assert.match(onopen, /setReplaying\(true\)/, 'onopen must set the replaying state');

  // …and cleared by the boundary frame.
  const replayCase = useWorld.match(/case 'replay_done':[\s\S]*?break;/)?.[0] ?? '';
  assert.match(replayCase, /replayingRef\.current = false/, 'replay_done must clear replayingRef');
  assert.match(replayCase, /setReplaying\(false\)/, 'replay_done must clear the replaying state');
});

test('writer input is held while catching up (02 §6.2)', () => {
  // A prompt submitted mid-replay interleaves with historical frames and opens
  // the input lock early (the historical `writer_idle` settles the turn).
  const sendToWriter = useWorld.match(/const sendToWriter = useCallback\([\s\S]*?\n  \}, \[/)?.[0] ?? '';
  assert.match(sendToWriter, /replayingRef\.current/,
    'sendToWriter must consult replayingRef');
  assert.match(sendToWriter, /Catching up/, 'sendToWriter must reject with a catch-up message');
});

test('the two content-frame sounds are gated during replay (decision D)', () => {
  // `chalk_writing`/`chalk_landed` are replayed; a replay must not re-fire the
  // charge / paper-slide. Both call sites consult replayingRef.
  assert.match(useWorld, /if \(!replayingRef\.current\) playCharge\(0\)/,
    'playCharge must be gated by replayingRef');
  assert.match(useWorld, /if \(!replayingRef\.current\) playFoley\('paper-slide'\)/,
    'playFoley(paper-slide) must be gated by replayingRef');
});

test('the replay failsafe disarms on open, replay_done, close and cleanup (02 §7)', () => {
  // `replayTo` is synchronous: a missing `replay_done` is an exception path. The
  // failsafe must not leak a timer across reconnects, and the flags must not
  // survive a dropped socket (a reconnect would inherit a stale input lock).
  const timers = useWorld.match(/replayDoneTimer/g)?.length ?? 0;
  assert.ok(timers >= 5,
    `replayDoneTimer must be declared, armed and cleared (>=5 mentions, saw ${timers})`);
  assert.match(useWorld, /REPLAY_DONE_TIMEOUT_MS/, 'the budget must come from the shared constant');
  assert.match(useWorld, /}, REPLAY_DONE_TIMEOUT_MS\)/,
    'the failsafe must be a setTimeout using the shared budget');

  const onclose = useWorld.match(/ws\.onclose = \(ev: CloseEvent\) => \{[\s\S]*?\n      \};/)?.[0] ?? '';
  assert.match(onclose, /replayDoneTimer/, 'onclose must disarm the failsafe');
  assert.match(onclose, /replayingRef\.current = false/,
    'onclose must clear the flag so a reconnect does not inherit a lock');

  const cleanup = useWorld.match(/return \(\) => \{\n      stopped = true;[\s\S]*?\n    \};/)?.[0] ?? '';
  assert.match(cleanup, /replayDoneTimer/, 'effect cleanup must clear the failsafe timer');
});

test('a protocol close reports a stale page instead of reconnecting (03 §3.3)', () => {
  const onclose = useWorld.match(/ws\.onclose = \(ev: CloseEvent\) => \{[\s\S]*?\n      \};/)?.[0] ?? '';
  assert.match(onclose, /closeKind\(ev\.code\) === 'protocol'/,
    'onclose must classify with closeKind');
  assert.match(onclose, /out of date with the server/,
    'a protocol verdict must surface a visible notice');
  // The protocol branch must return BEFORE scheduling a retry, or the page
  // hammers the server every 1.2s forever.
  const protocolBranch = onclose.match(/closeKind\(ev\.code\) === 'protocol'[\s\S]*?return;/)?.[0] ?? '';
  assert.doesNotMatch(protocolBranch, /retryTimer = window\.setTimeout/,
    'the protocol branch must not schedule a reconnect');
});
