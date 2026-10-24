/**
 * The known-good model data for `vendor/pi-rp` (tools/pi-model-data/), and the file moves around it.
 *
 * pi-rp's model list (`packages/ai/src/providers/data/*.json`) is gitignored and generated from
 * models.dev LIVE, so an unchanged submodule can stop compiling the day upstream adds a model
 * (2026-10-19: opencode-go gained a google-generative-ai model → TS2322, every fresh worktree's
 * build failed). `check:model-data` does not catch it — that data is "valid", it just does not
 * type-check. So the build installs this snapshot instead of fetching, and only a deliberate
 * refresh (AIRP_PI_HYDRATE=1, then `pnpm pi snapshot` once it compiles) changes it.
 *
 * The snapshot is public model metadata (ids, prices, context windows, base URLs from
 * models.dev, MIT) and ships with the open-source copy like the rest of tools/.
 *
 * Pure file helpers (directories are arguments) so tools/pi-model-snapshot.test.mjs runs on
 * temp folders; tools/pi-rp.mjs decides when to call them.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SNAPSHOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pi-model-data');
/** The generator's own bookkeeping file travels with the data (it carries generatedAt and the hashes). */
const MANIFEST = '.manifest.json';

/** The data files of a folder: every `*.json` plus the manifest, sorted; [] when it does not exist. */
export function dataFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
}

/** True when `dataDir` holds exactly the snapshot's files, byte for byte. */
export function matchesSnapshot(dataDir, snapshotDir = SNAPSHOT_DIR) {
  const want = dataFiles(snapshotDir);
  const have = dataFiles(dataDir);
  if (want.length === 0 || want.join('\n') !== have.join('\n')) return false;
  return want.every((name) => readFileSync(path.join(dataDir, name)).equals(readFileSync(path.join(snapshotDir, name))));
}

/** Copy every data file from `from` into `to`, removing data files `from` does not have. */
export function replaceData(from, to) {
  const files = dataFiles(from);
  if (!files.includes(MANIFEST)) throw new Error(`${from} has no ${MANIFEST}: not a model data folder`);
  mkdirSync(to, { recursive: true });
  for (const stale of dataFiles(to)) if (!files.includes(stale)) rmSync(path.join(to, stale));
  for (const name of files) copyFileSync(path.join(from, name), path.join(to, name));
  return files.length;
}

/** The snapshot's `generatedAt`, for messages; '' when unreadable. */
export function snapshotDate(snapshotDir = SNAPSHOT_DIR) {
  try {
    return String(JSON.parse(readFileSync(path.join(snapshotDir, MANIFEST), 'utf8')).generatedAt ?? '');
  } catch {
    return '';
  }
}
