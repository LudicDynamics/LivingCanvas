/**
 * Pointer parallax store — module scope, mirroring useCamera's "motion never
 * re-renders React" contract.
 *
 * The viewport's pointermove handler published `{x,y}` through React state,
 * which re-rendered the whole canvas subtree (backdrop + every card + links +
 * particles) on every mouse move — cost that grows with card count. Instead
 * the handler publishes here and the two consumers (SceneBackdrop,
 * ParticleLayer) read it imperatively: the backdrop writes its own transform,
 * the particle loop samples it. Zero React work per move.
 */

export interface Parallax {
  x: number;
  y: number;
}

/** Current normalized pointer position [-1, 1] per axis. Mutated in place. */
const current: Parallax = { x: 0, y: 0 };
const listeners = new Set<(p: Parallax) => void>();

/**
 * Publish the normalized pointer position. `current` is the SAME object every
 * call — subscribers must read x/y immediately, never retain it.
 */
export function setParallax(x: number, y: number): void {
  current.x = x;
  current.y = y;
  for (const fn of listeners) fn(current);
}

/** Read the latest value (the particle loop samples this each frame). */
export function getParallax(): Parallax {
  return current;
}

/** Subscribe to updates; fires once immediately with the current value. */
export function subscribeParallax(fn: (p: Parallax) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => {
    listeners.delete(fn);
  };
}
