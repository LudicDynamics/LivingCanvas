import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const CUSTOM_OPENAI_PROVIDER = 'openai-compatible';
export const OFFICIAL_OPENAI_PROVIDER = 'airp-openai-official';
export const OFFICIAL_OPENAI_MODEL = 'gpt-6-luna';
export const OFFICIAL_OPENAI_ID = `${OFFICIAL_OPENAI_PROVIDER}/${OFFICIAL_OPENAI_MODEL}`;
export const OFFICIAL_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_CATALOG_FILE = '.airp-openai-catalog.json';
export const OPENAI_GENERATION_FILE = '.airp-openai-generation.json';

export interface CatalogModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
}
export interface CatalogSnapshot {
  generation: number;
  baseUrl: string;
  models: CatalogModel[];
}
export interface CredentialPair { baseUrl: string; apiKey: string }

export type CatalogError = 'missing-credentials' | 'invalid-url' | 'timeout' | 'redirect' | 'http-error' | 'response-too-large' | 'invalid-response' | 'empty-catalog';
export class ModelCatalogError extends Error {
  constructor(readonly category: CatalogError) { super(category); this.name = 'ModelCatalogError'; }
}
export function isOfficialOpenAIBaseUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'api.openai.com' && !url.port && !url.username && !url.password
      && !url.search && !url.hash && url.pathname.replace(/\/+$/, '') === '/v1';
  } catch { return false; }
}

export function validateCatalogUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ModelCatalogError('invalid-url'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ModelCatalogError('invalid-url');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

export async function discoverModels(pair: CredentialPair, fetchImpl: typeof fetch = fetch, externalSignal?: AbortSignal): Promise<{ baseUrl: string; models: CatalogModel[] }> {
  if (!pair.baseUrl || !pair.apiKey) throw new ModelCatalogError('missing-credentials');
  const base = validateCatalogUrl(pair.baseUrl);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  if (externalSignal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${base.toString().replace(/\/$/, '')}/models`, {
        method: 'GET', headers: { Authorization: `Bearer ${pair.apiKey}`, Accept: 'application/json' },
        signal: controller.signal, redirect: 'manual',
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new ModelCatalogError('timeout');
      throw new ModelCatalogError('http-error');
    }
    if (response.status >= 300 && response.status < 400) throw new ModelCatalogError('redirect');
    if (!response.ok) throw new ModelCatalogError('http-error');
    const declaredSize = Number(response.headers.get('content-length') ?? 0);
    if (declaredSize > 1_048_576) throw new ModelCatalogError('response-too-large');
    let body: string;
    try {
      const reader = response.body?.getReader();
      if (!reader) {
        body = await response.text();
        if (Buffer.byteLength(body) > 1_048_576) throw new ModelCatalogError('response-too-large');
      } else {
        const chunks: Uint8Array[] = []; let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1_048_576) { await reader.cancel(); throw new ModelCatalogError('response-too-large'); }
          chunks.push(value);
        }
        body = new TextDecoder().decode(Buffer.concat(chunks));
      }
    } catch (error) {
      if (error instanceof ModelCatalogError) throw error;
      if (controller.signal.aborted) throw new ModelCatalogError('timeout');
      throw new ModelCatalogError('invalid-response');
    }
    let payload: unknown;
    try { payload = JSON.parse(body) as unknown; } catch { throw new ModelCatalogError('invalid-response'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('data' in payload) || !Array.isArray(payload.data)) throw new ModelCatalogError('invalid-response');
    const models: CatalogModel[] = [];
    const seen = new Set<string>();
    for (const item of payload.data) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !('id' in item) || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 256 || seen.has(item.id)) continue;
      seen.add(item.id);
      models.push({
        id: item.id, name: 'name' in item && typeof item.name === 'string' && item.name.trim() ? item.name.slice(0, 256) : item.id,
        contextWindow: 'context_window' in item ? safeLimit(item.context_window, 128_000, 2_000_000) : 128_000,
        maxTokens: 'max_tokens' in item ? safeLimit(item.max_tokens, 8_192, 1_000_000) : 8_192,
      });
    }
    if (!models.length) throw new ModelCatalogError('empty-catalog');
    return { baseUrl: base.toString().replace(/\/$/, ''), models };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}
function safeLimit(value: unknown, fallback: number, ceiling: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(value, ceiling) : fallback;
}

export function readCatalogSnapshot(repoRoot: string): CatalogSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(repoRoot, OPENAI_CATALOG_FILE), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('generation' in parsed) || !('baseUrl' in parsed) || !('models' in parsed)) return null;
    if (typeof parsed.generation !== 'number' || !Number.isSafeInteger(parsed.generation) || parsed.generation < 0 || typeof parsed.baseUrl !== 'string' || !Array.isArray(parsed.models) || !parsed.models.length) return null;
    validateCatalogUrl(parsed.baseUrl);
    const models: CatalogModel[] = [];
    for (const model of parsed.models) {
      if (!model || typeof model !== 'object' || Array.isArray(model) || !('id' in model) || !('name' in model) || !('contextWindow' in model) || !('maxTokens' in model)) return null;
      if (typeof model.id !== 'string' || typeof model.name !== 'string' || typeof model.contextWindow !== 'number' || !Number.isSafeInteger(model.contextWindow) || typeof model.maxTokens !== 'number' || !Number.isSafeInteger(model.maxTokens)) return null;
      models.push({ id: model.id, name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens });
    }
    return { generation: parsed.generation, baseUrl: parsed.baseUrl, models };
  } catch { return null; }
}

export function writeCatalogSnapshot(repoRoot: string, snapshot: CatalogSnapshot): void {
  atomicWrite(path.join(repoRoot, OPENAI_CATALOG_FILE), JSON.stringify(snapshot));
}
export function readCatalogGeneration(repoRoot: string): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(repoRoot, OPENAI_GENERATION_FILE), 'utf8')) as { generation?: unknown };
    return Number.isSafeInteger(parsed.generation) && Number(parsed.generation) >= 0 ? Number(parsed.generation) : 0;
  } catch { return 0; }
}
export function writeCatalogGeneration(repoRoot: string, generation: number): void {
  atomicWrite(path.join(repoRoot, OPENAI_GENERATION_FILE), JSON.stringify({ generation }));
}
function atomicWrite(file: string, content: string): void {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, content, { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

export function officialOpenAIModel() {
  return { id: OFFICIAL_OPENAI_MODEL, name: 'GPT-6 Luna', api: 'openai-responses', baseUrl: OFFICIAL_OPENAI_BASE_URL,
    reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8_192 };
}
