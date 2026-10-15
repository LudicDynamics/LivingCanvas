// Browser mode host routes — server assertions. Runs against built dist.
// Nothing paid is called: the model proxy is only exercised on its refusal paths.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createBrowserRuntimeRouter, packImage } from '../dist/routes/browser-runtime.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function unpack(buf) {
  const n = buf.readUInt32LE(0);
  const entries = JSON.parse(buf.subarray(4, 4 + n).toString());
  const out = new Map();
  let off = 4 + n;
  for (const [p, len] of entries) { out.set(p, buf.subarray(off, off + len)); off += len; }
  assert.equal(off, buf.length, 'pack is exactly header + bodies');
  return out;
}

test('image pack carries the chosen template, presets, extensions and pi-rp metadata', () => {
  const files = unpack(packImage(REPO, ['whitechapel']));
  assert.ok(files.has('/repo/templates/whitechapel/world.json'));
  assert.ok(files.has('/repo/presets/writer.json'));
  assert.ok(files.has('/repo/vendor/pi-rp/packages/coding-agent/package.json'));
  assert.ok([...files.keys()].some((p) => p.startsWith('/repo/extensions/')));
  assert.ok(![...files.keys()].some((p) => p.startsWith('/repo/templates/wuwu/')), 'unchosen templates stay out');
  // Platform audio: every file named (so the in-tab server finds a world's theme), none of its bytes shipped.
  const audio = [...files.entries()].filter(([p]) => p.startsWith('/repo/assets/audio/'));
  assert.ok(audio.length > 0, 'platform audio placeholders are in the image');
  assert.ok(audio.some(([p]) => p === '/repo/assets/audio/bgm/calm.mp3'));
  assert.ok(audio.every(([, body]) => (body.length ?? body.byteLength ?? body) === 0), 'placeholders carry no bytes');
});

