// A world that would not open, in words the player can act on (lib/world-load-error.ts), and the header's agent
// status not polling before a world is open (lib/agent-settings-poll.ts) — canvas-20261011-0211: raw
// `POST /api/worlds/load -> 502 {…}` toasts and a flood of 409 no_active_world from GET /api/agent-settings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const wl = await jiti.import('../src/lib/world-load-error.ts');
const poll = await jiti.import('../src/lib/agent-settings-poll.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const err = (status, payload) => Object.assign(new Error(`POST /api/worlds/load -> ${status} ${JSON.stringify(payload)}`), { status, payload });

test('load failures: signed out → sign in; network / bad files → a retry sentence; never the raw request line', () => {
  assert.deepEqual(wl.worldLoadFailureOf(err(401, { code: 'signed_out', error: 'Sign in to your account to open this world.' })), { kind: 'sign-in', text: wl.WORLD_LOAD_TEXT.signedOut });
  assert.deepEqual(wl.worldLoadFailureOf(err(503, { code: 'network', error: 'x' })), { kind: 'retry', text: wl.WORLD_LOAD_TEXT.network });
  const files = wl.worldLoadFailureOf(err(502, { code: 'world_files', error: 'x', detail: 'catalog: ambient/lao-he.json does not match its sha256' }));
  assert.equal(files.kind, 'retry');
  assert.doesNotMatch(files.text, /sha256|POST|502/);
  assert.equal(wl.worldLoadFailureOf(err(409, { error: 'A world operation is in progress.' })).text, 'A world operation is in progress.');
  assert.equal(wl.worldLoadFailureOf(new Error('boom')).text, wl.WORLD_LOAD_TEXT.fallback, 'no payload: a sentence, not the request line');
  assert.equal(wl.worldLoadFailureOf(err(401, { code: 'signed_out' }), (k) => `T:${k}`).text, `T:${wl.WORLD_LOAD_TEXT.signedOut}`, 'translated');
});

test('load failure sentences are translated in all three languages', async () => {
  const messages = JSON.parse(await src('../src/lib/messages.json'));
  for (const key of Object.values(wl.WORLD_LOAD_TEXT)) {
    for (const lang of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[lang], `${key} → ${lang}`);
  }
});

test('App: a failed open notifies through worldLoadFailureOf and signs in, then retries the same open', async () => {
  const app = await src('../src/App.tsx');
  assert.match(app, /const failure = worldLoadFailureOf\(error/);
  assert.match(app, /failure\.kind === 'sign-in'\) void withAccount\('play', \(\) => \{ void loadWorld\(worldPath, options\); \}, worldPath\)/);
  assert.doesNotMatch(app, /notify\(error instanceof Error \? error\.message : 'Could not load that world'\)/);
});

test('agent status poll: none before a world is open or after no_active_world; backs off on errors; normal cadence when healthy', () => {
  const d = (o) => poll.agentSettingsPollDelay({ open: false, worldOpen: true, failures: 0, noWorld: false, ...o });
  assert.equal(d({ worldOpen: false }), null);
  assert.equal(d({ noWorld: true, failures: 1 }), null);
  assert.equal(d({}), 5000);
  assert.equal(d({ open: true }), 2000);
  assert.deepEqual([1, 2, 3, 4, 5, 10].map((failures) => d({ failures })), [5000, 10000, 20000, 40000, 60000, 60000]);
  // 503 agent_starting (a world load, an agent restart): it is coming up — steady 3 s, no back-off.
  assert.equal(d({ starting: true, failures: 4 }), 3000);
});

test('AgentSettings: a 503 agent_starting reads "the characters are starting", keeps the last status, is not an error', async () => {
  const c = await src('../src/components/AgentSettings.tsx');
  assert.match(c, /agentStarting = data\?\.code === 'agent_starting'/);
  assert.match(c, /t\('Characters are starting'\)/);
  assert.match(c, /if \(!agentStarting\) \{ setStatus\(null\)/);
  const route = await src('../../server/src/routes/world.ts');
  assert.match(route, /status\(503\)\.json\(\{ code: 'agent_starting'/);
});

test('AgentSettings: polls only with a world (App passes the open save), through agentSettingsPollDelay', async () => {
  const c = await src('../src/components/AgentSettings.tsx');
  assert.match(c, /agentSettingsPollDelay\(\{ open, worldOpen, failures, noWorld, starting: agentStarting \}\)/);
  assert.match(c, /if \(worldOpen\) void poll\(\)/);
  assert.doesNotMatch(c, /setTimeout\(poll, open \? 2000 : 5000\)/);
  const app = await src('../src/App.tsx');
  assert.match(app, /worldKey=\{activeWorldPath \?\? manifest\?\.id \?\? null\}/);
});
