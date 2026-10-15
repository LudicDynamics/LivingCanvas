import type { FocusCoordinator, FocusOwner } from './focus-coordinator.js';

export type OverlayKind = 'dice' | 'radial' | 'dialogue';

export type AdmissionResult =
  | { accepted: true; token: string }
  | {
      accepted: false;
      code: 'dialogue_focused' | 'nook_projection' | 'world_unavailable';
      message: string;
    };

export interface OverlayAdmission {
  request(kind: OverlayKind, caller: FocusOwner): AdmissionResult;
  release(token: string): void;
  /** Read-only inspection for an adapter and deterministic behavior tests. */
  isActive(token: string): boolean;
  setWorldAvailable(available: boolean): void;
}

/**
 * Gate performance overlays before they reach the DOM. The coordinator is
 * supplied by the host so focus and overlay ownership cannot diverge into
 * separate document-level stacks.
 */
export function createOverlayAdmission(focus: FocusCoordinator): OverlayAdmission {
  let nextToken = 0;
  let worldAvailable = true;
  const active = new Set<string>();

  return {
    request(kind, caller) {
      if (!worldAvailable) {
        return {
          accepted: false,
          code: 'world_unavailable',
          message: 'The world is unavailable. Please try again.',
        };
      }

      const focused = focus.peek();
      if ((kind === 'dice' || kind === 'radial') && focused === 'character-dialogue' && caller !== 'character-dialogue') {
        return {
          accepted: false,
          code: 'dialogue_focused',
          message: 'Close the character dialogue before starting this action.',
        };
      }
      if (kind === 'radial' && focused === 'nook' && caller !== 'nook') {
        return {
          accepted: false,
          code: 'nook_projection',
          message: 'Close the Nook projection before opening the action menu.',
        };
      }

      const token = `overlay-${++nextToken}`;
      active.add(token);
      return { accepted: true, token };
    },

    release(token) {
      // Set.delete is intentionally idempotent: a late cleanup from an
      // unmounted overlay cannot revoke a newer admission.
      active.delete(token);
    },

    isActive(token) {
      return active.has(token);
    },

    setWorldAvailable(available) {
      worldAvailable = available;
    },
  };
}
