import test from 'node:test';
import assert from 'node:assert/strict';
import { createImeGuard, guardImeKey } from '../src/lib/ime.ts';

function key(keyName, isComposing = false, keyCode = 13) {
  return {
    key: keyName,
    nativeEvent: { isComposing, keyCode },
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

test('candidate Enter cannot submit, including WebKit confirmation ordering', () => {
  for (const event of [key('Enter', true), key('Enter', false, 229)]) {
    assert.equal(guardImeKey(event), true);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
  }
});

test('ordinary Enter remains sendable and candidate arrows do not recall history', () => {
  const enter = key('Enter');
  assert.equal(guardImeKey(enter), false);
  assert.equal(enter.prevented, false);
  assert.equal(enter.stopped, false);
  const arrow = key('ArrowUp', true, 38);
  assert.equal(guardImeKey(arrow), true);
  assert.equal(arrow.prevented, false);
  assert.equal(arrow.stopped, true);
});

test('composition boundaries keep Enter guarded only while that input is composing', () => {
  const guard = createImeGuard();
  const before = key('Enter');
  assert.equal(guard.guardKey(before), false);
  guard.onCompositionStart();
  const candidate = key('Enter', false, 13);
  assert.equal(guard.guardKey(candidate), true);
  assert.equal(candidate.prevented, true);
  guard.onCompositionEnd();
  const submitted = key('Enter');
  assert.equal(guard.guardKey(submitted), false);
  assert.equal(submitted.prevented, false);
});
