import { useSyncExternalStore } from 'react';

export type PerformancePreset = 'balanced' | 'performance' | 'quality' | 'custom';
export type PerformanceLevel = 'full' | 'reduced' | 'off';

export interface PerformanceSettings {
  preset: PerformancePreset;
  effectsEnabled: boolean;
  particleDensity: 'full' | 'reduced';
  shadowQuality: PerformanceLevel;
  backdropBlur: PerformanceLevel;
  canvasGrain: boolean;
  diceRendering: '3d' | 'numeric';
  /** Canvas 2.5D parallax (pointer drift of backdrop and particles). */
  parallax: boolean;
  /** Canvas portrait videos: `focused` = only the one the pointer last rested on; `all` = the scene's focal portrait autoplays. */
  avatarMotion: 'all' | 'focused';
  /** World-launcher card videos: `autoplay` near the view's centre, or `hover` = only the card under the pointer / focus. */
  launcherVideo: 'autoplay' | 'hover';
}

/** Fields added in envelope v2; a v1 record keeps its old behaviour (all full). */
const V1_FILL = { parallax: true, avatarMotion: 'all', launcherVideo: 'autoplay' } as const;

const STORAGE_KEY = 'airp:performance-settings';
const LEGACY_KEY = 'airp:effects';
const SETTINGS_FIELDS = [
  'preset',
  'effectsEnabled',
  'particleDensity',
  'shadowQuality',
  'backdropBlur',
  'canvasGrain',
  'diceRendering',
  'parallax',
  'avatarMotion',
  'launcherVideo',
] as const;
const PATCH_FIELDS = SETTINGS_FIELDS.filter((field) => field !== 'preset');
const PRESETS = {
  // Effects on by default but lighter; OS reduced-motion still wins downstream.
  balanced: {
    preset: 'balanced',
    effectsEnabled: true,
    particleDensity: 'reduced',
    shadowQuality: 'full',
    backdropBlur: 'full',
    canvasGrain: true,
    diceRendering: '3d',
    parallax: false,
    avatarMotion: 'focused',
    launcherVideo: 'hover',
  },
  performance: {
    preset: 'performance',
    effectsEnabled: false,
    particleDensity: 'reduced',
    shadowQuality: 'reduced',
    backdropBlur: 'off',
    canvasGrain: false,
    diceRendering: 'numeric',
    parallax: false,
    avatarMotion: 'focused',
    launcherVideo: 'hover',
  },
  quality: {
    preset: 'quality',
    effectsEnabled: true,
    particleDensity: 'full',
    shadowQuality: 'full',
    backdropBlur: 'full',
    canvasGrain: true,
    diceRendering: '3d',
    parallax: true,
    avatarMotion: 'all',
    launcherVideo: 'autoplay',
  },
} satisfies Record<Exclude<PerformancePreset, 'custom'>, PerformanceSettings>;
const DEFAULT_SETTINGS: PerformanceSettings = { ...PRESETS.balanced };

let initialized = false;
let snapshot: PerformanceSettings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPerformanceSettings(value: unknown): value is PerformanceSettings {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== SETTINGS_FIELDS.length || SETTINGS_FIELDS.some((field) => !Object.hasOwn(value, field))) return false;
  return (
    (value.preset === 'balanced' || value.preset === 'performance' || value.preset === 'quality' || value.preset === 'custom') &&
    typeof value.effectsEnabled === 'boolean' &&
    (value.particleDensity === 'full' || value.particleDensity === 'reduced') &&
    (value.shadowQuality === 'full' || value.shadowQuality === 'reduced' || value.shadowQuality === 'off') &&
    (value.backdropBlur === 'full' || value.backdropBlur === 'reduced' || value.backdropBlur === 'off') &&
    typeof value.canvasGrain === 'boolean' &&
    (value.diceRendering === '3d' || value.diceRendering === 'numeric') &&
    typeof value.parallax === 'boolean' &&
    (value.avatarMotion === 'all' || value.avatarMotion === 'focused') &&
    (value.launcherVideo === 'autoplay' || value.launcherVideo === 'hover')
  );
}

