import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateWorldManifest, type LocalWorldStore } from '@airp/shared';
import { compressWorldImages } from '@airp/shared/images';
import { MADE_ID, isOfficialId, workshopOf, worldCopyFilter } from '../world-workshop.js';
import { playHistoryOf, resetPlayState } from '../world-play-reset.js';
import { BundleError, packTarGz, unpackTarGz, type TarEntry, type UnpackLimits } from './tar.js';

/**
 * World bundles: what travels between a
 * local AIRP and a hosted one is the AUTHORED world and nothing it was played
 * into. Built the way a 试玩 copy is: `worldCopyFilter` leaves the runtime
 * stores behind (history, sessions, memory, backups), then `resetPlayState`
 * takes out what play wrote INTO content files (dice results, receipts, found
 * items, states, endings, NPC talk). What remains is filtered once more by an
 * extension allowlist — the same list the receiving side enforces, so a local
 * world never builds a bundle the remote would refuse for a file type.
 */

export const BUNDLE_TYPE = 'application/gzip';

const MB = 1024 * 1024;
const envNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

/** Upload ceilings; the total is also the HTTP body limit of the upload route. */
export function bundleLimits(): UnpackLimits {
  return {
    maxTotalBytes: envNumber('AIRP_SYNC_MAX_BYTES', 200 * MB),
    maxFileBytes: envNumber('AIRP_SYNC_MAX_FILE_BYTES', 64 * MB),
    maxFiles: envNumber('AIRP_SYNC_MAX_FILES', 5000),
  };
}

const AUTHORED = /\.(md|json|ya?ml|webp|png|jpe?g|gif|avif|mp3|ogg|wav|webm|mp4)$/i;
/** HTML cards are world content only where cards live. */
const HTML_ROOTS = /^(world|player|characters)\//;
const UNSAFE_SEGMENT = /[\x00-\x1f\x7f\\:]/;

/** Why a bundle path is refused, or null when it may travel. Pure. */
export function bundlePathProblem(rel: unknown): 'bad_path' | 'bad_type' | null {
  if (typeof rel !== 'string' || !rel || rel.length > 400 || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return 'bad_path';
  const segments = rel.split('/');
  if (segments.length > 16) return 'bad_path';
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || UNSAFE_SEGMENT.test(segment) || Buffer.byteLength(segment) > 200) return 'bad_path';
  }
  // Dot-directories are runtime state; the one exception is where generate_image lands pictures.
  const dotted = segments.some((segment) => segment.startsWith('.'));
  if (dotted && !(rel.startsWith('.airpworld/assets/') && !segments.slice(2).some((s) => s.startsWith('.')))) return 'bad_path';
  if (/\.html$/i.test(rel)) return HTML_ROOTS.test(rel) ? null : 'bad_type';
  return AUTHORED.test(rel) ? null : 'bad_type';
}

/** Files below `root` that may travel, POSIX-relative, with sizes. Symlinks never do. */
export async function authoredFiles(root: string): Promise<{ files: { rel: string; size: number }[]; skipped: string[] }> {
  const files: { rel: string; size: number }[] = [];
  const skipped: string[] = [];
  const walk = async (dir: string) => {
    const entries = await fs.readdir(path.join(root, dir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        if (entry.name.startsWith('.') && !(rel === '.airpworld' || rel === '.airpworld/assets' || rel.startsWith('.airpworld/assets/'))) continue;
        await walk(rel);
      } else if (entry.isFile()) {
        if (rel.startsWith('.airpworld/') && !rel.startsWith('.airpworld/assets/')) continue;
        if (bundlePathProblem(rel)) { skipped.push(rel); continue; }
        files.push({ rel, size: (await fs.stat(path.join(root, rel))).size });
      }
    }
  };
  await walk('');
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files, skipped };
}

export interface BuiltBundle {
  bundle: Buffer;
  /** SHA-256 of the bundle bytes: the version a pair compares. */
  hash: string;
  files: number;
  bytes: number;
  /** Files left out because their type may not travel. */
  skipped: string[];
}

