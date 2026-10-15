// What an agent process may see of the server's environment
// (apps/server/src/engine/agent-env.ts). The fix rests on one Node fact — an
// env entry whose value is `undefined` is dropped at spawn — so one test here
// really spawns a child through the same spread pi-rp uses.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { withholdSecrets, withheldNames, agentSpawnEnv, SECRET_NAME } = await jiti.import('../src/engine/agent-env.ts');

const parent = {
  PATH: '/usr/bin',
  HOME: '/home/player',
  HTTPS_PROXY: 'http://proxy:8080',
  LANG: 'ja_JP.UTF-8',
  OPENAI_API_KEY: 'sk-agent-own-key',
  DASHSCOPE_API_KEY: 'dashscope-secret',
  FLOW_API_KEY: 'flow-secret',
  AIRP_TTS_LOCAL_API_KEY: 'tts-secret',
  AIRP_TTS_TRANSLATE_API_KEY: 'translate-secret',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_URL: 'https://example.supabase.co',
  GITHUB_TOKEN: 'ghp-secret',
  AIRP_WORLDS_ROOT: '/data/users/u/worlds',
  // The local ↔ remote link: where the account session file is, the remote,
  // and where to sign in.
  AIRP_REMOTE_CONFIG: '/home/player/.config/airp/remote.json',
  AIRP_REMOTE_URL: 'https://remote.example/',
  AIRP_AUTH_URL: 'https://example.supabase.co',
  AIRP_AUTH_ANON_KEY: 'anon',
  AIRP_SYNC_GATEWAY_SECRET: 'gateway-secret',
};
// What launch.ts hands the writer: its passthrough whitelist, its own key included.
const agent = { OPENAI_API_KEY: 'sk-agent-own-key', PI_PROJECT_CONFIG_DIR: '/w/.airpworld', AIRP_ROLE: 'writer' };

test('every secret the agent was not given is withheld; what it was given stays', () => {
  const env = withholdSecrets(agent, parent);
  for (const name of ['DASHSCOPE_API_KEY', 'FLOW_API_KEY', 'AIRP_TTS_LOCAL_API_KEY', 'AIRP_TTS_TRANSLATE_API_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_URL', 'GITHUB_TOKEN', 'AIRP_REMOTE_CONFIG', 'AIRP_REMOTE_URL', 'AIRP_AUTH_URL', 'AIRP_AUTH_ANON_KEY', 'AIRP_SYNC_GATEWAY_SECRET']) {
    assert.ok(name in env && env[name] === undefined, `${name} must be withheld`);
  }
  // Its own model key: the agent calls its model itself.
  assert.equal(env.OPENAI_API_KEY, 'sk-agent-own-key');
  assert.equal(env.AIRP_ROLE, 'writer');
  // Nothing non-secret is touched: tools need PATH, HOME, locale, proxy.
  for (const name of ['PATH', 'HOME', 'HTTPS_PROXY', 'LANG', 'AIRP_WORLDS_ROOT']) assert.ok(!(name in env), `${name} is left to the spread`);
});

test('the name rule catches credentials by shape, not by a list someone forgets to update', () => {
  for (const name of ['NEW_PROVIDER_API_KEY', 'SOME_SECRET', 'X_TOKEN', 'DB_PASSWORD', 'SESSION_COOKIE', 'AWS_ACCESS_KEY_ID', 'TYPESAFE_THING']) {
    assert.ok(SECRET_NAME.test(name), name);
  }
  for (const name of ['PATH', 'HOME', 'LANG', 'KEYBOARD_LAYOUT', 'MONKEY', 'AIRP_IMAGE_MODEL', 'NODE_OPTIONS', 'TOKENIZERS_PARALLELISM_X']) {
    assert.ok(!SECRET_NAME.test(name), name);
  }
  assert.deepEqual(withheldNames(agent, { PATH: 'x', DASHSCOPE_API_KEY: 'y' }), ['DASHSCOPE_API_KEY']);
});

test('a real child spawned through pi-rp’s spread cannot see a withheld key', () => {
  // Exactly rpc-client.js: `env: { ...process.env, ...this.options.env }`.
  const spawnEnv = { ...parent, ...withholdSecrets(agent, parent) };
  const run = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { env: spawnEnv, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const seen = JSON.parse(run.stdout);
  assert.equal(seen.DASHSCOPE_API_KEY, undefined);
  assert.equal(seen.FLOW_API_KEY, undefined);
  assert.equal(seen.AIRP_TTS_LOCAL_API_KEY, undefined);
  assert.equal(seen.GITHUB_TOKEN, undefined);
  assert.ok(!Object.values(seen).includes('dashscope-secret'), 'not under another name either');
  assert.equal(seen.OPENAI_API_KEY, 'sk-agent-own-key');
  assert.equal(seen.HOME, '/home/player');
  assert.equal(seen.HTTPS_PROXY, 'http://proxy:8080');
});

test('every agent spawn in the server goes through it', () => {
  const lifecycle = fs.readFileSync(new URL('../src/engine/lifecycle.ts', import.meta.url), 'utf8');
  const arranger = fs.readFileSync(new URL('../src/engine/canvas-arranger-lifecycle.ts', import.meta.url), 'utf8');
  assert.equal((lifecycle.match(/new RpcClient\(/g) ?? []).length, 2);
  assert.equal((lifecycle.match(/env: agentSpawnEnv\(spec\.env\),/g) ?? []).length, 2);
  assert.doesNotMatch(lifecycle, /env: spec\.env[,\s]/);
  // The canvas arranger was de-agented (2026-09-18 ruling): it is a
  // server-internal state machine and must not spawn any agent process.
  assert.doesNotMatch(arranger, /new RpcClient\(/);
  assert.equal(typeof agentSpawnEnv, 'function');
});

test('the reason this module exists is still true of the vendored spawner', () => {
  // If pi-rp ever stops spreading the parent env, this test fails and tells
  // whoever reads it that agent-env.ts may be simplified — not that it broke.
  const rpc = fs.readFileSync(new URL('../../../vendor/pi-rp/packages/coding-agent/dist/modes/rpc/rpc-client.js', import.meta.url), 'utf8');
  assert.match(rpc, /env: \{ \.\.\.process\.env, \.\.\.this\.options\.env \}/);
});

test('service mode: AIRP_AI_KEY reaches the agent only for the image provider, never other secrets', async () => {
  const { serviceImageKeyEnv } = await import('../dist/engine/launch.js');
  const svc = { AIRP_AI_BASE: 'https://ai.example/v1', AIRP_AI_KEY: 'wl-service-key', DASHSCOPE_API_KEY: 'x', GITHUB_TOKEN: 'y' };
  assert.deepEqual(serviceImageKeyEnv(svc), { AIRP_AI_KEY: 'wl-service-key' });
  // ... and handing it over survives the withholding (it is in the agent's own env), the rest does not.
  const env = withholdSecrets(serviceImageKeyEnv(svc), svc);
  assert.equal(env.AIRP_AI_KEY, 'wl-service-key');
  assert.equal(env.DASHSCOPE_API_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.deepEqual(serviceImageKeyEnv({ ...svc, OPENAI_API_KEY: 'sk-own' }), {}, 'an own image key is used instead');
  assert.deepEqual(serviceImageKeyEnv({ ...svc, AIRP_IMAGE_MODEL: 'openrouter/google/gemini-2.5-flash-image' }), {}, 'an OpenRouter image model never calls the service');
  assert.deepEqual(serviceImageKeyEnv({ AIRP_AI_KEY: 'wl-service-key' }), {}, 'no service base, nothing');
});
