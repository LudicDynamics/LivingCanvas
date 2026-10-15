/**
 * The player's backpack. One reader for one fact:
 * the `bag` section of the injected state block (02) and `GET /backpack`
 * (`apps/server/src/routes/world.ts`) MUST agree on what is in the bag, so the
 * scan lives here and the route calls this function — the same extraction the
 * viewpoint/events work did for their own duplicated reads.
 *
 * `BagItem`'s field names are a CROSS-END CONTRACT, not a style choice
 * (评审 B-5): `apps/web/src/components/sidebar/RightSidebar.tsx` reads
 * `item.filename` and `item.frontmatter` directly. Renaming a field here
 * (e.g. to `fm`) would silently break the backpack panel with a TypeError on
 * `undefined`, while the injection-side `bag` section kept working — two
 * consumers of one helper, two shapes. Do not rename.
 */
import type { WorldStore } from '../store/world-store.js';
import { displayItemOf } from '../rules/html-item.js';

export interface BagItem {
  /** World-root relative path, e.g. `player/brass-key.md`. */
  path: string;
  /** Basename of `path`; the sidebar's display fallback. */
  filename: string;
  frontmatter: Record<string, any> | null;
  body: string;
}

/**
 * Every markdown in `player/`, in `listFiles` order. `player/README.md` is the
 * bag's own config, not an item. Callers that need a stable order sort it
 * themselves (02 §3.4 uses `comparePaths`; the route passes it through).
 */
export async function listBackpack(store: WorldStore): Promise<BagItem[]> {
  const allFiles = (await store.listFiles('player')).filter((file) => file !== 'player/README.md');
  return Promise.all(
    allFiles.map(async (file) => {
      const raw = await store.readFile(file);
      const { frontmatter, body } = displayItemOf(file, raw);
      const slash = file.lastIndexOf('/');
      return {
        path: file,
        filename: slash === -1 ? file : file.slice(slash + 1),
        frontmatter,
        body,
      };
    })
  );
}
