/**
 * frame-probe.ts — opt-in frame diagnostics for real-machine stutter reports.
 *
 * Why: headless probes stay at full frame rate on this codebase, so camera /
 * launcher stutter reports cannot be reproduced in CI. This probe runs ON the
 * reporter's machine: it samples frame gaps, records long tasks, and buckets
 * the hot-path counters (camera frames, grid writes, card flips, budget
 * notifications) per second, so an exported log shows WHICH second burned and
 * on WHAT. It is a developer tool: off by default, and while off every hook is
 * a single boolean read.
 *
 * Deliberately NOT part of `performance-settings`: preset switches overwrite
 * that whole object, and a diagnostics toggle must survive preset changes. It
 * persists under its own storage key instead.
 */

export type FrameProbeEventKey =
  | 'cameraFrame'
  | 'cameraPublish'
  | 'gridWrite'
  | 'cardFlip'
  | 'budgetNotify'
  | 'launcherPlace'
  | 'launcherDrag'
  | 'wheelZoom'
  | 'cardPointerDown';

const STORAGE_KEY = 'airp:frame-probe';

/** Keep the last ~40s of per-frame gaps at 60Hz. */
const FRAME_GAP_LIMIT = 2400;
/** Keep the last ~120s of per-second counter buckets. */
const SERIES_SECONDS = 120;
/** Low-frequency event log cap. */
const EVENT_LIMIT = 2000;
/** Long-task log cap. */
const LONG_TASK_LIMIT = 500;

interface FrameProbeEvent {
  /** `performance.now()`-based ms timestamp. */
  t: number;
  key: FrameProbeEventKey | 'longtask' | 'probeStart' | 'probeStop';
  detail?: string;
}

interface LongTaskSample {
  t: number;
  duration: number;
}

let enabled = false;
let rafId = 0;
let lastFrameTime = 0;
let observer: PerformanceObserver | null = null;

const frameGaps: number[] = [];
const events: FrameProbeEvent[] = [];
const longTasks: LongTaskSample[] = [];
/** Per-second buckets: seconds-ago bucket → key → count. */
let series: Map<number, Map<string, number>> = new Map();
let sessionStart = 0;

function readStored(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function persist(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(STORAGE_KEY, 'on');
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: the probe still works for this tab's lifetime.
  }
}

function bucketNow(): number {
  return Math.floor((performance.now() - sessionStart) / 1000);
}

function recordFrameGap(gap: number): void {
  pushCapped(frameGaps, gap, FRAME_GAP_LIMIT);
}

function bump(bucket: number, key: string): void {
  let perKey = series.get(bucket);
  if (!perKey) {
    perKey = new Map();
    series.set(bucket, perKey);
    // Drop buckets that fell out of the window.
    for (const old of series.keys()) {
      if (bucket - old >= SERIES_SECONDS) series.delete(old);
    }
  }
  perKey.set(key, (perKey.get(key) ?? 0) + 1);
}

/** Accumulate a value (gap milliseconds) instead of counting occurrences. */
function bumpMs(bucket: number, key: string, value: number): void {
  bump(bucket, key);
  const perKey = series.get(bucket);
  if (perKey) perKey.set(`${key}#`, (perKey.get(`${key}#`) ?? 0) + value);
}

function frameLoop(now: number): void {
  if (!enabled) return;
  if (lastFrameTime > 0) {
    const gap = now - lastFrameTime;
    recordFrameGap(gap);
    const bucket = bucketNow();
    bump(bucket, 'frames');
    if (gap > 33) bump(bucket, 'over33');
    if (gap > 50) bump(bucket, 'over50');
    // Summed gap length lets the export derive a per-second fps without
    // keeping the raw gaps per bucket.
    bumpMs(bucket, 'gapSumMs', gap);
  }
  lastFrameTime = now;
  rafId = requestAnimationFrame(frameLoop);
}

