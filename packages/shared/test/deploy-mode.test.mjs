import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeployModeError, SERVICE_KEYS, loadDeployMode, modeLabel, parseEnvText, resolveDeployMode, viteEnvOf } from '../dist/deploy-mode/node.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const urls = Object.fromEntries(SERVICE_KEYS.map((k) => [k, `https://${k.toLowerCase()}.example`]));

test('parseEnvText: comments, quotes, export, trailing comments', () => {
  assert.deepEqual(parseEnvText('# c\nA=1\nexport B="two words"\nC=x # note\n\nbad line\nD=\'q\''), { A: '1', B: 'two words', C: 'x', D: 'q' });
});

test('resolveDeployMode: nothing is guessed', () => {
  assert.throws(() => resolveDeployMode({}), (e) => e instanceof DeployModeError && /AIRP_DEPLOY/.test(e.message) && /WORLDLINES_LOGIN/.test(e.message));
  assert.throws(() => resolveDeployMode({ AIRP_DEPLOY: 'prod', WORLDLINES_LOGIN: 'on', ...urls }), /AIRP_DEPLOY/);
  assert.throws(() => resolveDeployMode({ AIRP_DEPLOY: 'remote', WORLDLINES_LOGIN: 'off' }), /always has WORLDLINES_LOGIN=on/);
});

test('resolveDeployMode: login on needs every service URL', () => {
  const { AIRP_CHRONICLE_BASE, ...missing } = urls;
  assert.throws(() => resolveDeployMode({ AIRP_DEPLOY: 'remote', WORLDLINES_LOGIN: 'on', ...missing }), /AIRP_CHRONICLE_BASE is not set/);
  assert.throws(() => resolveDeployMode({ AIRP_DEPLOY: 'local', WORLDLINES_LOGIN: 'on', ...urls, AIRP_ID_BASE: 'http://evil.example' }), /AIRP_ID_BASE is not an https URL/);
  const m = resolveDeployMode({ AIRP_DEPLOY: 'remote', WORLDLINES_LOGIN: 'on', ...urls, AIRP_DATA_BASE: 'https://d.example/' });
  assert.equal(m.services.AIRP_DATA_BASE, 'https://d.example');
});

test('resolveDeployMode: login off needs no URL and keeps none', () => {
  const m = resolveDeployMode({ AIRP_DEPLOY: 'local', WORLDLINES_LOGIN: 'off', ...urls });
  assert.equal(m.login, 'off');
  assert.ok(Object.values(m.services).every((v) => v === null));
});

test('modeLabel', () => {
  assert.equal(modeLabel({ deploy: 'remote', login: 'on' }, { version: 'canvas-20261008-1200', sha: 'abc1234' }), 'remote · canvas-20261008-1200 · abc1234');
  assert.equal(modeLabel({ deploy: 'local', login: 'off' }, { version: '0.1.0', sha: 'abc1234' }), 'local · login off · 0.1.0 (abc1234)');
  assert.equal(modeLabel({ deploy: 'local', login: 'on' }, { version: '0.1.0', sha: null }), 'local · login on · 0.1.0');
});

test('the shipped mode files are valid; local is login on; neither holds a key', () => {
  // config/.env.remote stays in the private repository (the public copy has only the local file)
  for (const deploy of ['local', 'remote'].filter((d) => fs.existsSync(path.join(REPO, 'config', `.env.${d}`)) || d === 'local')) {
    const text = fs.readFileSync(path.join(REPO, 'config', `.env.${deploy}`), 'utf8');
    assert.doesNotMatch(text, /(_KEY|_TOKEN|_SECRET|PASSWORD)\s*=\s*\S/, `config/.env.${deploy} must hold public values only`);
    const env = {};
    const m = loadDeployMode({ repoRoot: REPO, env, deploy });
    assert.equal(m.deploy, deploy);
    assert.equal(m.login, 'on');
  }
});

test('loadDeployMode: explicit mode, file merged without overriding, login off turns reporting off', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config/.env.local'), `AIRP_DEPLOY=local\nWORLDLINES_LOGIN=on\n${Object.entries(urls).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
  // production callers pass no fallback: no mode → refuse
  assert.throws(() => loadDeployMode({ repoRoot: root, env: {} }), /no build mode given/);
  // the remote file is not there (public copy): a clear error, never a quiet local build
  assert.throws(() => loadDeployMode({ repoRoot: root, env: {}, deploy: 'remote' }), /\.env\.remote is missing/);
  assert.throws(() => loadDeployMode({ repoRoot: root, env: { AIRP_DEPLOY: 'local' }, deploy: 'remote' }), /contradicts/);
  const env = { AIRP_DATA_BASE: 'https://mine.example' };
  const m = loadDeployMode({ repoRoot: root, env, fallback: 'local' });
  assert.equal(m.services.AIRP_DATA_BASE, 'https://mine.example');
  assert.equal(env.AIRP_ID_BASE, urls.AIRP_ID_BASE);
  const off = { WORLDLINES_LOGIN: 'off', AIRP_CHRONICLE_BASE: 'https://c.example' };
  const m2 = loadDeployMode({ repoRoot: root, env: off, deploy: 'local' });
  assert.equal(m2.login, 'off');
  assert.equal(off.AIRP_CHRONICLE_BASE, 'off');
  assert.equal(off.AIRP_DATA_BASE, 'off');
  assert.equal(off.AIRP_AI_ACCOUNT, '0');
  assert.equal(off.AIRP_GUEST_TRIAL, '0', 'no guest trial without login');
  const vite = viteEnvOf(m2, { version: '0.1.0', sha: null });
  assert.equal(vite.VITE_WORLDLINES_LOGIN, 'off');
  assert.equal(vite.VITE_AIRP_CHRONICLE_BASE, 'off');
  assert.equal(vite.VITE_AIRP_ID_BASE, undefined);
});
