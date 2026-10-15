import fs from 'node:fs';
import { accountAgentDir, ensureProviderConfig } from './provider-config.js';
import { localAiProxyBase, readAiGateway } from '../ai-gateway.js';
import { modelPreferenceArgs } from './model-preferences.js';
import { worldModelPreference } from './world-models.js';
import { isOfficialOpenAIBaseUrl } from './openai-model-catalog.js';
import path from 'node:path';
import { airpEnv, extensionArgs, installPreset, skillArgs } from './presets.js';
import { CHARACTER_ROLE_PREFIX, isValidCharacterId, resolveImageModelId } from '@airp/shared';
import { writerCompactionFromEnv, writerSettingsOverlay } from './writer-beat-policy.js';

/**
 * Spawn parameters for a pi-rp agent process — the **single source** of truth.
 *
 * Both the server (`lifecycle.ts`) and the gate probe (`tools/probe-writer.mjs`)
 * build their spawn args here, so a session-dir change or a new flag can never
 * drift between the two again (before this module there were three hand-rolled
 * copies, one of which even carried an extra `--offline`).
 */
export interface LaunchSpec {
  cliPath: string;
  /** Working directory for the spawned process — always the world root. */
  cwd: string;
  args: string[];
  /** RpcClient expects `Record<string,string>`, not `NodeJS.ProcessEnv`. */
  env: Record<string, string>;
}

/** Drops `undefined` values — `airpEnv` returns a `ProcessEnv` whose keys may be unset. */
function toEnv(...records: NodeJS.ProcessEnv[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (value !== undefined) out[key] = value;
    }
  }
  return out;
}

