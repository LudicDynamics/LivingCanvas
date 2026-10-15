import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  CARD_FORMS,
  COMPONENT_KINDS,
  COMPONENT_REGISTRY,
  COMPONENT_SCHEMAS,
  LocalWorldStore,
  SHOW_REGISTRY,
  cardKindOf,
  componentDefOf,
  componentDocOf,
  getComponent,
  listComponents,
  listPerformances,
  parseFrontmatter,
  resolveComponentKind,
  showComponent,
  stringifyFrontmatter,
  useItemTargetOf,
} from '../dist/index.js';

/** Parse a `get_component` example string the way a model-written file would be. */
function exampleFrontmatter(example) {
  const { frontmatter } = parseFrontmatter(example);
  assert.ok(frontmatter, `example did not parse:\n${example}`);
  return frontmatter;
}

// ------------------------------------------------------- registry completeness

test('T2: the registry holds 19 kinds, each with a CARD_FORMS row and a full entry', () => {
  const kinds = Object.keys(COMPONENT_REGISTRY);
  assert.equal(kinds.length, 19, 'doc 10 §14.2: 19 docked kinds');
  assert.deepEqual([...COMPONENT_KINDS].sort(), kinds.slice().sort(), 'COMPONENT_KINDS matches the registry');
  for (const [kind, def] of Object.entries(COMPONENT_REGISTRY)) {
    assert.ok(CARD_FORMS[kind], `${kind} has no CARD_FORMS row`);
    assert.equal(def.kind, kind);
    assert.ok(def.purpose.length > 0, `${kind}.purpose`);
    assert.ok(def.label.length > 0, `${kind}.label`);
    assert.ok(Array.isArray(def.fields), `${kind}.fields`);
    assert.ok(typeof def.example === 'string' && def.example.includes('---'), `${kind}.example`);
  }
});

test('T3: COMPONENT_SCHEMAS and COMPONENT_REGISTRY share the same key set', () => {
  assert.deepEqual(
    Object.keys(COMPONENT_SCHEMAS).sort(),
    Object.keys(COMPONENT_REGISTRY).sort()
  );
});

test('T4: componentDocOf(kind).form is the SAME object as CARD_FORMS[kind] (no second size table)', () => {
  for (const kind of Object.keys(COMPONENT_REGISTRY)) {
    assert.deepEqual(componentDocOf(kind).form, CARD_FORMS[kind], `form drift for ${kind}`);
  }
});

test('T5: every kind example parses under its own schema, resolves back, and round-trips', () => {
  for (const kind of Object.keys(COMPONENT_REGISTRY)) {
    const example = COMPONENT_REGISTRY[kind].example;
    const { frontmatter: fm, body } = parseFrontmatter(example);
    assert.ok(fm, `${kind}'s example has frontmatter`);
    const parsed = COMPONENT_SCHEMAS[kind].safeParse(fm);
    assert.equal(
      parsed.success,
      true,
      `${kind}'s example does not satisfy COMPONENT_SCHEMAS.${kind}: ${JSON.stringify(parsed.error?.issues)}`
    );
    assert.equal(resolveComponentKind(fm, `${kind}.md`), kind, `${kind}'s example resolves elsewhere`);
    // Round-trip: re-serializing the parsed frontmatter and re-parsing yields
    // the same values, so a model can copy the example and keep editing.
    const reparsed = parseFrontmatter(stringifyFrontmatter(fm, body));
    assert.deepEqual(reparsed.frontmatter, fm, `${kind}'s example does not round-trip`);
  }
});

test('T6: the index text marks every accepts-bearing kind as a use_item_on target', async () => {
  const { text, details } = await getComponent(nullStoreCtx(), {});
  assert.equal(details.mode, 'index');
  const lines = text.split('\n');
  for (const doc of listComponents()) {
    const line = lines.find((l) => l.startsWith(doc.kind + ' '));
    assert.ok(line, `index has a line for ${doc.kind}`);
    if (doc.accepts) {
      assert.ok(line.includes('[use_item_on target]'), `${doc.kind} line carries the target marker`);
    } else {
      assert.ok(!line.includes('[use_item_on target]'), `${doc.kind} line must not claim to be a target`);
    }
  }
  // Spot check the doc 10 §2.1 sample line shape.
  assert.ok(/lock\s+adventure\s+/.test(text), 'index lines are `kind pack purpose`');
  assert.ok(text.includes('19 registered'), 'index reports the count');
});

