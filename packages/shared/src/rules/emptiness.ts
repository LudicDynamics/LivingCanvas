/**
 * Emptiness rules for initialisation.
 *
 * Zero dependencies on purpose: the caller passes a file list (`store.listFiles`
 * output), so these are pure and unit-testable without a store (the design notes
 * §9.1 item 3: "pure function, unit-testable").
 *
 * `files` semantics (LocalWorldStore.listFiles, local-store.ts:210-233): paths
 * are world-root relative, dotfiles and `node_modules` are skipped, and
 * directories themselves are never returned. "Direct child of `dir`" therefore
 * means: the part of the path after `dir + '/'` contains no `/`.
 */

/**
 * Names of `files` that are direct children of `dir` (no `/` in the remainder).
 * Exported because `nookCardPaths` (rules/characters.ts) needs the same notion —
 * one implementation, not three.
 */
export function directChildrenOf(files: readonly string[], dir: string): string[] {
  const prefix = dir === '' ? '' : `${dir}/`;
  const out: string[] = [];
  for (const f of files) {
    if (!f.startsWith(prefix)) continue;
    const rest = f.slice(prefix.length);
    if (rest === '' || rest.includes('/')) continue;
    out.push(rest);
  }
  return out;
}

/**
 * A layer is a stub ⟺ its directory has no `README.md`.
 * The check is exact and case-sensitive: `README.md`, not `readme.md`.
 *
 * `dir` is world-root relative (e.g. `world/baker-street/crime-scene`).
 */
export function isLayerEmpty(files: readonly string[], dir: string): boolean {
  return !directChildrenOf(files, dir).includes('README.md');
}

/**
 * Names of DIRECT child directories of `dir` (no `/` in the remainder, no `dir`
 * itself). Symmetric with `directChildrenOf` above, but for a DIRECTORY list.
 *
 * `dirs` MUST come from `store.listDirs(dir)` — a DIRECTORY walk, which yields
 * empty directories too. It MUST NOT be derived from `files` (a FILE walk):
 * a completely empty subdirectory never appears there, so the door card for it
 * would have no emptiness counterpart (N2 00 §2.3.1
 * spike B vs C). One source, two readings.
 *
 * Dot-prefixed segments are skipped, matching the `listDirs` walk
 * (local-store.ts:360 `entry.name.startsWith('.')`) so the pure function stays
 * self-consistent when called with a hand-built list.
 */
export function directChildDirsOf(dirs: readonly string[], dir: string): string[] {
  const prefix = dir === '' ? '' : `${dir}/`;
  const out = new Set<string>();
  for (const d of dirs) {
    if (!d.startsWith(prefix)) continue;
    const rest = d.slice(prefix.length);
    if (rest === '' || rest.includes('/') || rest.startsWith('.')) continue;
    out.add(rest);
  }
  return [...out].sort();
}

/**
 * A nook is empty ⟺ it holds nothing but `preset.json` / `*.json` (the design notes
 * §4.1) AND it has no direct subdirectory.
 *
 * Subdirectories ARE content (N2 00 §5.4): under the A-tier nook, a subdirectory
 * is a room with a door card on this scene's canvas (N2 00 §4.3), so "all my
 * writing lives in rooms" is a furnished nook, not an empty one. The old rule
 * ("content spilled into a subdirectory does not fill the nook") was wrong for
 * nook and made `nook-init` re-furnish an already-decorated room.
 *
 * `dirs` = `store.listDirs(dir)` output (it includes `dir` itself). It is
 * REQUIRED, not optional: a default of `[]` would silently restore the old,
 * dangerous semantics at any call site that forgets it.
 */
export function isNookEmpty(files: readonly string[], dir: string, dirs: readonly string[]): boolean {
  return (
    directChildrenOf(files, dir).every((name) => name.endsWith('.json')) &&
    directChildDirsOf(dirs, dir).length === 0
  );
}

/**
 * Did the initialiser actually leave a product on disk? `status === 'completed'`
 * from `spawnAgent` does NOT imply this — the model may have written nothing.
 *
 * A failed product is treated as a failure so W2 can fall back: if the layer's
 * README never lands, the layer stays a stub and every later entry re-triggers
 * initialisation, forever.
 *
 * - `scene`: the direct children include `README.md` (`dirs` is ignored).
 * - `nook`: the direct children include any non-`*.json` file, OR a direct
 *   subdirectory was created (a written card or a new room — N2 00 §5.4).
 */
export function hasInitProduct(
  files: readonly string[],
  dir: string,
  kind: 'scene' | 'nook',
  dirs: readonly string[]
): boolean {
  const children = directChildrenOf(files, dir);
  return kind === 'scene'
    ? children.includes('README.md')
    : children.some((name) => !name.endsWith('.json')) || directChildDirsOf(dirs, dir).length > 0;
}
