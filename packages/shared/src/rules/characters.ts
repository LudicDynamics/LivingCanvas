/**
 * Character-id rules.
 *
 * Zero dependencies on purpose: no zod, no yaml, no node builtins. Any consumer
 * may import this safely — the server (route validation), the agent-process
 * extension (`airp-init`), and the unit tests (node --test, no build).
 *
 * The character id is the directory name under `characters/` (the developer handbook:
 * ASCII lowercase kebab-case; the directory IS the id). The server route, the
 * `arrangeCards` action, `POST /api/card/footprint` and this batch's `airp-init`
 * command all need the same operations, so they live here and nowhere else:
 * - `GET /api/nook`
 * - `arrangeCards` nook branch
 * - `POST /api/card/footprint`
 * plus this batch's `airp-init` command.
 */

import { directChildrenOf } from './emptiness.js';
import { isHtmlPath } from './html-head.js';

/** A valid character id: lowercase ASCII kebab-case, no path separators. */
const CHARACTER_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** True when `id` is a legal character id. */
export function isValidCharacterId(id: string): boolean {
  return CHARACTER_ID_RE.test(id);
}

/**
 * The nook id for a character: `characters/<id>` (world-root relative, no
 * leading or trailing slash — the design notes), or null when `id` is illegal.
 *
 * This is the ONLY place that builds the nook path shape; callers must not
 * concatenate it themselves.
 */
export function nookIdOf(id: string): string | null {
  return isValidCharacterId(id) ? `characters/${id}` : null;
}

/**
 * The character id a path belongs to: `characters/<id>` or `characters/<id>/…`
 * → `<id>`; anything else, or an illegal id, → null.
 *
 * The id segment must contain no `/`, so traversal (`characters/a/../..`) never
 * matches — the guard is the id regex, not a path normalise.
 */
export function characterIdOfPath(path: string): string | null {
  const PREFIX = 'characters/';
  if (!path.startsWith(PREFIX)) return null;
  const rest = path.slice(PREFIX.length);
  const slash = rest.indexOf('/');
  const id = slash === -1 ? rest : rest.slice(0, slash);
  return isValidCharacterId(id) ? id : null;
}

/**
 * The four immutable configuration files at a character nook root.
 *
 * This deliberately accepts world-root-relative paths only and reuses the
 * canonical character path parser; nested files with the same basename are
 * ordinary lived traces, not configuration.
 */
export function characterRootConfigOf(
  path: string
): 'README.md' | 'identity.md' | 'personality.md' | 'memory.md' | null {
  const characterId = characterIdOfPath(path);
  if (characterId === null) return null;
  const prefix = `characters/${characterId}/`;
  if (!path.startsWith(prefix)) return null;
  const filename = path.slice(prefix.length);
  if (filename.includes('/')) return null;
  if (
    filename === 'README.md' ||
    filename === 'identity.md' ||
    filename === 'personality.md' ||
    filename === 'memory.md'
  ) {
    return filename;
  }
  return null;
}

/**
 * The markdown a nook page shows: direct-child `.md` under
 * `characters/<id>/`, minus the four root configuration files.
 *
 * Distinct question from `characterIdOfPath`: this one answers "what does the
 * page display" (direct children only), that one answers "which character owns
 * this path" (subdirectories included). Do not merge them.
 */
export function nookCardPaths(allFiles: readonly string[], nookId: string): string[] {
  return directChildrenOf(allFiles, nookId)
    .filter(
      (name) =>
        (name.endsWith('.md') || isHtmlPath(name)) &&
        characterRootConfigOf(`${nookId}/${name}`) === null
    )
    .map((name) => `${nookId}/${name}`);
}

// === Nook sub-scenes — NEW ===
//
// A `nookSceneId` is any DIRECTORY in the `characters/<id>/` subtree, as a
// world-root-relative path with no leading or trailing slash (N2 00 §4.1).
// The character root itself (`characters/<id>`) is scene 0 and is byte-identical
// to N1's nookId, so existing `cards` rows need no migration.
//
// These five are the ONE implementation of "is this a nook scene / which
// scene owns this path"; the route, the `arrangeCards` branches and the web app
// MUST call them instead of splitting on '/' themselves (N2 00 §5.1). They stay
// inside this file's zero-dependency charter (no zod, no yaml, no builtins).

/** One path segment of a sub-scene: the same kebab-case rule as a character id. */
export function isValidNookSegment(seg: string): boolean {
  return CHARACTER_ID_RE.test(seg);
}

/**
 * Is `scene` a legal path RELATIVE to a character root?
 *
 * `''` / `null` / `undefined` all mean "the character root scene" and are legal
 * (N2 00 §5.1 C1). Otherwise every `/`-separated segment must pass
 * `isValidNookSegment` — an empty segment (`'a//b'`, `'office/'`, `'/office'`)
 * fails, so a leading or trailing slash is rejected and MUST NOT be normalised
 * away by the caller (N2 00 §4.1).
 */
export function isValidNookScenePath(scene: string | null | undefined): boolean {
  if (scene === null || scene === undefined || scene === '') return true;
  return scene.split('/').every(isValidNookSegment);
}

/** Is `id` a full nook scene id, `characters/<id>[/<seg>]*` (no trailing `/`)? */
export function isNookSceneId(id: string): boolean {
  const PREFIX = 'characters/';
  if (!id.startsWith(PREFIX)) return false;
  const segs = id.slice(PREFIX.length).split('/');
  if (!isValidCharacterId(segs[0])) return false;
  return segs.slice(1).every(isValidNookSegment);
}

/**
 * The parent scene id of `sceneId`: `null` for a character root (its last
 * segment is the id itself, whose parent `characters` is not a scene), and
 * `null` for anything illegal (N2 00 §5.1).
 */
export function nookSceneParent(sceneId: string): string | null {
  if (!isNookSceneId(sceneId)) return null;
  const slash = sceneId.lastIndexOf('/');
  if (sceneId.slice(0, slash).indexOf('/') === -1) return null;
  return sceneId.slice(0, slash);
}

/**
 * Full scene id → the `scene` segment relative to `nookId` (N2 00 §5.1).
 *
 *   ('characters/elias/office', 'characters/elias') → 'office'
 *   ('characters/elias',        'characters/elias') → ''   ← legal root
 *   ('characters/ryo/office',   'characters/elias') → null ← out of subtree
 *
 * Three-valued on purpose: `''` is the legal root and `null` is "out of bounds",
 * so a caller that switched characters cannot silently walk into the wrong
 * character's room by having both collapse to `null` (N2 00 §5.1 C7).
 */
export function nookScenePathOf(sceneId: string, nookId: string): string | null {
  if (!isNookSceneId(sceneId) || !isNookSceneId(nookId)) return null;
  if (sceneId !== nookId && !sceneId.startsWith(`${nookId}/`)) return null;
  return sceneId === nookId ? '' : sceneId.slice(nookId.length + 1);
}
