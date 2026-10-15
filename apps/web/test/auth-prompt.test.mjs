// Browser mode: a burst of `auth-required` from the Worker opens the account popup once,
// so × closes it for real (it used to re-open on the next refused model call).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const { createAuthPrompt, AUTH_PROMPT_QUIET_MS } = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/auth-prompt.ts');

test('auth-required: one popup per quiet period, then again', () => {
  let t = 1000, opened = 0;
  const ask = createAuthPrompt(() => { opened++; }, () => t);
  assert.equal(ask(), true);
  for (let i = 0; i < 10; i++) { t += 500; assert.equal(ask(), false); }
  assert.equal(opened, 1);
  t += AUTH_PROMPT_QUIET_MS;
  assert.equal(ask(), true);
  assert.equal(opened, 2);
});

test('browser-mode routes the Worker\'s auth-required through the quiet prompt', async () => {
  const src = await readFile(new URL('../src/lib/browser-mode.ts', import.meta.url), 'utf8');
  // the guest trial's end has its own quiet prompt (reason 'trial'); everything else as before
  assert.match(src, /m\.type === 'auth-required'\) \{ if \(m\.reason === 'trial'\) askAfterTrial\(\); else askToSignIn\(\); return; \}/);
  assert.match(src, /const askAfterTrial = createAuthPrompt\(/);
  assert.match(src, /const askToSignIn = createAuthPrompt\(/);
});
