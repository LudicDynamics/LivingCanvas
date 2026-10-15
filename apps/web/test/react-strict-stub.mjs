/**
 * A ~React that behaves like StrictMode in development: state updaters are
 * invoked TWICE with the same previous value and the SECOND result is kept.
 *
 * This exists because that one rule is what broke the companion dialogue
 *: a hook claimed a line id by assigning a ref inside its
 * updater, so the second invocation took the other branch and returned the
 * previous array unchanged — the character's words never reached the screen
 * while the player's did. No source assertion can catch that; only running the
 * hook under the doubled contract can.
 *
 * Not a React implementation. It supports exactly the four hooks this repo's
 * projection hooks use, one component at a time, rendered synchronously.
 */

/** Hook slots for the single component under test, in call order. */
let slots = [];
let cursor = 0;
/** Effects collected this pass: { fn, deps, cleanup }. */
let effects = [];
let renderFn = null;
let dirty = false;
let rendering = false;

function slot(init) {
  const index = cursor++;
  if (!(index in slots)) slots[index] = init();
  return { index, get: () => slots[index], set: (value) => { slots[index] = value; } };
}

export function useState(initial) {
  const cell = slot(() => (typeof initial === 'function' ? initial() : initial));
  const setState = (next) => {
    const previous = cell.get();
    let value;
    if (typeof next === 'function') {
      // The whole point: run it twice, keep the second answer.
      next(previous);
      value = next(previous);
    } else {
      value = next;
    }
    if (!Object.is(value, previous)) {
      cell.set(value);
      dirty = true;
    }
  };
  return [cell.get(), setState];
}

export function useRef(initial) {
  return slot(() => ({ current: initial })).get();
}

export function useCallback(fn, deps) {
  const cell = slot(() => ({ fn, deps }));
  const stored = cell.get();
  if (!sameDeps(stored.deps, deps)) {
    cell.set({ fn, deps });
    return fn;
  }
  return stored.fn;
}

export function useMemo(factory, deps) {
  const cell = slot(() => ({ value: factory(), deps }));
  const stored = cell.get();
  if (!sameDeps(stored.deps, deps)) {
    const value = factory();
    cell.set({ value, deps });
    return value;
  }
  return stored.value;
}

export function useEffect(fn, deps) {
  const cell = slot(() => ({ deps: null, cleanup: undefined, first: true }));
  const stored = cell.get();
  const changed = stored.first || !sameDeps(stored.deps, deps);
  effects.push({ cell, fn, deps, changed });
}

/** Layout effects share the same deterministic flush in hook tests. */
export function useLayoutEffect(fn, deps) {
  useEffect(fn, deps);
}

function sameDeps(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  return a.every((value, i) => Object.is(value, b[i]));
}

/**
 * Render the hook until its state settles, running effects between passes the
 * way React does. Returns the last value the hook returned.
 */
export function render(fn) {
  renderFn = fn;
  slots = [];
  cursor = 0;
  effects = [];
  return flush();
}

/** Re-render with the current state; use after feeding the hook external input. */
export function rerender() {
  dirty = true;
  return flush();
}

function flush() {
  let result;
  let passes = 0;
  do {
    dirty = false;
    cursor = 0;
    const collected = [];
    const previousEffects = effects;
    effects = collected;
    rendering = true;
    try {
      result = renderFn();
    } finally {
      rendering = false;
    }
    void previousEffects;
    for (const effect of collected) {
      if (!effect.changed) continue;
      const stored = effect.cell.get();
      if (typeof stored.cleanup === 'function') stored.cleanup();
      const cleanup = effect.fn();
      effect.cell.set({ deps: effect.deps, cleanup, first: false });
    }
    passes += 1;
    if (passes > 50) throw new Error('render loop did not settle');
  } while (dirty);
  return result;
}

/** Run every registered cleanup, as unmounting would. */
export function unmount() {
  for (const cell of slots) {
    if (cell && typeof cell === 'object' && typeof cell.cleanup === 'function') cell.cleanup();
  }
  slots = [];
  effects = [];
  renderFn = null;
}

export default { useState, useRef, useCallback, useMemo, useEffect };
export { rendering as __rendering };