/** Fields of world.json that describe ONE side's pairing, never the world itself. */
export function stripPairing(manifest: Record<string, unknown>): Record<string, unknown> {
  // `location` (本机 / 云端, the design notes) is this device's choice, not part of the world.
  const { remote: _remote, sync: _sync, location: _location, ...rest } = manifest;
  return rest;
}

/**
 * A clean copy of a world at its opening, in a fresh temp directory (the
 * caller removes it). `store` is the world's live store when it is the active
 * one, so its history is read without opening a second handle.
 */
export async function cleanCopy(worldDir: string, store?: LocalWorldStore | null): Promise<{ dir: string; dispose(): Promise<void> }> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-bundle-'));
  const dir = path.join(parent, 'world');
  const dispose = () => fs.rm(parent, { recursive: true, force: true });
  try {
    const history = await playHistoryOf(worldDir, store);
    await fs.cp(worldDir, dir, { recursive: true, filter: worldCopyFilter(worldDir), verbatimSymlinks: true });
    await resetPlayState(dir, { history, dropRuntime: true });
    return { dir, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

/**
 * The files of a world that may travel: clean copy → allowlist, world.json
 * without this side's pairing (and passed through `manifest`). Shared by the
 * tar bundle (the VPS sync API) and the per-file upload to the storage service.
 */
export async function buildEntries(worldDir: string, options: { store?: LocalWorldStore | null; manifest?: (m: Record<string, unknown>) => Record<string, unknown> } = {}): Promise<{ entries: TarEntry[]; bytes: number; skipped: string[] }> {
  const copy = await cleanCopy(worldDir, options.store);
  try {
    // What leaves this machine is compressed; the world on disk keeps its originals.
    await compressWorldImages(copy.dir);
    const { files, skipped } = await authoredFiles(copy.dir);
    const entries: TarEntry[] = [];
    let bytes = 0;
    for (const file of files) {
      let data = await fs.readFile(path.join(copy.dir, file.rel));
      if (file.rel === 'world.json') {
        const manifest = stripPairing(JSON.parse(data.toString('utf8')) as Record<string, unknown>);
        data = Buffer.from(JSON.stringify(options.manifest ? options.manifest(manifest) : manifest, null, 2) + '\n');
      }
      bytes += data.length;
      entries.push({ path: file.rel, data });
    }
    const limits = bundleLimits();
    if (bytes > limits.maxTotalBytes) throw new BundleError(413, 'too_large', `This world is ${Math.ceil(bytes / MB)} MB; the limit is ${Math.floor(limits.maxTotalBytes / MB)} MB.`);
    return { entries, bytes, skipped };
  } finally {
    await copy.dispose();
  }
}

/** Build the bundle of a world: clean copy → allowlist → gzipped tar. */
export async function buildBundle(worldDir: string, options: { store?: LocalWorldStore | null; manifest?: (m: Record<string, unknown>) => Record<string, unknown> } = {}): Promise<BuiltBundle> {
  const { entries, bytes, skipped } = await buildEntries(worldDir, options);
  const bundle = packTarGz(entries);
  return { bundle, hash: createHash('sha256').update(bundle).digest('hex'), files: entries.length, bytes, skipped };
}

export interface ExtractedBundle {
  /** The extracted world, inside `stagingParent`; the caller moves or removes it. */
  dir: string;
  manifest: Record<string, unknown>;
  files: number;
  bytes: number;
  hash: string;
}

/**
 * Unpack and validate an uploaded (or downloaded) bundle into a new directory
 * under `stagingParent` — put that on the same filesystem as the destination
 * so the final move is one rename. Everything is checked BEFORE a byte is
 * written: paths, types, sizes, duplicates, and a world.json that parses,
 * satisfies the shared manifest schema and is a workshop world (`made-` id,
 * `workshop` block). Then play state is reset once more on this side: the
 * receiver does not trust the sender to have done it.
 */
export async function extractBundle(bundle: Buffer, stagingParent: string): Promise<ExtractedBundle> {
  return extractEntries(unpackTarGz(bundle, bundleLimits()), stagingParent, createHash('sha256').update(bundle).digest('hex'));
}

/**
 * `extractBundle` for files that arrived one by one (the storage service); `hash` = the version they are.
 * `official`: the owner's download of an official edition (services-remote.ts) — its id is the edition
 * id and its world.json has no workshop block (the caller writes one); nothing else accepts that.
 */
export async function extractEntries(entries: TarEntry[], stagingParent: string, hash: string, options: { official?: boolean } = {}): Promise<ExtractedBundle> {
  const seen = new Set<string>();
  let bytes = 0;
  for (const entry of entries) {
    const problem = bundlePathProblem(entry.path);
    if (problem === 'bad_path') throw new BundleError(400, 'bad_path', `Refused path in bundle: ${JSON.stringify(entry.path.slice(0, 200))}.`);
    if (problem === 'bad_type') throw new BundleError(415, 'bad_type', `This file type may not be uploaded: ${entry.path}.`);
    const key = entry.path.toLowerCase();
    if (seen.has(key)) throw new BundleError(400, 'bad_path', `Duplicate path in bundle: ${entry.path}.`);
    seen.add(key);
    bytes += entry.data.length;
  }
  const worldJson = entries.find((entry) => entry.path === 'world.json');
  if (!worldJson) throw new BundleError(422, 'invalid_world', 'The bundle has no world.json at its root.');
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(worldJson.data.toString('utf8'));
    validateWorldManifest(parsed);
    manifest = parsed as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 300) : 'unreadable';
    throw new BundleError(422, 'invalid_world', `world.json is not a valid world manifest: ${detail}`);
  }
  if (options.official) {
    if (!isOfficialId(manifest.id)) throw new BundleError(422, 'invalid_world', 'This is not an official edition.');
  } else {
    if (typeof manifest.id !== 'string' || !MADE_ID.test(manifest.id)) throw new BundleError(422, 'invalid_world', 'Only worlds made in the workshop (id made-xxxxxxxx) can be synced.');
    if (!workshopOf(manifest)) throw new BundleError(422, 'invalid_world', 'world.json has no workshop block.');
  }

  await fs.mkdir(stagingParent, { recursive: true });
  const dir = path.join(stagingParent, `.incoming-${randomUUID()}`);
  try {
    await fs.mkdir(dir);
    for (const entry of entries) {
      const target = path.join(dir, ...entry.path.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, entry.data, { flag: 'wx' });
    }
    await resetPlayState(dir, { dropRuntime: true });
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
  return { dir, manifest, files: entries.length, bytes, hash };
}

export async function writeManifestFile(dir: string, manifest: Record<string, unknown>): Promise<void> {
  const file = path.join(dir, 'world.json');
  await fs.writeFile(`${file}.tmp`, JSON.stringify(manifest, null, 2) + '\n');
  await fs.rename(`${file}.tmp`, file);
}

export async function readManifestFile(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(dir, 'world.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Move a directory aside into `<root>/.trash` — the shelf's "delete means recoverable rename". */
export async function trashDir(root: string, id: string): Promise<boolean> {
  const target = path.join(root, id);
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isDirectory()) return false;
  const trash = path.join(root, '.trash');
  await fs.mkdir(trash, { recursive: true });
  await fs.rename(target, path.join(trash, `${id}-${randomUUID()}`));
  return true;
}

/**
 * Copy a directory tree to `destination`, which may be on another filesystem
 * (the hosted tenants and the public root are separate volumes, so a rename
 * between them fails with EXDEV).
 */
export async function copyTree(source: string, destination: string): Promise<void> {
  await fs.cp(source, destination, { recursive: true, verbatimSymlinks: true });
}

export { BundleError };
