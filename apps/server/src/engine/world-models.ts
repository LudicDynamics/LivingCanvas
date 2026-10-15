import fs from 'node:fs';
import path from 'node:path';
import { worldModelFor, type WorldModelChoice } from '@airp/shared';
import { readAiGateway } from '../ai-gateway.js';
import { accountPlan } from '../sync/account-plan.js';
import { ensureProviderConfig } from './provider-config.js';

/**
 * world.json `models` (packages/shared rules/experience.ts worldModelFor) at agent launch: the world's model for a
 * role when this player may use it, else null (→ the saved pick or the default, model-preferences.ts).
 *
 *   - through the Worldlines AI service (signed in, a trial guest, or the browser runtime): a paid-only model needs
 *     a paid plan — the plan the account panel last read (sync/account-plan.ts); unknown / a guest = free;
 *   - on the player's own key: whatever the provider config lists.
 * A model the agent's provider config does not list is skipped (pi-rp exits on an unknown --model).
 */
export function worldModelPreference(repoRoot: string, worldRoot: string, role: 'writer' | 'character', env: NodeJS.ProcessEnv = process.env): WorldModelChoice | null {
  let manifest: unknown;
  try { manifest = JSON.parse(fs.readFileSync(path.join(worldRoot, 'world.json'), 'utf8')); } catch { return null; }
  const hints = (manifest as { models?: unknown } | null)?.models;
  if (!hints) return null;
  ensureProviderConfig(repoRoot); // the bundled models are listed before the first launch reads them
  const listed = providerModels(repoRoot);
  return worldModelFor(role, hints, {
    route: routeOf(env, (provider) => keyEnvOf(listed, provider)),
    plan: accountPlan(),
    known: (provider, model) => listed.get(provider)?.has(model) ?? false,
  });
}

/** Does this world's agent reach the provider through the Worldlines service (not an own key)? */
function routeOf(env: NodeJS.ProcessEnv, keyEnv: (provider: string) => string | null): 'gateway' | 'own' {
  if ((env.AIRP_AI_BASE ?? '').trim()) return 'gateway';
  const name = keyEnv('deepseek');
  const ownKey = !!name && !!(env[name] ?? '').trim();
  return !ownKey && readAiGateway(env, { guest: true })?.account ? 'gateway' : 'own';
}

type Listed = Map<string, Set<string>> & { keys_?: Map<string, string | null> };

/** provider → model ids in `.pi/agent/models.json` (plus its `$ENV` key name). */
function providerModels(repoRoot: string): Listed {
  const out: Listed = new Map();
  out.keys_ = new Map();
  try {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, '.pi', 'agent', 'models.json'), 'utf8')) as { providers?: Record<string, { apiKey?: unknown; models?: unknown }> };
    for (const [provider, p] of Object.entries(config.providers ?? {})) {
      const ids = Array.isArray(p?.models) ? p.models.map((m) => (m && typeof m === 'object' ? (m as { id?: unknown }).id : null)).filter((id): id is string => typeof id === 'string') : [];
      out.set(provider, new Set(ids));
      out.keys_.set(provider, typeof p?.apiKey === 'string' && p.apiKey.startsWith('$') ? p.apiKey.slice(1) : null);
    }
  } catch { /* no config: nothing known */ }
  return out;
}
const keyEnvOf = (listed: Listed, provider: string): string | null => listed.keys_?.get(provider) ?? (provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : null);
