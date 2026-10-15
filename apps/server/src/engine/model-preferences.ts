import fs from 'node:fs';
import path from 'node:path';
import { AgentModelSelectionSchema } from '@airp/shared';

export type ModelPreference = { provider: string; model: string; thinking: 'off' | 'low' | 'medium' | 'high' };
export type ModelPreferences = Partial<Record<'writer' | 'character', ModelPreference>>;

/**
 * Validate a single stored preference before it reaches the CLI argv.
 *
 * Why: `readModelPreferences` feeds `--provider/--model/--thinking` straight
 * into the spawned pi-rp process. An illegal `--model` makes pi-rp's
 * `findInitialModel` call `process.exit(1)`, which burns the lifecycle's crash
 * backoff loop and can wedge the world. This file is user-editable, so treat it
 * as untrusted: parse with the strict (`.strict()`) `AgentModelSelectionSchema`
 * and drop anything malformed (fail-soft) rather than passing it through.
 *
 * `.partial()` is used because the on-disk entry carries only the three
 * selection fields — the schema's `role`/`world` are context for the UI, not
 * part of the file. All three fields must still be present so we never emit a
 * `--provider undefined`.
 */
function parsePreference(value: unknown): ModelPreference | undefined {
  const parsed = AgentModelSelectionSchema.partial().safeParse(value);
  if (!parsed.success) return undefined;
  const { provider, model, thinking } = parsed.data;
  if (!provider || !model || !thinking) return undefined;
  return { provider, model, thinking };
}

/**
 * Providers pi-rp's generated catalog still lists but Worldlines no longer offers
 *. Hidden from every model
 * list a player sees (Agents → Model), refused as a choice, and a saved choice
 * of one falls back to the default. Filtered here, never by patching vendor/pi-rp.
 */
export const HIDDEN_PROVIDERS: ReadonlySet<string> = new Set(['vercel-ai-gateway']);
export const isHiddenProvider = (provider: string | undefined | null): boolean => !!provider && HIDDEN_PROVIDERS.has(provider.toLowerCase());

/** The model list a player may see and pick from. */
export function userFacingModels<T extends { provider: string }>(models: readonly T[]): T[] {
  return models.filter((m) => !isHiddenProvider(m.provider));
}

export function readModelPreferences(worldRoot: string): ModelPreferences {
  try {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(worldRoot, '.airpworld/model-preferences.json'), 'utf8')
    );
    if (typeof raw !== 'object' || raw === null) return {};
    const source = raw as Record<string, unknown>;
    const result: ModelPreferences = {};
    for (const role of ['writer', 'character'] as const) {
      const preference = parsePreference(source[role]);
      if (preference && !isHiddenProvider(preference.provider)) result[role] = preference;
    }
    return result;
  } catch {
    return {};
  }
}
/**
 * Defaults for a world with no saved preference: both roles
 * on DeepSeek `deepseek-v4-flash` (the model `ensureProviderConfig` registers on a fresh install), low thinking. Was OpenAI `gpt-5.6-luna` until
 * that key was invalidated. The Agents panel still overrides per world.
 */
export const DEFAULT_MODEL_PREFERENCES: Record<'writer' | 'character', ModelPreference> = {
  writer: { provider: 'deepseek', model: 'deepseek-v4-flash', thinking: 'low' },
  character: { provider: 'deepseek', model: 'deepseek-v4-flash', thinking: 'low' },
};

/**
 * The CLI flags for a role: the player's saved pick for this save, else the world's own hint (world.json `models`,
 * already checked against the plan and the provider config by engine/world-models.ts), else the default.
 */
export function modelPreferenceArgs(worldRoot: string, role: 'writer' | 'character', worldHint?: ModelPreference | null): string[] {
  const preference = readModelPreferences(worldRoot)[role] ?? worldHint ?? DEFAULT_MODEL_PREFERENCES[role];
  return ['--provider', preference.provider, '--model', preference.model, '--thinking', preference.thinking];
}
export function writeModelPreferences(worldRoot: string, preferences: ModelPreferences): void {
  const dir = path.join(worldRoot, '.airpworld');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'model-preferences.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(preferences, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}
