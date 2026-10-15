// One agent, one turn at a time.
//
//The character the player talks to
// by voice and the one in the dock are the SAME process with the same memory.
// pi runs one turn at a time (integration.md §7.1), so two mouths on one
// character must share one queue or they race for that turn.
//
// The queue is a pure scheduling primitive, so none of this needs a pi process.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { AgentLifecycleManager } = await jiti.import('../src/engine/lifecycle.ts');

function manager(options = {}) {
  return new AgentLifecycleManager({ repoRoot: '/tmp/nowhere', vendorCliPath: '/tmp/nowhere/cli.js', ...options });
}

/** A turn that resolves only when the test says so, recording its overlap. */
function turn(log, name, state) {
  return () => {
    state.running += 1;
    state.maxConcurrent = Math.max(state.maxConcurrent, state.running);
    log.push(`start:${name}`);
    return new Promise((resolve, reject) => {
      state.release[name] = (err) => {
        state.running -= 1;
        log.push(`end:${name}`);
        if (err) reject(err);
        else resolve(name);
      };
    });
  };
}

test('two turns for one character never overlap; the second waits', async () => {
  const lifecycle = manager();
  const log = [];
  const state = { running: 0, maxConcurrent: 0, release: {} };

  // The call turn starts; the dock message arrives while it is still running.
  const call = lifecycle.submitCharacterTurn('nanami', turn(log, 'call', state));
  const dock = lifecycle.submitCharacterTurn('nanami', turn(log, 'dock', state));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(log, ['start:call'], 'the dock turn must not open a second pi turn');
  assert.equal(lifecycle.queuedCharacterTurns('nanami'), 2);

  state.release.call();
  await call;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(log, ['start:call', 'end:call', 'start:dock']);

  state.release.dock();
  await dock;
  assert.equal(state.maxConcurrent, 1, 'pi runs one turn at a time');
  assert.equal(lifecycle.queuedCharacterTurns('nanami'), 0);
});

test('a queued message is answered, never dropped', async () => {
  const lifecycle = manager();
  const state = { running: 0, maxConcurrent: 0, release: {} };
  const log = [];
  const first = lifecycle.submitCharacterTurn('nanami', turn(log, 'first', state));
  const second = lifecycle.submitCharacterTurn('nanami', turn(log, 'second', state));
  await new Promise((resolve) => setImmediate(resolve));
  state.release.first();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  state.release.second();
  assert.equal(await second, 'second', 'the message that arrived during a call still gets its turn');
});

test('a failed turn does not poison the ones behind it', async () => {
  const lifecycle = manager();
  const state = { running: 0, maxConcurrent: 0, release: {} };
  const log = [];
  const failing = lifecycle.submitCharacterTurn('nanami', turn(log, 'failing', state));
  const after = lifecycle.submitCharacterTurn('nanami', turn(log, 'after', state));
  await new Promise((resolve) => setImmediate(resolve));

  state.release.failing(new Error('agent died mid-turn'));
  await assert.rejects(failing, /agent died mid-turn/);
  await new Promise((resolve) => setImmediate(resolve));
  state.release.after();
  assert.equal(await after, 'after');
  assert.equal(lifecycle.queuedCharacterTurns('nanami'), 0);
});

test('different characters are different processes, so they still run in parallel', async () => {
  const lifecycle = manager();
  const state = { running: 0, maxConcurrent: 0, release: {} };
  const log = [];
  const a = lifecycle.submitCharacterTurn('nanami', turn(log, 'nanami', state));
  const b = lifecycle.submitCharacterTurn('watson', turn(log, 'watson', state));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.maxConcurrent, 2, 'serialising across characters would be a needless stall');
  state.release.nanami();
  state.release.watson();
  await Promise.all([a, b]);
});

test('an unbounded backlog is refused loudly rather than grown', async () => {
  const lifecycle = manager();
  const state = { running: 0, maxConcurrent: 0, release: {} };
  const log = [];
  const pending = [];
  for (let i = 0; i < 8; i += 1) {
    pending.push(lifecycle.submitCharacterTurn('nanami', turn(log, `t${i}`, state)));
  }
  await assert.rejects(
    lifecycle.submitCharacterTurn('nanami', turn(log, 'overflow', state)),
    /still answering earlier messages/,
    'a stuck agent must not become unbounded memory',
  );
  // Drain, so the test leaves nothing pending.
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    state.release[`t${i}`]?.();
  }
  await Promise.allSettled(pending);
});

