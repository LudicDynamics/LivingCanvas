import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createConnectionSettingsRouter } from '../dist/routes/connection-settings.js';
import { readLocalTtsConfig } from '../dist/routes/local-tts.js';

const fields = ['AIRP_TTS_LOCAL_BASE_URL', 'AIRP_TTS_LOCAL_VOICE', 'AIRP_TTS_LOCAL_TIMEOUT_MS', 'AIRP_TTS_LOCAL_API_KEY', 'AIRP_TTS_CHARACTER_VOICES'];

async function harness(t) {
  const before = Object.fromEntries(fields.map(key => [key, process.env[key]]));
  for (const key of fields) delete process.env[key];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-local-tts-settings-'));
  const file = path.join(root, '.env.local');
  fs.writeFileSync(file, '# Preserved\nOTHER_SETTING=existing\n');
  const app = express();
  app.use(express.json());
  app.use('/api', createConnectionSettingsRouter(root));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
    for (const key of fields) {
      if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    }
  });
  const url = `http://127.0.0.1:${server.address().port}/api/connection-settings`;
  return {
    root, file, get: () => fetch(url),
    save: (body, headers = {}) => fetch(url, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AIRP-Settings': '1', ...headers }, body: JSON.stringify(body) }),
  };
}

test('Nanami configuration is persisted, immediately applied, and never exposes its key', async t => {
  const h = await harness(t);
  const initial = await (await h.get()).json();
  assert.equal(initial.AIRP_TTS_LOCAL_BASE_URL, '');
  assert.equal(initial.AIRP_TTS_LOCAL_VOICE, 'setsuna');
  assert.equal(initial.AIRP_TTS_LOCAL_TIMEOUT_MS, '20000');
  assert.equal(initial.AIRP_TTS_LOCAL_API_KEY, false);
  const update = { AIRP_TTS_LOCAL_BASE_URL: 'http://198.51.100.1:8090', AIRP_TTS_LOCAL_VOICE: 'setsuna_v2',
    AIRP_TTS_LOCAL_TIMEOUT_MS: '45000', AIRP_TTS_LOCAL_API_KEY: 'test-only-secret', AIRP_TTS_CHARACTER_VOICES: 'vera=setsuna,nanami=online' };
  assert.equal((await h.save(update)).status, 200);
  assert.deepEqual(readLocalTtsConfig(), { baseUrl: update.AIRP_TTS_LOCAL_BASE_URL, voice: 'setsuna_v2', timeoutMs: 45000, apiKey: 'test-only-secret' });
  const response = await h.get();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  assert.equal(JSON.parse(body).AIRP_TTS_LOCAL_API_KEY, true);
  assert.equal(JSON.parse(body).AIRP_TTS_CHARACTER_VOICES, 'vera=setsuna,nanami=online');
  assert.ok(!body.includes('test-only-secret'));
  const saved = fs.readFileSync(h.file, 'utf8');
  assert.match(saved, /OTHER_SETTING=existing/);
  assert.match(saved, /AIRP_TTS_LOCAL_TIMEOUT_MS="45000"/);
  assert.equal((await h.save({ AIRP_TTS_LOCAL_API_KEY: '', AIRP_TTS_LOCAL_BASE_URL: '' })).status, 200);
  assert.equal(readLocalTtsConfig().baseUrl, '');
  assert.equal(readLocalTtsConfig().apiKey, 'test-only-secret');
  assert.match(fs.readFileSync(h.file, 'utf8'), /AIRP_TTS_LOCAL_BASE_URL=""/);
});

test('Invalid local settings are rejected atomically without damaging existing configuration', async t => {
  const h = await harness(t);
  const before = fs.readFileSync(h.file, 'utf8');
  for (const invalid of [
    { AIRP_TTS_LOCAL_BASE_URL: 'file:///etc/passwd' },
    { AIRP_TTS_LOCAL_BASE_URL: 'http://user:password@localhost:8090' },
    { AIRP_TTS_LOCAL_BASE_URL: 'http://localhost:8090?key=secret' },
    { AIRP_TTS_LOCAL_VOICE: '../voice' },
    { AIRP_TTS_LOCAL_TIMEOUT_MS: '0' },
    { AIRP_TTS_LOCAL_TIMEOUT_MS: '120001' },
    { AIRP_TTS_LOCAL_TIMEOUT_MS: '1.5' },
    { AIRP_TTS_LOCAL_TIMEOUT_MS: 30000 },
    { AIRP_TTS_LOCAL_API_KEY: 'key\nINJECTED=bad' },
  ]) {
    assert.equal((await h.save({ AIRP_TTS_LOCAL_VOICE: 'new-voice', ...invalid })).status, 400);
    assert.equal(fs.readFileSync(h.file, 'utf8'), before);
    assert.equal(readLocalTtsConfig().voice, 'setsuna');
  }
});

test('Local voice configuration retains the existing localhost and CSRF boundary', async t => {
  const h = await harness(t);
  const update = { AIRP_TTS_LOCAL_BASE_URL: 'http://localhost:8090' };
  for (const headers of [{ Origin: 'https://example.com' }, { 'X-Forwarded-For': '198.51.100.2' }, { 'X-AIRP-Settings': '' }]) {
    assert.equal((await h.save(update, headers)).status, 403);
  }
  assert.equal(readLocalTtsConfig().baseUrl, '');
});
