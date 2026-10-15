import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { LiveCallRegistry } = await jiti.import('../src/engine/live-session.ts');

test('an A→B→A transition during sideband attach is caller-only, never a visible old-A frame', async t => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });

  let activeRoot = '/saves/a';
  let worldEpoch = 7;
  const visibleFailures = [];
  const sideband = {
    send() {},
    close() {},
    onOpen() {},
    onMessage() {},
    onError(handler) { queueMicrotask(() => handler(new Error('attach failed'))); },
    onClose() {},
  };
  const registry = new LiveCallRegistry({
    repoRoot: '/tmp',
    lifecycle: {
      isWorldRootCurrent: root => activeRoot === root,
      getWorldEpoch: () => worldEpoch,
      isWorldIdentityCurrent: (root, capturedEpoch) => activeRoot === root && worldEpoch === capturedEpoch,
      getCharacter: () => null,
      startCharacter: async () => null,
      submitCharacterTurn: async () => {},
    },
    readCharacterReadme: async () => '---\nname: Sarah\n---\nA detective.',
    onVisibleFailure: (...failure) => visibleFailures.push(failure),
    fetchImpl: async () => new Response(JSON.stringify({
      session: { id: 'live-session-a' },
      transport: { sdp: 'answer-sdp' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
    connectSideband: () => {
      activeRoot = '/saves/b';
      worldEpoch += 1;
      activeRoot = '/saves/a';
      worldEpoch += 1;
      return sideband;
    },
  });

  await assert.rejects(
    registry.open({
      characterId: 'sarah',
      sdp: 'offer-sdp',
      language: 'en',
      voice: 'alloy',
      worldRoot: '/saves/a',
    }),
    error => error.code === 'world_changed' && error.status === 409,
  );
  assert.deepEqual(visibleFailures, [], 'the stale attach error does not broadcast to WebSocket clients');
  assert.equal(registry.has('sarah'), false, 'the failed open never registers a call');
});
