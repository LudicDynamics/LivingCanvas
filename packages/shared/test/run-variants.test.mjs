// Run variants: a new run
// picks one option per variant from a seed, overlays it, deletes the unpicked
// overlays, sets the variant's state and records the run — once.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createActionService,
  LocalWorldStore,
  parseFrontmatter,
  pickVariant,
  pickVariants,
  prepareRun,
  runRecordOf,
  runVariantsOf,
  RESERVED_FRONTMATTER_KEYS,
  WorldManifestSchema,
} from '../dist/index.js';

const VARIANT = { id: 'culprit', options: ['eve', 'ross', 'koharu'], state: 'culprit' };

async function world({ variants = [VARIANT], readme } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-variants-'));
  const write = async (rel, text) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  };
  await write('world.json', JSON.stringify({ id: 't', name: 't', description: 't', author: 't', genre: 't', createdAt: 'x', updatedAt: 'x', ...(variants ? { variants } : {}) }));
  await write('world/README.md', readme ?? [
    '---',
    'type: readme',
    'title: Manor',
    'states:',
    '  - { id: culprit, label: Culprit, type: enum, values: [eve, ross, koharu], initial: eve, hidden: true }',
    '---',
    'The manor.',
    '',
  ].join('\n'));
  await write('world/hall/eve.md', '---\ntype: note\ntitle: Eve\n---\nEve (base = the first option).\n');
  for (const o of VARIANT.options) {
    await write(`variants/culprit/${o}/world/hall/eve.md`, `---\ntype: note\ntitle: Eve\n---\nEve when the culprit is ${o}.\n`);
    await write(`variants/culprit/${o}/command/find.yaml`, `name: find\ndo:\n  - action: event\n    with: { text: "${o} did it" }\n`);
  }
  return root;
}
const readme = async (root) => parseFrontmatter(await fs.readFile(path.join(root, 'world/README.md'), 'utf8')).frontmatter;
const exists = (p) => fs.access(p).then(() => true, () => false);

test('pickVariant is deterministic, depends on the seed and covers every option', () => {
  assert.equal(pickVariant('seed-1', VARIANT), pickVariant('seed-1', VARIANT));
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(pickVariant(`seed-${i}`, VARIANT));
  assert.deepEqual([...seen].sort(), ['eve', 'koharu', 'ross'], 'every option is reachable');
  // Independent variants draw independently from one seed (the id is mixed in).
  const two = [VARIANT, { id: 'weapon', options: ['a', 'b', 'c'] }];
  const combos = new Set();
  for (let i = 0; i < 200; i++) combos.add(Object.values(pickVariants(`s${i}`, two)).join('/'));
  assert.ok(combos.size > 3);
});

test('the manifest schema accepts variants and rejects malformed ones', () => {
  assert.deepEqual(runVariantsOf({ variants: [VARIANT] }), { variants: [VARIANT], errors: [] });
  assert.deepEqual(runVariantsOf({}), { variants: [], errors: [] });
  assert.ok(runVariantsOf({ variants: [{ id: 'culprit', options: ['eve'] }] }).errors.length, 'two options at least');
  assert.ok(runVariantsOf({ variants: [{ id: 'culprit', options: ['eve', 'eve'] }] }).errors.length, 'distinct options');
  assert.ok(runVariantsOf({ variants: [{ id: 'Culprit', options: ['a', 'b'] }] }).errors.length, 'ascii kebab-case id');
  assert.throws(() => WorldManifestSchema.parse({ id: 't', name: 't', description: 't', author: 't', genre: 't', createdAt: 'x', updatedAt: 'x', variants: [{ id: 'x', options: ['a'] }] }));
});

test('prepareRun overlays the picked option, deletes the others, sets the state and records the run', async () => {
  const root = await world();
  const run = await prepareRun(root, { seed: 'fixed-seed' });
  const picked = pickVariant('fixed-seed', VARIANT);
  assert.deepEqual(run, { seed: 'fixed-seed', variants: { culprit: picked } });
  assert.match(await fs.readFile(path.join(root, 'world/hall/eve.md'), 'utf8'), new RegExp(`culprit is ${picked}`));
  assert.match(await fs.readFile(path.join(root, 'command/find.yaml'), 'utf8'), new RegExp(`${picked} did it`), 'an overlay may add files');
  assert.equal(await exists(path.join(root, 'variants')), false, 'the unpicked options are gone from the save');
  const fm = await readme(root);
  assert.equal(fm.status.data.culprit, picked);
  assert.deepEqual(runRecordOf(fm), run);
  assert.equal(fm.title, 'Manor', 'the rest of the README is kept');
});

test('prepareRun is idempotent: a prepared save is never re-rolled', async () => {
  const root = await world();
  const first = await prepareRun(root, { force: { culprit: 'koharu' } });
  const again = await prepareRun(root, { force: { culprit: 'ross' } });
  assert.deepEqual(again, first);
  assert.equal((await readme(root)).status.data.culprit, 'koharu');
});

test('force overrides the seed; an unknown option is refused', async () => {
  for (const o of VARIANT.options) {
    const root = await world();
    assert.equal((await prepareRun(root, { force: { culprit: o } })).variants.culprit, o);
    assert.equal((await readme(root)).status.data.culprit, o);
  }
  await assert.rejects(prepareRun(await world(), { force: { culprit: 'butler' } }), /no option "butler"/);
});

test('a world without variants is left untouched', async () => {
  const root = await world({ variants: null });
  const before = await fs.readFile(path.join(root, 'world/README.md'), 'utf8');
  assert.equal(await prepareRun(root), null);
  assert.equal(await fs.readFile(path.join(root, 'world/README.md'), 'utf8'), before);
  assert.equal(await exists(path.join(root, 'variants')), true, 'nothing is deleted either');
});

test('a variant state must be a declared enum that holds the option', async () => {
  const root = await world({ readme: '---\ntype: readme\ntitle: Manor\n---\nNo states.\n' });
  await assert.rejects(prepareRun(root, { seed: 'x' }), /must declare an enum state "culprit"/);
});

test('the run record is reserved: commands and agents cannot rewrite it', async () => {
  assert.ok(RESERVED_FRONTMATTER_KEYS.includes('run'));
  const root = await world();
  await prepareRun(root, { force: { culprit: 'ross' } });
  const store = new LocalWorldStore(root);
  try {
    const writer = createActionService(store, { type: 'writer', id: 'writer' }, { turn: 'turn:1' });
    const refused = await writer.editEntity({ path: 'world/README.md', frontmatter: { run: { seed: 'x', variants: { culprit: 'eve' } } } }).catch((e) => e);
    assert.equal(refused.code, 'invalid_argument');
    const state = await writer.editEntity({ path: 'world/README.md', frontmatter: { status: { data: { culprit: 'eve' } } } }).catch((e) => e);
    assert.equal(state.code, 'invalid_argument', 'the variant state is a declared state');
    assert.equal((await readme(root)).status.data.culprit, 'ross');
  } finally {
    store.close();
  }
});