test('the queue counts down as turns finish, so it is not a one-way ratchet', async () => {
  const lifecycle = manager();
  const state = { running: 0, maxConcurrent: 0, release: {} };
  const log = [];
  const one = lifecycle.submitCharacterTurn('nanami', turn(log, 'one', state));
  assert.equal(lifecycle.queuedCharacterTurns('nanami'), 1);
  await new Promise((resolve) => setImmediate(resolve));
  state.release.one();
  await one;
  assert.equal(lifecycle.queuedCharacterTurns('nanami'), 0);
  // And a later turn starts immediately rather than behind a ghost.
  const two = lifecycle.submitCharacterTurn('nanami', turn(log, 'two', state));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(log.includes('start:two'));
  state.release.two();
  await two;
});


test('switching saves rejects an old queued turn without blocking the new save', async () => {
  const lifecycle = manager();
  const order = [];
  let releaseA;
  const runningA = lifecycle.submitCharacterTurn('vera', () => new Promise((resolve) => {
    order.push('A:start');
    releaseA = () => {
      order.push('A:end');
      resolve();
    };
  }));
  const queuedA = lifecycle.submitCharacterTurn('vera', async () => {
    order.push('A:stale');
  });
  await new Promise((resolve) => setImmediate(resolve));

  await lifecycle.stopCharacters();
  const turnB = lifecycle.submitCharacterTurn('vera', async () => {
    order.push('B');
  });
  releaseA();
  await runningA;
  await assert.rejects(queuedA, /belongs to a save that is no longer active/);
  await turnB;
  assert.deepEqual(order, ['A:start', 'A:end', 'B']);
});

test('late A character events are discarded and current B events retain their save identity', () => {
  const forwarded = [];
  const progressFrames = [];
  const lifecycle = manager({
    eventSink: (...args) => forwarded.push(args),
    frameSink: (frame) => progressFrames.push(frame),
  });
  const staleClient = {};
  const activeClient = {};
  lifecycle.characterEpochs.set('vera', 3);
  lifecycle.characterWorldEpoch = 1;
  lifecycle.characterClients.set('vera', activeClient);
  lifecycle.characterWorlds.set('vera', '/saves/b');

  lifecycle.handleEngineEvent('character', { type: 'message_update' }, 'character:vera', staleClient, '/saves/a', 2, 0);
  assert.equal(forwarded.length, 0, 'the previous save callback must not reach the frame sink');

  lifecycle.handleEngineEvent('character', { type: 'agent_settled' }, 'character:vera', activeClient, '/saves/b', 3, 1);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0][4], '/saves/b');
  assert.equal(progressFrames[0].savePath, '/saves/b');
});

test('world transition rejects a turn submitted before character teardown awaits', async () => {
  const lifecycle = manager();
  lifecycle.beginWorldTransition();
  await assert.rejects(
    lifecycle.submitCharacterTurn('vera', async () => {}),
    /active world changed/,
  );
});

test('a character stop arriving after a world transition is superseded without close side effects', async () => {
  const lifecycle = manager();
  lifecycle.characterWorldRoot = '/saves/a';
  lifecycle.beginWorldTransition();
  const sideEffects = [];
  const statuses = [];
  const status = await lifecycle.stopCharacterWithAction(
    'vera',
    '/saves/a',
    async () => { sideEffects.push('character_talked and cursor settled'); },
    value => statuses.push(value),
  );

  assert.equal(status, 'superseded');
  assert.deepEqual(sideEffects, []);
  assert.deepEqual(statuses, ['superseded']);
});

test('a deferred character stop superseded before drain skips its event and cursor work', async () => {
  const lifecycle = manager();
  lifecycle.characterWorldRoot = '/saves/a';
  lifecycle.switchingModels = true;
  const sideEffects = [];
  const statuses = [];
  const queued = await lifecycle.stopCharacterWithAction(
    'vera',
    '/saves/a',
    async () => { sideEffects.push('character_talked and cursor settled'); },
    value => statuses.push(value),
  );
  assert.equal(queued, 'deferred');

  lifecycle.beginWorldTransition();
  await lifecycle.flushDeferredCharacterStops();

  assert.deepEqual(sideEffects, []);
  assert.deepEqual(statuses, ['deferred', 'superseded']);
});

test('a same-root deferred character close still performs its side effects after model switching', async () => {
  const lifecycle = manager();
  lifecycle.characterWorldRoot = '/saves/a';
  lifecycle.switchingModels = true;
  const sideEffects = [];
  const statuses = [];
  await lifecycle.stopCharacterWithAction(
    'vera',
    '/saves/a',
    async () => { sideEffects.push('character_talked and cursor settled'); },
    value => statuses.push(value),
  );

  await lifecycle.flushDeferredCharacterStops();

  assert.deepEqual(sideEffects, ['character_talked and cursor settled']);
  assert.deepEqual(statuses, ['deferred', 'completed']);
});