/** Session storage for a world: `<worldRoot>/.airpworld/sessions/` (T0.3 — memory travels with the world zip). */
export function sessionsDirOf(worldRoot: string): string {
  const dir = path.join(worldRoot, '.airpworld', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resource discovery kill-switches (pi-rp `--no-*` flags).
 *
 * A spawned agent MUST see exactly what AIRP hands it, and nothing the developer machine
 * happens to have installed globally. Without these, pi-rp's discovery walks surfaces we do
 * not control. Measured on this machine (`get_commands` from a real writer spawn):
 *
 *  - `--no-skills`: kills `<home>/.agents/skills/` — **37 skills** leaked into the command
 *    table (`skill:tdd`, `skill:character-sim`, `skill:llm-writing`, …). Also covers
 *    `<cwd>/.airpworld/skills/`, which a world package could otherwise plant. Note
 *    `<home>/.pi/agent/skills/` does NOT leak: `PI_CODING_AGENT_DIR` is pinned to the repo's
 *    `.pi/agent` (see `agentDirEnv`), so the user's own agent dir is never read.
 *  - `--no-extensions`: `<cwd>/.airpworld/extensions/*.ts` — a world package's own extensions
 *    would otherwise be discovered and executed (project trust is granted by `--approve`).
 *  - `--no-context-files`: `<agentDir>/AGENTS.md` plus every `AGENTS.md`/`CLAUDE.md` up the
 *    ancestor chain from the world root. A world living under `<repo>/templates/<x>/` or
 *    `<repo>/worlds/<x>/` therefore picks up the repo's own `AGENTS.md` — 18KB of Chinese
 *    developer handbook — straight into the agent's system prompt.
 *  - `--no-prompt-templates` / `--no-themes`: same discovery shape, no AIRP use.
 *
 * Explicit `--extension` / `--skill` flags still load under `--no-*` (verified: `noSkills` +
 * `additionalSkillPaths` keeps the explicit paths and drops the discovered set — see
 * `resource-loader.ts`, `noExtensions ? cliEnabledExtensions : merge(cli, enabled)`), and
 * pi-rp's own hidden inline extensions (llama.cpp / memories / opening, `builtInExtensions`)
 * are unaffected — they are built-in factories, not discovery. So this isolates discovery
 * without touching AIRP's own tool face or the active preset.
 */
const ISOLATION_ARGS = [
  '--no-extensions',
  '--no-skills',
  '--no-context-files',
  '--no-prompt-templates',
  '--no-themes',
] as const;

/**
 * Pins pi-rp's agent config dir to the repo's `.pi/agent/`.
 *
 * Without it `getAgentDir()` falls back to `~/.pi/agent/`, where whoever runs this
 * machine picked their own providers — the repo would then behave differently per
 * developer. Same mechanism an earlier Worldlines project uses (`PI_CODING_AGENT_DIR`), just pointing
 * at a repo-local dir so `.pi/agent/models.json` is the one config that matters.
 */
function agentDirEnv(repoRoot: string): Record<string, string> {
  ensureProviderConfig(repoRoot);
  // Signed in, and a provider without its own key: chat (and pictures) go
  // through the account (ai-gateway.ts) via this server's loopback proxy.
  // Never with an explicit AIRP_AI_BASE: the browser runtime routes its own models.
  const gateway = (process.env.AIRP_AI_BASE ?? '').trim() ? null : readAiGateway(process.env, { guest: true });
  if (!gateway?.account) return { PI_CODING_AGENT_DIR: path.join(repoRoot, '.pi', 'agent'), ...ownImageEnv(), ...serviceImageKeyEnv() };
  const legacyUrl = (process.env.OPENAI_BASE_URL ?? '').trim();
  const accountEnv = legacyUrl && !isOfficialOpenAIBaseUrl(legacyUrl)
    ? { ...process.env, OPENAI_API_KEY: undefined }
    : process.env;
  const proxy = localAiProxyBase();
  const dir = accountAgentDir(repoRoot, proxy, accountEnv);
  return {
    PI_CODING_AGENT_DIR: dir ?? path.join(repoRoot, '.pi', 'agent'),
    ...accountImageEnv(proxy),
  };
}

/**
 * Not signed in: name the image model the agent will use, so an own OPENAI_API_KEY with no AIRP_IMAGE_MODEL
 * draws with openai/gpt-image-1 instead of falling back to the OpenRouter default (no_credentials).
 */
export function ownImageEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if ((env.AIRP_IMAGE_MODEL ?? '').trim()) return {};
  const model = resolveImageModelId(env);
  return model.startsWith('openai/') ? { AIRP_IMAGE_MODEL: model } : {};
}

/**
 * Service mode (an explicit AIRP_AI_BASE + AIRP_AI_KEY, no account sign-in): the
 * image provider (image-openai-provider.ts) calls the service with that key, but
 * agent-env.ts withholds every `*_KEY` from the agent. Hand back AIRP_AI_KEY —
 * and nothing else — only when generate_image will actually use it: no own
 * image key, and the configured image model is not an OpenRouter one.
 */
export function serviceImageKeyEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const key = (env.AIRP_AI_KEY ?? '').trim();
  if (!key || !(env.AIRP_AI_BASE ?? '').trim()) return {};
  if ((env.OPENAI_API_KEY ?? '').trim()) return {};
  if (!resolveImageModelId(env).startsWith('openai/')) return {};
  return { AIRP_AI_KEY: key };
}

/** generate_image without an own image key: the OpenAI-compatible path through the proxy. */
function accountImageEnv(proxy: string): Record<string, string> {
  const model = (process.env.AIRP_IMAGE_MODEL ?? '').trim();
  const own = model.startsWith('openrouter/') ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY;
  if ((own ?? '').trim()) return {};
  return { AIRP_AI_BASE: proxy, AIRP_IMAGE_MODEL: model.startsWith('openai/') ? model : `openai/${(process.env.AIRP_AI_IMAGE_MODEL ?? '').trim() || 'gpt-image-1'}` };
}

/**
 * Session files are keyed by AGENT, never shared
 *
 *
 * A character's thread is `char-<id>.jsonl`, opened by explicit path. The
 * writer's thread is any other `.jsonl` in the same directory. The writer used
 * to resume with pi-rp's `--continue`, which opens the most recently modified
 * `.jsonl` in the directory — a `char-<id>.jsonl` whenever the player had just
 * talked to someone. The writer then ran INSIDE that character's file: its
 * turns (the player's actions, its narration of everyone) were appended to the
 * character's thread and became that character's model context, and the next
 * restart moved it into whichever character file was newest. So the writer
 * now names its own file and never opens a character's
 *.
 */
export const CHARACTER_SESSION_PREFIX = 'char-';

/** `<sessions>/char-<id>.jsonl` — the one file a character agent reads and appends to. */
export function characterSessionFile(worldRoot: string, characterId: string): string {
  return path.join(sessionsDirOf(worldRoot), `${CHARACTER_SESSION_PREFIX}${characterId}.jsonl`);
}

