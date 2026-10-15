// The public brain seam (integration.md §6, the design notes).
//
// `runDelegation` was private with one caller, so a second voice backend could
// not run a character turn without going through a GPT Live call. `deliver` is
// the same execution half, minus the call: same turn, same receipt, same two
// languages. Nothing here needs a pi process or a socket — the lifecycle is a
// fake, which is the whole point of the extraction.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { LiveCallRegistry } = await jiti.import('../src/engine/live-session.ts');
const { createCollectingChannel } = await jiti.import('../src/engine/character-duplex.ts');

/** A character agent that answers with the events a real turn would produce. */
function fakeAgent(events, over = {}) {
  return {
    promptAndWait: async () => events,
    getLastAssistantText: async () => null,
    abort: async () => {},
    ...over,
  };
}

const assistant = (text) => ({ type: 'message_end', message: { role: 'assistant', content: text } });
const toolCall = (toolName, args, isError = false) => [
  { type: 'tool_execution_start', toolCallId: 't1', toolName, args },
  { type: 'tool_execution_end', toolCallId: 't1', toolName, isError, result: { details: {} } },
];

/** A registry whose lifecycle is a fake; `turns` records what was prompted. */
function registry(agent, over = {}) {
  const turns = [];
  const failures = [];
  const queue = [];
  const reg = new LiveCallRegistry({
    repoRoot: '/tmp/nowhere',
    lifecycle: {
      isWorldRootCurrent: () => true,
      getCharacter: () => agent,
      startCharacter: async () => agent,
      submitCharacterTurn: (characterId, run) => {
        queue.push(characterId);
        return run();
      },
      ...over.lifecycle,
    },

    readCharacterReadme: async () => null,
    onVisibleFailure: (characterId, reason) => failures.push({ characterId, reason }),
  });
  return { reg, turns, failures, queue };
}

test('deliver is public, and returns the words and the receipt as a value', async () => {
  const { reg } = registry(fakeAgent([
    ...toolCall('move', { path: 'world/inn/old-key.md', to: 'player' }),
    assistant('I have it.'),
  ]));

  const outcome = await reg.deliver('nanami', 'get the key', {
    worldRoot: '/tmp/world',
    language: 'en',
  });

  assert.equal(outcome.ok, true);
  // Her line, then the receipt the voice paraphrases as "done".
  assert.equal(outcome.spoken[0], 'I have it.');
  assert.match(outcome.spoken[1], /Done: moved old key/);
  assert.deepEqual(outcome.receipt, [{ tool: 'move', ok: true, path: 'world/inn/old-key.md', target: 'player' }]);
});

test('a channel receives exactly what the outcome reports', async () => {
  const { reg } = registry(fakeAgent([assistant('Good evening.')]));
  const channel = createCollectingChannel();
  const outcome = await reg.deliver('nanami', 'hello', {
    worldRoot: '/tmp/world',
    language: 'en',
    channel,
    delegationId: 'd1',
  });
  assert.deepEqual(channel.spoken, outcome.spoken);
  assert.deepEqual(channel.spoken, ['Good evening.']);
  assert.equal(channel.kind, 'voice-live');
  assert.deepEqual(channel.notices, []);
});

test('the receipt is phrased in the language the caller asked for', async () => {
  const { reg } = registry(fakeAgent([...toolCall('roll_dice', {}), assistant('どうぞ。')]));
  const outcome = await reg.deliver('nanami', 'さいころ', { worldRoot: '/tmp/world', language: 'ja' });
  assert.match(outcome.spoken[1], /完了：ダイスを振りました/);
});

test('a turn that only ACTED still reports, rather than claiming it could not', async () => {
  // the design notes — the whole point of the receipt channel.
  const { reg } = registry(fakeAgent([...toolCall('chalk', {})]));
  const outcome = await reg.deliver('nanami', 'write it down', { worldRoot: '/tmp/world', language: 'en' });
  assert.equal(outcome.ok, true);
  assert.match(outcome.spoken[0], /Done: wrote it into the story/);
});

test('a failed tool call is named, so the caller hears it did NOT happen', async () => {
  const { reg } = registry(fakeAgent([...toolCall('move', { path: 'a.md' }, true), assistant('Hm.')]));
  const outcome = await reg.deliver('nanami', 'move it', { worldRoot: '/tmp/world', language: 'en' });
  assert.match(outcome.spoken[1], /Could not/);
  assert.equal(outcome.receipt[0].ok, false);
});

test('a turn with nothing to say fails visibly, through the notice channel', async () => {
  const { reg, failures } = registry(fakeAgent([]));
  const channel = createCollectingChannel();
  const outcome = await reg.deliver('nanami', 'say something', {
    worldRoot: '/tmp/world', language: 'en', channel,
  });
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.spoken, []);
  assert.equal(failures.length, 1);
  // A visible degradation is a notice, never mistaken for her own line.
  assert.deepEqual(channel.spoken, []);
  assert.match(channel.notices[0], /could not put that into words/i);
});

test('a dead agent is a visible failure, not a silent stall', async () => {
  const agent = fakeAgent([], { promptAndWait: async () => { throw new Error('turn timed out'); } });
  const { reg, failures } = registry(agent);
  const channel = createCollectingChannel();
  const outcome = await reg.deliver('nanami', 'hello', {
    worldRoot: '/tmp/world', language: 'en', channel,
  });
  assert.equal(outcome.ok, false);
  assert.match(failures[0].reason, /character turn failed: turn timed out/);
  assert.match(channel.notices[0], /try again shortly/);
});

test('an agent that cannot be started tells its caller, and says so visibly', async () => {
  const { reg, failures } = registry(null, {
    lifecycle: {
      getCharacter: () => null,
      startCharacter: async () => { throw new Error('world changed'); },
    },
  });
  let healed = false;
  const outcome = await reg.deliver('nanami', 'hello', {
    worldRoot: '/tmp/world',
    language: 'en',
    onAgentUnavailable: async () => { healed = true; },
  });
  assert.equal(outcome.ok, false);
  assert.match(failures[0].reason, /character agent unavailable: world changed/);
  assert.equal(healed, true, 'the caller gets to clean up its own dead call');
});

test('a delegation whose owner went away is dropped before it costs a turn', async () => {
  let prompted = 0;
  const agent = fakeAgent([assistant('hi')], {
    promptAndWait: async () => { prompted += 1; return [assistant('hi')]; },
  });
  const { reg } = registry(agent);
  const outcome = await reg.deliver('nanami', 'hello', {
    worldRoot: '/tmp/world', language: 'en', isCurrent: () => false,
  });
  assert.equal(outcome.ok, false);
  assert.equal(prompted, 0, 'a hung-up call must not spend a character turn');
});

test('every deliver rides the shared per-character queue', async () => {
  const { reg, queue } = registry(fakeAgent([assistant('hi')]));
  await reg.deliver('nanami', 'hello', { worldRoot: '/tmp/world', language: 'en' });
  // One agent, one turn at a time: the call goes through the same queue the
  // dock uses, or the two race for pi's single turn.
  assert.deepEqual(queue, ['nanami']);
});
