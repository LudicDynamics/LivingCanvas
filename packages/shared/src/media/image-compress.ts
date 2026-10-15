/**
 * Image compression for every picture that enters a world
 *. One policy, two encoders:
 *
 *   - Node (local server, agent process, tools): `sharp`, loaded lazily — an
 *     OPTIONAL dependency of this package. Absent → no encoder.
 *   - Browser runtime (apps/browser-runtime): the Worker installs
 *     `globalThis.__airpImageEncoder` (OffscreenCanvas → WebP, JPEG fallback).
 *
 * No encoder is a normal state: `compressImage` then hands the bytes back
 * unchanged. It never fails a write because of compression, never upscales,
 * and is idempotent — its own output passes through untouched.
 *
 * Pure apart from the encoder: the size / alpha / animation decision reads
 * only the file header (`readImageInfo`), so skipping is free.
 */

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif';

/** What a picture is for; decides its long-edge cap. */
export type ImageRole = 'cover' | 'scene' | 'map' | 'portrait' | 'token';

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
  /** The file can carry transparency (PNG colour type / tRNS, WebP alpha). */
  alpha: boolean;
  /** Animated GIF / WebP / APNG: never re-encoded (a still would lose frames). */
  animated: boolean;
}

export const IMAGE_POLICY = Object.freeze({
  /** WebP quality (0–100) for colour, and for the alpha plane. */
  quality: 80,
  alphaQuality: 90,
  /** Long-edge caps by role, in pixels. */
  longEdge: Object.freeze({ cover: 1280, scene: 1920, map: 2048, portrait: 1024, token: 768 } satisfies Record<ImageRole, number>),
  /** The launcher thumbnail a cover could get later (follow-up, not produced yet). */
  thumbLongEdge: 480,
  /** At or below this and within its cap, a file is left alone. */
  smallBytes: 96 * 1024,
  /** A WebP within its cap at or below this many bits per pixel is already compact. */
  compactWebpBpp: 3,
  /** A re-encode that does not resize must save at least this share, or the original stays. */
  minGain: 0.1,
});

export interface EncodeOptions {
  /** Expected output size from the header (aspect kept, never more than the source). */
  width: number;
  height: number;
  /**
   * The long-edge cap. An encoder that honours EXIF orientation fits the
   * oriented picture inside a maxEdge square instead of using width × height.
   */
  maxEdge: number;
  format: 'webp' | 'png' | 'jpeg';
  quality: number;
  alphaQuality: number;
  /** The source may be transparent: an encoder must not fall back to a format without alpha. */
  alpha: boolean;
}

/** The encoder port. `null` = this encoder cannot do it; the original is kept. */
export interface ImageEncoder {
  readonly id: string;
  encode(input: Uint8Array, options: EncodeOptions): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
}

export interface CompressOptions {
  /** Default: from `path` (`imageRoleForPath`), else `scene`. */
  role?: ImageRole;
  /** World-relative path; only used to infer the role. */
  path?: string;
  /** Keep the source format (the file cannot be renamed); only resizes. */
  keepFormat?: boolean;
  /** Use this encoder instead of the resolved one (tests). */
  encoder?: ImageEncoder | null;
}

export interface CompressResult {
  bytes: Uint8Array;
  mimeType: string;
  /** File extension for `mimeType`, without the dot (`webp`, `png`, `jpg`). */
  ext: string;
  changed: boolean;
  /** Why it was left alone, or what was done. */
  reason: 'unsupported' | 'animated' | 'small' | 'compact' | 'in-bounds' | 'no-encoder' | 'declined' | 'no-gain' | 'resized' | 'converted';
  width: number;
  height: number;
  before: number;
}

const MIME: Record<ImageFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const EXT_OF_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export const extForImageMime = (mimeType: string): string | null => EXT_OF_MIME[mimeType] ?? null;

// ── header parsing ──────────────────────────────────────────────────────────

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const be32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const be16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const le24 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const le32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

function pngInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 33 || ascii(b, 12, 4) !== 'IHDR') return null;
  const width = be32(b, 16), height = be32(b, 20), colorType = b[25];
  let alpha = colorType === 4 || colorType === 6;
  let animated = false;
  // Walk the chunks before the image data for tRNS (palette / key transparency) and acTL (APNG).
  for (let at = 8; at + 8 <= b.length;) {
    const length = be32(b, at), type = ascii(b, at + 4, 4);
    if (type === 'IDAT' || type === 'IEND') break;
    if (type === 'tRNS') alpha = true;
    if (type === 'acTL') animated = true;
    at += 12 + length;
  }
  return { format: 'png', width, height, alpha, animated };
}

function jpegInfo(b: Uint8Array): ImageInfo | null {
  for (let at = 2; at + 9 < b.length;) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xff) { at++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { format: 'jpeg', width: be16(b, at + 7), height: be16(b, at + 5), alpha: false, animated: false };
    }
    at += 2 + be16(b, at + 2);
  }
  return null;
}

function webpInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 30) return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { format: 'webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff, alpha: false, animated: false };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = le32(b, 21);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: ((bits >>> 28) & 1) === 1, animated: false };
  }
  if (chunk === 'VP8X') {
    const flags = b[20];
    return { format: 'webp', width: le24(b, 24) + 1, height: le24(b, 27) + 1, alpha: (flags & 0x10) !== 0, animated: (flags & 0x02) !== 0 };
  }
  return null;
}

