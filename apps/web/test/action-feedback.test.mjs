import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url);
const {
  ActionFeedbackStore,
  actionDetailsOf,
  classifyActionResult,
  runAction,
} = await jiti.import('../src/lib/action-feedback.ts');
const { AirpRequestError } = await jiti.import('../src/lib/airp-gateway.ts');

test('domain details classify a handled refusal as conflict, not HTTP success', () => {
  const result = { ok: true, item: 'player/key.md', target: 'world/lock.md', handled: false, reason: 'wrong_item', event: { id: 'evt-3' } };
  assert.equal(classifyActionResult('present', result), 'conflict');
  assert.deepEqual(actionDetailsOf(result), { item: 'player/key.md', target: 'world/lock.md', handled: false, reason: 'wrong_item', event: { id: 'evt-3' } });
});

test('present handled:false stays a conflict even when HTTP returned details', async () => {
  const store = new ActionFeedbackStore();
  const result = await runAction(
    store,
    { key: 'present:key:lock', verb: 'present', target: 'world/lock.md' },
    async () => ({
      ok: true,
      item: 'player/key.md',
      target: 'world/lock.md',
      handled: false,
      reason: 'wrong_item',
      presentation: { foley: 'paper-slide', burst: 'none' },
    }),
  );
  assert.equal(result.outcome, 'conflict');
  assert.equal(result.phase, 'conflict');
  assert.equal(result.details.handled, false);
});

test('a failed dice check is still an accepted persisted fact', () => {
  assert.equal(classifyActionResult('dice', { ok: true, path: 'world/lock.md', result: 2, passed: false, rolls: [2], crit: false, fumble: false }), 'accepted');
});

test('structured errors distinguish conflict, rejection, and transport failure', () => {
  assert.equal(classifyActionResult('choice', { ok: false, code: 'choice_not_found', error: 'stale option' }), 'conflict');
  assert.equal(classifyActionResult('act', { ok: false, code: 'dice_forced_not_allowed', error: 'forbidden' }), 'rejected');
  assert.equal(classifyActionResult('act', { ok: false, code: 'internal', error: 'disk down' }), 'failed');
});

test('feedback keys settle once and preserve the first authoritative details', async () => {
  const store = new ActionFeedbackStore();
  const first = await runAction(store, { key: 'choice:world/door:1', verb: 'choice', target: 'world/door.md' }, async () => ({ ok: true, choice: 'Open', index: 1, event: { id: 'evt-9' } }));
  assert.equal(first.status, 'accepted');
  assert.equal(first.eventId, 'evt-9');
  assert.equal(store.begin({ key: first.key, verb: 'choice' }).eventId, 'evt-9');
  const second = store.settle(first.key, { ok: false, code: 'internal', error: 'late failure' });
  assert.equal(second, first);
});

test('pending and explicit local cancel remain visible terminal outcomes', () => {
  const store = new ActionFeedbackStore();
  const pending = store.begin({ key: 'present:item:target', verb: 'present' });
  assert.equal(pending.outcome, 'pending');
  const cancelled = store.cancel(pending.key);
  assert.equal(cancelled.outcome, 'cancelled');
  assert.equal(cancelled.status, null);
  assert.equal(store.cancel(pending.key), cancelled);
});

test('gateway ActionRequestError payload codes survive the rejected Promise boundary', async () => {
  const store = new ActionFeedbackStore();
  const result = await runAction(store, { key: 'enter:world/harbor', verb: 'enter' }, async () => {
    throw new AirpRequestError('blocked', 409, { code: 'requirements_not_met' });
  });
  assert.equal(result.outcome, 'conflict');
  assert.equal(result.status, 'conflict');
  assert.equal(result.message, 'That requirement is not met.');
});
test('action UI keeps domain choices out of the Writer prompt callback', async () => {
  const entity = await readFile(new URL('../src/components/narrative/EntityInteractions.tsx', import.meta.url), 'utf8');
  const dialog = await readFile(new URL('../src/components/BagItemDialog.tsx', import.meta.url), 'utf8');
  // The coordinator call moved into the shared hook so the card
  // panel and the left rail cannot drift; the invariant is unchanged.
  const hook = await readFile(new URL('../src/lib/use-declared-choice.tsx', import.meta.url), 'utf8');
  assert.match(hook, /runAction<DeclaredChoiceDetails>\('choice'/);
  assert.match(entity, /useDeclaredChoice\(/);
  assert.doesNotMatch(entity, /Look closer[\s\S]{0,300}send\(/);
  assert.match(dialog, /onChoose\?:/);
  assert.doesNotMatch(dialog, /airpGateway\.choose/);
  assert.doesNotMatch(dialog, /runAction\(/);
});
test('gate and door pointer semantics reserve click for inspect and desktop double-click for enter', async () => {
  const card = await readFile(new URL('../src/components/canvas/CardRenderer.tsx', import.meta.url), 'utf8');
  const prop = await readFile(new URL('../src/components/canvas/PropCard.tsx', import.meta.url), 'utf8');
  const canvas = await readFile(new URL('../src/components/canvas/CanvasObject.tsx', import.meta.url), 'utf8');
  assert.match(canvas, /if \(isGate \|\| isDoor\) \{\s*setInspected\(true\)/);
  assert.match(canvas, /onDoubleClick=\{event => \{[\s\S]*requestEnter\(gateTarget\)/);
  assert.match(canvas, /if \(isGate \|\| isDoor\) \{\s*requestEnter\(gateTarget\)/);
  assert.match(prop, /DOUBLE-CLICK TO ENTER/);
  assert.doesNotMatch(prop, /clickTimer|onDoubleClick|onKeyDown/);
  assert.doesNotMatch(card, /handleGateClick|handleGateDoubleClick|clickTimer/);
});

test('target drops do not perform success-only unlock presentation before authority', async () => {
  const card = await readFile(new URL('../src/components/canvas/CardRenderer.tsx', import.meta.url), 'utf8');
  const canvas = await readFile(new URL('../src/components/canvas/CanvasObject.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(card, /playFoley\(['"]unlock['"]\)/);
  assert.doesNotMatch(canvas, /puzzle-unlock-burst/);
  assert.doesNotMatch(canvas, /setIsUnlockedEffect/);
});
