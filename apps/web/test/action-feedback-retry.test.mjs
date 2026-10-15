import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const { createActionFeedbackCoordinator } = await jiti.import('../src/lib/action-feedback.ts');

const intent = { worldId: 'wuwu-zh', projection: 'layer:map', verb: 'enter', source: 'double-click', target: 'world/harbor-chart', layer: 'world/harbor-chart' };
const entered = { ok: true, layer: 'world/harbor-chart', name: 'Harbor', first: false, followers: { moved: [], failures: [] }, event: { id: 'evt-4' } };
const reconcile = async () => ({ status: 'confirmed', source: 'layer-refresh', projection: 'layer:map' });

test('a locked gate is asked again once the player has picked up the item', async () => {
  const coordinator = createActionFeedbackCoordinator();
  let locked = true;
  let requests = 0;
  const request = async () => {
    requests++;
    return locked ? { ok: false, code: 'requirements_not_met', error: 'Put the badge in your bag.' } : entered;
  };

  const refused = await coordinator.execute(intent, request, reconcile);
  assert.equal(refused.outcome, 'conflict');

  locked = false;
  const opened = await coordinator.execute(intent, request, reconcile);
  assert.equal(requests, 2, 'the second gesture must reach the server, not replay the refusal');
  assert.equal(opened.attempt, 1);
  assert.equal(opened.phase, 'succeeded');

});

test('a place entered, left and entered again reaches the server every time', async () => {
  const coordinator = createActionFeedbackCoordinator();
  let requests = 0;
  const request = async () => { requests++; return entered; };
  for (let i = 0; i < 3; i++) {
    const done = await coordinator.execute(intent, request, reconcile);
    assert.equal(done.phase, 'succeeded');
    assert.equal(done.attempt, i);
  }
  assert.equal(requests, 3, 'a settled success must not swallow the next entry');
});

test('a gesture repeated while the first is in flight is still one request', async () => {
  const coordinator = createActionFeedbackCoordinator();
  let requests = 0;
  let release;
  const request = () => { requests++; return new Promise((r) => { release = () => r(entered); }); };
  const a = coordinator.execute(intent, request, reconcile);
  const b = coordinator.execute(intent, request, reconcile);
  await new Promise((r) => setTimeout(r, 0));
  release();
  await Promise.all([a, b]);
  assert.equal(requests, 1);
});

test('a confirmed action is silent: no toast, the scene change is the feedback', async () => {
  const coordinator = createActionFeedbackCoordinator();
  const done = await coordinator.execute(intent, async () => entered, reconcile);
  assert.equal(done.reconcile, 'confirmed');
  assert.notEqual(done.presentation, 'eligible', 'App.tsx toasts only an eligible presentation of a success');
});

test('action feedback messages are translated in every locale', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/lib/action-feedback.ts', import.meta.url), 'utf8');
  const messages = JSON.parse(fs.readFileSync(new URL('../src/lib/messages.json', import.meta.url), 'utf8'));
  const keys = [...new Set([...src.matchAll(/message(?:: |\s*=\s*)'([A-Z][^']*[.…])'/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 5);
  for (const key of keys) for (const locale of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[locale], `${key} → ${locale}`);
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /if \(!isWorldUnavailable\(\)\) notify\(t\(result\.message\)\);/, 'action messages go through t()');
});
