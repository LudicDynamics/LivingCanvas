import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readManifestFile, writeManifestFile } from './bundle.js';

/**
 * What 「本机 · 未同步」 compares: the newest content
 * mtime and world.json's digest at the moment a world last matched its cloud copy.
 */

const DEVICE_FIELDS = new Set(['remote', 'sync', 'location']);

/** world.json's content, without the fields that only describe this device's copy. */
export function manifestDigest(manifest: Record<string, unknown>): string {
  const keep = Object.keys(manifest).filter((k) => !DEVICE_FIELDS.has(k)).sort();
  return createHash('sha256').update(JSON.stringify(manifest, keep)).digest('hex').slice(0, 32);
}

/**
 * The newest mtime among the files an upload carries: everything but world.json
 * (compared by digest instead — writing the pair touches it), the agents' `.pi`
 * and the run state in `.airpworld` (its generated pictures in `assets/` do count).
 */
export async function contentStamp(dir: string): Promise<number> {
  let newest = 0;
  const walk = async (rel: string): Promise<void> => {
    const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.map(async (e) => {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && (e.name === 'world.json' || e.name === '.pi' || e.name === '.trash')) return;
      // Of the run state only the generated pictures travel (bundle.ts worldCopyFilter).
      if (child === '.airpworld') return walk('.airpworld/assets');
      if (e.isDirectory()) return walk(child);
      if (!e.isFile()) return;
      const st = await fs.stat(path.join(dir, child)).catch(() => null);
      if (st && st.mtimeMs > newest) newest = st.mtimeMs;
    }));
  };
  await walk('');
  return newest;
}

/**
 * Record the copy as matching the cloud now (after an upload or a download).
 * `location` only when given: an upload by 「发布」 does not decide where a world is kept.
 */
export async function markSynced(dir: string, stamp: number, digest: string, location?: 'cloud'): Promise<void> {
  const fresh = await readManifestFile(dir);
  if (!fresh || typeof fresh.remote !== 'object' || fresh.remote === null) return;
  const { conflictRevision: _c, ...remote } = fresh.remote as Record<string, unknown>;
  await writeManifestFile(dir, { ...fresh, ...(location ? { location } : {}), remote: { ...remote, stamp, manifestDigest: digest } });
}
