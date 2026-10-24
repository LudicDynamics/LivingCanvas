// How far a world open has got, for the page's loading indicator (apps/web lib/world-load-progress.ts,
// components/chrome/WorldLoading.tsx). Opening a world on the browser build first downloads every file of its
// bundle (worlds.ts `materialise`: ~114 files / 8 MB for 末班车), then the in-tab server's /api/worlds/load runs:
//   `download`  files / bytes done of the bundle — a blob already in the blob cache counts as done at once;
//   `prepare`   the files are in place, the server is making the save (no measurable progress: a spinner).
// Updates are throttled (at most one per `minIntervalMs`, 100 ms = ≤10/s): the first and the last always go out.

export type WorldLoadProgress =
  | { world: string; phase: 'download'; filesDone: number; filesTotal: number; bytesDone: number; bytesTotal: number }
  | { world: string; phase: 'prepare' };

export interface LoadProgressMeter {
  /** File `index` of the bundle is in hand (counted once; a file that was cached at the start is already counted). */
  fileDone(index: number): void;
  /** Every file is in hand: send the final numbers whatever the throttle says. */
  finish(): void;
}

/**
 * A meter over one bundle's files. `cached[i]` says file i needs no network (catalog.hasBlob at the start): those
 * count as done from the first update. `emit` gets each update the throttle lets through.
 */
export function createLoadProgress(
  world: string,
  files: readonly { size: number; cached: boolean }[],
  emit: (p: WorldLoadProgress) => void,
  opts: { now?: () => number; minIntervalMs?: number } = {},
): LoadProgressMeter {
  const now = opts.now ?? (() => performance.now());
  const minIntervalMs = opts.minIntervalMs ?? 100;
  const done = new Uint8Array(files.length);
  let filesDone = 0, bytesDone = 0, bytesTotal = 0;
  files.forEach((f, i) => {
    const size = Math.max(0, f.size || 0);
    bytesTotal += size;
    if (f.cached) { done[i] = 1; filesDone++; bytesDone += size; }
  });
  let last = -Infinity;
  let sentDone = -1;
  const send = (force: boolean) => {
    const t = now();
    if (!force && t - last < minIntervalMs) return;
    if (force && sentDone === filesDone && last !== -Infinity) return; // nothing new since the last update
    last = t;
    sentDone = filesDone;
    emit({ world, phase: 'download', filesDone, filesTotal: files.length, bytesDone, bytesTotal });
  };
  send(true);
  return {
    fileDone(index) {
      if (index < 0 || index >= files.length || done[index]) return;
      done[index] = 1;
      filesDone++;
      bytesDone += Math.max(0, files[index].size || 0);
      send(false);
    },
    finish() { send(true); },
  };
}
