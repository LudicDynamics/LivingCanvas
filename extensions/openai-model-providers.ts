import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readCatalogGeneration, readCatalogSnapshot, officialOpenAIModel, CUSTOM_OPENAI_PROVIDER, OFFICIAL_OPENAI_BASE_URL, OFFICIAL_OPENAI_PROVIDER } from '../apps/server/src/engine/openai-model-catalog.ts';

export default function registerOpenAIProviders(pi: ExtensionAPI) {
  const root = path.dirname(path.dirname(process.env.PI_CODING_AGENT_DIR ?? path.resolve('.pi/agent')));
  removeProviderOverlays(root);
  pi.registerProvider(OFFICIAL_OPENAI_PROVIDER, {
    api: 'openai-responses', baseUrl: OFFICIAL_OPENAI_BASE_URL, apiKey: '$OPENAI_API_KEY', models: [officialOpenAIModel()],
  });
  const snapshot = readCatalogSnapshot(root);
  const generation = readCatalogGeneration(root);
  const activeGeneration = Number.parseInt(process.env.AIRP_CUSTOM_OPENAI_GENERATION ?? '', 10);
  const activeBaseUrl = process.env.AIRP_CUSTOM_OPENAI_BASE_URL?.replace(/\/+$/, '');
  if (snapshot && snapshot.generation === generation && Number.isSafeInteger(activeGeneration) && activeGeneration === generation && snapshot.baseUrl === activeBaseUrl &&
    process.env.AIRP_CUSTOM_OPENAI_BASE_URL && process.env.AIRP_CUSTOM_OPENAI_API_KEY) {
    pi.registerProvider(CUSTOM_OPENAI_PROVIDER, {
      api: 'openai-completions', baseUrl: process.env.AIRP_CUSTOM_OPENAI_BASE_URL, apiKey: '$AIRP_CUSTOM_OPENAI_API_KEY',
      models: snapshot.models.map(model => ({ id: model.id, name: model.name, reasoning: false, input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: model.contextWindow, maxTokens: model.maxTokens })),
    });
  }
}

function removeProviderOverlays(repoRoot: string): void {
  for (const configDir of [path.join(repoRoot, '.pi', 'agent'), path.join(repoRoot, '.pi', 'agent-account')]) {
    const modelsFile = path.join(configDir, 'models.json');
    try {
      const config: unknown = JSON.parse(fs.readFileSync(modelsFile, 'utf8'));
      if (config && typeof config === 'object' && !Array.isArray(config) && 'providers' in config) {
        const sourceProviders = config.providers;
        if (sourceProviders && typeof sourceProviders === 'object' && !Array.isArray(sourceProviders)) {
          const providers = Object.fromEntries(Object.entries(sourceProviders).filter(([id]) => id !== OFFICIAL_OPENAI_PROVIDER && id !== CUSTOM_OPENAI_PROVIDER));
          if (Object.keys(providers).length !== Object.keys(sourceProviders).length) {
            writeJson(modelsFile, { ...config, providers });
          }
        }
      }
    } catch { /* A missing or invalid optional config cannot override the extension provider. */ }
    const authFile = path.join(configDir, 'auth.json');
    try {
      const auth: unknown = JSON.parse(fs.readFileSync(authFile, 'utf8'));
      if (!auth || typeof auth !== 'object' || Array.isArray(auth)) continue;
      const credentials = Object.fromEntries(Object.entries(auth).filter(([provider]) => provider !== OFFICIAL_OPENAI_PROVIDER && provider !== CUSTOM_OPENAI_PROVIDER));
      if (Object.keys(credentials).length !== Object.keys(auth).length) {
        writeJson(authFile, credentials);
      }
    } catch { /* A missing or invalid optional auth file has no provider credential to remove. */ }
  }
}
function writeJson(file: string, value: unknown): void {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
