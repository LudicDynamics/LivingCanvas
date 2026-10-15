// GET /api/world/panels — declared states as prose for the player / world /
// character panels. Hidden states never leave.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore } from '@airp/shared';
import { createPanelsRouter } from '../dist/routes/panels.js';

async function serve(store) {
  const app = express();
  app.use('/api', createPanelsRouter(() => store));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const get = async () => (await fetch(`http://127.0.0.1:${port}/api/world/panels`)).json();
  return { get, close: () => new Promise((r) => server.close(r)) };
}

const HP = `states:
  - id: hp
    label: 伤势
    type: number
    initial: 3
    range: [0, 3]
    shown_as:
      - { min: 3, text: 毫发无伤 }
      - { min: 1, text: 受了伤 }
      - { max: 0, text: 奄奄一息 }
  - id: doom
    label: 厄运
    type: number
    initial: 0
    hidden: true
status:
  data:
    hp: 2
    doom: 5
`;

test('player, world and character states come back as prose; hidden ones are dropped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-panels-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'w', name: 'W', description: '', author: '', genre: 't', mode: 'closed',
    characters: [{ id: 'vera', name: 'Vera', home: 'world' }], createdAt: 'x', updatedAt: 'x',
  }));
  await store.writeFile('world/README.md', '---\nname: M\ntype: readme\nstates:\n  - id: alarm\n    label: 警戒\n    type: enum\n    initial: calm\n    values: [calm, loud]\n    shown_as: { calm: 四下安静, loud: 警报大作 }\n---\n');
  await store.writeFile('world/station/README.md', '---\nname: Station\ntype: readme\n---\n');
  await store.writeFile('player/README.md', `---\nname: You\n${HP}---\n`);
  await store.writeFile('characters/vera/README.md', '---\nname: Vera\nstates:\n  - id: trust\n    label: 信任\n    type: flag\n    initial: true\n---\n');
  const s = await serve(store);
  try {
    const body = await s.get();
    assert.equal(body.ok, true);
    assert.deepEqual(body.player.states, [{ id: 'hp', label: '伤势', text: '受了伤' }]);
    assert.equal(body.world.name, 'W');
    assert.equal(body.world.mode, 'closed');
    assert.deepEqual(body.world.states, [{ id: 'alarm', label: '警戒', text: '四下安静' }]);
    assert.deepEqual(body.world.places, { visited: 0, total: 1 });
    assert.deepEqual(body.characters, { vera: [{ id: 'trust', label: '信任', text: '信任' }] });
    assert.doesNotMatch(JSON.stringify(body), /doom|厄运/);
  } finally { await s.close(); }
});