function observeLongTasks(): void {
  if (typeof PerformanceObserver !== 'function') return;
  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTasks.push({ t: Math.round(entry.startTime), duration: Math.round(entry.duration) });
      if (longTasks.length > LONG_TASK_LIMIT) longTasks.shift();
      pushEvent('longtask', `${Math.round(entry.duration)}ms`);
    }
  });
  try {
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    observer = null;
  }
}

function pushEvent(key: FrameProbeEvent['key'], detail?: string): void {
  events.push({ t: Math.round(performance.now()), key, detail });
  if (events.length > EVENT_LIMIT) events.shift();
}

/** Turn the probe on or off. Starts/stops the sampling loop. */
export function setFrameProbeEnabled(on: boolean): void {
  if (enabled === on) return;
  enabled = on;
  persist(on);
  if (on) {
    frameGaps.length = 0;
    events.length = 0;
    longTasks.length = 0;
    series = new Map();
    lastFrameTime = 0;
    sessionStart = performance.now();
    pushEvent('probeStart');
    observeLongTasks();
    rafId = requestAnimationFrame(frameLoop);
  } else {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    observer?.disconnect();
    observer = null;
    pushEvent('probeStop');
  }
}

/** Whether the probe currently samples. */
export function isFrameProbeEnabled(): boolean {
  return enabled;
}

/** Restore the persisted toggle. Call once during app bootstrap. */
export function initializeFrameProbe(): void {
  if (readStored()) setFrameProbeEnabled(true);
}

/**
 * Count one hot-path occurrence, bucketed per second. While the probe is off
 * this is a single boolean read — safe to leave at every call site.
 */
export function probeCount(key: FrameProbeEventKey): void {
  if (!enabled) return;
  bump(bucketNow(), key);
}

/** Record a low-frequency event with optional detail. */
export function probeMark(key: FrameProbeEventKey | 'longtask', detail?: string): void {
  if (!enabled) return;
  pushEvent(key, detail);
}

export interface FrameProbeSummary {
  sampledMs: number;
  frames: number;
  fpsAvg: number;
  gapP50: number;
  gapP90: number;
  gapP99: number;
  gapMax: number;
  framesOver33: number;
  framesOver50: number;
  longTasks: number;
  counters: Record<string, number>;
}

export interface FrameProbeSnapshot {
  meta: {
    exportedAt: string;
    sessionMs: number;
    userAgent: string;
    platform: string;
    devicePixelRatio: number;
    viewport: { w: number; h: number };
    hardwareConcurrency: number | null;
    deviceMemoryGB: number | null;
    language: string;
    /** The performance-settings preset active during the session, so exports
     * state which device tier the frames were captured under. */
    performancePreset: string;
    /** The full individual settings (effects, shadow, blur, …) behind that
     * preset — custom presets carry the exact knob values here. */
    performanceSettings: Record<string, unknown>;
  };
  summary: FrameProbeSummary;
  /** Frame gaps in ms, oldest first (last ~40s). */
  frameGaps: number[];
  /** Per-second counter buckets, keyed by seconds since probe start. */
  perSecond: Record<string, Record<string, number>>;
  /** Low-frequency events (flips, long tasks, probe lifecycle). */
  events: FrameProbeEvent[];
  longTasks: LongTaskSample[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 10) / 10;
}

/** Push to a capped ring buffer (oldest dropped). */
export function pushCapped<T>(buffer: T[], item: T, cap: number): void {
  buffer.push(item);
  if (buffer.length > cap) buffer.shift();
}

/** Frame-gap statistics for the HUD and the exported snapshot. */
export function summarizeFrameGaps(gaps: number[]): {
  frames: number;
  fpsAvg: number;
  gapP50: number;
  gapP90: number;
  gapP99: number;
  gapMax: number;
  framesOver33: number;
  framesOver50: number;
} {
  const sorted = [...gaps].sort((a, b) => a - b);
  const over = (ms: number) => sorted.filter((gap) => gap > ms).length;
  const total = sorted.reduce((sum, gap) => sum + gap, 0);
  return {
    frames: sorted.length,
    fpsAvg: sorted.length > 0 ? Math.round(1000 / (total / sorted.length)) : 0,
    gapP50: percentile(sorted, 0.5),
    gapP90: percentile(sorted, 0.9),
    gapP99: percentile(sorted, 0.99),
    gapMax: sorted.length > 0 ? Math.round(sorted[sorted.length - 1]) : 0,
    framesOver33: over(33),
    framesOver50: over(50),
  };
}

