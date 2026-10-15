// M4 server assembly: the three fetch points that
// turn file bytes into a renderable item must synthesise the `.html` virtual
// frontmatter and an EMPTY body. The body half is the load-bearing one — a
// leaked body means HTML source reaches the writer's per-turn injection
//, so T10 asserts on the rendered text, not on the route.
// T13 is the static half: one definition of the choke point is the whole point,
// and runtime cannot tell one copy from five.
// Runs against built dist: `pnpm --filter @airp/server build` first.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { LocalWorldStore } from '@airp/shared';
import { createWorldRouter } from '../dist/routes/world.js';
import { EventBridge } from '../dist/engine/event-bridge.js';

const MANIFEST = JSON.stringify({
  id: 'html-assembly',
  name: 'HTML assembly',
  description: '',
  author: '',
  genre: 'test',
  createdAt: '',
  updatedAt: '',
  characters: [{ id: 'ryo', name: 'Ryo', home: 'world/map' }],
});

const PAGE = [
  '<!DOCTYPE html>',
  '<html><head>',
  '<title>Custom Puzzle</title>',
  '<meta name="description" content="A geometry puzzle rendered as a live page.">',
  '<style>body { margin: 0; display: flex; }</style>',
  '</head><body><svg></svg></body></html>',
].join('\n');

const LIFECYCLE = { stopCharacters: async () => {}, startWriter: async () => {}, stopAll: async () => {} };

