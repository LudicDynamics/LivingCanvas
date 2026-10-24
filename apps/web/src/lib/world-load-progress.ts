/**
 * The world-opening indicator's state (components/chrome/WorldLoading.tsx). Opening a world on the browser build
 * (canvas.worldlines.gg) first downloads every file of its bundle — ~114 files / 8 MB for 末班车 — and only then
 * does the in-tab server's /api/worlds/load make the save; players read the silent wait as 「卡住了」. The runtime
 * posts its progress (apps/browser-runtime/src/load-progress.ts, ≤10 updates/s) as `world-progress`
 * (lib/browser-mode.ts relays it here). The local edition has no runtime: its open is only a spinner.
 *
 * Phases, in order:
 *   opening   the request is out, nothing measured yet (local edition: the whole server load)   spinner
 *   download  files / bytes of the bundle (cached blobs count as done at once)                     progress bar
 *   prepare   the files are in place; the server is making the save                              spinner
 *   enter     the save is open; the page is entering its first scene                             spinner
 * Pure apart from the tiny store at the bottom, so the phase and label rules are unit-tested.
 */

export type RuntimeWorldProgress =
  | { world: string; phase: 'download'; filesDone: number; filesTotal: number; bytesDone: number; bytesTotal: number }
  | { world: string; phase: 'prepare' };

export interface WorldLoadState {
  /** The path the page asked to open (`templates/<id>`, `published/<id>`, a save `worlds/<save>`). */
  path: string;
  /** The runtime's latest word on this open; null until it says anything (always null on the local edition). */
  progress: RuntimeWorldProgress | null;
  /** The server answered: the page is entering the world's first scene. */
  entering: boolean;
}

export type WorldLoadPhase =
  | { kind: 'opening' }
  | { kind: 'download'; filesDone: number; filesTotal: number; bytesDone: number; bytesTotal: number; percent: number }
  | { kind: 'prepare' }
  | { kind: 'enter' };

/** The runtime's catalog key of a load path (apps/browser-runtime/src/worlds.ts `WorldLibrary.keyOfPath`); null for a save. */
export function worldLoadKey(worldPath: string): string | null {
  const m = /^(?:\.\/)?(templates|published|worlds\/published)\/([a-zA-Z0-9][\w-]*)\/?$/.exec(worldPath);
  return m ? `${m[1] === 'templates' ? 'templates' : 'published'}/${m[2]}` : null;
}

/** Fold one runtime update into the state: only an update about the world being opened counts. */
export function withRuntimeProgress(state: WorldLoadState | null, p: RuntimeWorldProgress): WorldLoadState | null {
  if (!state || state.entering || !p || typeof p.world !== 'string') return state;
  if (worldLoadKey(state.path) !== p.world) return state;
  // A late download update never takes the indicator back from `prepare`.
  if (p.phase === 'download' && state.progress?.phase === 'prepare') return state;
  return { ...state, progress: p };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/** What the indicator shows for a state. */
export function worldLoadPhase(state: WorldLoadState | null): WorldLoadPhase {
  if (!state) return { kind: 'opening' };
  if (state.entering) return { kind: 'enter' };
  const p = state.progress;
  if (!p) return { kind: 'opening' };
  if (p.phase === 'prepare') return { kind: 'prepare' };
  const filesTotal = Math.max(0, Math.floor(p.filesTotal));
  const filesDone = clamp(Math.floor(p.filesDone), 0, filesTotal);
  const bytesTotal = Math.max(0, p.bytesTotal);
  const bytesDone = clamp(p.bytesDone, 0, bytesTotal);
  // By bytes (what takes the time); a bundle of empty files goes by file count.
  const ratio = bytesTotal > 0 ? bytesDone / bytesTotal : filesTotal > 0 ? filesDone / filesTotal : 1;
  // 100 only when every file is in: rounding must not show a full bar with files still missing.
  const percent = filesDone >= filesTotal ? 100 : Math.min(99, Math.floor(ratio * 100));
  return { kind: 'download', filesDone, filesTotal, bytesDone, bytesTotal, percent };
}

/** Bytes as MB with one decimal (1 MB = 1024²), never "0.0" for a started download. */
export function formatMegabytes(bytes: number): string {
  const mb = Math.max(0, bytes) / (1024 * 1024);
  if (mb > 0 && mb < 0.1) return '0.1';
  return mb.toFixed(1);
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** The progress line, 「已下载 12 / 114 · 3.1 / 8.0 MB」. */
export function downloadLabel(phase: Extract<WorldLoadPhase, { kind: 'download' }>, t: Translate): string {
  return t('Downloaded {done} / {total} · {mb} / {totalMb} MB', {
    done: phase.filesDone, total: phase.filesTotal, mb: formatMegabytes(phase.bytesDone), totalMb: formatMegabytes(phase.bytesTotal),
  });
}

/** The phase headline (the live region: it changes once per phase, not with every number). */
export function phaseHeadline(phase: WorldLoadPhase, t: Translate): string {
  switch (phase.kind) {
    case 'download': return t('Downloading the world…');
    case 'prepare': return t('Preparing your save…');
    case 'enter': return t('Entering the world…');
    default: return t('Opening the world…');
  }
}

// ── The store: App.tsx begins / enters / ends a load, lib/browser-mode.ts feeds the runtime's updates. ──
let current: WorldLoadState | null = null;
const listeners = new Set<() => void>();
const set = (next: WorldLoadState | null) => {
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
};

export const worldLoadStore = {
  get: (): WorldLoadState | null => current,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  /** A new open replaces whatever the last one left. */
  begin(path: string) { set({ path, progress: null, entering: false }); },
  runtime(p: RuntimeWorldProgress) { set(withRuntimeProgress(current, p)); },
  entering(path: string) { if (current?.path === path && !current.entering) set({ ...current, entering: true }); },
  end(path: string) { if (current?.path === path) set(null); },
};