test('T7 (M-5 corrected): lock accepts a note-tagged key, and rejects an unrelated item', () => {
  // A real copper key is `type: note` + `tags: [key]` (doc 10 E1), so the lock
  // matches on itemKinds [note] or itemTags [key] — never on `component: key`.
  assert.deepEqual(useItemTargetOf('lock', { type: 'note', tags: ['key'] }), {
    candidate: true,
    hint: 'Use a key here',
  });
  assert.equal(useItemTargetOf('lock', { type: 'note' }).candidate, true, 'itemKinds includes note');
  assert.equal(useItemTargetOf('lock', { type: 'note', tags: ['rubbish'] }).candidate, true);
  assert.equal(useItemTargetOf('lock', { type: 'sprite', tags: ['boot'] }).candidate, false);
  assert.equal(useItemTargetOf('note', { type: 'note' }).candidate, false, 'note has no accepts');
  // A kind whose accepts is `any` takes anything.
  assert.equal(useItemTargetOf('photo', { type: 'chalk' }).candidate, true);
});

test('T8: no id is both a docked component and a performance', () => {
  const docked = new Set(Object.keys(COMPONENT_REGISTRY));
  for (const id of Object.keys(SHOW_REGISTRY)) {
    assert.equal(docked.has(id), false, `${id} is in both registries`);
  }
});

test('T9: listPerformances covers the seven §14.3 performances, each with a param schema and duration', () => {
  const shows = listPerformances();
  assert.equal(shows.length, 7);
  const ids = shows.map((s) => s.id);
  assert.deepEqual(ids, [
    'spotlight',
    'lights_out',
    'fireworks',
    'evidence_burst',
    'camera_focus',
    'ink_burst',
    'roll_ceremony',
  ]);
  for (const s of shows) {
    assert.ok(s.params && typeof s.params.safeParse === 'function', `${s.id}.params schema`);
    assert.ok(s.defaultDuration >= 300 && s.defaultDuration <= 12000, `${s.id}.defaultDuration`);
    assert.equal(typeof s.requiresTarget, 'boolean');
  }
});

// ------------------------------------------------- kind resolution (doc 10 §3.1)

test('T1: resolveComponentKind and cardKindOf agree on the kind table', () => {
  assert.equal(resolveComponentKind({ type: 'component', component: 'lock' }, 'x.md'), 'lock');
  assert.equal(resolveComponentKind({ component: 'letter' }, 'x.md'), 'letter');
  assert.equal(resolveComponentKind({ type: 'note' }, 'x.md'), 'note');
  assert.equal(resolveComponentKind({}, 'foo.md'), 'note', 'bare md is a note');
  assert.equal(resolveComponentKind({}, 'README.md'), 'gate', 'README is a scene gate, not a component');
  assert.equal(resolveComponentKind({ type: 'chalk' }, 'x.md'), 'chalk');
  assert.equal(resolveComponentKind({ type: 'sprite' }, 'x.md'), 'sprite');
  // cardKindOf delegates to the same resolver once the registry is loaded.
  assert.equal(cardKindOf({ type: 'component', component: 'lock' }, 'x.md'), 'lock');
  assert.equal(cardKindOf({}, 'foo.md'), 'note');
  assert.equal(cardKindOf({}, 'README.md'), 'gate');
});

// ------------------------------------------------------ get_component (T10)

/**
 * get_component reads no store at all, so the context hands it one that throws
 * on any property access — a stray read turns into a test failure.
 */
function nullStoreCtx() {
  const store = new Proxy(
    {},
    {
      get() {
        throw new Error('get_component must not touch the store');
      },
    }
  );
  return { store, actor: { type: 'writer' }, turn: 'turn:test:1' };
}

