// world.json `models`: a world's model per agent role, honored only when this player may use it —
// paid-only models of the Worldlines AI service need a paid plan; guests and unknown plans get the next candidate.
// Runs against built dist.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { worldModelFor, GATEWAY_PAID_ONLY_MODELS, WorldModelHintsSchema } from '@airp/shared';
import { worldModelPreference } from '../dist/engine/world-models.js';
import { modelPreferenceArgs } from '../dist/engine/model-preferences.js';
import { rememberAccountPlan, forgetAccountPlan } from '../dist/sync/account-plan.js';

const HINT = { character: [{ model: 'deepseek-v4-pro', thinking: 'off' }, { model: 'deepseek-v4-flash', thinking: 'off' }] };

test('worldModelFor: first allowed candidate; paid-only needs a paid plan on the service; own key takes it', () => {
  assert.ok(GATEWAY_PAID_ONLY_MODELS.includes('deepseek-v4-pro'));
  const pro = { provider: 'deepseek', model: 'deepseek-v4-pro', thinking: 'off' };
  const flash = { provider: 'deepseek', model: 'deepseek-v4-flash', thinking: 'off' };
  assert.deepEqual(worldModelFor('character', HINT, { route: 'gateway', plan: 'vivid' }), pro);
  assert.deepEqual(worldModelFor('character', HINT, { route: 'gateway', plan: 'story' }), pro);
  assert.deepEqual(worldModelFor('character', HINT, { route: 'gateway', plan: 'free' }), flash, 'free plan → the next candidate');
  assert.deepEqual(worldModelFor('character', HINT, { route: 'gateway', plan: null }), flash, 'a guest / unknown plan = free');
  assert.deepEqual(worldModelFor('character', HINT, { route: 'own', plan: null }), pro, 'own DeepSeek key: the player pays DeepSeek');
  assert.equal(worldModelFor('writer', HINT, { route: 'gateway', plan: 'vivid' }), null, 'no hint for the role → the default');
  assert.deepEqual(worldModelFor('character', HINT, { route: 'own', plan: null, known: (_p, m) => m !== 'deepseek-v4-pro' }), flash, 'a model the provider config does not list is skipped');
  assert.deepEqual(worldModelFor('writer', { writer: 'deepseek-v4-flash' }, { route: 'gateway', plan: null }), { provider: 'deepseek', model: 'deepseek-v4-flash', thinking: 'low' }, 'a bare string');
  assert.equal(worldModelFor('character', { character: [{ model: 'x', thinking: 'loud' }] }, { route: 'own', plan: null }), null, 'malformed → none');
  // the manifest keeps it; a malformed block is dropped, the world still loads
  assert.deepEqual(WorldModelHintsSchema.parse(HINT).character?.[0], { model: 'deepseek-v4-pro', thinking: 'off' });
  assert.match(fs.readFileSync(new URL('../../../packages/shared/src/schemas/world.ts', import.meta.url), 'utf8'), /models: WorldModelHintsSchema\.optional\(\)\.catch\(undefined\)/, 'a malformed block never stops a world from loading');
});

test('at launch: the plan the account panel read decides; the saved pick for the save still wins', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-world-models-'));
  const saved = { ...process.env };
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); forgetAccountPlan(); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.copyFileSync(new URL('../../../config/deepseek-models.example.json', import.meta.url), path.join(root, 'config/deepseek-models.example.json'));
  const world = path.join(root, 'worlds', 'prologue');
  fs.mkdirSync(world, { recursive: true });
  fs.writeFileSync(path.join(world, 'world.json'), JSON.stringify({ id: 'last-train-prologue-zh', name: 'x', models: HINT }));
  // signed in to the service (a session in remote.json), no own DeepSeek key
  const remote = path.join(root, 'remote.json');
  fs.writeFileSync(remote, JSON.stringify({ session: { accessToken: 'a' } }));
  Object.assign(process.env, { AIRP_REMOTE_CONFIG: remote });
  for (const k of ['AIRP_AI_BASE', 'AIRP_AI_ACCOUNT', 'DEEPSEEK_API_KEY']) delete process.env[k];
  assert.equal(worldModelPreference(root, world, 'character')?.model, 'deepseek-v4-flash', 'plan not read yet → free');
  rememberAccountPlan('vivid');
  assert.equal(worldModelPreference(root, world, 'character')?.model, 'deepseek-v4-pro');
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, '.pi/agent/models.json'), 'utf8')).providers.deepseek.models.some((m) => m.id === 'deepseek-v4-pro'), 'the bundled pro model is listed for pi-rp');
  rememberAccountPlan('free');
  assert.equal(worldModelPreference(root, world, 'character')?.model, 'deepseek-v4-flash');
  // signed out, playing as a trial guest (a guest session beside remote.json): never a paid-only model
  fs.writeFileSync(remote, JSON.stringify({}));
  fs.writeFileSync(path.join(root, 'guest.json'), JSON.stringify({ accessToken: 'g' }));
  process.env.AIRP_GUEST_TRIAL = '1';
  rememberAccountPlan('vivid');
  assert.equal(worldModelPreference(root, world, 'character')?.model, 'deepseek-v4-flash');
  // own key: the player's DeepSeek account pays
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  assert.equal(worldModelPreference(root, world, 'character')?.model, 'deepseek-v4-pro');
  // CLI flags: hint used when nothing is saved; the saved pick wins
  const hint = worldModelPreference(root, world, 'character');
  assert.deepEqual(modelPreferenceArgs(world, 'character', hint), ['--provider', 'deepseek', '--model', 'deepseek-v4-pro', '--thinking', 'off']);
  fs.mkdirSync(path.join(world, '.airpworld'), { recursive: true });
  fs.writeFileSync(path.join(world, '.airpworld/model-preferences.json'), JSON.stringify({ character: { provider: 'deepseek', model: 'deepseek-v4-flash', thinking: 'low' } }));
  assert.deepEqual(modelPreferenceArgs(world, 'character', hint), ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '--thinking', 'low']);
});

test('the prologue editions ask for the best catalog model for 夏澄, with a free-plan fallback', () => {
  for (const id of ['last-train-prologue', 'last-train-prologue-zh', 'last-train-prologue-jp', 'last-train-prologue-ko']) {
    const world = JSON.parse(fs.readFileSync(new URL(`../../../templates/${id}/world.json`, import.meta.url), 'utf8'));
    assert.deepEqual(world.models, HINT, id);
  }
});