function parseStoredEnvelope(raw: string): PerformanceSettings | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      Object.keys(parsed).length !== 2 ||
      !Object.hasOwn(parsed, 'version') ||
      !Object.hasOwn(parsed, 'settings') ||
      (parsed.version !== 1 && parsed.version !== 2)
    ) return null;
    // A v1 record predates the three lighter-Balanced fields: it keeps exactly
    // the behaviour it had (all full) and is not rewritten until the player changes something.
    const settings = parsed.version === 1 && isRecord(parsed.settings)
      ? (Object.keys(V1_FILL).some((field) => Object.hasOwn(parsed.settings as object, field)) ? null : { ...parsed.settings, ...V1_FILL })
      : parsed.settings;
    if (!isPerformanceSettings(settings)) return null;
    return { ...settings };
  } catch {
    return null;
  }
}

function getStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function persist(settings: PerformanceSettings): boolean {
  try {
    const storage = getStorage();
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, settings }));
    return true;
  } catch {
    return false;
  }
}

function initialize(): void {
  if (initialized) return;
  initialized = true;
  snapshot = DEFAULT_SETTINGS;

  let storage: Storage | null;
  let raw: string | null;
  try {
    storage = getStorage();
    if (!storage) return;
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return;
  }

  if (raw !== null) {
    snapshot = parseStoredEnvelope(raw) ?? DEFAULT_SETTINGS;
    return;
  }

  let legacy: string | null;
  try {
    legacy = storage.getItem(LEGACY_KEY);
  } catch {
    return;
  }
  if (legacy !== 'on' && legacy !== 'off') return;

  // An explicit old choice keeps the behaviour it had: full detail (the old
  // Balanced fields, now Quality's), effects as the player left them.
  snapshot = { ...PRESETS.quality, preset: 'custom', effectsEnabled: legacy === 'on' };
  if (persist(snapshot)) {
    try {
      storage.removeItem(LEGACY_KEY);
    } catch {
      // Keep the successfully migrated record; it takes precedence on the next load.
    }
  }
}

function sameSettings(left: PerformanceSettings, right: PerformanceSettings): boolean {
  return SETTINGS_FIELDS.every((field) => left[field] === right[field]);
}

function commit(next: PerformanceSettings): void {
  initialize();
  if (sameSettings(snapshot, next)) return;
  snapshot = next;
  persist(snapshot);
  for (const listener of [...listeners]) listener();
}

export function readPerformanceSettings(): PerformanceSettings {
  initialize();
  return snapshot;
}

export function subscribePerformanceSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePerformanceSettings(): PerformanceSettings {
  return useSyncExternalStore(subscribePerformanceSettings, readPerformanceSettings, () => DEFAULT_SETTINGS);
}

export function setPerformancePreset(preset: Exclude<PerformancePreset, 'custom'>): void {
  if (preset !== 'balanced' && preset !== 'performance' && preset !== 'quality') return;
  initialize();
  commit({ ...PRESETS[preset] });
}

/** Another device's settings (lib/account-data.ts): merged onto the current ones; anything invalid is ignored. */
export function replacePerformanceSettings(next: Partial<PerformanceSettings>): void {
  initialize();
  if (!isRecord(next)) return;
  const merged = { ...snapshot };
  for (const field of SETTINGS_FIELDS) if (Object.hasOwn(next, field)) (merged as Record<string, unknown>)[field] = next[field];
  if (isPerformanceSettings(merged)) commit(merged);
}

export function updatePerformanceSettings(patch: Partial<Omit<PerformanceSettings, 'preset'>>): void {
  initialize();
  if (!isRecord(patch) || Object.keys(patch).some((field) => !PATCH_FIELDS.includes(field as typeof PATCH_FIELDS[number]))) return;
  const next = { ...snapshot, ...patch, preset: 'custom' };
  if (!isPerformanceSettings(next)) return;
  commit(next);
}
