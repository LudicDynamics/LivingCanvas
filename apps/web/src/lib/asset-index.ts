/**
 * Content-addressed media URLs.
 *
 * The server hashes the active world's media (`assetIndex` on `/api/worlds/load`,
 * `GET /api/asset-index` otherwise). A path with a known hash is asked for as
 * `/api/asset?path=…&kind=…&h=<hash>`: the same bytes get the same URL in every
 * world and edition, so the browser cache and the Service Worker keep them and
 * a second open, a switch back, or the other edition downloads nothing.
 *
 * A path WITHOUT a known hash (a picture the writer just made, an old server)
 * keeps the old per-load `session=` URL. A path whose file changed is dropped
 * from the index on `file_changed` and re-read, so a stale hash is never
 * requested for new bytes.
 */

const HASH = /^[0-9a-f]{32}$/;
let hashes = new Map<string, string>();

const norm = (path: string) => path.replace(/^\/+/, '');

/** Replace the index with the server's answer; anything malformed is skipped. */
export function setAssetIndex(files: unknown): void {
  const next = new Map<string, string>();
  if (files && typeof files === 'object') {
    for (const [path, hash] of Object.entries(files as Record<string, unknown>)) {
      if (typeof hash === 'string' && HASH.test(hash)) next.set(norm(path), hash);
    }
  }
  hashes = next;
}

/** The known content hash of a world-relative media path, if any. */
export function assetHashOf(path: string): string | undefined {
  return hashes.get(norm(path));
}

/** A world file changed: its hash (if any) is no longer trusted until the index is re-read. */
export function forgetAssetHash(path: string): boolean {
  return hashes.delete(norm(path));
}

/** How many paths are indexed (for diagnostics and tests). */
export function assetIndexSize(): number {
  return hashes.size;
}

/**
 * The URL of one world media file: content-addressed when its hash is known,
 * otherwise the per-load `session` URL the page has always used.
 */
export function worldAssetUrl(path: string, kind: string, session: string): string {
  const rel = norm(path);
  const hash = hashes.get(rel);
  const base = `/api/asset?path=${encodeURIComponent(rel)}&kind=${kind}`;
  return hash ? `${base}&h=${hash}` : `${base}&session=${encodeURIComponent(session)}`;
}
