import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createModeRouter, startDeployMode } from '../dist/deploy-mode.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const URLS = 'AIRP_ID_BASE=https://auth.example\nAIRP_STORAGE_BASE=https://storage.example\nAIRP_AI_ACCOUNT_BASE=https://ai.example/v1\nAIRP_BILLING_BASE=https://billing.example\nAIRP_CHRONICLE_BASE=https://chronicle.example\nAIRP_DATA_BASE=https://data.example\n';

function root(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-mode-'));
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"version":"9.9.9"}');
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'config', name), text);
  return dir;
}

async function serve(t) {
  const app = express();
  app.use(express.json());
  app.use('/api', createModeRouter());
  app.post('/api/remote/login', (_req, res) => res.json({ ok: true, reached: true }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('local, login on: health reports mode + version; login routes pass', async (t) => {
  const env = { AIRP_BUILD_SHA: 'abc1234' };
  const m = startDeployMode(root({ '.env.local': `AIRP_DEPLOY=local\nWORLDLINES_LOGIN=on\n${URLS}` }), env);
  assert.equal(m.label, 'local · login on · 9.9.9 (abc1234)');
  assert.equal(m.identityClient, true, 'the identity client is a static import of this server');
  const base = await serve(t);
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.deepEqual(h, { ok: true, deploy: 'local', login: 'on', version: '9.9.9', sha: 'abc1234', label: m.label, identityClient: true });
  assert.equal((await fetch(`${base}/api/remote/login`, { method: 'POST' })).status, 200);
});

test('local, login off: sign-in refused, reporting services off', async (t) => {
  const env = {};
  const m = startDeployMode(root({ '.env.local': `AIRP_DEPLOY=local\nWORLDLINES_LOGIN=off\n${URLS}` }), env);
  assert.equal(m.mode.login, 'off');
  assert.equal(env.AIRP_CHRONICLE_BASE, 'off');
  assert.equal(env.AIRP_AI_ACCOUNT, '0');
  const base = await serve(t);
  const r = await fetch(`${base}/api/remote/login`, { method: 'POST' });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'login_off');
  assert.match((await (await fetch(`${base}/api/health`)).json()).label, /^local · login off · 9\.9\.9/);
});

test('play asks for an account only where a sign-in exists (login on); login off never gates a world', async () => {
  const { playRequiresAccount } = await import('../dist/sync/remote-client.js');
  const saved = process.env.AIRP_PLAY_WITHOUT_ACCOUNT;
  delete process.env.AIRP_PLAY_WITHOUT_ACCOUNT;
  try {
    startDeployMode(root({ '.env.local': `AIRP_DEPLOY=local\nWORLDLINES_LOGIN=on\n${URLS}` }), {});
    assert.equal(playRequiresAccount(), true);
    startDeployMode(root({ '.env.local': `AIRP_DEPLOY=local\nWORLDLINES_LOGIN=off\n${URLS}` }), {});
    assert.equal(playRequiresAccount(), false, 'the account panel cannot sign in here, so it must not stand in front of a world');
  } finally {
    if (saved === undefined) delete process.env.AIRP_PLAY_WITHOUT_ACCOUNT; else process.env.AIRP_PLAY_WITHOUT_ACCOUNT = saved;
  }
});

test('which worlds ask for an account: local login on = shared only, local login off = none, remote = all', async () => {
  const { playAccountScope, guestTrialOn, remoteSettingsView } = await import('../dist/sync/remote-client.js');
  const saved = { play: process.env.AIRP_PLAY_WITHOUT_ACCOUNT, guest: process.env.AIRP_GUEST_TRIAL, config: process.env.AIRP_REMOTE_CONFIG };
  delete process.env.AIRP_PLAY_WITHOUT_ACCOUNT;
  process.env.AIRP_REMOTE_CONFIG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'srv-mode-remote-')), 'remote.json');
  try {
    // Local, login on: the worlds on this computer play with the player's own key; no guest trial (nothing is locked).
    startDeployMode(root({ '.env.local': `AIRP_DEPLOY=local\nWORLDLINES_LOGIN=on\nAIRP_GUEST_TRIAL=1\n${URLS}` }), { AIRP_GUEST_TRIAL: '1' });
    process.env.AIRP_GUEST_TRIAL = '1';
    assert.equal(playAccountScope(), 'shared');
    assert.equal(guestTrialOn(), false, 'the local worlds are open: there is nothing for a guest trial to unlock');
    const view = await remoteSettingsView();
    assert.deepEqual([view.playRequiresAccount, view.playAccountScope, view.guestTrial], [true, 'shared', false]);
    // Local, login off: nothing asks.
    startDeployMode(root({ '.env.local': `AIRP_DEPLOY=local\nWORLDLINES_LOGIN=off\n${URLS}` }), {});
    assert.equal(playAccountScope(), 'none');
    // Remote (canvas.worldlines.gg): every world asks, and the guest trial works as before.
    startDeployMode(root({ '.env.remote': `AIRP_DEPLOY=remote\nWORLDLINES_LOGIN=on\n${URLS}` }), { AIRP_DEPLOY: 'remote', AIRP_RELEASE: 'canvas-20261015-1200' });
    process.env.AIRP_GUEST_TRIAL = '1';
    assert.equal(playAccountScope(), 'all');
    assert.equal(guestTrialOn(), true);
    const hosted = await remoteSettingsView();
    assert.deepEqual([hosted.playRequiresAccount, hosted.playAccountScope, hosted.guestTrial], [true, 'all', true]);
    // AIRP_PLAY_WITHOUT_ACCOUNT=1 still opens everything on this computer.
    process.env.AIRP_PLAY_WITHOUT_ACCOUNT = '1';
    assert.equal(playAccountScope(), 'none');
  } finally {
    for (const [k, v] of [['AIRP_PLAY_WITHOUT_ACCOUNT', saved.play], ['AIRP_GUEST_TRIAL', saved.guest], ['AIRP_REMOTE_CONFIG', saved.config]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('remote without its file, or login on without a URL: refuse to start', () => {
  assert.throws(() => startDeployMode(root({}), { AIRP_DEPLOY: 'remote' }), /\.env\.remote is missing/);
  assert.throws(() => startDeployMode(root({ '.env.remote': 'AIRP_DEPLOY=remote\nWORLDLINES_LOGIN=on\nAIRP_ID_BASE=https://auth.example\n' }), { AIRP_DEPLOY: 'remote', AIRP_RELEASE: 'canvas-20261008-1200' }), /AIRP_STORAGE_BASE is not set/);
  const m = startDeployMode(root({ '.env.remote': `AIRP_DEPLOY=remote\nWORLDLINES_LOGIN=on\n${URLS}` }), { AIRP_DEPLOY: 'remote', AIRP_RELEASE: 'canvas-20261008-1200', AIRP_BUILD_SHA: 'abc1234' });
  assert.equal(m.label, 'remote · canvas-20261008-1200 · abc1234');
});

test('the real server exits non-zero on a broken mode', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'apps/server/dist/index.js')], {
    env: { PATH: process.env.PATH, HOME: os.tmpdir(), AIRP_DEPLOY: 'local', WORLDLINES_LOGIN: 'maybe', PORT: '0', AIRP_REPO_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'srv-root-')) },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /WORLDLINES_LOGIN must be "on" or "off"/);
});
