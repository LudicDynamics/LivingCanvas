// Entering a world sends several requests for the same character at once (the
// pending greeting, the dock opening, the first line typed). Each used to call
// startCharacter, which stops the running client first, so later requests
// killed earlier ones and those turns failed with "Client not started"
//. ensureCharacter makes
// concurrent callers share one start and reuses a live client for the same world.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { AgentLifecycleManager } = await jiti.import('../src/engine/lifecycle.ts');

function characterWorld() {
  const root = mkdtempSync(path.join(tmpdir(), 'airp-character-world-'));
  mkdirSync(path.join(root, 'characters', 'vera'), { recursive: true });
  writeFileSync(path.join(root, 'world.json'), JSON.stringify({ characters: [{ id: 'vera' }] }));
  writeFileSync(path.join(root, 'characters', 'vera', 'preset.json'), JSON.stringify({ id: 'test-character' }));
  return root;
}

function managerWithFakeStarts() {
  const m = new AgentLifecycleManager({ repoRoot: '/tmp/nowhere', vendorCliPath: '/tmp/nowhere/cli.js' });
  const started = [];
  m.startCharacterProcess = async function (id, world, generation, worldEpoch, previous) {
    if (previous) await previous.promise.catch(() => {});
    this.assertCurrentCharacterStart(id, world, generation, worldEpoch);
    await this.retireCharacterClient(id);
    this.assertCurrentCharacterStart(id, world, generation, worldEpoch);
    const client = { id, world, n: started.length + 1, stop: async () => {} };
    const starting = this.characterStarting.get(id);
    if (starting?.generation === generation) starting.client = client;
    started.push(client);
    await new Promise((resolve) => setTimeout(resolve, 20));
    this.assertCurrentCharacterStart(id, world, generation, worldEpoch);
    this.characterClients.set(id, client);
    this.characterWorlds.set(id, world);
    return client;
  };
  return { m, started };
}

