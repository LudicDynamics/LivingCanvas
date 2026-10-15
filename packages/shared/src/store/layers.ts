/**
 * Layer tree — DERIVED from the world's directory structure, never declared.
 *
 * The tree IS the truth. Directory layout → layer ids (holmes-world):
 *
 *   world/                          → 'map'                (the root page)
 *   world/baker-street/             → 'world/baker-street'
 *   world/abandoned-orchard/        → 'world/abandoned-orchard'
 *
 * A directory's `README.md` is its scene config (doc-10 E0):
 *   - README present  → a written layer (name/material come from frontmatter);
 *   - README absent   → a STUB layer (doc-11 §3: "first sight" not yet written —
 *                       the door still exists, walking in initialises it).
 *
 * `world.json` MUST NOT declare a `layers` map: declaring the tree in two
 * places lets them drift (a manifest key pointing at a directory that does not
 * exist). The tree and the README frontmatter already say everything.
 *
 * A layer's page shows the markdown DIRECTLY in its directory, plus each CHILD
 * layer's door card (the child dir's README, or a synthetic stub door). It never
 * reaches into a child layer's contents — the tree decides nesting, so a
 * sub-scene's cards stay on the sub-scene's page.
 */
import type { LayerConfig } from '../schemas/world.js';
import { isHtmlPath } from '../rules/html-head.js';

/** The virtual root page; its directory is `world/`. */
export const MAP_LAYER = 'map';
/** The world content root, relative to the world dir. */
export const WORLD_DIR = 'world';

/** Directory a layer id maps to. */
export function dirOfLayer(id: string): string {
  return id === MAP_LAYER ? WORLD_DIR : id;
}

/** Layer id a directory maps to. */
export function layerOfDir(dir: string): string {
  return dir === WORLD_DIR ? MAP_LAYER : dir;
}

/**
 * Directory part of a path ('' when the path has no slash). Exported so the
 * init rules (`rules/emptiness.ts`) and the nook validation share the ONE
 * implementation instead of each writing a third copy.
 */
export function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

/**
 * True when `dir` is (or is under) the layer tree — `world` or `world/**`.
 *
 * This is the ONE predicate behind "is this directory a layer?"; `deriveLayers`
 * uses the same expression below. A caller that needs "would this PATH ever
 * appear in some layer's `items`" must ask this instead of re-deriving it from
 * the directory string (see `cardWritingFrame` in the server bridge).
 *
 * Note it is deliberately NOT `layerOfDir`: that function is an identity map for
 * everything except `world` (`characters/<id>` maps to itself, `player` to
 * `player`), so it cannot answer membership. And it is NOT `resolveLayer`
 * either, whose `characters/** → null` is a frozen semantic about the LAYER
 * TABLE, not about nook pages.
 */
export function isLayerDir(dir: string): boolean {
  return dir === WORLD_DIR || dir.startsWith(`${WORLD_DIR}/`);
}

/**
 * Build the layer map from the set of directories under `world/`.
 * `readFm(dir)` returns that directory's README frontmatter, or null when the
 * directory has no README (a stub layer).
 */
export function deriveLayers(
  dirs: string[],
  readFm: (dir: string) => Record<string, any> | null
): Record<string, LayerConfig> {
  // Only directories at or under world/ are layers.
  const layerDirs = dirs.filter(isLayerDir).sort();

  const inTree = new Set(layerDirs);
  const layers: Record<string, LayerConfig> = {};

  for (const d of layerDirs) {
    // Nearest ancestor directory that is itself a layer; map is the root.
    let parent: string | null = null;
    for (let i = d.lastIndexOf('/'); i > 0; i = d.lastIndexOf('/', i - 1)) {
      const anc = d.slice(0, i);
      if (inTree.has(anc)) {
        parent = layerOfDir(anc);
        break;
      }
    }
    const fm = readFm(d);
    const id = layerOfDir(d);
    const name = d.split('/').pop() || id;
    layers[id] = fm
      ? {
          name: typeof fm.name === 'string' ? fm.name : name,
          parent,
          material: typeof fm.material === 'string' ? fm.material : undefined,
          stub: fm.stub === true ? true : undefined,
        }
      : {
          // No README yet: a stub layer — the door exists, the scene does not.
          name,
          parent,
          stub: true,
        };
  }
  return layers;
}

/**
 * The markdown a layer's page shows DIRECTLY: files in its own directory,
 * MINUS its own README. A directory's README is that layer's *config* (name,
 * material, bg) — the scene's identity, which the badge/backdrop already carry.
 * It is not a canvas object: rendering it produced an unclickable "ghost door"
 * sitting on top of the scene's own content. Child layers still arrive as door
 * cards via `childLayers`, so a sub-scene never leaks onto its parent's page.
 */
export function cardsOfLayer(layerId: string, allFiles: string[]): string[] {
  const dir = dirOfLayer(layerId);
  const ownReadme = `${dir}/README.md`;
  const cards: string[] = [];
  for (const f of allFiles) {
    if ((f.endsWith('.md') || isHtmlPath(f)) && dirOf(f) === dir && f !== ownReadme) cards.push(f);
  }
  return cards;
}

/**
 * Immediate child layer ids of `layerId`, stable order — each becomes a door
 * card on the parent page (the child's README, or a synthesised stub door when
 * the child has no README yet).
 */
export function childLayers(
  layerId: string,
  layers: Record<string, LayerConfig>
): string[] {
  return Object.keys(layers)
    .filter((id) => id !== MAP_LAYER && layers[id].parent === layerId)
    .sort();
}

export function layerOfPath(path: string, layers: Record<string, LayerConfig>): string {
  let best = MAP_LAYER;
  for (const id of Object.keys(layers)) {
    if (id === MAP_LAYER) continue;
    if (path === id || path.startsWith(`${id}/`)) {
      if (id.length > best.length) best = id;
    }
  }
  return best;
}
