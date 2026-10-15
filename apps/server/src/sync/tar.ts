import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * The world bundle container: a gzipped
 * POSIX tar with PAX `path` records for long or non-ASCII names, so a bundle
 * can be inspected with `tar tzf` and nothing here depends on a library.
 *
 * Deliberately narrow on the way IN: regular files and directories only. A
 * symlink, hard link, device or FIFO entry fails the whole bundle — the
 * extractor never has to decide what a link inside a world should point at.
 */

export interface TarEntry { path: string; data: Buffer }

export class BundleError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const BLOCK = 512;

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function header(name: string, size: number, type: string): Buffer {
  const block = Buffer.alloc(BLOCK, 0);
  block.write(name, 0, 100, 'utf8');
  block.write(octal(0o644, 8), 100, 8, 'ascii');
  block.write(octal(0, 8), 108, 8, 'ascii');
  block.write(octal(0, 8), 116, 8, 'ascii');
  block.write(octal(size, 12), 124, 12, 'ascii');
  block.write(octal(0, 12), 136, 12, 'ascii');
  block.fill(0x20, 148, 156);
  block.write(type, 156, 1, 'ascii');
  block.write('ustar\0', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return block;
}

const pad = (size: number) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK, 0);

/** A PAX record: `<len> path=<value>\n`, where len counts itself. */
function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (String(length).length + Buffer.byteLength(body) !== length) length = String(length).length + Buffer.byteLength(body);
  return Buffer.from(`${length}${body}`, 'utf8');
}

/** Pack files into a gzipped tar. Paths are POSIX and relative. */
export function packTarGz(entries: readonly TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const simple = /^[\x20-\x7e]+$/.test(entry.path) && entry.path.length <= 100;
    if (!simple) {
      const record = paxRecord('path', entry.path);
      parts.push(header('PaxHeader', record.length, 'x'), record, pad(record.length));
    }
    const name = simple ? entry.path : entry.path.replace(/[^\x20-\x7e]/g, '_').slice(-100);
    parts.push(header(name, entry.data.length, '0'), entry.data, pad(entry.data.length));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return gzipSync(Buffer.concat(parts));
}

export interface UnpackLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

function readString(block: Buffer, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

function readOctal(block: Buffer, start: number, length: number): number {
  const text = readString(block, start, length).trim();
  if (!/^[0-7]*$/.test(text)) throw new BundleError(400, 'bad_bundle', 'The bundle is not a readable tar archive.');
  return text ? parseInt(text, 8) : 0;
}

/** The `path` of a PAX extended header; lengths are in BYTES, so it walks the buffer. */
function paxPath(data: Buffer): string | undefined {
  let at = 0;
  let found: string | undefined;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space < 0) break;
    const length = Number(data.subarray(at, space).toString('ascii'));
    if (!Number.isInteger(length) || length <= 0 || at + length > data.length) break;
    const kv = data.subarray(space + 1, at + length).toString('utf8').replace(/\n$/, '');
    const eq = kv.indexOf('=');
    if (eq > 0 && kv.slice(0, eq) === 'path') found = kv.slice(eq + 1);
    at += length;
  }
  return found;
}

/**
 * Unpack a gzipped tar into memory, enforcing the limits WHILE reading (the
 * decompressed size is capped too, so a gzip bomb stops at the ceiling).
 */
export function unpackTarGz(bundle: Buffer, limits: UnpackLimits): TarEntry[] {
  let tar: Buffer;
  try {
    // The tar framing adds at most two blocks per file plus the end marker.
    tar = gunzipSync(bundle, { maxOutputLength: limits.maxTotalBytes + (limits.maxFiles * 3 + 2) * BLOCK });
  } catch (error) {
    const tooBig = error instanceof RangeError || (error as { code?: string })?.code === 'ERR_BUFFER_TOO_LARGE';
    throw tooBig
      ? new BundleError(413, 'too_large', 'The bundle is larger than the upload limit.')
      : new BundleError(400, 'bad_bundle', 'The bundle is not a gzipped tar archive.');
  }
  const entries: TarEntry[] = [];
  let total = 0;
  let offset = 0;
  let nextPath: string | undefined;
  while (offset + BLOCK <= tar.length) {
    const block = tar.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) break;
    const stored = readOctal(block, 148, 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
    if (sum !== stored) throw new BundleError(400, 'bad_bundle', 'The bundle has a damaged tar header.');
    const size = readOctal(block, 124, 12);
    const type = String.fromCharCode(block[156] || 0x30);
    const prefix = readString(block, 345, 155);
    const name = readString(block, 0, 100);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new BundleError(400, 'bad_bundle', 'The bundle is truncated.');
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'x') { nextPath = paxPath(data); continue; }
    if (type === 'g') continue;
    const entryPath = nextPath ?? (prefix ? `${prefix}/${name}` : name);
    nextPath = undefined;
    if (type === '5') continue;
    if (type !== '0') throw new BundleError(400, 'bad_entry', `Only regular files may travel in a bundle (${entryPath} is not one).`);
    if (size > limits.maxFileBytes) throw new BundleError(413, 'file_too_large', `${entryPath} is larger than the per-file limit.`);
    total += size;
    if (total > limits.maxTotalBytes) throw new BundleError(413, 'too_large', 'The bundle is larger than the upload limit.');
    if (entries.length >= limits.maxFiles) throw new BundleError(413, 'too_many_files', 'The bundle has too many files.');
    entries.push({ path: entryPath, data: Buffer.from(data) });
  }
  return entries;
}