test('direct start and ensure callers join the same in-flight actor generation', async () => {
  const root = characterWorld();
  const { m, started } = managerWithFakeStarts();
  m.completeWorldTransition(root);
  try {
    const direct = m.startCharacter('vera', root);
    const ensured = m.ensureCharacter('vera', root);
    const [a, b] = await Promise.all([direct, ensured]);
    assert.equal(started.length, 1);
    assert.equal(a, b);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a real lifecycle character start retires a prior turn timeout before publishing the client', async () => {
  const root = characterWorld();
  const m = new AgentLifecycleManager({ repoRoot, vendorCliPath: '/tmp/noop-cli.js' });
  m.completeWorldTransition(root);
  const client = { onEvent() {}, start: async () => {}, stop: async () => {} };
  m.createCharacterClient = () => client;
  const timeout = setTimeout(() => {}, 60_000);
  timeout.unref?.();
  m.turnTimeouts.set('character:vera', timeout);
  m.turnStartedAt.set('character:vera', Date.now());

  try {
    await m.ensureCharacter('vera', root);
    assert.equal(m.getCharacter('vera'), client);
    assert.equal(m.turnTimeouts.has('character:vera'), false);
    assert.equal(m.turnStartedAt.has('character:vera'), false);
    await m.stopCharacter('vera');
  } finally {
    clearTimeout(timeout);
    rmSync(root, { recursive: true, force: true });
  }
});

test('world transition rejects A starts, then permits the new B root', async () => {
  const aRoot = characterWorld();
  const bRoot = characterWorld();
  const { m, started } = managerWithFakeStarts();
  m.completeWorldTransition(aRoot);
  try {
    await m.ensureCharacter('vera', aRoot);
    m.beginWorldTransition();
    await assert.rejects(m.ensureCharacter('vera', aRoot));
    await m.stopCharacters();
    m.completeWorldTransition(bRoot);
    await assert.rejects(m.ensureCharacter('vera', aRoot));
    const b = await m.ensureCharacter('vera', bRoot);
    assert.equal(b.world, bRoot);
    assert.equal(started.length, 2);
  } finally {
    rmSync(aRoot, { recursive: true, force: true });
    rmSync(bRoot, { recursive: true, force: true });
  }
});

test('an A client still starting when transition begins cannot commit after B activates', async () => {
  const aRoot = characterWorld();
  const bRoot = characterWorld();
  const { m, started } = managerWithFakeStarts();
  m.completeWorldTransition(aRoot);
  try {
    const pendingA = m.ensureCharacter('vera', aRoot);
    m.beginWorldTransition();
    await m.stopCharacters();
    m.completeWorldTransition(bRoot);

    await assert.rejects(pendingA);
    const b = await m.ensureCharacter('vera', bRoot);
    assert.equal(b.world, bRoot);
    assert.equal(started.length, 1, 'the stale A startup must not allocate a client');
  } finally {
    rmSync(aRoot, { recursive: true, force: true });
    rmSync(bRoot, { recursive: true, force: true });
  }
});

test('three simultaneous requests for one character start it once and share the client', async () => {
  const root = characterWorld();
  const { m, started } = managerWithFakeStarts();
  m.completeWorldTransition(root);
  try {
    const [a, b, c] = await Promise.all([
      m.ensureCharacter('vera', root),
      m.ensureCharacter('vera', root),
      m.ensureCharacter('vera', root),
    ]);
    assert.equal(started.length, 1);
    assert.equal(a, b);
    assert.equal(b, c);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a live client for the same world is reused; another world starts a new one', async () => {
  const one = characterWorld();
  const two = characterWorld();
  const { m, started } = managerWithFakeStarts();
  m.completeWorldTransition(one);
  try {
    const first = await m.ensureCharacter('vera', one);
    assert.equal(await m.ensureCharacter('vera', one), first);
    assert.equal(started.length, 1);
    m.beginWorldTransition();
    m.completeWorldTransition(two);
    const other = await m.ensureCharacter('vera', two);
    assert.notEqual(other, first);
    assert.equal(started.length, 2);
  } finally {
    rmSync(one, { recursive: true, force: true });
    rmSync(two, { recursive: true, force: true });
  }
});


test('writer restarts retry transient startup failures with bounded backoff and honor world epochs', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalError = console.error;
  const originalWarn = console.warn;
  const timers = [];
  const errors = [];
  globalThis.setTimeout = (fn, delay) => {
    const timer = { fn, delay, unref() {} };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    const index = timers.indexOf(timer);
    if (index >= 0) timers.splice(index, 1);
  };
  console.error = (...args) => errors.push(args);
  console.warn = () => {};
  try {
    const stale = new AgentLifecycleManager({ repoRoot: '/tmp/nowhere', vendorCliPath: '/tmp/nowhere/cli.js' });
    let staleAttempts = 0;
    stale.startWriterProcess = async () => { staleAttempts += 1; };
    stale.scheduleWriterRestart('/w/a', stale.writerRestartGeneration, stale.writerEpoch);
    const oldTimer = timers.shift();
    stale.beginWorldTransition();
    oldTimer.fn();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(staleAttempts, 0, 'a retry from the retired world must not start after transition');

    const retrying = new AgentLifecycleManager({ repoRoot: '/tmp/nowhere', vendorCliPath: '/tmp/nowhere/cli.js' });
    let attempts = 0;
    retrying.startWriterProcess = async () => {
      attempts += 1;
      throw new Error('transient start failure');
    };
    retrying.scheduleWriterRestart('/w/a', retrying.writerRestartGeneration, retrying.writerEpoch);
    const firstDelay = timers[0].delay;
    await assert.rejects(retrying.startWriter('/w/a'), /transient start failure/);
    assert.equal(retrying.writerRestartGeneration, 0, 'ordinary same-root start keeps the retry generation');
    assert.equal(retrying.writerRestarts, 2, 'the retry budget is not reset by the ordinary start');
    const delays = [firstDelay];
    while (timers.length > 0) {
      const timer = timers.shift();
      if (timer.delay !== firstDelay) delays.push(timer.delay);
      timer.fn();
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(attempts, 5);
    assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000]);
    assert.ok(errors.some(([message]) => String(message).includes('writer restart failed')));
    assert.ok(errors.some(([message]) => String(message).includes('giving up')));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    console.error = originalError;
    console.warn = originalWarn;
  }
});

