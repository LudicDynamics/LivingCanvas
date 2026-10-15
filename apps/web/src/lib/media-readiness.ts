/** Internal media readiness seam shared by visual media consumers.
 * Readiness is evidence from the resource, never mount/HTTP success. Every
 * transition is bound to an owner/key/epoch tuple so late events cannot land
 * in a replaced projection.
 */
export type MediaOwner =
  | 'background'
  | 'portrait'
  | 'ambient'
  | 'bgm'
  | 'theme'
  | 'foley'
  | 'stinger'
  | 'voice'
  | 'show';

export type ReadinessState = 'unrequested' | 'loading' | 'ready' | 'failed';

export interface ReadinessSnapshot {
  owner: MediaOwner;
  key: string;
  state: ReadinessState;
  epoch: number;
  errorCode?: 'fetch' | 'decode' | 'media-error' | 'stale';
}

export interface MediaReadinessAdapter {
  request(owner: MediaOwner, key: string, epoch: number): Promise<ReadinessSnapshot>;
  snapshot(owner: MediaOwner, key: string): ReadinessSnapshot;
  invalidate(epoch: number): void;
  cancel(owner: MediaOwner, key: string, epoch: number): void;
  markReady(owner: MediaOwner, key: string, epoch?: number): ReadinessSnapshot;
  markFailed(owner: MediaOwner, key: string, epoch?: number, errorCode?: ReadinessSnapshot['errorCode']): ReadinessSnapshot;
  subscribe(listener: () => void): () => void;
}

interface Pending {
  snapshot: ReadinessSnapshot;
  resolve: (snapshot: ReadinessSnapshot) => void;
  consumers: number;
}
const idOf = (owner: MediaOwner, key: string): string => `${owner}\u0000${key}`;

export function createMediaReadinessAdapter(): MediaReadinessAdapter {
  const states = new Map<string, ReadinessSnapshot>();
  const pending = new Map<string, Pending>();
  const listeners = new Set<() => void>();
  let currentEpoch = 0;

  const snapshot = (owner: MediaOwner, key: string): ReadinessSnapshot =>
    states.get(idOf(owner, key)) ?? { owner, key, state: 'unrequested', epoch: currentEpoch };

  const finish = (next: ReadinessSnapshot): ReadinessSnapshot => {
    const id = idOf(next.owner, next.key);
    states.set(id, next);
    for (const listener of listeners) listener();
    const waiter = pending.get(id);
    if (waiter && waiter.snapshot.epoch === next.epoch) {
      pending.delete(id);
      waiter.resolve(next);
    }
    return next;
  };
  const adapter: MediaReadinessAdapter = {
    request(owner, key, epoch) {
      const id = idOf(owner, key);
      currentEpoch = Math.max(currentEpoch, epoch);
      const existingPending = pending.get(id);
      if (existingPending && existingPending.snapshot.epoch === epoch) {
        return new Promise<ReadinessSnapshot>((resolve) => {
          const previousResolve = existingPending.resolve;
          pending.set(id, {
            snapshot: existingPending.snapshot,
            consumers: existingPending.consumers + 1,
            resolve: (value) => {
              previousResolve(value);
              resolve(value);
            },
          });
        });
      }
      const existing = states.get(id);
      if (existing && existing.epoch === epoch && (existing.state === 'ready' || existing.state === 'failed')) {
        return Promise.resolve(existing);
      }
      const loading: ReadinessSnapshot = { owner, key, epoch, state: 'loading' };
      states.set(id, loading);
      return new Promise<ReadinessSnapshot>((resolve) => {
        pending.set(id, { snapshot: loading, consumers: 1, resolve });
      });
    },
    snapshot,
    invalidate(epoch) {
      currentEpoch = Math.max(currentEpoch + 1, epoch);
      for (const [id, item] of states) {
        if (item.epoch >= currentEpoch) continue;
        states.set(id, { ...item, state: 'unrequested', epoch: currentEpoch, errorCode: undefined });
        pending.delete(id);
      }
      for (const listener of listeners) listener();
    },
    cancel(owner, key, epoch) {
      const id = idOf(owner, key);
      const item = states.get(id);
      const waiter = pending.get(id);
      if (!item || item.epoch !== epoch || !waiter || waiter.snapshot.epoch !== epoch) return;
      if (waiter.consumers > 1) {
        pending.set(id, { ...waiter, consumers: waiter.consumers - 1 });
        return;
      }
      pending.delete(id);
      states.set(id, { ...item, state: 'failed', errorCode: 'stale' });
      for (const listener of listeners) listener();
    },
    markReady(owner, key, epoch = snapshot(owner, key).epoch) {
      // Staleness is per (owner, key): an entry is stale when the epoch stored
      // against it has moved on — a newer request for the same key, or a global
      // `invalidate`. Comparing against the adapter-wide `currentEpoch` instead
      // lets an unrelated owner's request (audio, background) reject a perfectly
      // current portrait ready event and strand it at `loading` forever.
      const current = states.get(idOf(owner, key));
      if (current && current.epoch !== epoch) return { ...current, state: 'failed', errorCode: 'stale' };
      return finish({ owner, key, state: 'ready', epoch });
    },
    markFailed(owner, key, epoch = snapshot(owner, key).epoch, errorCode = 'media-error') {
      const current = states.get(idOf(owner, key));
      if (current && current.epoch !== epoch) return { ...current, state: 'failed', errorCode: 'stale' };
      return finish({ owner, key, state: 'failed', epoch, errorCode });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return adapter;
}

/** Shared adapter for the current browser projection; components only mutate
 * their own owner/key entries and never use this as a world-fact store. */
export const mediaReadiness = createMediaReadinessAdapter();
