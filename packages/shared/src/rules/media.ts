import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ActionError } from '../actions/errors.js';
import { isHtmlPath } from './html-head.js';

/** Media lanes understood by the world asset endpoint. */
export type AssetMediaKind = 'image' | 'video' | 'audio';

type AssetInspection = {
  absolutePath: string;
  mimeType: string;
};

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const VIDEO_EXTENSIONS: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const AUDIO_EXTENSIONS: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
};

function invalidAsset(message: string, reason: string): ActionError {
  return new ActionError({
    code: 'invalid_asset_ref',
    message,
    details: { reason },
  });
}

/**
 * One inspection chain's root policy: "which world-relative
 * paths count as approved" is pulled out of the checks themselves, so
 * `/api/asset` and `/api/world-file` share ONE implementation with two
 * configurations instead of two copies of the traversal checks.
 *
 * Module-private on purpose (frozen, §2.4): exporting it would make a second
 * policy outside this file look supported, and TS4023 would force the type
 * public the moment `inspectAsset` / `assetSegments` were exported.
 */
interface AssetRootPolicy {
  /** Lane names this policy accepts. */
  readonly lanes: readonly string[];
  /** Approved-root test for the lexical phase (before `resolve`). */
  readonly lexicalRootAllows: (segments: readonly string[]) => boolean;
  /** Approved-root test for the realpath phase (the symlink boundary). */
  readonly realRootAllows: (segments: readonly string[]) => boolean;
  /** Message for a lexical root rejection. */
  readonly lexicalMessage: string;
  /** Message for a realpath root rejection. */
  readonly realMessage: string;
}

/**
 * Validate the lexical world-relative asset namespace without touching disk.
 * The only published roots are whatever `policy` approves. Segment-shape rules
 * stay hardcoded: they are path shape, not an approved root, and both policies
 * share them.
 */
function assetSegments(relativePath: unknown, policy: AssetRootPolicy): string[] {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath !== relativePath.trim()) {
    throw invalidAsset('Asset reference must be a non-empty world-relative path.', 'path');
  }
  if (relativePath.includes('\\') || relativePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    throw invalidAsset('Asset reference must be a relative POSIX path.', 'path');
  }

  const segments = relativePath.split('/');
  if (!policy.lexicalRootAllows(segments)) {
    throw invalidAsset(policy.lexicalMessage, 'path');
  }

  for (const [index, segment] of segments.entries()) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw invalidAsset('Asset reference contains an invalid path segment.', 'path');
    }
    // `.airpworld` is the one permitted hidden segment, and only at the root.
    if (segment.startsWith('.') && !(index === 0 && segment === '.airpworld')) {
      throw invalidAsset('Asset reference contains an invalid hidden path segment.', 'path');
    }
  }
  return segments;
}

/** Whether a reference belongs to the published world asset namespace. */
export function isAllowedMediaReference(relativePath: string): boolean {
  try {
    assetSegments(relativePath, ASSET_ROOT_POLICY);
    return true;
  } catch {
    return false;
  }
}

function expectedMime(
  relativePath: string,
  media: AssetMediaKind | 'world-file'
): string | undefined {
  const ext = path.posix.extname(relativePath).toLowerCase();
  if (media === 'image') return IMAGE_EXTENSIONS[ext];
  if (media === 'video') return VIDEO_EXTENSIONS[ext];
  // `audio` stays an explicit branch: it used to be the fallthrough, and
  // leaving it implicit would let the world-file lane land in the audio table.
  if (media === 'audio') return AUDIO_EXTENSIONS[ext];
  // world-file: `.html` only, case-insensitive — the ONE extension judgement.
  return isHtmlPath(relativePath) ? 'text/html; charset=utf-8' : undefined;
}

