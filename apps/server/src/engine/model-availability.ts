import fs from 'node:fs';
import path from 'node:path';
import { readAiGateway } from '../ai-gateway.js';

/**
 * Can any agent reach a model at all on this computer?
 *
 * Without a provider key, a signed-in account or a configured gateway, a
 * prompt would start an agent that can never answer and the dialogue would
 * sit on "thinking…". The WS handler asks this first and answers with
 * `NO_MODEL_CODE` instead, which the page turns into a localized notice with a
 * button to the model settings.
 *
 * Generous on purpose: one usable route anywhere is enough. Which provider a
 * given agent picks is the model settings' business, not this gate's.
 */
export const NO_MODEL_CODE = 'no_model_configured';
export const NO_MODEL_MESSAGE = 'No model is configured. Add a model API key in Settings to talk to the characters.';

/** `*_API_KEY` variables that are not for chat (voices, speech, the image proxy). */
const NOT_CHAT = new Set(['DASHSCOPE_API_KEY', 'AIRP_TTS_LOCAL_API_KEY', 'FLOW_API_KEY']);

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function modelAvailable(repoRoot: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (readAiGateway(env, { guest: true })) return true;
  for (const [name, value] of Object.entries(env)) {
    if (/^[A-Z0-9_]+_API_KEY$/.test(name) && !NOT_CHAT.has(name) && (value ?? '').trim()) return true;
  }
  const agentDir = path.join(repoRoot, '.pi', 'agent');
  // `pi` subscription logins (OAuth) live in auth.json.
  const auth = readJson(path.join(agentDir, 'auth.json'));
  if (auth && typeof auth === 'object' && Object.keys(auth).length > 0) return true;
  // A custom provider with a literal key, or one whose `$VAR` is set.
  const models = readJson(path.join(agentDir, 'models.json')) as { providers?: Record<string, { apiKey?: unknown }> } | null;
  for (const provider of Object.values(models?.providers ?? {})) {
    const key = typeof provider?.apiKey === 'string' ? provider.apiKey.trim() : '';
    if (!key) continue;
    const variable = key.match(/^\$?([A-Z][A-Z0-9_]*)$/)?.[1];
    if (variable ? (env[variable] ?? '').trim() : true) return true;
  }
  return false;
}
