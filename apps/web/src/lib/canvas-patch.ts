/**
 * Canvas patch merging — pure functions for the `canvas_patched` frame
 *. `card_position` and this frame share ONE merge so the two
 * paths can never drift apart.
 *
 * Both merges are idempotent and return the SAME reference when nothing changed,
 * so React can bail out of the re-render.
 */

/** Minimal card shape: enough to patch position by path. */
export interface PatchItem {
  path: string;
  x: number;
  y: number;
  z: number;
}

/** Minimal link shape: enough to upsert/delete by id. */
export interface PatchLink {
  id: string;
}

/**
 * Move/patch one card to (x, y) (optionally z). Position already equal → the
 * same array reference (the early-exit idempotency guard, the design notes).
 */
export function mergeItemPatch<T extends PatchItem>(
  items: readonly T[],
  patch: { path: string; x: number; y: number; z?: number }
): readonly T[] {
  let changed = false;
  const next = items.map((it) => {
    if (it.path !== patch.path) return it;
    if (it.x === patch.x && it.y === patch.y && (patch.z === undefined || it.z === patch.z)) return it;
    changed = true;
    return patch.z === undefined
      ? ({ ...it, x: patch.x, y: patch.y } as T)
      : ({ ...it, x: patch.x, y: patch.y, z: patch.z } as T);
  });
  return changed ? next : items;
}

/**
 * Upsert links by `id` (or delete when `action === 'deleted'`). Every link
 * already present with identical fields → the same reference (idempotent).
 */
export function mergeLinkPatch<T extends PatchLink>(
  links: readonly T[],
  incoming: readonly T[],
  action?: string
): readonly T[] {
  if (incoming.length === 0) return links;
  const byId = new Map(links.map((l) => [l.id, l]));
  let changed = false;
  for (const next of incoming) {
    if (action === 'deleted') {
      if (byId.delete(next.id)) changed = true;
      continue;
    }
    const prev = byId.get(next.id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
      byId.set(next.id, next);
      changed = true;
    }
  }
  return changed ? [...byId.values()] : links;
}
