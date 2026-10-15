#!/usr/bin/env node
/**
 * Compress the pictures of world directories by the image policy
 *: WebP q80, long edge capped by role, renamed
 * to `.webp` with every world-relative reference rewritten; pictures no text
 * references keep their name and are only resized.
 *
 *   node tools/compress-world-images.mjs --templates            # plan for every templates/<id> (writes nothing)
 *   node tools/compress-world-images.mjs --templates --write    # the one-time migration: compress in place
 *   node tools/compress-world-images.mjs --check DIR…           # exit 1 when anything would change (release guard)
 *   node tools/compress-world-images.mjs DIR… [--write] [--json]
 *
 * Needs `pnpm --filter @airp/shared build` (and sharp, an optional dependency
 * of @airp/shared). Idempotent: a second --write finds nothing to do.
 *
 * `compressedSource(dir)` is what tools/migrate-worlds-to-storage.mjs uses:
 * the directory itself when nothing would change, else a compressed temp copy.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

async function images() {
  try {
    return await import(pathToFileURL(path.join(REPO, 'packages/shared/dist/media/index.js')).href);
  } catch (err) {
    throw new Error(`packages/shared is not built (pnpm --filter @airp/shared build): ${err?.message ?? err}`);
  }
}

/** Plan (dryRun) or apply the pass on one world directory. */
export async function compressWorld(dir, { write = false } = {}) {
  const { compressWorldImages } = await images();
  return compressWorldImages(dir, { dryRun: !write });
}

/**
 * The directory to upload for a world: itself when it is already compressed,
 * otherwise a compressed copy in a temp dir (`dispose()` removes it).
 */
export async function compressedSource(dir) {
  const plan = await compressWorld(dir);
  if (!plan.changes.length) return { dir, report: plan, dispose: async () => {} };
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-compress-'));
  const copy = path.join(parent, path.basename(dir));
  try {
    await fs.cp(dir, copy, { recursive: true });
    const report = await compressWorld(copy, { write: true });
    return { dir: copy, report, dispose: () => fs.rm(parent, { recursive: true, force: true }) };
  } catch (err) {
    await fs.rm(parent, { recursive: true, force: true });
    throw err;
  }
}

const MB = (n) => `${(n / 1048576).toFixed(1)} MB`;

async function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const check = argv.includes('--check');
  const json = argv.includes('--json');
  let dirs = argv.filter((a) => !a.startsWith('--'));
  if (argv.includes('--templates')) {
    const root = path.join(REPO, 'templates');
    for (const e of await fs.readdir(root, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.') && (await fs.stat(path.join(root, e.name, 'world.json')).catch(() => null))) dirs.push(path.join(root, e.name));
    }
  }
  if (!dirs.length || argv.includes('-h') || argv.includes('--help')) {
    console.log('usage: node tools/compress-world-images.mjs (--templates | DIR…) [--write | --check] [--json]');
    process.exit(dirs.length ? 0 : 2);
  }
  dirs = [...new Set(dirs.map((d) => path.resolve(d)))].sort();
  const rows = [];
  for (const dir of dirs) {
    const report = await compressWorld(dir, { write: write && !check });
    rows.push({ world: path.relative(REPO, dir) || dir, ...report });
    if (!json) {
      console.log(`${(write && !check ? 'done ' : 'plan ')} ${path.relative(REPO, dir).padEnd(34)} ${MB(report.bytesBefore).padStart(8)} → ${MB(report.bytesAfter).padStart(8)}  (${report.changes.length}/${report.scanned} pictures)`);
      for (const c of report.changes) console.log(`        ${c.path}${c.to !== c.path ? ` → ${c.to}` : ''}  ${(c.before / 1024).toFixed(0)}K → ${(c.after / 1024).toFixed(0)}K  ${c.reason} [${c.role}]`);
    }
  }
  const before = rows.reduce((n, r) => n + r.bytesBefore, 0);
  const after = rows.reduce((n, r) => n + r.bytesAfter, 0);
  const changed = rows.reduce((n, r) => n + r.changes.length, 0);
  if (json) console.log(JSON.stringify({ mode: check ? 'check' : write ? 'write' : 'plan', worlds: rows, before, after }, null, 2));
  else console.log(`# ${rows.length} world(s): pictures ${MB(before)} → ${MB(after)}; ${changed} to ${write && !check ? 'were' : 'would be'} compressed`);
  if (check && changed) {
    if (!json) console.log('# not compressed — run: node tools/compress-world-images.mjs --write <dirs> and commit');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err?.stack ?? String(err)); process.exit(1); });
}