test('direct writer commands never dispatch into a transitioning or different save', async () => {
  const { m } = managerWithFakeStarts();
  const writerA = { getState: async () => ({ model: null }) };
  m.characterWorldRoot = '/w/a';
  m.writer = writerA;
  m.writerWorld = '/w/a';
  let dispatched = 0;
  await m.dispatchWriterCommand('/w/a', async (writer) => {
    assert.equal(writer, writerA);
    dispatched += 1;
  });

  m.beginWorldTransition();
  await assert.rejects(
    m.dispatchWriterCommand('/w/a', async () => { dispatched += 1; }),
    /world transition is in progress/,
  );
  m.completeWorldTransition('/w/b');
  await assert.rejects(
    m.dispatchWriterCommand('/w/b', async () => { dispatched += 1; }),
    /not active for the requested world/,
  );
  assert.equal(dispatched, 1);
});

test('rollback rearms a writer watchdog consumed during a temporary transition', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalWarn = console.warn;
  const timers = [];
  globalThis.setTimeout = (fn, delay) => {
    const timer = { fn, delay, unref() {} };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    const index = timers.indexOf(timer);
    if (index >= 0) timers.splice(index, 1);
  };
  console.warn = () => {};
  let aborted = 0;
  const lifecycle = new AgentLifecycleManager({ repoRoot: '/tmp/nowhere', vendorCliPath: '/tmp/nowhere/cli.js' });
  const writer = { abort: async () => { aborted += 1; }, stop: async () => {} };
  lifecycle.completeWorldTransition('/w/a');
  lifecycle.writer = writer;
  lifecycle.writerWorld = '/w/a';
  lifecycle.writerEpoch = 7;
  lifecycle.turnStartedAt.set('writer', Date.now());
  lifecycle.turnIds.set('writer', 'writer:active');
  lifecycle.armTurnTimeout('writer', writer, 'writer', '/w/a', 7);

  try {
    const firstTimer = timers.shift();
    lifecycle.beginWorldTransition();
    firstTimer.fn();
    assert.equal(aborted, 0, 'a temporary switch does not abort the still-current A writer turn');

    lifecycle.completeWorldTransition('/w/a');
    assert.equal(timers.length, 1, 'rollback restores the current writer watchdog');
    timers.shift().fn();
    assert.equal(aborted, 1, 'the restored watchdog still aborts a genuinely hung turn');
    assert.equal(lifecycle.turnStartedAt.has('writer'), false);
    await lifecycle.stopWriter();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    console.warn = originalWarn;
  }
});

test('character abort is rejected during transition, for a stale root, and while models switch', async () => {
  const { m } = managerWithFakeStarts();
  let aborts = 0;
  const actor = { abort: async () => { aborts += 1; } };
  m.completeWorldTransition('/w/a');
  m.characterClients.set('vera', actor);
  m.characterWorlds.set('vera', '/w/a');
  await m.abortCharacter('vera', '/w/a');
  assert.equal(aborts, 1);

  m.beginWorldTransition();
  await assert.rejects(m.abortCharacter('vera', '/w/a'));
  assert.equal(aborts, 1);
  m.completeWorldTransition('/w/b');
  await assert.rejects(m.abortCharacter('vera', '/w/b'));
  assert.equal(aborts, 1);

  m.characterWorlds.set('vera', '/w/b');
  m.switchingModels = true;
  await assert.rejects(m.abortCharacter('vera', '/w/b'));
  assert.equal(aborts, 1);
});
