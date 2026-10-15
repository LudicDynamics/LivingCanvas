/**
 * doc 08 acceptance: `use_item_on` (08 §10.1/§10.2).
 *
 * Imports built `dist/` modules directly (not the barrel) so one unfinished
 * sibling module cannot block this file at import time. Build first
 * (`pnpm --filter @airp/shared build`), then:
 *   node --test packages/shared/test/use-item.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ActionError } from '../dist/actions/errors.js';
import { COMPONENT_REGISTRY } from '../dist/components/registry.js';
import {
  assertEntityPath,
  pickPresentation,
  renderText,
  toEntityRef,
} from '../dist/actions/use-item.js';
import { createActionService } from '../dist/actions/service.js';
import { LocalWorldStore } from '../dist/store/local-store.js';

const WORLD_JSON = JSON.stringify({
  id: 'proj-1',
  name: 'T',
  description: '',
  author: '',
  genre: 'test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const KEY = '---\ntype: note\ntitle: Copper Key\ntags: [key]\n---\n\nA small copper key.\n';

const LOCK = [
  '---',
  'type: component',
  'component: lock',
  'title: The Cellar Door',
  'status:',
  '  data:',
  '    locked: true',
  '---',
  '',
  'A rusted padlock.',
  '',
].join('\n');

const OPEN_LOCK = LOCK.replace('locked: true', 'locked: false');

const CHALK = '---\ntype: chalk\ntitle: Evening\n---\n\nDusk settles.\n';

async function tempWorld(files = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-use-item-'));
  await fs.mkdir(path.join(root, 'world/inn'), { recursive: true });
  await fs.mkdir(path.join(root, 'player'), { recursive: true });
  await fs.writeFile(path.join(root, 'world.json'), WORLD_JSON, 'utf-8');
  await fs.writeFile(
    path.join(root, 'world/README.md'),
    '---\nname: Map\ntype: readme\n---\n\n# Map\n',
    'utf-8'
  );
  await fs.writeFile(
    path.join(root, 'world/inn/README.md'),
    '---\nname: Inn\ntype: readme\n---\n\n# Inn\n',
    'utf-8'
  );
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf-8');
  }
  return root;
}

function service(store, actor = { type: 'player' }) {
  return createActionService(store, actor, { turn: 'req:test' });
}

function isActionError(code) {
  return (err) => {
    assert.ok(err instanceof ActionError, `expected ActionError, got ${err}`);
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    return true;
  };
}

const usages = async (store) =>
  (await store.getEvents(50)).filter((e) => e.type === 'use_item_on');

// --------------------------------------------------------- 08 §10.1 pure fns

test('§10.1 assertEntityPath: empty → invalid_argument', () => {
  assert.throws(() => assertEntityPath('', 'item'), isActionError('invalid_argument'));
});

test('§10.1 assertEntityPath: absolute / traversal / reserved → invalid_path', () => {
  assert.throws(() => assertEntityPath('/etc/passwd', 'item'), isActionError('invalid_path'));
  assert.throws(() => assertEntityPath('a/../b', 'item'), isActionError('invalid_path'));
  assert.throws(() => assertEntityPath('.airpworld/x.md', 'item'), isActionError('invalid_path'));
  assert.throws(() => assertEntityPath('a/b\\c.md', 'item'), isActionError('invalid_path'));
});

test('§10.1 assertEntityPath: a legal path passes and strips a leading "./"', () => {
  assert.equal(assertEntityPath('player/key.md', 'item'), 'player/key.md');
  assert.equal(assertEntityPath('./player/key.md', 'item'), 'player/key.md');
});

test('§10.1 pickPresentation: handled → unlock; character → paper-slide; else none', () => {
  assert.deepEqual(pickPresentation(true, 'lock', 'world/inn/door.md'), {
    foley: 'unlock',
    burst: 'unlock',
  });
  assert.deepEqual(pickPresentation(false, 'sprite', 'world/inn/watson.md'), {
    foley: 'paper-slide',
    burst: 'present',
  });
  assert.deepEqual(pickPresentation(false, 'gate', 'characters/watson/README.md'), {
    foley: 'paper-slide',
    burst: 'present',
  });
  assert.deepEqual(pickPresentation(false, 'chalk', 'world/inn/evening.md'), {
    foley: 'none',
    burst: 'none',
  });
});

test('§10.1 toEntityRef: title wins, then name, then filename slug', () => {
  const fm = (fmObj) => ({ frontmatter: fmObj, body: '' });
  assert.equal(toEntityRef('player/k.md', fm({ title: 'T', name: 'N' })).name, 'T');
  assert.equal(toEntityRef('player/k.md', fm({ name: 'N' })).name, 'N');
  assert.equal(toEntityRef('player/copper-key.md', fm({})).name, 'copper-key');
  assert.equal(toEntityRef('player/copper-key.md', fm(null)).name, 'copper-key');
});

test('§10.1 renderText: three branches, each carrying both names and both paths', () => {
  const item = { path: 'player/copper-key.md', name: 'Copper Key', frontmatter: {} };
  const target = { path: 'world/cellar/cellar-door.md', name: 'The Cellar Door', frontmatter: {} };

  const opened = renderText(item, target, { handled: true, summary: 'The lock opened.' }, 'lock');
  assert.equal(
    opened,
    'Used "Copper Key" (player/copper-key.md) on "The Cellar Door" (world/cellar/cellar-door.md). The lock opened.'
  );

  const noHandler = renderText(item, target, { handled: false, reason: 'no_handler' }, 'lock');
  assert.equal(
    noHandler,
    'Used "Copper Key" (player/copper-key.md) on "The Cellar Door" (world/cellar/cellar-door.md). '
      + 'The Cellar Door has not reacted yet — nothing in the world changed.'
  );

  const refused = renderText(item, target, { handled: false, reason: 'wrong_item' }, 'lock');
  assert.equal(
    refused,
    'Used "Copper Key" (player/copper-key.md) on "The Cellar Door" (world/cellar/cellar-door.md). '
      + 'The lock did not respond to it.'
  );
});

// --------------------------------------------------------- 08 §10.2 store

test('§10.2 lock + right key: opens, one event, no entity_edited (money shot)', async () => {
  const store = new LocalWorldStore(
    await tempWorld({ 'player/copper-key.md': KEY, 'world/inn/cellar-door.md': LOCK })
  );
  const r = await service(store).useItemOn({
    item: 'player/copper-key.md',
    target: 'world/inn/cellar-door.md',
  });

  assert.equal(r.details.handled, true);
  assert.equal(r.details.targetKind, 'lock');
  assert.equal(r.details.reason, null);
  assert.equal(r.details.itemName, 'Copper Key');
  assert.equal(r.details.targetName, 'The Cellar Door');
  assert.deepEqual(r.details.presentation, { foley: 'unlock', burst: 'unlock' });
  assert.ok(r.text.includes('player/copper-key.md'));
  assert.ok(r.text.includes('world/inn/cellar-door.md'));

  const after = await fs.readFile(
    path.join(store.worldRoot, 'world/inn/cellar-door.md'),
    'utf-8'
  );
  assert.ok(after.includes('locked: false'), 'lock flipped to open');
  assert.ok(after.includes('opened_by: player/copper-key.md'));
  assert.ok(after.includes('A rusted padlock.'), 'body untouched');

  const evs = await usages(store);
  assert.equal(evs.length, 1, 'exactly one use_item_on');
  const ev = evs[0];
  assert.equal(ev.actor.type, 'player');
  assert.equal(ev.subject, 'world/inn/cellar-door.md');
  assert.equal(ev.layer, 'world/inn');
  assert.equal(ev.detail.item, 'player/copper-key.md');
  assert.equal(ev.detail.itemName, 'Copper Key');
  assert.equal(ev.detail.target, 'world/inn/cellar-door.md');
  assert.equal(ev.detail.targetName, 'The Cellar Door');
  assert.equal(ev.detail.targetKind, 'lock');
  assert.equal(ev.detail.handled, true);
  assert.ok(typeof ev.detail.effect === 'string');
  assert.equal('reason' in ev.detail, false, 'reason must NOT enter the event detail (m-13)');

  const edited = (await store.getEvents(50)).filter((e) => e.type === 'entity_edited');
  assert.equal(edited.length, 0, 'handler MUST NOT land entity_edited');
});

test('§10.2 already_open: handled:false + reason, event lands, file bytes unchanged', async () => {
  const store = new LocalWorldStore(
    await tempWorld({ 'player/copper-key.md': KEY, 'world/inn/cellar-door.md': OPEN_LOCK })
  );
  const r = await service(store).useItemOn({
    item: 'player/copper-key.md',
    target: 'world/inn/cellar-door.md',
  });

  assert.equal(r.details.handled, false);
  assert.equal(r.details.reason, 'already_open');
  assert.deepEqual(r.details.presentation, { foley: 'none', burst: 'none' });
  assert.equal((await usages(store)).length, 1);
  assert.equal(await store.readFile('world/inn/cellar-door.md'), OPEN_LOCK, 'bytes unchanged');
});

test('§10.2 wrong item: handled:false / wrong_item, file bytes unchanged', async () => {
  const store = new LocalWorldStore(
    await tempWorld({
      'player/old-boat-ticket.md': '---\ntype: note\ntitle: Old Boat Ticket\n---\n\nA stub.\n',
      'world/inn/cellar-door.md': LOCK,
    })
  );
  const r = await service(store).useItemOn({
    item: 'player/old-boat-ticket.md',
    target: 'world/inn/cellar-door.md',
  });

  assert.equal(r.details.handled, false);
  assert.equal(r.details.reason, 'wrong_item');
  assert.equal(await store.readFile('world/inn/cellar-door.md'), LOCK);
  assert.equal((await usages(store)).length, 1, 'event lands even when refused');
  assert.ok(/did not respond/.test(r.text));
});

test('§10.2 no handler: handled:false / no_handler, event lands, world unchanged', async () => {
  const store = new LocalWorldStore(
    await tempWorld({ 'player/copper-key.md': KEY, 'world/inn/evening.md': CHALK })
  );
  const r = await service(store).useItemOn({
    item: 'player/copper-key.md',
    target: 'world/inn/evening.md',
  });

  assert.equal(r.details.handled, false);
  assert.equal(r.details.reason, 'no_handler');
  assert.equal(r.details.targetKind, null, 'chalk is not a registered component kind');
  assert.deepEqual(r.details.presentation, { foley: 'none', burst: 'none' });
  assert.ok(/has not reacted yet/.test(r.text));
  assert.equal(await store.readFile('world/inn/evening.md'), CHALK);
  assert.equal((await usages(store)).length, 1);
});

test('§10.2 handler lookup is keyed on the TARGET kind, not the item (a lock item does not fire lockHandler)', async () => {
  const lockItem = '---\ntype: component\ncomponent: lock\ntitle: A Spare Lock\ntags: [key]\n---\n\nL.\n';
  const store = new LocalWorldStore(
    await tempWorld({ 'player/spare.md': lockItem, 'world/inn/evening.md': CHALK })
  );
  const r = await service(store).useItemOn({ item: 'player/spare.md', target: 'world/inn/evening.md' });
  assert.equal(r.details.handled, false);
  assert.equal(r.details.reason, 'no_handler');
});

test('§10.2 item is NOT moved or consumed (doc-20:289)', async () => {
  const store = new LocalWorldStore(
    await tempWorld({ 'player/copper-key.md': KEY, 'world/inn/cellar-door.md': LOCK })
  );
  await service(store).useItemOn({
    item: 'player/copper-key.md',
    target: 'world/inn/cellar-door.md',
  });
  assert.equal(await store.readFile('player/copper-key.md'), KEY, 'item content identical');
  const moved = (await store.getEvents(50)).filter((e) => e.type === 'entity_moved');
  assert.equal(moved.length, 0);
});

test('§10.2 layer: bag item + layer target → layer id; both in player → null', async () => {
  const store = new LocalWorldStore(
    await tempWorld({
      'player/copper-key.md': KEY,
      'player/spare-key.md': KEY,
      'world/inn/cellar-door.md': LOCK,
    })
  );
  const svc = service(store);
  await svc.useItemOn({ item: 'player/copper-key.md', target: 'world/inn/cellar-door.md' });
  const inLayer = (await usages(store))[0];
  assert.equal(inLayer.layer, 'world/inn');

  await svc.useItemOn({ item: 'player/spare-key.md', target: 'player/copper-key.md' });
  const inBag = (await usages(store)).find((e) => e.subject === 'player/copper-key.md');
  assert.equal(inBag.layer, null);
});

// --------------------------------------------------------- 08 §10.2 errors

test('§7.1 missing item → not_found, nothing lands', async () => {
  const store = new LocalWorldStore(await tempWorld({ 'world/inn/cellar-door.md': LOCK }));
  await assert.rejects(
    service(store).useItemOn({ item: 'player/nope.md', target: 'world/inn/cellar-door.md' }),
    isActionError('not_found')
  );
  assert.equal((await store.getEvents(50)).length, 0);
});

test('§7.1 missing target → not_found, nothing lands', async () => {
  const store = new LocalWorldStore(await tempWorld({ 'player/copper-key.md': KEY }));
  await assert.rejects(
    service(store).useItemOn({ item: 'player/copper-key.md', target: 'world/inn/nope.md' }),
    isActionError('not_found')
  );
  assert.equal((await store.getEvents(50)).length, 0);
});

test('§7.1 empty strings → invalid_argument', async () => {
  const store = new LocalWorldStore(await tempWorld({ 'player/copper-key.md': KEY }));
  await assert.rejects(
    service(store).useItemOn({ item: '', target: 'player/copper-key.md' }),
    isActionError('invalid_argument')
  );
  await assert.rejects(
    service(store).useItemOn({ item: 'player/copper-key.md', target: '' }),
    isActionError('invalid_argument')
  );
});

test('§7.1 item is a directory → invalid_path', async () => {
  const store = new LocalWorldStore(await tempWorld({ 'world/inn/cellar-door.md': LOCK }));
  await assert.rejects(
    service(store).useItemOn({ item: 'player', target: 'world/inn/cellar-door.md' }),
    isActionError('invalid_path')
  );
});

test('§7.1 item is a README → invalid_path', async () => {
  const store = new LocalWorldStore(await tempWorld({ 'world/inn/cellar-door.md': LOCK }));
  await assert.rejects(
    service(store).useItemOn({ item: 'world/inn/README.md', target: 'world/inn/cellar-door.md' }),
    isActionError('invalid_path')
  );
});

test('§3.4 handler throw → internal, no event, target file unchanged', async () => {
  const store = new LocalWorldStore(
    await tempWorld({ 'player/copper-key.md': KEY, 'world/inn/cellar-door.md': LOCK })
  );
  const def = COMPONENT_REGISTRY.lock;
  const real = def.handler;
  def.handler = async () => {
    throw new Error('handler exploded');
  };
  try {
    await assert.rejects(
      service(store).useItemOn({ item: 'player/copper-key.md', target: 'world/inn/cellar-door.md' }),
      (err) => {
        assert.ok(err instanceof ActionError);
        assert.equal(err.code, 'internal');
        assert.match(err.message, /handler exploded/);
        return true;
      }
    );
  } finally {
    def.handler = real;
  }
  assert.equal((await store.getEvents(50)).length, 0);
  assert.equal(await store.readFile('world/inn/cellar-door.md'), LOCK, 'no half-write');
});

test('§4.2 handler wrote but appendEvent failed → event_failed, file change stands', async () => {
  const store = new LocalWorldStore(
    await tempWorld({ 'player/copper-key.md': KEY, 'world/inn/cellar-door.md': LOCK })
  );
  const original = store.appendEvent.bind(store);
  store.appendEvent = async () => {
    throw new Error('db gone');
  };
  await assert.rejects(
    service(store).useItemOn({ item: 'player/copper-key.md', target: 'world/inn/cellar-door.md' }),
    isActionError('event_failed')
  );
  store.appendEvent = original;
  assert.equal((await store.getEvents(50)).length, 0);
  assert.ok(
    (await store.readFile('world/inn/cellar-door.md')).includes('locked: false'),
    'no compensation — the file write stands'
  );
});

test('§2.3 text carries both names and both paths in every branch', async () => {
  const store = new LocalWorldStore(await tempWorld({ 'player/copper-key.md': KEY }));
  const svc = service(store);
  const mk = (rel, body) => store.writeFile(rel, body);

  await mk('world/inn/locked.md', LOCK);
  const ok = await svc.useItemOn({ item: 'player/copper-key.md', target: 'world/inn/locked.md' });
  assert.ok(ok.text.includes('Copper Key') && ok.text.includes('The Cellar Door'));

  await mk('world/inn/evening.md', CHALK);
  const none = await svc.useItemOn({ item: 'player/copper-key.md', target: 'world/inn/evening.md' });
  assert.ok(none.text.includes('Evening') && none.text.includes('world/inn/evening.md'));
  assert.ok(none.text.includes('player/copper-key.md'));

  await mk('world/inn/wrong.md', LOCK);
  await mk('player/ticket.md', '---\ntype: note\ntitle: Ticket\n---\n\nT.\n');
  const wrong = await svc.useItemOn({ item: 'player/ticket.md', target: 'world/inn/wrong.md' });
  assert.ok(wrong.text.includes('Ticket') && wrong.text.includes('The Cellar Door'));
  assert.ok(/did not respond/.test(wrong.text));
});