/** Format, size, alpha and animation from the header alone; `null` = not a PNG / JPEG / WebP / GIF we can read. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  const b = bytes;
  if (b.length < 12) return null;
  try {
    if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return pngInfo(b);
    if (b[0] === 0xff && b[1] === 0xd8) return jpegInfo(b);
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return webpInfo(b);
    if (ascii(b, 0, 4) === 'GIF8') return { format: 'gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), alpha: true, animated: true };
  } catch {
    return null;
  }
  return null;
}

// ── roles ───────────────────────────────────────────────────────────────────

/** The role a world-relative path implies. Unknown → `scene` (the most generous non-map cap). */
export function imageRoleForPath(rel: string | undefined): ImageRole {
  const p = (rel ?? '').toLowerCase();
  if (/(^|\/)maps?\//.test(p) || /(^|[/-])map\.[a-z]+$/.test(p)) return 'map';
  if (/(^|\/)(tokens?|icons?)\//.test(p)) return 'token';
  if (/(^|\/)(characters?|portraits?|avatars?|npcs?|emotions?|items?|props?)\//.test(p) || /(portrait|avatar)[^/]*$/.test(p)) return 'portrait';
  return 'scene';
}

/** Output size for a long-edge cap: aspect kept, never larger than the source. */
export function fitWithin(width: number, height: number, cap: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= cap) return { width, height };
  const scale = cap / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// ── encoders ────────────────────────────────────────────────────────────────

let registered: ImageEncoder | null | undefined;
let nodeEncoder: Promise<ImageEncoder | null> | null = null;

/** Pin the encoder (a host's own, or `null` for "never compress"); `undefined` restores auto-detection. */
export function registerImageEncoder(encoder: ImageEncoder | null | undefined): void {
  registered = encoder;
}

/** sharp, when it is installed. The specifier is a variable so bundlers leave it alone. */
async function loadSharpEncoder(): Promise<ImageEncoder | null> {
  try {
    const specifier = 'sharp';
    const mod = await import(/* @vite-ignore */ specifier);
    const sharp = (mod.default ?? mod) as SharpLike;
    if (typeof sharp !== 'function') return null;
    sharp.cache?.(false);
    return {
      id: 'sharp',
      async encode(input, o) {
        // rotate(): apply EXIF orientation first — the WebP carries no EXIF, so a phone photo would lie sideways.
        let pipeline = sharp(input, { failOn: 'error', limitInputPixels: 64 * 1024 * 1024 }).rotate();
        pipeline = pipeline.resize({ width: o.maxEdge, height: o.maxEdge, fit: 'inside', withoutEnlargement: true });
        if (o.format === 'webp') pipeline = pipeline.webp({ quality: o.quality, alphaQuality: o.alphaQuality, effort: 4 });
        else if (o.format === 'jpeg') pipeline = pipeline.jpeg({ quality: Math.max(o.quality, 82), mozjpeg: true });
        else pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
        const bytes = await pipeline.toBuffer();
        return { bytes, mimeType: o.format === 'webp' ? 'image/webp' : o.format === 'jpeg' ? 'image/jpeg' : 'image/png' };
      },
    };
  } catch {
    return null;
  }
}

/** The subset of sharp this module drives. */
interface SharpPipeline {
  rotate(): SharpPipeline;
  resize(o: { width: number; height: number; fit: 'inside'; withoutEnlargement: boolean }): SharpPipeline;
  webp(o: Record<string, unknown>): SharpPipeline;
  jpeg(o: Record<string, unknown>): SharpPipeline;
  png(o: Record<string, unknown>): SharpPipeline;
  toBuffer(): Promise<Uint8Array>;
}
type SharpLike = ((input: Uint8Array, o?: Record<string, unknown>) => SharpPipeline) & { cache?: (on: boolean) => void };

/**
 * The encoder in effect: a registered one, else the browser runtime's
 * (`globalThis.__airpImageEncoder`), else sharp in Node, else `null`.
 */
export async function resolveImageEncoder(): Promise<ImageEncoder | null> {
  if (registered !== undefined) return registered;
  const g = globalThis as { __airpImageEncoder?: ImageEncoder; __airpNode?: unknown };
  if (g.__airpImageEncoder) return g.__airpImageEncoder;
  // Inside the browser runtime (node:* shims present) there is no sharp to load.
  if (g.__airpNode) return null;
  nodeEncoder ??= loadSharpEncoder();
  return nodeEncoder;
}

// ── the policy ──────────────────────────────────────────────────────────────

/**
 * Compress one picture by the policy. Returns the bytes to store and their
 * type; `changed: false` means store the input as it is.
 */
export async function compressImage(input: Uint8Array, options: CompressOptions = {}): Promise<CompressResult> {
  const info = readImageInfo(input);
  const before = input.length;
  const keep = (reason: CompressResult['reason']): CompressResult => {
    const mimeType = info ? MIME[info.format] : 'application/octet-stream';
    return { bytes: input, mimeType, ext: EXT_OF_MIME[mimeType] ?? 'bin', changed: false, reason, width: info?.width ?? 0, height: info?.height ?? 0, before };
  };
  if (!info || info.format === 'gif' || info.width < 1 || info.height < 1) return keep('unsupported');
  if (info.animated) return keep('animated');

  const role = options.role ?? imageRoleForPath(options.path);
  const maxEdge = IMAGE_POLICY.longEdge[role];
  const target = fitWithin(info.width, info.height, maxEdge);
  const resize = target.width !== info.width || target.height !== info.height;
  const format: EncodeOptions['format'] = options.keepFormat ? (info.format === 'webp' ? 'webp' : info.format) : 'webp';

  if (!resize) {
    if (before <= IMAGE_POLICY.smallBytes) return keep('small');
    if (info.format === 'webp' && (before * 8) / (info.width * info.height) <= IMAGE_POLICY.compactWebpBpp) return keep('compact');
    // Same format, same size: a lossless PNG round trip or a JPEG re-encode buys little.
    if (options.keepFormat && info.format !== 'webp') return keep('in-bounds');
  }

  const encoder = options.encoder !== undefined ? options.encoder : await resolveImageEncoder();
  if (!encoder) return keep('no-encoder');
  let out: { bytes: Uint8Array; mimeType: string } | null = null;
  try {
    out = await encoder.encode(input, { ...target, maxEdge, format, quality: IMAGE_POLICY.quality, alphaQuality: IMAGE_POLICY.alphaQuality, alpha: info.alpha });
  } catch {
    out = null;
  }
  const outInfo = out ? readImageInfo(out.bytes) : null;
  if (!out || !outInfo || !EXT_OF_MIME[out.mimeType] || MIME[outInfo.format] !== out.mimeType) return keep('declined');
  // A fallback that dropped alpha (canvas → JPEG) would paint the transparent part black.
  if (info.alpha && !outInfo.alpha && outInfo.format === 'jpeg') return keep('declined');
  const limit = resize ? before : before * (1 - IMAGE_POLICY.minGain);
  if (out.bytes.length >= limit) return keep('no-gain');
  return {
    bytes: out.bytes,
    mimeType: out.mimeType,
    ext: EXT_OF_MIME[out.mimeType],
    changed: true,
    reason: resize ? 'resized' : 'converted',
    width: outInfo.width,
    height: outInfo.height,
    before,
  };
}