test('T10: getComponent is read-only and fails loudly on unknown kinds', async () => {
  const ctx = nullStoreCtx();

  const index = await getComponent(ctx, {});
  assert.equal(index.details.mode, 'index');
  assert.equal(index.details.components.length, 19);

  const full = await getComponent(ctx, { component: ['lock', 'lock'] });
  assert.equal(full.details.mode, 'full');
  assert.equal(full.details.components.length, 1, 'duplicates collapse');
  assert.equal(full.details.components[0].kind, 'lock');
  assert.ok(full.text.includes('component: lock') || full.text.includes('literal "lock"'));
  assert.ok(full.text.includes('minimal example'));

  await assert.rejects(() => getComponent(ctx, { component: 'puzzel-box' }), (err) => {
    assert.equal(err.code, 'not_found');
    assert.match(err.message, /Unknown component "puzzel-box"/);
    assert.match(err.message, /19 registered kinds/);
    return true;
  });

  await assert.rejects(() => getComponent(ctx, { component: ['a', 'b'] }), (err) => {
    assert.equal(err.code, 'not_found');
    assert.match(err.message, /Unknown component\(s\): "a", "b"/);
    return true;
  });

  await assert.rejects(() => getComponent(ctx, { component: 'world/inn/key.md' }), (err) => {
    assert.equal(err.code, 'invalid_argument');
    assert.match(err.message, /is a path, not a component kind/);
    return true;
  });
});

// ------------------------------------------------------ show (T11)

test('T11: showComponent never writes, carries a show_frame, and maps its errors', async () => {
  const calls = { write: 0, event: 0, canvas: 0 };
  const store = {
    readFile: async (p) => {
      if (p === 'world/baker-street/rusty-key.md') {
        return '---\ntitle: The Rusty Key\n---\nA key.\n';
      }
      throw new Error('ENOENT');
    },
    writeFile: async () => {
      calls.write += 1;
    },
    writeFileAtomic: async () => {
      calls.write += 1;
    },
    appendEvent: async () => {
      calls.event += 1;
    },
    execCanvas: () => {
      calls.canvas += 1;
    },
  };
  const ctx = { store, actor: { type: 'writer' }, turn: 'turn:test:1' };

  const result = await showComponent(ctx, {
    component: 'spotlight',
    target: 'world/baker-street/rusty-key.md',
    duration_ms: 100,
  });
  assert.equal(result.details.frame.type, 'show_frame');
  assert.equal(result.details.frame.component, 'spotlight');
  assert.equal(result.details.frame.targetName, 'The Rusty Key');
  assert.equal(result.details.frame.durationMs, 300, 'duration clamps up to the 300ms floor');
  assert.equal(result.details.resolved.targetName, 'The Rusty Key');
  assert.deepEqual(calls, { write: 0, event: 0, canvas: 0 }, 'show writes nothing');

  await assert.rejects(() => showComponent(ctx, { component: 'letter' }), (err) => {
    assert.equal(err.code, 'unsupported');
    assert.match(err.message, /docked component, not a performance/);
    return true;
  });

  await assert.rejects(() => showComponent(ctx, { component: 'nope' }), (err) => {
    assert.equal(err.code, 'not_found');
    assert.match(err.message, /Unknown performance "nope"\. Available: /);
    return true;
  });

  await assert.rejects(() => showComponent(ctx, { component: 'spotlight' }), (err) => {
    assert.equal(err.code, 'invalid_argument');
    assert.match(err.message, /needs a target path/);
    return true;
  });

  await assert.rejects(
    () => showComponent(ctx, { component: 'spotlight', target: 'world/ghost.md' }),
    (err) => {
      assert.equal(err.code, 'not_found');
      assert.match(err.message, /Target not found: "world\/ghost.md"/);
      return true;
    }
  );

  await assert.rejects(
    () => showComponent(ctx, { component: 'fireworks', params: { bursts: 'many' } }),
    (err) => {
      assert.equal(err.code, 'invalid_field_value');
      assert.match(err.message, /Bad params for fireworks/);
      return true;
    }
  );

  await assert.rejects(
    () => showComponent(ctx, { component: 'lights_out', duration_ms: 'soon' }),
    (err) => {
      assert.equal(err.code, 'invalid_argument');
      assert.match(err.message, /duration_ms must be a number/);
      return true;
    }
  );

  // E10: evidence_burst drops missing links but keeps the good ones.
  const burst = await showComponent(ctx, {
    component: 'evidence_burst',
    target: 'world/baker-street/rusty-key.md',
    links: ['world/baker-street/rusty-key.md', 'world/gone.md', 'world/also-gone.md'],
  });
  assert.deepEqual(burst.details.frame.links, ['world/baker-street/rusty-key.md']);
  assert.match(burst.text, /2 of 3 link paths were not found/);

  // E10 (all bad): refuse the performance entirely.
  await assert.rejects(
    () =>
      showComponent(ctx, {
        component: 'evidence_burst',
        target: 'world/baker-street/rusty-key.md',
        links: ['world/gone.md'],
      }),
    (err) => {
      assert.equal(err.code, 'not_found');
      return true;
    }
  );
});

