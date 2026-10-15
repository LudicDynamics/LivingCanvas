/**
 * Nook sub-scene tree — the PARALLEL derivation to `layers.ts` (N2 00 §5.3).
 *
 * `deriveLayers` hard-codes the `world/**` filter and maps `world` → `map`;
 * nook needs neither, so instead of parameterising that load-bearing function
 * (consumed by `scanLayers` and `look-at`) this module derives a second,
 * smaller tree rooted at a character: `characters/<id>` is scene 0, and every
 * directory below it is a sub-scene (`the design notes`).
 *
 * The id-agnostic primitives of `layers.ts` are REUSED, not copied: `dirOf`
 * for path semantics, `cardsOfLayer` for page membership, `childLayers` for
 * doors. Only `nookSceneOfPath` is written by hand — it must NOT inherit
 * `layerOfPath`'s silent `map` fallback (N2 00 §5.3.1).
 *
 * Directory set MUST come from `store.listDirs(nookId)`: a DIRECTORY walk
 * (empty directories included ⇒ their door card exists), NOT derived from
 * `listFiles`, a file walk where a completely empty sub-scene vanishes
 * (N2 00 §2.3, spike B vs C).
 */
import type { LayerConfig } from '../schemas/world.js';
import { cardsOfLayer, childLayers } from './layers.js';
import { characterIdOfPath, nookCardPaths, nookSceneParent } from '../rules/characters.js';

/**
 * Derive a character's scene tree from the set of directories under it.
 * Same shape as `deriveLayers`, but the root is `nookId` (parent `null`) and
 * only the `nookId` subtree is kept — a stray `world/**` or other character's
 * directory must never become a door on this canvas.
 *
 * `readFm(dir)` returns that directory's README frontmatter, or `null` when the
 * directory has no README (a stub scene — the door still exists).
 */
export function deriveNookLayers(
  nookId: string,
  dirs: readonly string[],
  readFm: (dir: string) => Record<string, any> | null
): Record<string, LayerConfig> {
  const treeDirs = dirs.filter((d) => d === nookId || d.startsWith(`${nookId}/`)).sort();

  const inTree = new Set(treeDirs);
  const layers: Record<string, LayerConfig> = {};

  for (const d of treeDirs) {
    // Nearest ancestor directory that is itself in the tree. `nookId` has no
    // in-tree ancestor (`characters` was filtered out) ⇒ parent stays null,
    // which is exactly "the character root has no parent", no special case.
    let parent: string | null = null;
    for (let i = d.lastIndexOf('/'); i > 0; i = d.lastIndexOf('/', i - 1)) {
      const anc = d.slice(0, i);
      if (inTree.has(anc)) {
        parent = anc;
        break;
      }
    }
    const fm = readFm(d);
    const name = d.split('/').pop() || d;
    layers[d] = fm
      ? {
          name: typeof fm.name === 'string' ? fm.name : name,
          parent,
          material: typeof fm.material === 'string' ? fm.material : undefined,
          stub: fm.stub === true ? true : undefined,
        }
      : { name, parent, stub: true };
  }
  return layers;
}

/**
 * Immediate sub-scene ids of `sceneId`, stable order — each becomes a door card
 * on the parent scene. DIRECT children only: the tree decides nesting, so a
 * grandchild scene never leaks onto this canvas (N2 00 §3 decision 4).
 */
export function nookSceneDoors(sceneId: string, layers: Record<string, LayerConfig>): string[] {
  return childLayers(sceneId, layers);
}

/**
 * Which nook scene a path belongs to (longest prefix), or `null` when it is not
 * in this character's subtree.
 *
 * MUST NOT delegate to `layerOfPath`: that returns `MAP_LAYER` on no match
 * (`layers.ts` `let best = MAP_LAYER`), which for a nook tree makes an
 * out-of-bounds path claim to belong to `map` — the `arrangeCards` guard would
 * then pass a stray write it exists to stop (N2 00 §5.3.1).
 */
export function nookSceneOfPath(path: string, layers: Record<string, LayerConfig>): string | null {
  if (characterIdOfPath(path) === null) return null;
  let best: string | null = null;
  for (const id of Object.keys(layers)) {
    if (path === id || path.startsWith(`${id}/`)) {
      if (best === null || id.length > best.length) best = id;
    }
  }
  return best;
}

/**
 * The markdown a scene's canvas shows, DIRECTLY (no doors, no recursion, not
 * the scene's own README).
 *
 * The root and a sub-scene need different exclusions, so this branches rather
 * than unions (N2 00 §5.2): `nookCardPaths` drops the four root config files
 * but its config check returns `null` for nested paths, so it would leak a
 * sub-scene's own README; `cardsOfLayer` excludes that README by exact-dir
 * match but knows nothing about `identity.md` / `personality.md` / `memory.md`.
 * Neither works alone.
 */
export function nookSceneCards(sceneId: string, allFiles: readonly string[]): string[] {
  return nookSceneParent(sceneId) === null
    ? nookCardPaths(allFiles, sceneId)
    : cardsOfLayer(sceneId, allFiles as string[]);
}
