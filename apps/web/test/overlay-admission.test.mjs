import assert from 'node:assert/strict';
import { test } from 'node:test';

let focus = null;
let overlays = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  focus = await jiti.import('../src/lib/focus-coordinator.ts');
  overlays = await jiti.import('../src/lib/overlay-admission.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping focus/overlay tests:', err?.message ?? err);
}
const skip = focus && overlays ? false : 'jiti or pi-rp submodule unavailable';

test('focus coordinator keeps one token per owner and closes only the topmost owner', { skip }, () => {
  const coordinator = focus.createFocusCoordinator();
  const workspace = coordinator.acquire('workspace');
  const journal = coordinator.acquire('journal');
  const dialogue = coordinator.acquire('character-dialogue');

  assert.equal(coordinator.acquire('character-dialogue'), dialogue);
  assert.deepEqual(coordinator.snapshot().map((entry) => entry.owner), [
    'workspace',
    'journal',
    'character-dialogue',
  ]);

  assert.deepEqual(coordinator.handleEscape(), { owner: 'character-dialogue', token: dialogue });
  assert.equal(coordinator.peek(), 'journal');
  assert.deepEqual(coordinator.handleEscape(), { owner: 'journal', token: journal });
  assert.equal(coordinator.peek(), 'workspace');
  assert.equal(coordinator.release(workspace), true);
  assert.equal(coordinator.release(workspace), false);
  assert.equal(coordinator.handleEscape(), null);
});

test('dialogue and Nook focus reject conflicting overlays before admission', { skip }, () => {
  const coordinator = focus.createFocusCoordinator();
  const admission = overlays.createOverlayAdmission(coordinator);
  coordinator.acquire('character-dialogue');

  assert.deepEqual(admission.request('dice', 'workspace'), {
    accepted: false,
    code: 'dialogue_focused',
    message: 'Close the character dialogue before starting this action.',
  });
  assert.deepEqual(admission.request('radial', 'workspace'), {
    accepted: false,
    code: 'dialogue_focused',
    message: 'Close the character dialogue before starting this action.',
  });

  coordinator.handleEscape();
  coordinator.acquire('nook');
  assert.deepEqual(admission.request('radial', 'workspace'), {
    accepted: false,
    code: 'nook_projection',
    message: 'Close the Nook projection before opening the action menu.',
  });
});

test('overlay release is idempotent and unavailable worlds reject new admissions', { skip }, () => {
  const coordinator = focus.createFocusCoordinator();
  const admission = overlays.createOverlayAdmission(coordinator);
  const result = admission.request('dice', 'workspace');
  assert.equal(result.accepted, true);
  if (!result.accepted) return;

  assert.equal(admission.isActive(result.token), true);
  admission.release(result.token);
  admission.release(result.token);
  assert.equal(admission.isActive(result.token), false);

  admission.setWorldAvailable(false);
  assert.deepEqual(admission.request('dialogue', 'character-dialogue'), {
    accepted: false,
    code: 'world_unavailable',
    message: 'The world is unavailable. Please try again.',
  });
});
