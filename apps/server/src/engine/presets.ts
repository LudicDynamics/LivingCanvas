import fs from 'node:fs';
import path from 'node:path';
import { isOfficialOpenAIBaseUrl } from './openai-model-catalog.js';

/**
 * AIRP's project config directory name (a system directory inside the world; see doc-05 §7.4).
 *
 * It is also pi-rp's `PI_PROJECT_CONFIG_DIR`: only when it is set to this value
 * will pi-rp look under `<worldRoot>/.airpworld/prompt-presets/`.
 */
export const AIRP_CONFIG_DIR = '.airpworld';

/** Checks whether a preset file is a valid pi-rp preset (the top level must have `items`). */
export function readPresetId(file: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { id?: unknown };
    return typeof parsed?.id === 'string' && parsed.id ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Installs a preset into the world's `<worldRoot>/.airpworld/prompt-presets/` and returns its id.
 *
 * Why we must "install" it rather than hand the file path straight to the engine:
 *  - pi-rp's `--preset` accepts only the preset's **id**; passing an absolute path yields
 *    `Warning: Prompt preset "…" not found` and silently falls back to the default preset;
 *  - discovery walks `<configDir>/prompt-presets/` recursively (pi-rp 6c693a7f3), but only
 *    that tree — `characters/<name>/preset.json` lives outside it and is never seen, so a
 *    character preset has to be copied in before it can be named by id.
 */
export function installPreset(worldRoot: string, srcFile: string): string {
  const id = readPresetId(srcFile);
  if (!id) throw new Error(`preset "${srcFile}" is not a valid pi-rp preset (missing top-level id)`);
  const dir = path.join(worldRoot, AIRP_CONFIG_DIR, 'prompt-presets');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(srcFile, path.join(dir, `${id}.json`));
  return id;
}

/**
 * Env vars passed through from the server process into the agent process
 * (doc-tools/11 §11 conflict 8). Whitelist, NOT `...process.env`: forwarding
 * everything would drag the developer machine's PATH/HOME/proxy vars into the
 * agent and make "what the agent can see" unauditable (doc-tools/12 §2.3).
 */
const AIRP_ENV_PASSTHROUGH = [
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENAI_BASE_URL',
  'AIRP_CUSTOM_OPENAI_BASE_URL',
  'AIRP_CUSTOM_OPENAI_API_KEY',
  'AIRP_CUSTOM_OPENAI_GENERATION',
  'AIRP_IMAGE_BASE_URL',
  'AIRP_IMAGE_QUALITY',
  'AIRP_IMAGE_MODEL',
  'AIRP_IMAGE_TIMEOUT_MS',
  'AIRP_WRITER_MAX_TOOL_CALLS',
  'AIRP_IMAGE_LIBRARY_DIR',
  // AIRP_AI_KEY is deliberately NOT here: launch.ts serviceImageKeyEnv hands it over
  // only when generate_image will call the Worldlines service with it (service mode).
] as const;

export interface AirpEnvOptions {
  /** doc-tools/00 §3: the agent's only identity difference. `writer` | `character:<id>`. Omitted = not injected. */
  role?: string;
  /** Per-spawn additions (e.g. the probe's PI_OFFLINE). `undefined` values are dropped by launch.ts's toEnv. */
  extra?: Record<string, string | undefined>;
}

/**
 * Builds the environment variables needed to spawn the pi-rp process.
 *
 * `PI_PROJECT_CONFIG_DIR` is the master switch: it is what makes pi-rp discover the
 * world's `<worldRoot>/.airpworld/prompt-presets/`.
 *
 * Deliberately **no `PI_OPENING`**. pi-rp's opening seeder plants messages into the
 * session's **chat history**, but in AIRP no agent's chat history is ever displayed:
 * the player-facing opening *is* a `type: chalk` markdown file sitting in the layer
 * directory (doc-05 §7.4), and a character learns the scene by `look_at` / `read`
 * (the hook only lists which files exist; doc-07 §3.5, B3). Seeding chat would show
 * the player nothing and burn a turn.
 *
 * `role` is the ONE injection point for agent identity (doc-tools/00 §3).
 */
export function airpEnv(opts: AirpEnvOptions = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PI_PROJECT_CONFIG_DIR: AIRP_CONFIG_DIR };
  const legacyOpenAIBaseUrl = process.env.OPENAI_BASE_URL?.trim();
  const legacyOpenAICustomEndpoint = Boolean(legacyOpenAIBaseUrl && !isOfficialOpenAIBaseUrl(legacyOpenAIBaseUrl));
  for (const key of AIRP_ENV_PASSTHROUGH) {
    if (legacyOpenAICustomEndpoint && (key === 'OPENAI_API_KEY' || key === 'OPENAI_BASE_URL')) continue;
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  // Only write AIRP_AGENT_ROLE when a role was actually given: '' and undefined are
  // both "unset" in the degradation table (doc-tools/01 §2.3) but warn differently.
  if (opts.role !== undefined) env.AIRP_AGENT_ROLE = opts.role;
  for (const [key, value] of Object.entries(opts.extra ?? {})) {
    env[key] = value;
  }
  return env;
}

/**
 * Skill directories handed to pi-rp via `--skill` (accepts a file or a directory, repeatable;
 * see `vendor/pi-rp/packages/coding-agent/src/cli/args.ts`).
 *
 * Two tiers, loaded together:
 *  - project level `<repoRoot>/skills/` — craft that applies to every world: how to generate
 *    images, how to narrate with components, how to pace a reveal, how to mesh narrative
 *    with gameplay;
 *  - world level `<worldRoot>/skills/` — this world's own voice and plot, shipped inside the
 *    world package, sitting next to `world/`.
 *
 * We pass paths explicitly rather than relying on pi-rp's `.pi/skills` discovery because a
 * scaffolded world can live outside this repo, where ancestor discovery would never reach
 * the project-level tier.
 *
 * Only directories that exist are passed, so a world without `skills/` costs nothing.
 * Subagents delegated from the writer (scene-init / nook-init) run in the same process and
 * inherit these skills; their preset only needs the `skills` slot to see them listed.
 */
export function skillArgs(repoRoot: string, worldRoot: string): string[] {
  const args: string[] = [];
  for (const dir of [path.join(repoRoot, 'skills'), path.join(worldRoot, 'skills')]) {
    if (fs.existsSync(dir)) args.push('--skill', dir);
  }
  return args;
}

/**
 * Extension paths handed to pi-rp via `--extension` (repeatable; accepts a file or directory).
 *
 * Discovers project-level extensions under `<repoRoot>/extensions/` and world-level extensions
 * under `<worldRoot>/extensions/`.
 */
export function extensionArgs(repoRoot: string, worldRoot?: string): string[] {
  const args: string[] = [];
  const searchDirs = [path.join(repoRoot, 'extensions')];
  if (worldRoot) {
    searchDirs.push(path.join(worldRoot, 'extensions'));
  }
  for (const dir of searchDirs) {
    if (fs.existsSync(dir)) {
      try {
        // A `.js` sitting next to a `.ts` of the same basename is a stale
        // transpile artifact (jiti runs the `.ts`). Loading BOTH registers
        // every slot / tool twice — `registerSlot` is a bare `Map.set`
        // (slot-renderers.ts:26), so the winner is decided by readdir order.
        // Prefer the `.ts` and skip its `.js` twin.
        for (const file of fs.readdirSync(dir)) {
          const isTs = file.endsWith('.ts') && !file.endsWith('.d.ts');
          const isJs = file.endsWith('.js') && !file.endsWith('.d.ts');
          if (!isTs && !isJs) continue;
          if (file.endsWith('.test.ts') || file.endsWith('.spec.ts')) continue;
          if (isJs && fs.existsSync(path.join(dir, `${file.slice(0, -3)}.ts`))) continue;
          args.push('--extension', path.join(dir, file));
        }
      } catch {
        // Skip unreadable directory
      }
    }
  }
  return args;
}
