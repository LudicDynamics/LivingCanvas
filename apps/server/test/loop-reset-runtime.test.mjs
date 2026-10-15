// Loop reset, the server half: the action layer has
// already put the files back; the server retires the agents' conversations.
//
//   - the event bridge hands every tailed world event to its listeners
//     (index.ts wires `loop_reset` → lifecycle.resetForLoop);
//   - `retireSessionsForLoop`: character threads are deleted, the writer's is
//     set aside (renamed out of `.jsonl`), so the next writer launch starts a
//     new thread instead of resuming the old loop;
//   - index.ts is wired that way (source check).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { EventBridge } from '../dist/engine/event-bridge.js';
import { retireSessionsForLoop, writerSessionFile } from '../dist/engine/launch.js';
import { LocalWorldStore } from '@airp/shared';

const settle = () => new Promise((r) => setTimeout(r, 5));

test('the event bridge hands tailed world events to its listeners', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-loop-bridge-'));
  const store = new LocalWorldStore(root);
  try {
    await store.writeFile('world.json', JSON.stringify({ id: 'l', name: 'L', description: '', author: '', genre: 't', createdAt: '', updatedAt: '' }));
    const bridge = new EventBridge();
    bridge.setWss({ clients: [] });
    const seen = [];
    bridge.onWorldEvent(() => { throw new Error('a failing listener never stops the tail'); });
    bridge.onWorldEvent((event, worldRoot) => seen.push([event.type, event.detail.loop, worldRoot]));
    bridge.startTailReader(store);
    await settle();
    await store.appendEvent({ type: 'loop_reset', actor: { type: 'engine' }, detail: { loop: 2, kept: { notes: 0, links: 0, states: [], files: [] }, dropped: [] } });
    await bridge.drainWorldEvents();
    assert.deepEqual(seen, [['loop_reset', 2, root]]);
    bridge.stopTailReader?.();
  } finally {
    store.close();
  }
});

test('retireSessionsForLoop: characters forget, the writer starts a new thread, nothing is resumed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-loop-sessions-'));
  const real = await fs.realpath(root);
  const dir = path.join(root, '.airpworld', 'sessions');
  await fs.mkdir(dir, { recursive: true });
  const header = JSON.stringify({ type: 'session', cwd: real });
  await fs.writeFile(path.join(dir, 'writer-a.jsonl'), `${header}\n`);
  await fs.writeFile(path.join(dir, 'char-chizuru.jsonl'), `${header}\n`);
  assert.ok(writerSessionFile(root), 'before: the writer would resume its thread');

  const touched = retireSessionsForLoop(root, 2);
  assert.equal(touched.length, 2);
  const left = (await fs.readdir(dir)).sort();
  assert.deepEqual(left, ['writer-a.loop-1.done']);
  assert.equal(writerSessionFile(root), null, 'after: the next writer launch is a fresh thread');
  assert.deepEqual(retireSessionsForLoop(path.join(root, 'nope'), 3), [], 'no sessions dir: nothing to do');
});

test('index.ts: a loop_reset event retires the agents through the lifecycle', async () => {
  const src = await fs.readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(src, /eventBridge\.onWorldEvent\([\s\S]*?'loop_reset'[\s\S]*?lifecycle\.resetForLoop\(worldRoot/);
  const world = await fs.readFile(new URL('../src/routes/world.ts', import.meta.url), 'utf8');
  assert.match(world, /prepareRun\(playPath[\s\S]*?prepareLoop\(playPath\)/, 'a new run takes its loop-start after the variant draw');
  assert.match(world, /prepareLoop\(resolvedPath\)[\s\S]*?new LocalWorldStore\(resolvedPath\)/, 'an older save gets one when opened');
  const lifecycle = await fs.readFile(new URL('../src/engine/lifecycle.ts', import.meta.url), 'utf8');
  assert.match(lifecycle, /resetForLoop\(worldRoot: string, loop: number\)[\s\S]*?this\.writerQueue[\s\S]*?stopCharacters\(\)[\s\S]*?stopWriterInternal\(\)[\s\S]*?retireSessionsForLoop/);
});