/** The `cwd` in a session file's header line, or null when it has none / is unreadable. */
function sessionHeaderCwd(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const first = buf.subarray(0, n).toString('utf8').split('\n', 1)[0];
    const header = JSON.parse(first) as { type?: unknown; cwd?: unknown };
    return header.type === 'session' && typeof header.cwd === 'string' && header.cwd !== '' ? header.cwd : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * The writer's own session file for this world, or null for a fresh start.
 *
 * The same choice pi-rp's `--continue` makes (the most recently modified
 * session whose header `cwd` is this world), with every character's file taken
 * out of the running. A save whose writer only ever lived inside a character
 * file has no writer file of its own: the writer starts a new one, and the
 * character file keeps what was already merged into it.
 */
export function writerSessionFile(worldRoot: string): string | null {
  const dir = sessionsDirOf(worldRoot);
  // The agent records `process.cwd()`, which is the REAL path (macOS: /var → /private/var).
  const canonical = (p: string): string => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const root = canonical(worldRoot);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let best: { file: string; mtime: number } | null = null;
  for (const name of names) {
    if (!name.endsWith('.jsonl') || name.startsWith(CHARACTER_SESSION_PREFIX)) continue;
    const file = path.join(dir, name);
    const cwd = sessionHeaderCwd(file);
    if (cwd === null || canonical(cwd) !== root) continue;
    let mtime: number;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (!best || mtime > best.mtime) best = { file, mtime };
  }
  return best?.file ?? null;
}

/**
 * A loop reset: the writer's next turn starts a new
 * thread instead of resuming the old loop's conversation, and every character's
 * thread is forgotten. Old writer threads are kept, renamed out of the
 * `.jsonl` namespace (`<name>.loop-<n>.done`), so nothing is lost and nothing
 * is resumed. Returns the files touched, world-relative.
 */
export function retireSessionsForLoop(worldRoot: string, loop: number): string[] {
  const dir = sessionsDirOf(worldRoot);
  const touched: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return touched;
  }
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const file = path.join(dir, name);
    try {
      if (name.startsWith(CHARACTER_SESSION_PREFIX)) {
        fs.rmSync(file, { force: true });
      } else {
        fs.renameSync(file, path.join(dir, `${name.slice(0, -'.jsonl'.length)}.loop-${loop - 1}.done`));
      }
      touched.push(path.relative(worldRoot, file));
    } catch {
      // best effort: a file that cannot move is resumed, never lost
    }
  }
  return touched;
}

/** The writer has a thread of its own to resume (a character's file does not count). */
export function hasExistingSession(worldRoot: string): boolean {
  return writerSessionFile(worldRoot) !== null;
}

