// The build mode in the page (lib/build-mode.ts): VITE_* → the shared resolver, no guessing, the footer line.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const M = await jiti.import('../src/lib/build-mode.ts');
const { resolveDeployMode } = await import('../../../packages/shared/dist/deploy-mode/index.js');
const src = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('no Vite env (tests, a build without a mode): no mode, login off, browser mode refuses', () => {
  assert.equal(M.buildMode(), null);
  assert.equal(M.loginEnabled(), false, 'only an explicit on enables sign-in');
  assert.match(M.buildModeProblem(), /AIRP_DEPLOY/);
  assert.equal(M.buildModeLabel(), 'mode not set');
  assert.match(src('lib/browser-mode.ts'), /const problem = buildModeProblem\(\);\n\s*if \(problem\) throw new Error/);
});

test('VITE_* map onto the shared resolver', () => {
  const env = { VITE_AIRP_DEPLOY: 'remote', VITE_WORLDLINES_LOGIN: 'on' };
  for (const k of ['AIRP_ID_BASE', 'AIRP_STORAGE_BASE', 'AIRP_AI_ACCOUNT_BASE', 'AIRP_BILLING_BASE', 'AIRP_CHRONICLE_BASE', 'AIRP_DATA_BASE']) env[`VITE_${k}`] = `https://${k.toLowerCase()}.example`;
  assert.equal(resolveDeployMode(M.modeEnvOf(env)).deploy, 'remote');
  delete env.VITE_AIRP_DATA_BASE;
  assert.throws(() => resolveDeployMode(M.modeEnvOf(env)), /AIRP_DATA_BASE is not set/);
});

test('account dialog: mode line at the bottom; sign-in only with login on', () => {
  const d = src('components/account/AccountDialog.tsx');
  assert.match(d, /data-testid="build-mode">\{buildModeLabel\(\)\}/);
  assert.match(d, /loginEnabled\(\)\s*\n?\s*\? <AccountTab/);
});

test('no edition flag left: data / chronicle come from the mode, off when absent', () => {
  const b = src('lib/browser-mode.ts');
  assert.doesNotMatch(b, /OPEN_SOURCE_EDITION/);
  assert.match(b, /envValue\('VITE_AIRP_CHRONICLE_BASE'\) \?\? 'off'/);
  assert.match(b, /envValue\('VITE_AIRP_DATA_BASE'\) \?\? 'off'/);
  assert.match(src('main.tsx'), /staticSite: browserDeployment\.staticSite && buildMode\(\)\?\.deploy === 'remote'/);
});
