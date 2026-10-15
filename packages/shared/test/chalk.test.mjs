/**
 * doc 02 `chalk` acceptance tests: default `NN-slug.md` naming, explicit-path
 * collision, append continuation + shallow status merge, the frontmatter
 * skeleton, and the round-trip invariant.
 *
 * Imports built `dist/` modules directly (not the barrel): `dist/index.js`
 * re-exports every sibling module in the batch, so one unfinished sibling
 * blocks the whole barrel at import time. Build first:
 *   pnpm --filter @airp/shared build
 *   node --test packages/shared/test/chalk.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ActionError } from '../dist/actions/errors.js';
import { createActionService } from '../dist/actions/service.js';
import {
  buildFrontmatter,
  nextOrdinal,
  renderAppend,
  slugify,
  stringifyChalkFile,
  writeChalk,
  yamlScalar,
} from '../dist/actions/chalk.js';
import { parseFrontmatter } from '../dist/schemas/frontmatter.js';
import { LocalWorldStore } from '../dist/store/local-store.js';

const ACTOR = { type: 'writer' };

async function tempStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-chalk-test-'));
  const store = new LocalWorldStore(root);
  await store.writeFile(
    'world.json',
    JSON.stringify({
      id: 'proj-1',
      name: 'T',
      description: '',
      author: '',
      genre: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  );
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('world/room/README.md', '---\nname: Room\ntype: readme\n---\n\n# Room\n');
  return { store, root };
}

function service(store) {
  return createActionService(store, ACTOR, { turn: 'turn:test:1' });
}

function isActionError(code) {
  return (err) => {
    assert.ok(err instanceof ActionError, `expected ActionError, got ${err}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}: ${err.message}`);
    return true;
  };
}

// ---------------------------------------------------------------- pure fns

test('slugify (§2.4): kebab ASCII, punctuation folded, non-ASCII degenerates', () => {
  assert.equal(slugify('The Closed Piano'), 'the-closed-piano');
  assert.equal(slugify('The lid gives way.'), 'the-lid-gives-way');
  assert.equal(slugify('雨夜'), 'chalk');
  assert.equal(slugify('a/b:c*d'), 'a-b-c-d');
  assert.equal(slugify('x'.repeat(50)).length, 32);
});

test('nextOrdinal (§2.4 / §7.5): max + 1, holes not filled, unnumbered ignored', () => {
  assert.equal(nextOrdinal(['01-a.md', '02-b.md', '04-c.md']), '05');
  assert.equal(nextOrdinal(['evening.md']), '01');
  assert.equal(nextOrdinal(['99-x.md']), '100');
  assert.equal(nextOrdinal(['01-a.md', 'late-night.md']), '02');
  assert.equal(nextOrdinal(['100-x.md', '101-y.md']), '102');
  // Legacy `chalk-<slug>.md` names from the old god-mode prototype never count
  // (doc 02 §11 conflict 9): no `NN-` prefix, so the sequence starts fresh.
  assert.equal(nextOrdinal(['chalk-rainy-night.md']), '01');
});

test('yamlScalar (§4.3): quotes only when the bare form would not round-trip', () => {
  assert.equal(yamlScalar(1.5), '1.5');
  assert.equal(yamlScalar('1.5'), '"1.5"');
  assert.equal(yamlScalar('>50'), '">50"');
  assert.equal(yamlScalar(true), 'true');
  assert.equal(yamlScalar('Pick the rusted lock'), 'Pick the rusted lock');
  assert.equal(yamlScalar('Scene 2: The Piano'), '"Scene 2: The Piano"');
  assert.equal(yamlScalar(''), '""');
  // Interior quotes need no wrapping: YAML only treats a quote specially at
  // the START of a scalar, so the bare form round-trips (the legacy writer's
  // unconditional `"${item}"` was the bug, doc 02 §9.1).
  assert.equal(yamlScalar('say "hi"'), 'say "hi"');
  assert.equal(yamlScalar('"quoted start'), '"\\"quoted start"');
});

test('stringifyChalkFile round-trips through parseFrontmatter (§10.1)', () => {
  const fm = {
    type: 'chalk',
    title: 'The Closed Piano',
    anchor: 'world/manor/keys.md',
    roll_dice: { type: '1d100', desc: 'Pick the rusted lock', expect: '>50', result: 62, passed: true },
    choice: ['Open the lid', 'Play the unfinished nocturne'],
    status: { data: { lid: 'closed', tune: 'unknown', 技术进度: 3 } },
  };
  const body = 'The lid gives way.\n\nA dry click, and under it the keys.';
  const file = stringifyChalkFile(fm, body);

  const parsed = parseFrontmatter(file);
  assert.deepEqual(parsed.frontmatter, fm, 'frontmatter deep-equal');
  assert.equal(parsed.body, `\n${body}\n`, 'body preserved byte-for-byte');
  assert.deepEqual(parsed.errors, []);

  // Idempotent: re-serializing the parsed parts reproduces the file.
  assert.equal(stringifyChalkFile(parsed.frontmatter, parsed.body), file);
});

test('buildFrontmatter (§4.2): frozen key order, extra may not claim type/title', () => {
  const fm = buildFrontmatter({
    title: 'A Night',
    frontmatter: {
      extra: { anchor: 'world/room/keys.md' },
      roll_dice: { desc: 'd', expect: '>5' },
      choice: ['one'],
      status: { data: { a: 1 } },
    },
  });
  assert.deepEqual(Object.keys(fm), ['type', 'title', 'anchor', 'roll_dice', 'choice', 'status']);
  assert.equal(fm.type, 'chalk');
  assert.throws(() => buildFrontmatter({ title: 'x', frontmatter: { extra: { title: 'y' } } }), isActionError('invalid_argument'));
  assert.throws(
    () => buildFrontmatter({ title: 'x', frontmatter: { extra: { type: 'note' } } }),
    isActionError('invalid_argument')
  );
});

// ---------------------------------------------------------------- I/O tests

test('A: default naming lands <layer>/NN-<slug>.md and logs one entity_created', async () => {
  const { store, root } = await tempStore();
  try {
    await store.writeFile('world/room/01-dust.md', '---\ntype: chalk\ntitle: Dust\n---\n\nDust.\n');
    const svc = service(store);
    const r = await svc.writeChalk({
      body: 'The lid gives way.\n\nA dry click.',
      title: 'The lid gives way.',
      layer: 'world/room',
    });

    assert.equal(r.details.path, 'world/room/02-the-lid-gives-way.md');
    assert.equal(r.details.created, true);
    assert.equal(r.details.appended, false);
    assert.equal(r.details.name, 'The lid gives way.');
    assert.equal(r.details.layer, 'world/room');

    const raw = await fs.readFile(path.join(root, r.details.path), 'utf-8');
    const parsed = parseFrontmatter(raw);
    assert.equal(parsed.frontmatter.type, 'chalk');
    assert.equal(parsed.frontmatter.title, 'The lid gives way.');
    assert.equal(parsed.body.trim(), 'The lid gives way.\n\nA dry click.');

    const events = await store.getEventsSince(0);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'entity_created');
    assert.equal(events[0].detail.kind, 'chalk');
    assert.equal(events[0].detail.path, r.details.path);
    assert.equal(events[0].detail.name, 'The lid gives way.');
    assert.equal(events[0].layer, 'world/room');
    assert.equal(events[0].turn, 'turn:test:1');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('A thrice: 01/02/03, three events sharing one turn', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    const paths = [];
    for (const title of ['One', 'Two', 'Three']) {
      const r = await svc.writeChalk({ body: `${title}.`, title, layer: 'world/room' });
      paths.push(r.details.path);
    }
    assert.deepEqual(paths, [
      'world/room/01-one.md',
      'world/room/02-two.md',
      'world/room/03-three.md',
    ]);
    const events = await store.getEventsSince(0);
    assert.equal(events.length, 3);
    assert.deepEqual(new Set(events.map((e) => e.turn)), new Set(['turn:test:1']));
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('B: an existing explicit path raises already_exists and leaves the world untouched', async () => {
  const { store, root } = await tempStore();
  try {
    const target = 'world/room/taken.md';
    await store.writeFile(target, '---\ntype: chalk\ntitle: Original\n---\n\nOld words.\n');
    const before = await fs.readFile(path.join(root, target), 'utf-8');
    const beforeStat = await fs.stat(path.join(root, target));

    await assert.rejects(
      () => service(store).writeChalk({ body: 'New words.', title: 'New', path: target }),
      isActionError('already_exists')
    );

    assert.equal(await fs.readFile(path.join(root, target), 'utf-8'), before);
    assert.equal((await fs.stat(path.join(root, target))).mtimeMs, beforeStat.mtimeMs);
    assert.equal((await store.getEventsSince(0)).length, 0);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('B + append_to together is invalid_argument, with no side effect', async () => {
  const { store, root } = await tempStore();
  try {
    await assert.rejects(
      () =>
        service(store).writeChalk({
          body: 'x',
          title: 'x',
          path: 'world/room/a.md',
          appendTo: 'world/room/b.md',
        }),
      isActionError('invalid_argument')
    );
    assert.equal((await store.getEventsSince(0)).length, 0);
    assert.equal(await store.statKind('world/room/a.md'), 'missing');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C: append continues the body, keeps the title, overwrites choice, shallow-merges status', async () => {
  const { store, root } = await tempStore();
  try {
    const target = 'world/room/01-rainy-night.md';
    await store.writeFile(
      target,
      [
        '---',
        'type: chalk',
        'title: Rainy Night',
        'choice:',
        '  - Wait',
        'roll_dice:',
        '  type: 1d100',
        '  desc: Listen',
        '  expect: ">50"',
        'status:',
        '  data:',
        '    time: night',
        '    stage: one',
        '---',
        '',
        'The rain starts.',
        '',
      ].join('\n')
    );

    const svc = service(store);
    const r = await svc.writeChalk({
      body: 'A knock at the door.',
      title: 'Ignored Because Appending',
      appendTo: target,
      frontmatter: { choice: ['Open the door'], status: { data: { stage: 'two', guest: true } } },
    });

    assert.equal(r.details.path, target);
    assert.equal(r.details.created, false);
    assert.equal(r.details.appended, true);
    assert.equal(r.details.name, 'Rainy Night', 'append never renames the card');

    const parsed = parseFrontmatter(await fs.readFile(path.join(root, target), 'utf-8'));
    assert.equal(parsed.frontmatter.title, 'Rainy Night');
    assert.deepEqual(parsed.frontmatter.choice, ['Open the door'], 'choice overwritten');
    assert.deepEqual(parsed.frontmatter.roll_dice, { type: '1d100', desc: 'Listen', expect: '>50' });
    assert.deepEqual(parsed.frontmatter.status.data, { time: 'night', stage: 'two', guest: true });
    assert.equal(parsed.body, '\nThe rain starts.\n\nA knock at the door.\n');

    const events = await store.getEventsSince(0);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'entity_edited');
    assert.equal(events[0].detail.path, target);
    assert.equal(events[0].detail.name, 'Rainy Night');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C: appending to a non-chalk file fails and does not touch it', async () => {
  const { store, root } = await tempStore();
  try {
    const target = 'world/room/note.md';
    await store.writeFile(target, '---\ntype: note\ntitle: Note\n---\n\nNote.\n');
    await assert.rejects(
      () => service(store).writeChalk({ body: 'x', title: 'x', appendTo: target }),
      isActionError('malformed_entity')
    );
    assert.equal(await store.readFile(target), '---\ntype: note\ntitle: Note\n---\n\nNote.\n');
    assert.equal((await store.getEventsSince(0)).length, 0);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('D: link_to adds one row and still logs exactly one entity_created', async () => {
  const { store, root } = await tempStore();
  try {
    await store.writeFile('world/room/copper-key.md', '---\ntype: note\ntitle: Copper Key\n---\n\nA key.\n');
    const r = await service(store).writeChalk({
      body: 'The key turns.',
      title: 'The key turns',
      layer: 'world/room',
      linkTo: 'world/room/copper-key.md',
    });
    assert.deepEqual(r.details.link, {
      from: r.details.path,
      to: 'world/room/copper-key.md',
    });
    const rows = await store.getLayerLinks('world/room');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].from, r.details.path);
    assert.equal(rows[0].to, 'world/room/copper-key.md');
    assert.equal((await store.getEventsSince(0)).length, 1);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('D: a missing link_to endpoint fails before any write', async () => {
  const { store, root } = await tempStore();
  try {
    await assert.rejects(
      () =>
        service(store).writeChalk({
          body: 'x',
          title: 'x',
          layer: 'world/room',
          linkTo: 'world/room/ghost.md',
        }),
      isActionError('not_found')
    );
    assert.equal((await store.getEventsSince(0)).length, 0);
    assert.deepEqual(await store.listFiles('world/room'), ['world/room/README.md']);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('validation: empty body, absolute/escaping paths, README target, missing layer', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    await assert.rejects(() => svc.writeChalk({ body: '   ', title: 'x', layer: 'world/room' }), isActionError('invalid_argument'));
    await assert.rejects(
      () => svc.writeChalk({ body: 'x', title: 'x', path: '/etc/x.md' }),
      isActionError('invalid_path')
    );
    await assert.rejects(
      () => svc.writeChalk({ body: 'x', title: 'x', path: '../../../x.md' }),
      isActionError('invalid_path')
    );
    await assert.rejects(
      () => svc.writeChalk({ body: 'x', title: 'x', path: 'world/room/README.md' }),
      isActionError('not_movable')
    );
    await assert.rejects(
      () => svc.writeChalk({ body: 'x', title: 'x', layer: 'world/nope' }),
      isActionError('not_found')
    );
    await assert.rejects(
      () => svc.writeChalk({ body: 'x', title: 'x', path: 'notes/x.md' }),
      isActionError('invalid_path')
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('writeChalk registers on the action service under its camelCase name', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    assert.equal(typeof svc.writeChalk, 'function');
    const direct = await writeChalk(svc.ctx, { body: 'Direct.', title: 'Direct', layer: 'world/room' });
    assert.equal(direct.details.path, 'world/room/01-direct.md');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('player / character nooks are writable and report layer: null', async () => {
  const { store, root } = await tempStore();
  try {
    const svc = service(store);
    await store.writeFile('player/README.md', '---\nname: Bag\ntype: readme\n---\n\n# Bag\n');
    const bag = await svc.writeChalk({ body: 'A memento.', title: 'Memento', layer: 'player' });
    assert.equal(bag.details.path, 'player/01-memento.md');
    assert.equal(bag.details.layer, null);
    assert.equal((await store.getEventsSince(0))[0].layer, null);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('§7.4: a long chalk still lands, flagged long, never refused', async () => {
  const { store, root } = await tempStore();
  try {
    const r = await service(store).writeChalk({
      body: 'x'.repeat(250),
      title: 'Long',
      layer: 'world/room',
    });
    assert.equal(r.details.long, true);
    assert.equal(r.details.path, 'world/room/01-long.md');
    assert.match(r.text, /1 character[s]?|250 characters/);
    assert.match(r.text, /keep a single chalk short/);
    assert.equal(await store.statKind(r.details.path), 'file');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('renderAppend (§3.1): one blank line, trailing whitespace never accumulates', () => {
  assert.equal(renderAppend('old\n\n', 'new'), 'old\n\nnew');
  const once = renderAppend('old\n\n', 'new');
  assert.equal(renderAppend(`${once}\n`, 'again'), 'old\n\nnew\n\nagain');
});