/** Reject unregistered or unsafe character ids before any path/session work. */
export function assertCharacterLaunchable(worldRoot: string, characterId: string): void {
  if (!isValidCharacterId(characterId)) {
    throw new Error(`Invalid character id "${characterId}"`);
  }
  const manifestPath = path.join(worldRoot, 'world.json');
  let manifest: { characters?: Array<{ id?: string }> };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { characters?: Array<{ id?: string }> };
  } catch {
    throw new Error('World manifest is unavailable');
  }
  if (!manifest.characters?.some((character) => character.id === characterId)) {
    throw new Error(`Character "${characterId}" is not registered in this world`);
  }
  const characterRoot = path.join(worldRoot, 'characters', characterId);
  if (!fs.statSync(characterRoot, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Character "${characterId}" directory is unavailable`);
  }
}


/**
 * Writer ("director") launch spec.
 *
 * Session handling: `--session-dir` pins storage to the world; a world whose
 * writer already has a thread resumes THAT file with `--session <path>`
 * (`writerSessionFile`). Never `--continue`: pi-rp's "most recent session" is
 * often a character's `char-<id>.jsonl`, and the writer would then live in it.
 *
 * No opening seeding: the player-facing opening is a `type: chalk` file already
 * shipped in the layer directory, and chat history never reaches the canvas (doc-05 §7.4).
 */
export function writerLaunch(repoRoot: string, worldRoot: string, vendorCliPath: string): LaunchSpec {
  const presetId = installPreset(worldRoot, path.join(repoRoot, 'presets', 'writer.json'));
  // The two initializer profiles must exist in the WORLD's `.airpworld/prompt-presets/`
  // so the writer process's `subagent_profiles` sees them (R1 delegation) and the
  // `airp-init` command can spawn them (R2). Installed per launch — installPreset
  // overwrites, so a stale world-side copy never wins.
  installPreset(worldRoot, path.join(repoRoot, 'presets', 'scene-init.json'));
  installPreset(worldRoot, path.join(repoRoot, 'presets', 'nook-init.json'));
  const sessionsDir = sessionsDirOf(worldRoot);

  const args = [
    '--approve',
    '--preset',
    presetId,
    '--session-dir',
    sessionsDir,
    ...ISOLATION_ARGS,
    ...extensionArgs(repoRoot, worldRoot),
    ...skillArgs(repoRoot, worldRoot),
    '--thinking', process.env.AIRP_WRITER_THINKING || 'low',
    ...(process.env.AIRP_WRITER_MODEL ? ['--model', process.env.AIRP_WRITER_MODEL] : []),
  ];
  const ownSession = writerSessionFile(worldRoot);
  if (ownSession) args.push('--session', ownSession);
  // How much a compaction keeps, and a safety-net auto trigger
  //. Rewritten per launch like the presets, so a
  // stale copy never wins; absent when compaction is switched off.
  const compaction = writerCompactionFromEnv();
  if (compaction.enabled) {
    const overlay = path.join(worldRoot, '.airpworld', 'writer-settings.json');
    fs.writeFileSync(overlay, `${JSON.stringify(writerSettingsOverlay(compaction), null, 2)}\n`);
    args.push('--settings-file', overlay);
  }
  args.push(...modelPreferenceArgs(worldRoot, 'writer', worldModelPreference(repoRoot, worldRoot, 'writer')));

  return {
    cliPath: vendorCliPath,
    cwd: worldRoot,
    args,
    env: toEnv(airpEnv({ role: 'writer' }), agentDirEnv(repoRoot), {
      PI_CODING_AGENT_SESSION_DIR: sessionsDir,
      AIRP_AGENT_SCOPE: 'writer-top-level',
    }),
  };
}

/**
 * Character launch spec — one session file per character (`char-<id>.jsonl`), so a
 * character overlay's memory survives shutdown and rides along with the world.
 *
 * A character's own `characters/<id>/preset.json` wins over the repo's generic
 * character preset (same choice `lifecycle` made before). Characters get the
 * same two skill tiers as the writer (`skillArgs`): the platform tier teaches
 * how to act with the tools they have, the world tier teaches this world's voice.
 * The `skills` slot in the preset is what puts those descriptions into the
 * prompt — without it the `--skill` flags load nothing the model can see.
 */
export function characterLaunch(
  repoRoot: string,
  worldRoot: string,
  vendorCliPath: string,
  characterId: string
): LaunchSpec {
  assertCharacterLaunchable(worldRoot, characterId);
  const characterPreset = path.join(worldRoot, 'characters', characterId, 'preset.json');
  const presetId = installPreset(
    worldRoot,
    fs.existsSync(characterPreset) ? characterPreset : path.join(repoRoot, 'presets', 'character.json')
  );
  const sessionsDir = sessionsDirOf(worldRoot);

  return {
    cliPath: vendorCliPath,
    cwd: worldRoot,
    args: [
      '--approve',
      '--preset',
      presetId,
      '--session-dir',
      sessionsDir,
      '--session',
      characterSessionFile(worldRoot, characterId),
      ...((process.env.AIRP_CHARACTER_MODEL || process.env.AIRP_WRITER_MODEL) ? ['--model', (process.env.AIRP_CHARACTER_MODEL || process.env.AIRP_WRITER_MODEL)!] : []),
      ...ISOLATION_ARGS,
      ...extensionArgs(repoRoot, worldRoot),
      ...modelPreferenceArgs(worldRoot, 'character', worldModelPreference(repoRoot, worldRoot, 'character')),
      ...skillArgs(repoRoot, worldRoot),
    ],
    env: toEnv(airpEnv({ role: `${CHARACTER_ROLE_PREFIX}${characterId}` }), agentDirEnv(repoRoot), {
      PI_CODING_AGENT_SESSION_DIR: sessionsDir,
      AIRP_AGENT_SCOPE: 'character',
    }),
  };
}