async function readHeader(absolutePath: string): Promise<Buffer> {
  const handle = await open(absolutePath, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function imageMimeFromHeader(header: Buffer): string | undefined {
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    header.length >= 12 &&
    header.toString('ascii', 0, 4) === 'RIFF' &&
    header.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return undefined;
}

async function inspectAsset(
  worldRoot: string,
  relativePath: string,
  media: AssetMediaKind | 'world-file',
  policy: AssetRootPolicy
): Promise<AssetInspection> {
  if (!policy.lanes.includes(media)) {
    throw invalidAsset('Unknown asset media kind.', 'media_kind');
  }
  const segments = assetSegments(relativePath, policy);
  const root = path.resolve(worldRoot);

  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    throw invalidAsset('World root is unavailable.', 'not_found');
  }

  // Resolve the lexical path first, then resolve it again through symlinks. The
  // latter is the security boundary: a link inside assets must not publish a
  // file outside either approved subtree.
  const lexical = path.resolve(root, ...segments);
  if (lexical !== root && !lexical.startsWith(root + path.sep)) {
    throw invalidAsset('Asset reference escapes the world root.', 'path');
  }

  let resolved: string;
  try {
    resolved = await realpath(lexical);
  } catch {
    throw invalidAsset(`Asset does not exist: "${relativePath}"`, 'not_found');
  }
  const relativeResolved = path.relative(rootReal, resolved);
  const resolvedSegments = relativeResolved.split(path.sep);
  if (
    relativeResolved === '' ||
    path.isAbsolute(relativeResolved) ||
    relativeResolved === '..' ||
    relativeResolved.startsWith(`..${path.sep}`) ||
    !policy.realRootAllows(resolvedSegments)
  ) {
    throw invalidAsset(policy.realMessage, 'symlink');
  }

  let file;
  try {
    file = await stat(resolved);
  } catch {
    throw invalidAsset(`Asset does not exist: "${relativePath}"`, 'not_found');
  }
  if (!file.isFile()) {
    throw invalidAsset(`Asset is not a regular file: "${relativePath}"`, 'file_type');
  }

  const mimeType = expectedMime(relativePath, media);
  if (!mimeType) {
    throw invalidAsset(`Asset extension is not allowed for ${media}: "${relativePath}"`, 'extension');
  }

  if (media === 'image') {
    let actual: string | undefined;
    try {
      actual = imageMimeFromHeader(await readHeader(resolved));
    } catch {
      throw invalidAsset(`Asset could not be inspected: "${relativePath}"`, 'read');
    }
    if (!actual || actual !== mimeType) {
      throw invalidAsset(`Asset MIME does not match its image extension: "${relativePath}"`, 'mime');
    }
  }

  return { absolutePath: resolved, mimeType };
}

/**
 * Canonical image write gate. Every photo.image and create_char.avatar write
 * must call this exact function before writing any world file.
 */
export async function assertImageAsset(worldRoot: string, relativePath: string): Promise<void> {
  await inspectAsset(worldRoot, relativePath, 'image', ASSET_ROOT_POLICY);
}

/** Shared read gate for the generic `/api/asset` media endpoint. */
export async function assertAssetReference(
  worldRoot: string,
  relativePath: string,
  media: AssetMediaKind,
): Promise<AssetInspection> {
  return inspectAsset(worldRoot, relativePath, media, ASSET_ROOT_POLICY);
}

/** The existing root policy: `/api/asset` and the photo write gates share it. */
const ASSET_ROOT_POLICY: AssetRootPolicy = {
  lanes: ['image', 'video', 'audio'],
  lexicalRootAllows: (segments) =>
    (segments[0] === 'assets' && segments.length >= 2) ||
    (segments[0] === '.airpworld' && segments[1] === 'assets' && segments.length >= 3),
  realRootAllows: (segments) =>
    (segments[0] === 'assets' && segments.length >= 2) ||
    (segments[0] === '.airpworld' && segments[1] === 'assets' && segments.length >= 3),
  lexicalMessage: 'Asset reference must be under assets/ or .airpworld/assets/.',
  realMessage: 'Asset reference resolves outside the published asset roots.',
};

/**
 * The world-file policy (`/api/world-file`): anywhere inside the world root.
 * A non-empty segment list is already approved — the hidden-segment rule in
 * `assetSegments` still applies, since that is path SHAPE, not an approved root.
 */
const WORLD_FILE_ROOT_POLICY: AssetRootPolicy = {
  lanes: ['world-file'],
  lexicalRootAllows: (segments) => segments.length >= 1,
  realRootAllows: (segments) => segments.length >= 1,
  lexicalMessage: 'World file reference must be under the world root.',
  realMessage: 'World file reference resolves outside the world root.',
};

/**
 * World-file read gate. A NEW route, not a fourth `/api/asset`
 * lane: `world/a/x.html` is under no approved asset root, and widening those
 * roots would weaken the three existing media lanes at the same time.
 */
export async function assertWorldFileReference(
  worldRoot: string,
  relativePath: string,
): Promise<AssetInspection> {
  return inspectAsset(worldRoot, relativePath, 'world-file', WORLD_FILE_ROOT_POLICY);
}
