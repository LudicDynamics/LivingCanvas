/**
 * The two presentation moments. Pure: no I/O.
 *
 * The page presents exactly two things, and only when they become true:
 *   1. entering a scene this save has never entered before;
 *   2. obtaining an item (a file arriving in `player/`).
 *
 * Both are read back from facts the save already holds — `layer_entered`
 * since the last rollback, the layer READMEs, the bag — so there is no
 * milestone state to keep: a rollback rewinds them with the story and a new
 * save starts empty. This module only shapes those facts; it counts nothing
 * and has no notion of chapters or progress.
 */

/** One written layer, by DIRECTORY (`world` is the root, never `map`). */
export interface SceneLayer {
  layer: string;
  name: string;
  /** Still picture (`bg:`), when it is an image. */
  bg: string | null;
  /** Animated companion (`bgVideo:`, or a video `bg:`), webm/mp4 only. */
  video: string | null;
}

/** A scene this save has entered, in the order first entered. */
export interface VisitedScene {
  layer: string;
  name: string;
  video: string | null;
  poster: string | null;
}

function layerDir(layer: string): string {
  const l = layer.trim().replace(/^\/+|\/+$/g, '');
  return l === '' || l === 'map' ? 'world' : l;
}

/**
 * Scenes in the order this save first entered them. The start layer counts
 * from the beginning (it is where the run is, not a place it found); layers
 * without a README (stubs) are not scenes yet and are skipped.
 */
export function visitedScenes(input: {
  layers: readonly SceneLayer[];
  entered: readonly string[];
  start: string;
}): VisitedScene[] {
  const byDir = new Map(input.layers.map((l) => [layerDir(l.layer), l] as const));
  const out: VisitedScene[] = [];
  const seen = new Set<string>();
  for (const raw of [input.start, ...input.entered]) {
    const dir = layerDir(raw);
    if (seen.has(dir)) continue;
    const layer = byDir.get(dir);
    if (!layer) continue;
    seen.add(dir);
    out.push({ layer: dir, name: layer.name, video: layer.video, poster: layer.bg });
  }
  return out;
}
