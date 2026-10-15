import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Content hashes for media URLs.
 *
 * A media URL that carries `h=<hash of the bytes>` names those bytes for good,
 * so the browser (and the Service Worker, apps/web/public/sw.js) may keep it
 * forever and share it between worlds: the -jp / -zh / -en editions ship the
 * same pictures at the same paths, and a second game of a world is a copy of
 * the same files. A URL without `h` keeps its old meaning and old caching.
 *
 * The hash is the first 32 hex digits (128 bits) of SHA-256 over the file.
 * It is memoised per absolute path and invalidated by size or mtime, so the
 * index of a world already seen costs one `stat` per file.
 */

export const ASSET_HASH = /^[0-9a-f]{32}$/;

/** Year-long, never revalidated: only ever sent for a URL whose `h` matched the bytes. */
export const IMMUTABLE = 'max-age=31536000, immutable';

const memo = new Map<string, { size: number; mtimeMs: number; hash: string }>();
const MEMO_LIMIT = 20_000;

function digest(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex').slice(0, 32)));
  });
}

/** Hash of one file's bytes, or null when it is not a readable regular file. */
export async function fileHash(file: string): Promise<string | null> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return null;
  // A 0-byte file is a placeholder (browser mode's catalog stubs and platform
  // audio): it names no content, and one shared hash would collapse every
  // stub cover onto the same URL.
  if (stat.size === 0) return null;
  const known = memo.get(file);
  if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) return known.hash;
  const hash = await digest(file).catch(() => null);
  if (!hash) return null;
  if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value!);
  memo.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, hash });
  return hash;
}

/**
 * The memoised hash when it is still current, without reading the file: for
 * synchronous URL builders (the audio resolver). A file never hashed, or
 * changed since, answers null and its URL simply goes out without `h`.
 */
export function knownFileHash(file: string): string | null {
  const known = memo.get(file);
  if (!known) return null;
  try {
    const stat = statSync(file);
    return stat.isFile() && stat.size === known.size && stat.mtimeMs === known.mtimeMs ? known.hash : null;
  } catch {
    return null;
  }
}

/** Hash every media file under `dir` (recursively) so `knownFileHash` can answer for them. */
export async function warmHashes(dir: string): Promise<number> {
  const files: string[] = [];
  await walk(dir, files);
  for (let i = 0; i < files.length; i += 16) await Promise.all(files.slice(i, i + 16).map(fileHash));
  return files.length;
}

/** Media a world page can ask `/api/asset` for; everything else is skipped by the index. */
const MEDIA_FILE = /\.(?:webp|png|jpe?g|gif|avif|svg|mp4|webm|mov|m4v|mp3|ogg|oga|wav|m4a|aac|flac|opus)$/i;

/** The two approved asset roots of `/api/asset` (packages/shared rules/media.ts `ASSET_ROOT_POLICY`). */
const ASSET_ROOTS = ['assets', '.airpworld/assets'];

async function walk(dir: string, out: string[]): Promise<void> {
  const list = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of list) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(abs, out);
    else if (entry.isFile() && MEDIA_FILE.test(entry.name)) out.push(abs);
  }
}

/**
 * `{ "assets/scenes/world.jpg": "<hash>", … }` for every media file under a
 * world's asset roots. Paths are world-relative with `/`. Symlinks are not
 * followed (the `/api/asset` gate re-checks every request anyway).
 */
export async function worldAssetIndex(worldRoot: string): Promise<Record<string, string>> {
  const files: string[] = [];
  for (const root of ASSET_ROOTS) await walk(path.join(worldRoot, root), files);
  const out: Record<string, string> = {};
  // A few at a time: parallel enough to hide read latency, not a thousand open files.
  for (let i = 0; i < files.length; i += 16) {
    const batch = files.slice(i, i + 16);
    const hashes = await Promise.all(batch.map(fileHash));
    batch.forEach((abs, j) => {
      if (hashes[j]) out[path.relative(worldRoot, abs).split(path.sep).join('/')] = hashes[j]!;
    });
  }
  return out;
}

/**
 * Cache-Control for a media response. `h` present and equal to the bytes →
 * immutable (`public` for shared, curated media; `private` for a player's own
 * world, which may be an unpublished draft). `h` present but stale → `no-cache`,
 * so the wrong bytes are never pinned under that URL. No `h` → `fallback`.
 */
export function mediaCacheControl(requested: unknown, actual: string | null, scope: 'public' | 'private', fallback: string | null): string | null {
  if (typeof requested !== 'string' || !ASSET_HASH.test(requested)) return fallback;
  return actual === requested ? `${scope}, ${IMMUTABLE}` : 'no-cache';
}

/** Append `h=<hash>` to a media URL when the file hashes; the URL unchanged otherwise. */
export async function withContentHash(url: string, file: string): Promise<string> {
  const hash = await fileHash(file);
  return hash ? `${url}${url.includes('?') ? '&' : '?'}h=${hash}` : url;
}
