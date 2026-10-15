/**
 * Compress every picture of one world directory in place
 *: the pass behind a workshop publish, the
 * storage upload, the official release and the one-time template migration.
 *
 * Run it on a COPY whenever the original must stay (the author's draft keeps
 * its originals; only the copy that leaves the machine is compressed).
 *
 * References: the engine's contract is that a picture is referenced by its
 * WORLD-RELATIVE path (`assets/…`, `.airpworld/assets/…`) in README / card
 * frontmatter, world.json, YAML and HTML. A picture referenced that way is
 * converted to WebP and RENAMED to `.webp`, and every occurrence of the old
 * path in the world's text files is rewritten. A picture nothing references
 * by path (found by a naming convention, or not used at all) keeps its name
 * and format and is only resized when over its cap — renaming it could break
 * a lookup no text records.
 *
 * Idempotent: a second run finds nothing to do.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { compressImage, imageRoleForPath, type CompressResult, type ImageEncoder, type ImageRole } from './image-compress.js';

const IMAGE = /\.(png|jpe?g|webp)$/i;
const TEXT = /\.(md|json|ya?ml|html?|css|txt)$/i;

export interface WorldImageChange {
  /** World-relative POSIX path before. */
  path: string;
  /** Where it is now (the same path unless renamed to `.webp`). */
  to: string;
  before: number;
  after: number;
  reason: CompressResult['reason'];
  role: ImageRole;
  /** Text files whose references were rewritten (renames only). */
  rewritten: string[];
}

export interface WorldImageReport {
  changes: WorldImageChange[];
  /** Images looked at (changed or not). */
  scanned: number;
  bytesBefore: number;
  bytesAfter: number;
}

export interface WorldImageOptions {
  /** Plan only: encode in memory, report, write nothing. */
  dryRun?: boolean;
  encoder?: ImageEncoder | null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A world-relative path as it appears in text: optionally `./`-prefixed, not
 * the tail of a longer path (`x-assets/…`, `demo/assets/…`) and not the head
 * of a longer name (`a.png.bak`).
 */
export function referencePattern(rel: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9_./-])(\\./)?${escapeRe(rel)}(?![A-Za-z0-9_.-]*[A-Za-z0-9_-])`, 'g');
}

/** Replace every reference to `from` with `to` in `text`. */
export function rewriteReferences(text: string, from: string, to: string): string {
  return text.replace(referencePattern(from), (_m, lead: string, dot: string | undefined) => `${lead}${dot ?? ''}${to}`);
}

/** Files of a world that hold pictures or references; runtime state is skipped (`.airpworld/assets` excepted). */
async function listWorld(root: string): Promise<{ images: string[]; texts: string[] }> {
  const images: string[] = [];
  const texts: string[] = [];
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
        if (IMAGE.test(entry.name)) images.push(rel);
        else if (TEXT.test(entry.name)) texts.push(rel);
      }
    }
  };
  await walk('');
  images.sort();
  texts.sort();
  return { images, texts };
}

async function writeAtomic(file: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

/** Compress the pictures of the world at `root` (see the module comment). */
export async function compressWorldImages(root: string, options: WorldImageOptions = {}): Promise<WorldImageReport> {
  const { images, texts } = await listWorld(root);
  const textOf = new Map<string, string>();
  for (const rel of texts) textOf.set(rel, await fs.readFile(path.join(root, rel), 'utf8'));
  let cover: string | null = null;
  try {
    const manifest = JSON.parse(textOf.get('world.json') ?? 'null') as { cover?: unknown } | null;
    if (typeof manifest?.cover === 'string') cover = manifest.cover.replace(/^\.\//, '');
  } catch { /* an unreadable manifest has no cover */ }

  const existing = new Set(images.map((rel) => rel.toLowerCase()));
  const report: WorldImageReport = { changes: [], scanned: images.length, bytesBefore: 0, bytesAfter: 0 };
  const dirtyTexts = new Set<string>();

  for (const rel of images) {
    const abs = path.join(root, rel);
    const bytes = await fs.readFile(abs);
    report.bytesBefore += bytes.length;
    const referencedIn = [...textOf].filter(([, text]) => referencePattern(rel).test(text)).map(([file]) => file);
    // The cover cap applies only to a file used as nothing but the cover (it is often also the entry scene's bg).
    const onlyCover = cover === rel && referencedIn.every((file) => file === 'world.json') && (textOf.get('world.json') ?? '').split(rel).length === 2;
    const role: ImageRole = onlyCover ? 'cover' : imageRoleForPath(rel);
    // Renaming needs a reference to rewrite and a free target name.
    const renamed = rel.replace(IMAGE, '.webp');
    const canRename = /\.webp$/i.test(rel) || (referencedIn.length > 0 && !existing.has(renamed.toLowerCase()));
    const result = await compressImage(bytes, { role, keepFormat: !canRename, ...(options.encoder !== undefined ? { encoder: options.encoder } : {}) });
    if (!result.changed) {
      report.bytesAfter += bytes.length;
      continue;
    }
    const wanted = rel.replace(IMAGE, `.${result.ext}`);
    const to = !canRename || wanted.toLowerCase() === rel.toLowerCase() ? rel : wanted;
    // keepFormat came back in another format (cannot happen with sharp), or the new name is taken: leave it.
    const sameExt = result.ext === rel.replace(/^.*\./, '').toLowerCase().replace('jpeg', 'jpg');
    if ((!canRename && !sameExt) || (to !== rel && (referencedIn.length === 0 || existing.has(to.toLowerCase())))) {
      report.bytesAfter += bytes.length;
      continue;
    }
    const rewritten: string[] = [];
    if (to !== rel) {
      for (const file of referencedIn) {
        textOf.set(file, rewriteReferences(textOf.get(file)!, rel, to));
        dirtyTexts.add(file);
        rewritten.push(file);
      }
      existing.delete(rel.toLowerCase());
      existing.add(to.toLowerCase());
    }
    if (!options.dryRun) {
      await writeAtomic(path.join(root, to), result.bytes);
      if (to !== rel) await fs.rm(abs);
    }
    report.bytesAfter += result.bytes.length;
    report.changes.push({ path: rel, to, before: bytes.length, after: result.bytes.length, reason: result.reason, role, rewritten });
  }

  if (!options.dryRun) {
    for (const file of dirtyTexts) await writeAtomic(path.join(root, file), textOf.get(file)!);
  }
  return report;
}