/** Build the full snapshot for export. Cheap enough to run on demand. */
export function snapshotFrameProbe(): FrameProbeSnapshot {
  const stats = summarizeFrameGaps(frameGaps);
  const counters: Record<string, number> = {};
  for (const perKey of series.values()) {
    for (const [key, n] of perKey) counters[key] = (counters[key] ?? 0) + n;
  }
  const nav = globalThis.navigator as Navigator & { deviceMemory?: number };
  let performancePreset = 'unknown';
  let performanceSettingsSnapshot: Record<string, unknown> = {};
  try {
    const raw = globalThis.localStorage?.getItem('airp:performance-settings');
    const parsed: unknown = raw === null ? undefined : JSON.parse(raw);
    const stored = (parsed as { settings?: Record<string, unknown> } | undefined)?.settings;
    if (stored) {
      performanceSettingsSnapshot = stored;
      if (typeof stored.preset === 'string') performancePreset = stored.preset;
    }
  } catch {
    // Malformed settings stay 'unknown'; the export must not fail on it.
  }
  const perSecond: Record<string, Record<string, number>> = {};
  for (const [bucket, perKey] of [...series.entries()].sort((a, b) => a[0] - b[0])) {
    const flat = Object.fromEntries(perKey);
    // Derive fps from the accumulated gap length; keep the raw sum for
    // cross-checking (frames is the rAF count in that second).
    const frames = flat.frames ?? 0;
    const gapSum = flat['gapSumMs#'] ?? 0;
    if (frames > 0 && gapSum > 0) flat.fps = Math.round((frames * 1000) / gapSum);
    perSecond[String(bucket)] = flat;
  }
  return {
    meta: {
      exportedAt: new Date().toISOString(),
      sessionMs: enabled ? Math.round(performance.now() - sessionStart) : 0,
      userAgent: globalThis.navigator?.userAgent ?? '',
      platform: globalThis.navigator?.platform ?? '',
      devicePixelRatio: globalThis.devicePixelRatio ?? 1,
      viewport: { w: globalThis.innerWidth ?? 0, h: globalThis.innerHeight ?? 0 },
      hardwareConcurrency: nav?.hardwareConcurrency ?? null,
      deviceMemoryGB: nav?.deviceMemory ?? null,
      language: globalThis.navigator?.language ?? '',
      performancePreset,
      /** Full device-tier settings, so a custom preset states exactly which
       * individual knobs were on during the capture. */
      performanceSettings: performanceSettingsSnapshot,
    },
    summary: {
      sampledMs: frameGaps.length > 1 ? Math.round(frameGaps.reduce((sum, gap) => sum + gap, 0)) : 0,
      ...stats,
      longTasks: longTasks.length,
      counters,
    },
    frameGaps: frameGaps.map((gap) => Math.round(gap * 10) / 10),
    perSecond,
    events,
    longTasks,
  };
}

/** Latest-second view for the HUD: fps now, worst gap in the last second. */
export function frameProbeLive(): { fps: number; worstGap: number; over50Recent: number } {
  const recent = frameGaps.slice(-60);
  if (recent.length === 0) return { fps: 0, worstGap: 0, over50Recent: 0 };
  const avg = recent.reduce((sum, gap) => sum + gap, 0) / recent.length;
  return {
    fps: Math.round(1000 / avg),
    worstGap: Math.round(Math.max(...recent)),
    over50Recent: recent.filter((gap) => gap > 50).length,
  };
}
