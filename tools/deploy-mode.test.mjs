// tools/deploy-mode.mjs: the shell side of the build mode, and the gate on a built browser site.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { siteProblems } from './deploy-mode.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'deploy-mode.mjs');
const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: os.tmpdir() } });
const services = { AIRP_ID_BASE: 'https://auth.example', AIRP_STORAGE_BASE: 'https://storage.example' };
const mode = { deploy: 'remote', login: 'on', services };

function site({ deploy = 'remote', login = 'on', urls = services, server = 'function refreshTokens(){}\nvar IdentityError = class extends Error {}' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.mkdirSync(path.join(dir, 'runtime/abc'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  const env = { VITE_AIRP_DEPLOY: deploy, VITE_WORLDLINES_LOGIN: login, ...Object.fromEntries(Object.entries(urls).map(([k, v]) => [`VITE_${k}`, v])) };
  fs.writeFileSync(path.join(dir, 'assets/index-1.js'), `const e=${JSON.stringify(env)};`.replace(/"(VITE_[A-Z_]+)":/g, '$1:'));
  fs.writeFileSync(path.join(dir, 'runtime/abc/server.js'), server);
  return dir;
}

test('env: the mode must be said; remote prints the remote file, never a default', () => {
  const none = run('env');
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /say the mode/);
  if (fs.existsSync(path.join(HERE, '../config/.env.remote'))) { // private repository only
    const r = run('env', 'remote');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^export AIRP_DEPLOY='remote'/m);
    assert.match(r.stdout, /^export AIRP_ID_BASE='https:\/\//m);
  }
  const l = run('env', 'local');
  assert.match(l.stdout, /WORLDLINES_LOGIN='on'/);
});

test('check-site: a complete remote build passes', () => {
  assert.deepEqual(siteProblems(site(), mode), []);
});

test('check-site: wrong mode, missing URL or no identity client in server.js fail', () => {
  assert.match(siteProblems(site({ deploy: 'local' }), mode).join('\n'), /VITE_AIRP_DEPLOY=remote/);
  assert.match(siteProblems(site({ urls: { AIRP_ID_BASE: services.AIRP_ID_BASE } }), mode).join('\n'), /VITE_AIRP_STORAGE_BASE/);
  assert.match(siteProblems(site({ server: 'import(CLIENT_URL)' }), mode).join('\n'), /refreshTokens/);
});