test('componentDefOf returns null for a non-component kind and the entry for a real one', () => {
  assert.equal(componentDefOf('chalk'), null);
  assert.equal(componentDefOf('gate'), null);
  assert.equal(componentDefOf('lock').kind, 'lock');
});

// --------------------------- lock / container handlers (doc 10 §15.3, M-5/M-6)

test('lockHandler + containerHandler flip status.data via writeFileAtomic, with a real store', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-comp-'));
  try {
    await fs.writeFile(path.join(root, 'world.json'), JSON.stringify({ id: 't', name: 'T', version: 1 }));
    await fs.mkdir(path.join(root, 'world', 'cellar'), { recursive: true });
    await fs.mkdir(path.join(root, 'player'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'world', 'cellar', 'door.md'),
      '---\ntype: component\ncomponent: lock\ntitle: The Cellar Door\nstatus:\n  data:\n    locked: true\n---\nThe padlock is new.\n'
    );
    await fs.writeFile(
      path.join(root, 'player', 'copper-key.md'),
      '---\ntype: note\ntitle: Copper Key\ntags: [key]\n---\nA small copper key.\n'
    );

    const store = new LocalWorldStore(root);
    const doorParsed = parseFrontmatter(await store.readFile('world/cellar/door.md'));
    const keyParsed = parseFrontmatter(await store.readFile('player/copper-key.md'));
    // The copper key is a real candidate for the lock (M-5): `type: note` + tag.
    assert.equal(useItemTargetOf('lock', keyParsed.frontmatter).candidate, true);

    const outcome = await componentDefOf('lock').handler({
      item: { path: 'player/copper-key.md', name: 'Copper Key', frontmatter: keyParsed.frontmatter },
      target: {
        path: 'world/cellar/door.md',
        name: 'The Cellar Door',
        frontmatter: doorParsed.frontmatter,
        body: doorParsed.body,
      },
      actor: { type: 'player' },
      store,
      turn: 'turn:t:1',
    });
    assert.equal(outcome.handled, true);

    const after = parseFrontmatter(await store.readFile('world/cellar/door.md'));
    assert.equal(after.frontmatter.status.data.locked, false);
    assert.equal(after.frontmatter.status.data.opened_by, 'player/copper-key.md');
    assert.equal(after.frontmatter.title, 'The Cellar Door', 'unrelated keys survive');
    assert.match(after.body, /The padlock is new/, 'body is preserved');

    // Idempotence lives in the handler, not in a retry guard (doc 08 §4.3).
    const again = await componentDefOf('lock').handler({
      item: { path: 'player/copper-key.md', name: 'Copper Key', frontmatter: keyParsed.frontmatter },
      target: { path: 'world/cellar/door.md', name: 'The Cellar Door', frontmatter: after.frontmatter, body: after.body },
      actor: { type: 'player' },
      store,
      turn: 'turn:t:2',
    });
    assert.deepEqual(again, { handled: false, reason: 'already_open' });

    // Wrong item: no write, a legal `handled:false`.
    await fs.writeFile(
      path.join(root, 'world', 'cellar', 'chest.md'),
      '---\ntype: component\ncomponent: container\ntitle: The Iron Chest\nstatus:\n  data:\n    opened: false\n---\nNo handle.\n'
    );
    const chestParsed = parseFrontmatter(await store.readFile('world/cellar/chest.md'));
    const wrong = await componentDefOf('container').handler({
      item: { path: 'player/copper-key.md', name: 'Boot', frontmatter: { type: 'note', tags: ['boot'] } },
      target: { path: 'world/cellar/chest.md', name: 'The Iron Chest', frontmatter: chestParsed.frontmatter, body: chestParsed.body },
      actor: { type: 'player' },
      store,
      turn: 'turn:t:3',
    });
    assert.deepEqual(wrong, { handled: false, reason: 'wrong_item' });
    const untouched = parseFrontmatter(await store.readFile('world/cellar/chest.md'));
    assert.equal(untouched.frontmatter.status.data.opened, false, 'a wrong item changes nothing');

    store.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
