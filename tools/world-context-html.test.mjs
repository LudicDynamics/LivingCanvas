/**
 * the design notes — the write gate's `.html` behaviour, driven through a REAL
 * `tool_call` / `tool_result` pair (the same jiti harness as
 * `writer-beat-guard.test.mjs`, because `extensions/` runs under jiti, not tsc).
 *
 * Four observable assertions, each paired with the control that must stay
 * unchanged:
 *   1. a `.html` write is NOT blocked; a `.txt` write IS;
 *   2. the receipt lands exactly one `entity_created` with `kind: 'other'` and
 *      `name: 'x.html'` (the only assertion that proves `target.kind` survived
 *      from `tool_call` to `tool_result`);
 *   3. a `.html` that STARTS with `---\ncomponent: photo\n---\n` is NOT blocked
 *      while the same prefix on a `.md` IS (the photo gate's short-circuit);
 *   4. an `edit` on a `.html` whose text contains `on:` is not blocked and its
 *      receipt is not an error (the explicit T2 skip).
 *
 * `packages/shared` must be built first (`pnpm --filter @airp/shared build`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJiti } from '../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  tryNative: true,
  alias: {
    '@earendil-works/pi-coding-agent': new URL(
      '../vendor/pi-rp/packages/coding-agent/dist/index.js',
      import.meta.url
    ).pathname,
  },
});
const { default: registerWorldContext } = await jiti.import('../extensions/world-context.ts');
const deps = await jiti.import('../extensions/toolkit/deps.ts');

const HTML = '<!DOCTYPE html>\n<html><head><title>Pothos</title></head><body>hi</body></html>\n';

async function worldRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-html-gate-'));
  await fs.mkdir(path.join(root, 'world', 'a'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'world.json'),
    JSON.stringify({
      id: 'proj-html-1',
      name: 'T',
      description: '',
      author: '',
      genre: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  );
  return root;
}

function fakePi() {
  const handlers = new Map();
  return { pi: { on: (event, handler) => handlers.set(event, handler) }, handlers };
}

function ctx(cwd) {
  return { cwd, sessionManager: { getSessionId: () => 'sess-html' } };
}

/** The gate hook plus the manual "pi-rp writes the file" step it assumes. */
async function gate(hooks, cwd) {
  const verify = (toolCallId, ok) => ({ type: 'tool_result', toolCallId, isError: !ok });
  return {
    call: (toolCallId, toolName, input) => hooks.get('tool_call')({ type: 'tool_call', toolCallId, toolName, input }, ctx(cwd)),
    result: (toolCallId, ok = true) => hooks.get('tool_result')(verify(toolCallId, ok), ctx(cwd)),
  };
}

async function events(root, limit = 20) {
  const { LocalWorldStore } = await import('../packages/shared/dist/store/local-store.js');
  const store = new LocalWorldStore(root);
  try {
    return await store.getEvents(limit);
  } finally {
    store.close();
  }
}

test.afterEach(() => deps.resetDepsForTests());

test('a `.html` write passes the gate; a `.txt` write is still refused', async () => {
  const root = await worldRoot();
  try {
    const { pi, handlers } = fakePi();
    registerWorldContext(pi);
    const g = await gate(handlers, root);

    assert.equal(await g.call('c1', 'write', { path: path.join(root, 'world/a/x.html'), content: HTML }), undefined);

    const blocked = await g.call('c2', 'write', { path: path.join(root, 'world/a/x.txt'), content: HTML });
    assert.equal(blocked.block, true);
    assert.match(blocked.reason.split('\n')[0], /NOT written|Nothing was written/);
    assert.match(blocked.reason, /self-contained \.html page/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the `.html` receipt lands exactly one `entity_created` with kind `other`', async () => {
  const root = await worldRoot();
  try {
    const { pi, handlers } = fakePi();
    registerWorldContext(pi);
    const g = await gate(handlers, root);

    await g.call('c1', 'write', { path: path.join(root, 'world/a/x.html'), content: HTML });
    await fs.writeFile(path.join(root, 'world/a/x.html'), HTML);
    assert.equal(await g.result('c1'), undefined);

    const rows = await events(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'entity_created');
    assert.equal(rows[0].actor.type, 'writer');
    assert.deepEqual(rows[0].detail, { path: 'world/a/x.html', name: 'x.html', kind: 'other' });
    assert.equal(rows[0].layer, 'world/a');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the photo gate short-circuits for `.html` and still fires for `.md`', async () => {
  const root = await worldRoot();
  try {
    const { pi, handlers } = fakePi();
    registerWorldContext(pi);
    const g = await gate(handlers, root);
    const photoish = `---\ncomponent: photo\n---\n${HTML}`;

    assert.equal(await g.call('p1', 'write', { path: path.join(root, 'world/a/page.html'), content: photoish }), undefined);

    const blocked = await g.call('p2', 'write', { path: path.join(root, 'world/a/photo.md'), content: photoish });
    assert.equal(blocked.block, true);
    assert.match(blocked.reason, /component: photo/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an `edit` on a `.html` whose text mentions `on:` is not blocked and its receipt is clean', async () => {
  const root = await worldRoot();
  try {
    const file = path.join(root, 'world/a/live.html');
    const before = '<!DOCTYPE html>\n<html><body>on: do not read this as a binding</body></html>\n';
    const after = '<!DOCTYPE html>\n<html><body>on: do not read this as a binding, edited</body></html>\n';
    await fs.writeFile(file, before);

    const { pi, handlers } = fakePi();
    registerWorldContext(pi);
    const g = await gate(handlers, root);

    const proposed = await g.call('e1', 'edit', {
      path: file,
      edits: [{ oldText: 'edited', newText: 'edited again' }],
    });
    assert.equal(proposed, undefined);

    await fs.writeFile(file, after);
    assert.equal(await g.result('e1'), undefined);

    const rows = await events(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'entity_edited');
    assert.equal(rows[0].detail.kind, 'other');
    assert.equal(rows[0].detail.name, 'live.html');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an `on:` that IS a real binding still blocks a `.md` write (control)', async () => {
  const root = await worldRoot();
  try {
    const { pi, handlers } = fakePi();
    registerWorldContext(pi);
    const g = await gate(handlers, root);

    const blocked = await g.call('m1', 'write', {
      path: path.join(root, 'world/a/bad.md'),
      content: '---\ntitle: A\non:\n  examine:\n    - run: no-such-command\n---\n\nBody.\n',
    });
    assert.equal(blocked.block, true);
    assert.match(blocked.reason, /NOT written/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
