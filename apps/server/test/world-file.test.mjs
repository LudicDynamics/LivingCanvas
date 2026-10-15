// `GET /api/world-file` plus the
// §7.3 R1–R6 regression guards for the reused `/api/asset` chain.
// Runs against built dist: `pnpm --filter @airp/server build`
// first. Every case below is one row of the frozen §7.2 response table; the
// `reason` split between the lexical phase (`path`) and the realpath phase
// (`symlink`) is the one place the contract wording was amended (§11 冲突 2).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { ActionError, LocalWorldStore, assertAssetReference, isAllowedMediaReference } from '@airp/shared';
import { createWorldRouter } from '../dist/routes/world.js';
import { EventBridge } from '../dist/engine/event-bridge.js';

const MANIFEST = JSON.stringify({
  id: 'world-file-test',
  name: 'World file test',
  description: '',
  author: '',
  genre: 'test',
  createdAt: '',
  updatedAt: '',
});

const PAGE = '<!DOCTYPE html><html><head><title>Custom Puzzle</title></head><body>hi</body></html>';

const LIFECYCLE = { stopCharacters: async () => {}, startWriter: async () => {}, stopAll: async () => {} };

/** Temp world + router. `getStore` is injectable so the 409 case can detach it. */
async function harness(getStore) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-world-file-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', MANIFEST);
  await store.writeFile('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
  await store.writeFile('world/a/page.html', PAGE);
  await store.writeFile('world/a/UPPER.HTML', '<title>Upper</title>');
  await store.writeFile('world/a/y.md', '---\ntitle: Y\n---\n\nY.\n');
  await fs.mkdir(path.join(root, 'world/sub.html'), { recursive: true });
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets/photo.png'), Buffer.from('89504e470d0a1a0a', 'hex'));

  const app = express();
  app.use(express.json());
  app.use('/api', createWorldRouter(process.cwd(), LIFECYCLE, new EventBridge(), getStore ?? (() => store), () => {}));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    root,
    store,
    base,
    get: (route) => fetch(base + route),
    close: async () => {
      await new Promise((r) => server.close(r));
      store.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

async function expectError(response, status, code, reason) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, code);
  if (reason !== undefined) assert.equal(body.details?.reason, reason, JSON.stringify(body));
  return body;
}

// T4 — the success path: bytes, the lowercase UTF-8 content type, and `no-cache`
// (world files are AI-rewritable, so `immutable` would serve a stale page).
test('T4 GET /api/world-file serves a world .html with text/html and no-cache', async () => {
  const h = await harness();
  try {
    const response = await h.get('/world-file?path=world/a/page.html');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.equal(await response.text(), PAGE);
  } finally {
    await h.close();
  }
});

// T5 — case-insensitive extension, all the way to the response.
test('T5 GET /api/world-file accepts an uppercase .HTML extension', async () => {
  const h = await harness();
  try {
    const response = await h.get('/world-file?path=world/a/UPPER.HTML');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<title>Upper</title>');
  } finally {
    await h.close();
  }
});

// T1/T2 — V7 items 1 and 2: a `.md` and a `.png` are both 403. The `.png` is
// rejected for its EXTENSION, not its root: the world-file policy approves any
// position inside the world, so the root check never fires here.
test('T1/T2 GET /api/world-file rejects .md and .png with reason extension', async () => {
  const h = await harness();
  try {
    await expectError(await h.get('/world-file?path=world/a/y.md'), 403, 'invalid_asset_ref', 'extension');
    await expectError(await h.get('/world-file?path=assets/photo.png'), 403, 'invalid_asset_ref', 'extension');
  } finally {
    await h.close();
  }
});

// T3 — V7 item 3. The lexical phase reports `path`, not `symlink` (§11 冲突 2).
test('T3 GET /api/world-file rejects a lexical escape with reason path', async () => {
  const h = await harness();
  try {
    await expectError(await h.get('/world-file?path=../outside.html'), 403, 'invalid_asset_ref', 'path');
    // Trailing slash: an empty final segment, same lexical family.
    await expectError(await h.get('/world-file?path=world/a/'), 403, 'invalid_asset_ref', 'path');
  } finally {
    await h.close();
  }
});

// T7 — three branches: missing, directory, symlink escape.
test('T7 GET /api/world-file maps not_found 404 / file_type 403 / symlink 403', async () => {
  const h = await harness();
  try {
    await expectError(await h.get('/world-file?path=world/a/nope.html'), 404, 'invalid_asset_ref', 'not_found');
    await expectError(await h.get('/world-file?path=world/sub.html'), 403, 'invalid_asset_ref', 'file_type');
  } finally {
    await h.close();
  }
});