test('routes: status, dist allowlist, image, model proxy refuses without a key', async () => {
  const app = express();
  app.use('/api/browser-runtime', createBrowserRuntimeRouter(REPO, {}));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/browser-runtime`;
  try {
    const status = await (await fetch(`${base}/status`)).json();
    assert.deepEqual(status.providers, []);
    assert.equal((await fetch(`${base}/dist/..%2F..%2Fpackage.json`)).status, 404);
    assert.equal((await fetch(`${base}/dist/secrets.js`)).status, 404);
    const img = Buffer.from(await (await fetch(`${base}/image?templates=whitechapel,../../etc`)).arrayBuffer());
    assert.ok(unpack(img).has('/repo/templates/whitechapel/world.json'));
    const r = await fetch(`${base}/model/deepseek/v1/chat/completions`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 503);
    assert.equal((await fetch(`${base}/model/nowhere/v1/x`, { method: 'POST', body: '{}' })).status, 503);
  } finally {
    server.close();
  }
});

test('net proxy: allowlisted targets only, strips cookies / hop-by-hop both ways, adds nothing', async () => {
  const seen = [];
  const echo = (await import('node:http')).createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url.startsWith('/base/hop')) { res.writeHead(302, { location: `http://127.0.0.1:${echo.address().port}/base/after` }); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=upstream', 'access-control-allow-origin': '*', 'x-upstream': 'yes' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => echo.listen(0, '127.0.0.1', r));
  const up = `http://127.0.0.1:${echo.address().port}`;
  const app = express();
  app.use('/api/browser-runtime', createBrowserRuntimeRouter(REPO, { AIRP_BROWSER_NET_AUTH: `${up}/base`, AIRP_BROWSER_NET_REMOTE: `${up}/base/remote/` }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/browser-runtime`;
  try {
    assert.deepEqual(await (await fetch(`${base}/net`)).json(), { auth: `${up}/base/`, remote: `${up}/base/remote/` });
    assert.equal((await fetch(`${base}/net/evil/x`)).status, 403);
    assert.equal((await fetch(`${base}/net/constructor/x`)).status, 403);
    assert.equal((await fetch(`${base}/net/model/x`)).status, 403);
    assert.ok([403, 404].includes((await fetch(`${base}/net/remote/%2e%2e/%2e%2e/escape`)).status), 'no climbing out of the target base');
    assert.equal((await fetch(`${base}/net/remote/..%2F..%2Fescape`)).status, 403, 'no encoded slashes');
    assert.equal(seen.length, 0);

    const r = await fetch(`${base}/net/auth/auth/email/start?x=1`, {
      method: 'POST', body: '{"email":"a@b.c"}',
      headers: { 'content-type': 'application/json', authorization: 'Bearer caller-token', cookie: 'host=secret', origin: 'http://127.0.0.1', 'x-forwarded-for': '1.2.3.4' },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(r.headers.get('set-cookie'), null);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal(r.headers.get('x-upstream'), 'yes');
    const got = seen.at(-1);
    assert.equal(got.method, 'POST');
    assert.equal(got.url, '/base/auth/email/start?x=1');
    assert.equal(got.body, '{"email":"a@b.c"}');
    assert.equal(got.headers.authorization, 'Bearer caller-token', 'the caller\'s own bearer passes through');
    for (const h of ['cookie', 'origin', 'x-forwarded-for']) assert.equal(got.headers[h], undefined, `${h} dropped`);

    const hop = await fetch(`${base}/net/auth/hop`, { redirect: 'manual' });
    assert.equal(hop.status, 302);
    assert.equal(hop.headers.get('location'), '/api/browser-runtime/net/auth/after', 'redirects inside the allowlist stay on the proxy');
  } finally {
    server.close();
    echo.close();
  }
});

test('catalog: every edition listed in identity shape, storage-shaped download, blobs by sha256, image has no worlds', async () => {
  const { createHash } = await import('node:crypto');
  const app = express();
  app.use('/api/browser-runtime', createBrowserRuntimeRouter(REPO, {}));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/browser-runtime`;
  try {
    const img = unpack(Buffer.from(await (await fetch(`${base}/image`)).arrayBuffer()));
    assert.ok(![...img.keys()].some((p) => p.startsWith('/repo/templates/')), 'default image carries no world bodies');
    const { resources, next_cursor } = await (await fetch(`${base}/catalog/v1/resources?scope=public&product=livingcanvas&kind=world`)).json();
    assert.equal(next_cursor, null);
    const ids = resources.map((r) => r.id);
    for (const id of ['whitechapel', 'whitechapel-zh', 'whitechapel-jp']) assert.ok(ids.includes(id), `${id} listed`);
    const zh = resources.find((r) => r.id === 'whitechapel-zh');
    assert.equal(zh.product, 'livingcanvas'); assert.equal(zh.kind, 'world'); assert.equal(zh.status, 'published');
    assert.equal(zh.meta.edition, 'whitechapel'); assert.equal(zh.meta.locale, 'zh-CN');
    assert.equal(zh.meta.world.id, 'whitechapel-zh');
    assert.ok(zh.meta.cover?.path && /^[0-9a-f]{64}$/.test(zh.meta.cover.sha256));
    assert.match(zh.hash, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual((await (await fetch(`${base}/catalog/v1/resources?scope=mine`)).json()).resources, []);

    const dl = await (await fetch(`${base}/catalog/v1/objects/livingcanvas/world/whitechapel-zh/download-url`)).json();
    assert.equal(dl.hash, zh.hash);
    // storage §2: hash = sha256 over "<sha256> <size> <path>" lines sorted by path
    const lines = dl.files.map((f) => `${f.sha256} ${f.size} ${f.path}\n`).join('');
    assert.equal(dl.hash, `sha256:${createHash('sha256').update(lines).digest('hex')}`);
    assert.deepEqual(dl.files.map((f) => f.path), [...dl.files.map((f) => f.path)].sort());
    const wj = dl.files.find((f) => f.path === 'world.json');
    const body = Buffer.from(await (await fetch(new URL(wj.url, base))).arrayBuffer());
    assert.equal(createHash('sha256').update(body).digest('hex'), wj.sha256);
    assert.equal((await fetch(`${base}/catalog/v1/objects/livingcanvas/world/nope/download-url`)).status, 404);
    assert.equal((await fetch(`${base}/catalog/blob/${'0'.repeat(64)}`)).status, 404);
    assert.equal((await fetch(`${base}/catalog/blob/..%2F..%2Fpackage.json`)).status, 400);
  } finally {
    server.close();
  }
});
