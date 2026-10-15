import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { livingProblems } from './living-problems.mjs';
import { triggerProblems } from './trigger-problems.mjs';

async function world(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-living-check-'));
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  }
  return root;
}

const LIVING = {
  phases: [{ id: 'day', from: '06:00', label: 'Day' }, { id: 'night', from: '20:00', label: 'Night' }],
  display: { label: 'Time', text: '{day} {phase}' },
  events: [{ id: 'market-day', label: 'Market', on: { every: 3 }, at: 'world/square', gather: ['ann', 'ghost'] }],
  residents: {
    ann: {
      schedule: [{ at: 'world/square', phases: ['day'], if: 'world.open == true && time.phase == "day"' }, { at: 'world/nowhere' }, { at: 'map', if: 'world.closed == true' }],
      daily: [{ state: 'mood', pick: { happy: 1, sulky: 1 } }, { state: 'mood', by: 1 }, { state: 'missing', set: 1 }],
    },
    bob: { schedule: [{ at: 'map' }] },
  },
  variants: {
    'world/square': { base: 'assets/square.webp', when: [{ phases: ['night'], bg: 'assets/square-night.webp' }] },
  },
};

test('check:worlds reports every living-world authoring mistake', async () => {
  const root = await world({
    'world/README.md': '---\ntype: readme\nstates: [{ id: open, label: Open, type: flag, initial: true }]\n---\n',
    'world/square/README.md': '---\ntype: readme\nbg: assets/other.webp\n---\n',
    'characters/ann/README.md': '---\ntype: readme\nstates: [{ id: mood, label: Mood, type: enum, values: [happy, low], initial: happy }]\n---\n',
    'assets/square.webp': 'x',
  });
  const problems = await livingProblems(root, { characters: [{ id: 'ann', home: 'map' }], living: LIVING });
  const all = problems.join('\n');
  assert.match(all, /schedule\[1\]: layer world\/nowhere does not exist/);
  assert.match(all, /schedule\[2\]: "world.closed" is not a declared state/);
  assert.match(all, /daily\[0\]: "sulky" is not a value of mood/);
  assert.match(all, /daily\[1\]: by needs a number state/);
  assert.match(all, /daily\[2\]: characters\/ann\/README.md declares no state "missing"/);
  assert.match(all, /residents.bob: no character "bob"/);
  assert.match(all, /gather "ghost" is not a resident/);
  assert.match(all, /variants.world\/square: base assets\/square.webp is not the layer's bg/);
  assert.match(all, /picture assets\/square-night.webp is missing/);
  assert.doesNotMatch(all, /schedule\[0\]/, 'a valid if: with time.* is fine');
  assert.ok((await livingProblems(root, { characters: [], living: { phases: [] } })).some((p) => /living\.phases/.test(p)), 'schema errors come through');
});

test('pass_time outside a living world, and time / events refs in triggers', async () => {
  const root = await world({
    'world/README.md': '---\ntype: readme\n---\n',
    'command/nap.yaml': 'name: Nap\ndo:\n  - action: pass_time\n    with:\n      minutes: "60"\n',
  });
  assert.deepEqual(await livingProblems(root, { characters: [] }), ['command/nap.yaml: pass_time needs world.json living']);
  const triggers = [
    { id: 'a', kind: 'state', when: 'time.phase == "night" && events.market_day == true', fallback: 'x' },
    { id: 'b', kind: 'state', when: 'time.moon == 1', fallback: 'x' },
    { id: 'c', kind: 'state', when: 'events.fair == true', fallback: 'x' },
  ];
  const withLiving = (await triggerProblems(root, { characters: [], living: LIVING, triggers })).join('\n');
  assert.doesNotMatch(withLiving, /trigger a/);
  assert.match(withLiving, /trigger b: "time.moon" is not a time name/);
  assert.match(withLiving, /trigger c: "events.fair" names no living.events id/);
  const without = (await triggerProblems(root, { characters: [], triggers: [triggers[0]] })).join('\n');
  assert.match(without, /needs world.json living/);
});

// The skeletons are design notes, which the open-source copy does not carry.
const SKELETONS = new URL('../docs/worlds/living-skeletons/', import.meta.url);
const hasSkeletons = await fs.access(SKELETONS).then(() => true, () => false);

test('the outpost and caravan skeletons run on the same engine', { skip: !hasSkeletons && 'the design notes are not in this copy' }, async () => {
  const { parseLivingWorld, livingRefProblem, parseTriggerCondition, collectRefPaths, livingNow, residentPlace } = await import('../packages/shared/dist/index.js');
  for (const id of ['outpost', 'caravan']) {
    const doc = JSON.parse(await fs.readFile(new URL(`../docs/worlds/living-skeletons/${id}.world.json`, import.meta.url), 'utf8'));
    const { living, errors } = parseLivingWorld(doc.living);
    assert.deepEqual(errors, [], id);
    for (const t of doc.triggers) {
      const parsed = parseTriggerCondition(t.when, doc.characters.map((c) => c.id));
      assert.ok(parsed.ok, `${id}/${t.id}`);
      for (const ref of collectRefPaths(parsed.value)) if (ref.startsWith('time.') || ref.startsWith('events.')) assert.equal(livingRefProblem(living, ref), null, `${id}/${t.id} ${ref}`);
    }
    for (const c of doc.characters) assert.ok(living.residents[c.id], `${id}: ${c.id} has a schedule`);
    const now = livingNow(living, 1, 9 * 60);
    for (const c of doc.characters) assert.match(residentPlace(living, c.id, now, c.home, () => true).layer, /^(map|world\/)/);
    assert.ok(Array.isArray(doc.$missing) && doc.$missing.some((m) => m.startsWith('ENGINE GAP')), `${id} lists what the engine lacks`);
  }
});
