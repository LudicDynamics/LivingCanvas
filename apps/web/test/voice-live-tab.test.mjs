// Voice calls in a tab: the tab's server dials the AI service's voice channel
// (Fish voices in the cloud, tickets from ai) — but only once VOICE_LIVE_AVAILABLE flips at launch.
// Until then the tab stays on GPT Live, which the service does not carry, so the call button stays hidden.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const src = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('the tab picks its call transport from the one launch switch', () => {
  const mode = src('lib/browser-mode.ts');
  assert.match(mode, /import \{ VOICE_LIVE_AVAILABLE \} from '\.\/plans\.js'/);
  assert.match(mode, /if \(VOICE_LIVE_AVAILABLE\) \{\s*env\.AIRP_VOICE_PROVIDER = 'voice-live';\s*env\.VOICE_LIVE_TICKETS_URL = `\$\{d\.modelBase\.replace\(\/\\\/\+\$\/, ''\)\}\/voice\/live\/ticket`;/);
  assert.match(mode, /\} else \{\s*env\.AIRP_VOICE_PROVIDER = 'gpt-live';\s*\}/);
  assert.equal(mode.match(/env\.AIRP_VOICE_PROVIDER = /g)?.length, 2, 'set in exactly those two branches');
});

test('the switch is still off: calls are not live in a tab yet', () => {
  assert.match(src('lib/plans.ts'), /export const VOICE_LIVE_AVAILABLE = false;/);
});
