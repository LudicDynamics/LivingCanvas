export type FocusOwner =
  | 'workspace'
  | 'writer'
  | 'journal'
  | 'world-shelf'
  | 'belongings'
  | 'profile'
  | 'character-dialogue'
  | 'nook';

export type FocusToken = string;

export interface FocusEntry {
  readonly owner: FocusOwner;
  readonly token: FocusToken;
}

export type FocusSurfacePhase = 'open' | 'closing';

export interface FocusReturnHandle {
  capture(): void;
  restore(): boolean;
}

export interface FocusSurfaceRegistration {
  key: string;
  owner: FocusOwner;
  priority: number;
  root: HTMLElement | null;
  close: () => void;
  returnFocus?: FocusReturnHandle;
}

export interface FocusSurfaceLease {
  readonly key: string;
  readonly token: FocusToken;
  unregister(): void;
  markClosing(): boolean;
}

export interface FocusCoordinator {
  /** Acquire one focus owner. Re-acquiring an active owner is idempotent. */
  acquire(owner: FocusOwner): FocusToken;
  /** Release a token. Releasing an unknown/already released token is a no-op. */
  release(token: FocusToken): boolean;
  /** Return the current topmost owner, if any. */
  peek(): FocusOwner | null;
  /** Return a stable copy of the nested focus stack, bottom to top. */
  snapshot(): readonly FocusEntry[];
  /** Close only the topmost owner for an Escape press. */
  handleEscape(): FocusEntry | null;
  /** Register a closable surface without adding another focus-owner category. */
  registerSurface(surface: FocusSurfaceRegistration): FocusSurfaceLease;
  /** Return the topmost open surface by semantic priority and registration order. */
  peekSurface(): FocusSurfaceRegistration | null;
  /** Mark and close the topmost open surface at most once. */
  closeTopmostSurface(): FocusSurfaceRegistration | null;
  subscribe(listener: () => void): () => void;
}

/**
 * Create the single focus owner for a surface. This module has no DOM or
 * transport side effects; an App adapter can perform actual focus after the
 * owner transition has been accepted.
 */
export function createFocusCoordinator(): FocusCoordinator {
  let nextToken = 0;
  let nextSurfaceSequence = 0;
  let stack: FocusEntry[] = [];
  const surfaces = new Map<string, {
    registration: FocusSurfaceRegistration;
    token: FocusToken;
    sequence: number;
    phase: FocusSurfacePhase;
    lease: FocusSurfaceLease;
  }>();
  const surfaceOwnerWasPreexisting = new Map<FocusOwner, boolean>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const acquire = (owner: FocusOwner): FocusToken => {
    const existing = stack.find((entry) => entry.owner === owner);
    if (existing) return existing.token;

    const entry: FocusEntry = {
      owner,
      token: `focus-${++nextToken}`,
    };
    stack = [...stack, entry];
    notify();
    return entry.token;
  };

  const release = (token: FocusToken): boolean => {
    const index = stack.findIndex((entry) => entry.token === token);
    if (index < 0) return false;
    stack = [...stack.slice(0, index), ...stack.slice(index + 1)];
    notify();
    return true;
  };

  const unregisterSurface = (key: string): boolean => {
    const record = surfaces.get(key);
    if (!record) return false;
    surfaces.delete(key);

    // A surface and an independently acquired owner share one FocusEntry. Only
    // the last surface may release the entry, and only when it created it.
    const hasOwnerSurface = Array.from(surfaces.values()).some(
      candidate => candidate.registration.owner === record.registration.owner,
    );
    if (!hasOwnerSurface) {
      const preexisting = surfaceOwnerWasPreexisting.get(record.registration.owner) === true;
      surfaceOwnerWasPreexisting.delete(record.registration.owner);
      if (!preexisting) release(record.token);
    }
    notify();
    return true;
  };

  const coordinator: FocusCoordinator = {
    acquire,
    release,

    peek() {
      return stack.length > 0 ? stack[stack.length - 1].owner : null;
    },

    snapshot() {
      return stack.slice();
    },

    handleEscape() {
      const topmost = stack[stack.length - 1];
      if (!topmost) return null;
      if (Array.from(surfaces.values()).some(record => record.registration.owner === topmost.owner && record.phase === 'closing')) {
        return null;
      }
      coordinator.release(topmost.token);
      return topmost;
    },

    registerSurface(surface) {
      const current = surfaces.get(surface.key);
      if (current && current.registration.owner === surface.owner) {
        // Keep registration order stable across StrictMode/render retries, but
        // refresh callbacks and DOM roots so the lease never closes a stale UI.
        current.registration = surface;
        notify();
        return current.lease;
      }
      if (current) unregisterSurface(surface.key);

      const ownerAlreadyActive = stack.some(entry => entry.owner === surface.owner);
      const token = acquire(surface.owner);
      if (!surfaceOwnerWasPreexisting.has(surface.owner)) {
        surfaceOwnerWasPreexisting.set(surface.owner, ownerAlreadyActive);
      }
      const sequence = ++nextSurfaceSequence;
      const record: {
        registration: FocusSurfaceRegistration;
        token: FocusToken;
        sequence: number;
        phase: FocusSurfacePhase;
        lease: FocusSurfaceLease;
      } = {
        registration: surface,
        token,
        sequence,
        phase: 'open',
        lease: undefined as unknown as FocusSurfaceLease,
      };
      const lease: FocusSurfaceLease = {
        key: surface.key,
        token,
        unregister: () => { unregisterSurface(surface.key); },
        markClosing: () => {
          const active = surfaces.get(surface.key);
          if (!active || active !== record || active.phase !== 'open') return false;
          active.phase = 'closing';
          notify();
          return true;
        },
      };
      record.lease = lease;
      surfaces.set(surface.key, record);
      surface.returnFocus?.capture();
      notify();
      return lease;
    },

    peekSurface() {
      let topmost: (typeof surfaces extends Map<string, infer Value> ? Value : never) | null = null;
      for (const record of surfaces.values()) {
        if (record.phase !== 'open') continue;
        if (
          !topmost
          || record.registration.priority > topmost.registration.priority
          || (
            record.registration.priority === topmost.registration.priority
            && record.sequence > topmost.sequence
          )
        ) {
          topmost = record;
        }
      }
      return topmost?.registration ?? null;
    },

    closeTopmostSurface() {
      let topmost: (typeof surfaces extends Map<string, infer Value> ? Value : never) | null = null;
      for (const record of surfaces.values()) {
        if (record.phase !== 'open') continue;
        if (
          !topmost
          || record.registration.priority > topmost.registration.priority
          || (
            record.registration.priority === topmost.registration.priority
            && record.sequence > topmost.sequence
          )
        ) {
          topmost = record;
        }
      }
      if (!topmost) return null;
      topmost.phase = 'closing';
      notify();
      // Mark before invoking user code. A callback that synchronously causes a
      // second dispatch therefore observes no open surface and cannot re-run.
      topmost.registration.close();
      return topmost.registration;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return coordinator;
}
