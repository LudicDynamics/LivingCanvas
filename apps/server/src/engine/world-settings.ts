import fs from 'node:fs';
import path from 'node:path';
import { WorldSettingsSchema, DEFAULT_WORLD_SETTINGS, type WorldSettings, type WorldSettingsPatch } from '@airp/shared';

/**
 * Per-world player settings, stored beside the save (<worldRoot>/.airpworld/settings.json).
 *
 * Why a file and not localStorage: the server is the side
 * that decides whether an automatic turn fires, and it must read the same value
 * the player set in the UI. A localStorage flag would be invisible to
 * `routes/world.ts`, so the two would drift.
 *
 * This file is user-editable, so treat it as untrusted: parse with the strict
 * (`WorldSettingsSchema` is `.strict()`) schema and fall back to the defaults on
 * anything malformed (fail-soft) — never let a hand-edited file wedge a route.
 */
export function readWorldSettings(worldRoot: string): WorldSettings {
  try {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(worldRoot, '.airpworld/settings.json'), 'utf8')
    );
    const parsed = WorldSettingsSchema.partial().safeParse(raw);
    if (!parsed.success) return { ...DEFAULT_WORLD_SETTINGS };
    return { ...DEFAULT_WORLD_SETTINGS, ...parsed.data };
  } catch {
    return { ...DEFAULT_WORLD_SETTINGS };
  }
}

export function writeWorldSettings(worldRoot: string, settings: WorldSettings): void {
  const dir = path.join(worldRoot, '.airpworld');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}

/**
 * Apply a PARTIAL patch over the stored settings.
 *
 * `writeWorldSettings` stays the whole-object primitive; this is what
 * `POST /api/world-settings` calls, so the body may carry a subset of the
 * fields without resetting the ones it omits. Returns the merged result.
 */
export function updateWorldSettings(worldRoot: string, patch: WorldSettingsPatch): WorldSettings {
  const next: WorldSettings = { ...readWorldSettings(worldRoot), ...patch };
  writeWorldSettings(worldRoot, next);
  return next;
}
