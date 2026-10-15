import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** The subset of a pi-rp model definition that the bundled DeepSeek model needs. */
export interface DeepSeekModelDefinition {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
  compat: Record<string, unknown>;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

const validModel = (model: unknown): model is DeepSeekModelDefinition => isObject(model)
  && typeof model.id === 'string'
  && typeof model.name === 'string'
  && model.reasoning === true
  && Array.isArray(model.input)
  && model.input.every((item: unknown) => typeof item === 'string')
  && typeof model.contextWindow === 'number'
  && typeof model.maxTokens === 'number'
  && isObject(model.compat);

function bundledDefinition(source: unknown): { provider: JsonObject; models: DeepSeekModelDefinition[] } | undefined {
  if (!isObject(source) || !isObject(source.providers) || !isObject(source.providers.deepseek)) return undefined;
  const rawProvider = source.providers.deepseek;
  if (
    rawProvider.apiKey !== '$DEEPSEEK_API_KEY' ||
    rawProvider.baseUrl !== 'https://api.deepseek.com' ||
    rawProvider.api !== 'openai-completions' ||
    !Array.isArray(rawProvider.models)
  ) return undefined;
  // Every valid bundled model (the default deepseek-v4-flash first; deepseek-v4-pro for worlds that ask for it,
  // world.json `models`, engine/world-models.ts). An invalid row is skipped, never written.
  const models = rawProvider.models.filter(validModel);
  if (!models.some((m) => m.id === 'deepseek-v4-flash' || m.id === 'deepseek-flash')) return undefined;
  return {
    provider: {
      baseUrl: rawProvider.baseUrl,
      api: rawProvider.api,
      apiKey: '$DEEPSEEK_API_KEY',
      models,
    },
    models,
  };
}

/**
 * Add the shipped DeepSeek models without replacing local providers, credentials,
 * or model overrides (a model already listed is left as the owner wrote it).
 * Invalid local JSON is left untouched for an operator to fix.
 */
export function ensureProviderConfig(repoRoot: string): void {
  const sourceFile = path.join(repoRoot, 'config', 'deepseek-models.example.json');
  const targetFile = path.join(repoRoot, '.pi', 'agent', 'models.json');
  const definition = bundledDefinition(readJson(sourceFile));
  if (!definition) return;

  let config: JsonObject = {};
  if (fs.existsSync(targetFile)) {
    if (!fs.lstatSync(targetFile).isFile()) return;
    const parsed = readJson(targetFile);
    if (!isObject(parsed)) return;
    config = parsed;
  }
  const providers = config.providers === undefined ? {} : config.providers;
  if (!isObject(providers)) return;
  const existing = providers.deepseek;
  if (existing !== undefined && !isObject(existing)) return;
  const listed = isObject(existing) && Array.isArray(existing.models) ? existing.models : [];
  const missing = definition.models.filter((model) => !listed.some((candidate) => isObject(candidate) && candidate.id === model.id));
  if (isObject(existing) && missing.length === 0) return;

  const deepseek = isObject(existing)
    ? { ...existing, models: [...listed, ...missing] }
    : { ...definition.provider, models: definition.models };
  const next = { ...config, providers: { ...providers, deepseek } };
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  const tempFile = `${targetFile}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tempFile, targetFile);
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

/**
 * Chat through the signed-in Worldlines account (ai-gateway.ts) for every
 * provider this computer has no key for. The agents are separate processes
 * that must never hold the account session, so their models go to this
 * server's loopback proxy (`proxyBase`), which adds the token.
 *
 * `.pi/agent/models.json` stays as the owner wrote it; the rewritten copy
 * lives in a sibling agent dir `.pi/agent-account/` whose other entries
 * (settings, auth, caches) are links back to `.pi/agent/`. A provider is
 * rewritten when its `apiKey` names an unset variable (`$DEEPSEEK_API_KEY`),
 * and the built-in `openai` when OPENAI_API_KEY is unset. Returns that dir,
 * or null when every provider has its own key (nothing to route).
 */
export function accountAgentDir(repoRoot: string, proxyBase: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const agentDir = path.join(repoRoot, '.pi', 'agent');
  const parsed = readJson(path.join(agentDir, 'models.json'));
  const config: JsonObject = isObject(parsed) ? parsed : {};
  const providers: JsonObject = isObject(config.providers) ? { ...config.providers } : {};
  const unset = (name: string) => !(env[name] ?? '').trim();
  let routed = 0;
  for (const [id, raw] of Object.entries(providers)) {
    if (!isObject(raw) || typeof raw.apiKey !== 'string') continue;
    const variable = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(raw.apiKey)?.[1];
    if (!variable || !unset(variable)) continue;
    providers[id] = { ...raw, baseUrl: proxyBase, apiKey: 'worldlines-account' };
    routed++;
  }
  if (unset('OPENAI_API_KEY')) {
    providers.openai = { ...(isObject(providers.openai) ? providers.openai : {}), baseUrl: proxyBase, apiKey: 'worldlines-account' };
    routed++;
  }
  if (!routed) return null;

  const dir = path.join(repoRoot, '.pi', 'agent-account');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const entry of fs.existsSync(agentDir) ? fs.readdirSync(agentDir) : []) {
    if (entry === 'models.json') continue;
    const link = path.join(dir, entry);
    if (fs.lstatSync(link, { throwIfNoEntry: false })) continue;
    fs.symlinkSync(path.join('..', 'agent', entry), link);
  }
  const target = path.join(dir, 'models.json');
  const tempFile = `${target}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify({ ...config, providers }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tempFile, target);
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
  return dir;
}