test(
  'T7 GET /api/world-file rejects a symlink escaping the world root',
  { skip: process.platform === 'win32' ? 'symlink fixture requires POSIX' : false },
  async () => {
    const h = await harness();
    try {
      await fs.writeFile(path.join(path.dirname(h.root), `outside-${path.basename(h.root)}.html`), '<title>outside</title>');
      await fs.symlink(
        path.join(path.dirname(h.root), `outside-${path.basename(h.root)}.html`),
        path.join(h.root, 'world/a/escape.html'),
      );
      await expectError(await h.get('/world-file?path=world/a/escape.html'), 403, 'invalid_asset_ref', 'symlink');
    } finally {
      await fs.rm(path.join(path.dirname(h.root), `outside-${path.basename(h.root)}.html`), { force: true });
      await h.close();
    }
  },
);

// T8 — a missing and an empty `path` are a 400, NOT the 403 an empty segment
// would produce if it reached `assetSegments`.
test('T8 GET /api/world-file requires a non-empty path query', async () => {
  const h = await harness();
  try {
    await expectError(await h.get('/world-file'), 400, 'invalid_argument');
    await expectError(await h.get('/world-file?path='), 400, 'invalid_argument');
  } finally {
    await h.close();
  }
});

// T6 — pins the `needsWorld` entry. Without it this answers 400
// `{error:'No active world'}` and the client never sees `no_active_world`.
test('T6 GET /api/world-file with no active world answers 409 no_active_world', async () => {
  const h = await harness(() => null);
  try {
    const response = await h.get('/world-file?path=world/a/page.html');
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'no_active_world');
  } finally {
    await h.close();
  }
});

// ── §7.3 R1–R6: the reused chain must not drift while being parameterised ──

// R1 — `isAllowedMediaReference` keeps its 1-arg shape and the ASSET policy.
test('R1 isAllowedMediaReference keeps one argument and the asset policy', async () => {
  assert.equal(isAllowedMediaReference.length, 1);
  assert.equal(isAllowedMediaReference('assets/photo.png'), true);
  assert.equal(isAllowedMediaReference('.airpworld/assets/generated.webp'), true);
  assert.equal(isAllowedMediaReference('world/a/x.html'), false);
  assert.equal(isAllowedMediaReference('assets/'), false);
});

// R2 — the ASSET policy's four root boundaries survive verbatim. The bare roots
// are the ones a `length > 1` rewording would silently accept.
test('R2 the asset policy keeps its exact root boundaries', async () => {
  const h = await harness();
  try {
    const cases = [
      ['assets', 'path'],
      ['.airpworld', 'path'],
      ['.airpworld/other', 'path'],
      ['.airpworld/assets', 'path'],
    ];
    for (const [rel, reason] of cases) {
      await assert.rejects(
        () => assertAssetReference(h.root, rel, 'image'),
        (error) => {
          assert.ok(error instanceof ActionError, rel);
          assert.equal(error.code, 'invalid_asset_ref', rel);
          assert.equal(error.details.reason, reason, rel);
          return true;
        },
      );
    }
    // A legal reference still resolves: the policy is not merely stricter.
    assert.equal((await assertAssetReference(h.root, 'assets/photo.png', 'image')).mimeType, 'image/png');
  } finally {
    await h.close();
  }
});

// R3 — the two 403 messages must NOT be merged into one. This is the only risk
// with an observable external difference: `/api/asset`'s `error` text.
test('R3 /api/asset 403 error text is byte-identical to its baseline', async () => {
  const h = await harness();
  try {
    const lexical = await h.get('/asset?path=world/a/y.md&kind=image');
    assert.equal(lexical.status, 403);
    assert.equal(
      (await lexical.json()).error,
      'Asset reference must be under assets/ or .airpworld/assets/.',
    );

    const escape = await h.get('/asset?path=../x.png&kind=image');
    assert.equal(escape.status, 403);
    assert.equal((await escape.json()).error, 'Asset reference must be under assets/ or .airpworld/assets/.');

    const segment = await h.get('/asset?path=assets/&kind=image');
    assert.equal(segment.status, 403);
    assert.equal((await segment.json()).error, 'Asset reference contains an invalid path segment.');
  } finally {
    await h.close();
  }
});

// R5/R6 — `audio` must stay an explicit branch, and `world-file` must remain a
// lane the PUBLIC api cannot reach: the type is not widened, so the only way to
// hit it is a cast, which the policy still rejects.
test('R5/R6 the audio lane survives and world-file is unreachable from assertAssetReference', async () => {
  const h = await harness();
  try {
    await fs.writeFile(path.join(h.root, 'assets/clip.mp3'), 'ID3');
    assert.equal((await assertAssetReference(h.root, 'assets/clip.mp3', 'audio')).mimeType, 'audio/mpeg');
    await assert.rejects(
      () => assertAssetReference(h.root, 'world/a/page.html', 'world-file'),
      (error) => {
        assert.equal(error.code, 'invalid_asset_ref');
        assert.equal(error.details.reason, 'media_kind');
        return true;
      },
    );
  } finally {
    await h.close();
  }
});
