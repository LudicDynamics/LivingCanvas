import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createWorldRouter } from '../dist/routes/world.js';
import { createConnectionSettingsRouter } from '../dist/routes/connection-settings.js';

test('deleted active save detaches once and returns a recoverable response', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-recovery-'));
  let closed = 0, stopped = 0;
  let active = { worldRoot: path.join(root, 'deleted-save'), close() { closed++; } };
  const app = express();
  app.use('/api', createWorldRouter(root, { async stopAll() { stopped++; } }, { close() {} }, () => active, store => { active = store; }));
  app.use('/api', createConnectionSettingsRouter(root));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    for (const endpoint of ['manifest', 'characters', 'layer']) {
      const res = await fetch(`${base}/${endpoint}`);
      assert.equal(res.status, 409);
      assert.equal((await res.json()).code, 'no_active_world');
    }
    assert.equal((await fetch(`${base}/worlds`)).status, 200);
    assert.equal((await fetch(`${base}/connection-settings`)).status, 200);
    assert.equal(active, null); assert.equal(closed, 1); assert.equal(stopped, 1);
    assert.equal(fs.existsSync(path.join(root, 'deleted-save')), false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true }); }
});

test('connection settings protect credentials and preserve unrelated environment', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-connections-'));
  const previous = process.env.DASHSCOPE_API_KEY;
  fs.writeFileSync(path.join(root, '.env.local'), '# Keep this\nUNRELATED=value\n');
  const app = express(); app.use(express.json()); app.use('/api', createConnectionSettingsRouter(root));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/connection-settings`;
  const send = (body, extra = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AIRP-Settings': '1', ...extra }, body: JSON.stringify(body) });
  try {
    assert.equal((await send({ DASHSCOPE_API_KEY: 'test-only-credential' }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await send({ DASHSCOPE_API_KEY: 'test-only-credential' }, { 'X-Forwarded-For': '100.1.2.3' })).status, 403);
    assert.equal((await send({ DASHSCOPE_API_KEY: 'test-only-credential' })).status, 200);
    const config = await (await fetch(url)).text();
    assert.equal(JSON.parse(config).DASHSCOPE_API_KEY, true);
    assert.ok(!config.includes('test-only-credential'));
    assert.equal((await send({ DASHSCOPE_API_KEY: '' })).status, 200);
    assert.equal(process.env.DASHSCOPE_API_KEY, 'test-only-credential');
    assert.equal((await send({ DASHSCOPE_API_KEY: 'bad\nINJECTED=yes' })).status, 400);
    assert.match(fs.readFileSync(path.join(root, '.env.local'), 'utf8'), /UNRELATED=value/);
    assert.equal(fs.statSync(path.join(root, '.env.local')).mode & 0o777, 0o600);
  } finally {
    if (previous === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = previous;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true });
  }
});