async function harness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-html-assembly-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', MANIFEST);
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('world/a/README.md', '---\nname: A\ntype: readme\n---\n\n# A\n');
  await store.writeFile('world/a/page.html', PAGE);
  await store.writeFile('world/a/note.md', '---\ntitle: A note\ntype: note\n---\n\nBody text.\n');
  await store.writeFile('player/README.md', '---\nname: Bag\n---\n\n# Bag\n');
  await store.writeFile('player/page.html', PAGE);
  await store.writeFile('player/keep.md', '---\ntitle: Keepsake\ntype: note\n---\n\nKept.\n');
  await store.writeFile('characters/ryo/README.md', '---\nname: Ryo\ntype: readme\n---\n\n# Ryo\n');
  await store.writeFile('characters/ryo/desk.html', PAGE);
  await store.writeFile('characters/ryo/office/README.md', '---\nname: Office\ntype: readme\n---\n\n# Office\n');
  await store.writeFile('characters/ryo/office/board.html', PAGE);

  const app = express();
  app.use(express.json());
  app.use('/api', createWorldRouter(process.cwd(), LIFECYCLE, new EventBridge(), () => store, () => {}));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    store,
    base,
    get: async (route) => {
      const r = await fetch(base + route);
      assert.equal(r.status, 200, `${route} -> ${r.status}`);
      return r.json();
    },
    close: async () => {
      await new Promise((r) => server.close(r));
      store.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

// T9 — the layer's virtual frontmatter AND the footprint it drives. `w === 360`
// is the CARD_FORMS.html assertion (contract §4.3): with the row missing the
// skeleton silently draws nothing, so the number is the observable.
test('T9 GET /api/layer returns the .html virtual frontmatter with an empty body', async () => {
  const h = await harness();
  try {
    const layer = await h.get('/layer?layer=world/a');
    const item = layer.items.find((it) => it.path === 'world/a/page.html');
    assert.ok(item, 'the .html card is on the layer');
    assert.equal(item.frontmatter.type, 'html');
    assert.equal(item.frontmatter.title, 'Custom Puzzle');
    assert.equal(item.frontmatter.preview, 'A geometry puzzle rendered as a live page.');
    assert.equal(item.frontmatter.design, 'desktop');
    assert.equal(item.body, '', 'page source must never ride along as the body');
    assert.equal(item.kind, 'html');
    assert.equal(item.w, 360);
    assert.equal(item.h, 203);

    // The `.md` sibling is untouched — this route serves both kinds now.
    const note = layer.items.find((it) => it.path === 'world/a/note.md');
    assert.equal(note.frontmatter.title, 'A note');
    assert.equal(note.body.trim(), 'Body text.');
    assert.equal(note.kind, 'note');
  } finally {
    await h.close();
  }
});

// T10 — the per-turn injection face. `displayItemOf`'s empty body is what keeps
// page source out of the writer's context; assert on the rendered block so a
// future change that re-leaks the source fails here.
test('T10 the layer block prints no HTML source for the .html card', async () => {
  const h = await harness();
  try {
    const { displayItemOf, renderLayerBlock, summaryOf } = await import('@airp/shared');
    const raw = await h.store.readFile('world/a/page.html');
    const item = displayItemOf('world/a/page.html', raw);
    assert.equal(item.body, '');
    const summary = summaryOf(item.frontmatter, item.body);
    assert.equal(summary.includes('<'), false, summary);
    assert.equal(summary.includes('DOCTYPE'), false, summary);
    assert.equal(summary.includes('display: flex'), false, summary);
    assert.equal(summary, 'A geometry puzzle rendered as a live page.');
    assert.equal(typeof renderLayerBlock, 'function');
  } finally {
    await h.close();
  }
});

// T11 — backpack: virtual frontmatter keeps the sidebar title (field names are a
// cross-end contract) while the body stays empty.
test('T11 GET /api/backpack returns the .html virtual frontmatter with an empty body', async () => {
  const h = await harness();
  try {
    const bag = await h.get('/backpack');
    const page = bag.items.find((it) => it.path === 'player/page.html');
    assert.ok(page, 'the .html keepsake is in the bag');
    assert.equal(page.filename, 'page.html');
    assert.equal(page.frontmatter.type, 'html');
    assert.equal(page.frontmatter.title, 'Custom Puzzle');
    assert.equal(page.body, '');
    const keep = bag.items.find((it) => it.path === 'player/keep.md');
    assert.equal(keep.filename, 'keep.md');
    assert.equal(keep.frontmatter.title, 'Keepsake');
    assert.equal(keep.body.trim(), 'Kept.');
  } finally {
    await h.close();
  }
});

// T12 — both nook membership scans (root via nookCardPaths, sub-scene via
// cardsOfLayer) route through `readLayerItems`, so both halves must land.
test('T12 GET /api/nook returns .html cards on the root and the sub-scene', async () => {
  const h = await harness();
  try {
    const root = await h.get('/nook?character=ryo');
    const desk = root.items.find((it) => it.path === 'characters/ryo/desk.html');
    assert.ok(desk, 'root scene sees the .html card');
    assert.equal(desk.frontmatter.type, 'html');
    assert.equal(desk.frontmatter.title, 'Custom Puzzle');
    assert.equal(desk.body, '');
    const sub = await h.get('/nook?character=ryo&scene=office');
    const board = sub.items.find((it) => it.path === 'characters/ryo/office/board.html');
    assert.ok(board, 'sub-scene sees the .html card');
    assert.equal(board.frontmatter.type, 'html');
    assert.equal(board.body, '');
  } finally {
    await h.close();
  }
});

// A `.html` page whose body starts with `---` is the case that proves the branch
// is extension-driven: `parseFrontmatter` would read the block and leak the rest.
test('a .html whose body opens with a --- block still takes the html path', async () => {
  const h = await harness();
  try {
    await h.store.writeFile('world/a/dashes.html', '---\ntitle: Sneaky\n---\n<html><title>Dashes</title></html>');
    const layer = await h.get('/layer?layer=world/a');
    const item = layer.items.find((it) => it.path === 'world/a/dashes.html');
    assert.equal(item.frontmatter.title, 'Dashes', 'NOT the YAML title');
    assert.equal(item.body, '');

  } finally {
    await h.close();
  }
});

// T13 — uniqueness, counted by FUNCTION NAME. Counting
// `/\.html$/i` literals would be a false assertion (`html-head.ts` holds two:
// the predicate and the basename stripper), so the name is the reliable anchor:
// a missing export does not compile.
test('T13 displayItemOf and isHtmlPath each have exactly one definition', () => {
  const repo = path.resolve(import.meta.dirname, '..', '..', '..');
  const grep = (pattern, ...roots) => {
    try {
      return execFileSync('grep', ['-rn', pattern, ...roots], { cwd: repo, encoding: 'utf8' })
        .trim().split('\n').filter(Boolean);
    } catch (error) {
      if (error.status === 1) return [];
      throw error;
    }
  };
  assert.deepEqual(
    grep('export function displayItemOf', 'packages/shared/src', 'apps/server/src').map((line) => line.split(':')[0]),
    ['packages/shared/src/rules/html-item.ts'],
  );
  assert.deepEqual(
    grep('export function isHtmlPath', 'packages/shared/src').map((line) => line.split(':')[0]),
    ['packages/shared/src/rules/html-head.ts'],
  );
});
