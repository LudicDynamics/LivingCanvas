import { Router, type Request } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readLocalTtsConfig, parseCharacterVoices } from './local-tts.js';
import { runConnectionTests, type ConnectionTestDeps } from './connection-test.js';
import { aiRoutes } from '../ai-gateway.js';
import { readCatalogSnapshot, readCatalogGeneration, isOfficialOpenAIBaseUrl } from '../engine/openai-model-catalog.js';

const legacyFields = ['DASHSCOPE_API_KEY', 'AIRP_TTS_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'FLOW_API_KEY', 'FLOW_API_BASE', 'DEEPSEEK_API_KEY', 'AIRP_TTS_LOCAL_BASE_URL', 'AIRP_TTS_LOCAL_VOICE', 'AIRP_TTS_LOCAL_TIMEOUT_MS', 'AIRP_TTS_LOCAL_API_KEY', 'AIRP_TTS_CHARACTER_VOICES'] as const;
const customFields = ['AIRP_CUSTOM_OPENAI_PENDING_BASE_URL', 'AIRP_CUSTOM_OPENAI_PENDING_API_KEY'] as const;
const fields = [...legacyFields, ...customFields] as const;
const defaults: Record<string, string> = {
  AIRP_TTS_BASE_URL: 'https://dashscope-intl.aliyuncs.com/api/v1',
  OPENAI_BASE_URL: 'https://api.openai.com/v1',
  FLOW_API_BASE: 'http://127.0.0.1:8317',
};
const localHost = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
export function localRequest(req: Request): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) return false;
  if (req.headers.forwarded || req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']) return false;
  try {
    if (!localHost(new URL(`http://${req.headers.host}`).hostname)) return false;
    const origin = req.headers.origin;
    return !origin || (localHost(new URL(origin).hostname) && ['http:', 'https:'].includes(new URL(origin).protocol));
  } catch { return false; }
}

export function saveConnectionSettings(repoRoot: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid settings');
  const updates: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!fields.includes(key as typeof fields[number]) || typeof raw !== 'string') throw new Error('Unknown setting');
    const value = raw.trim();
    if (!value) {
      if (key === 'AIRP_TTS_LOCAL_BASE_URL' || key === 'AIRP_TTS_CHARACTER_VOICES' || customFields.includes(key as typeof customFields[number])) updates[key] = '';
      continue;
    }
    if (value.length > 4096 || /[\r\n"'\\\x00]/.test(value)) throw new Error('Invalid setting value');
    if (key === 'AIRP_TTS_CHARACTER_VOICES') parseCharacterVoices(value);
    else if (key === 'AIRP_TTS_LOCAL_VOICE') {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw new Error('Invalid local voice ID');
    } else if (key === 'AIRP_TTS_LOCAL_TIMEOUT_MS') {
      if (!/^\d+$/.test(value) || Number(value) < 1000 || Number(value) > 120000) throw new Error('Invalid local TTS timeout');
    } else if (!key.endsWith('_KEY')) {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid service URL');
    }
    updates[key] = value;
  }
  const hasCustomUrl = 'AIRP_CUSTOM_OPENAI_PENDING_BASE_URL' in updates;
  const hasCustomKey = 'AIRP_CUSTOM_OPENAI_PENDING_API_KEY' in updates;
  if (hasCustomUrl !== hasCustomKey) throw new Error('Custom OpenAI credentials must be saved as a pair');
  if (hasCustomUrl && Boolean(updates.AIRP_CUSTOM_OPENAI_PENDING_BASE_URL) !== Boolean(updates.AIRP_CUSTOM_OPENAI_PENDING_API_KEY)) throw new Error('Custom OpenAI credentials must be saved as a pair');
  if (hasCustomUrl) {
    const previous = Number.parseInt(process.env.AIRP_CUSTOM_OPENAI_PENDING_GENERATION ?? '0', 10);
    updates.AIRP_CUSTOM_OPENAI_PENDING_GENERATION = String(Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1);
  }
  if (!Object.keys(updates).length) return;
  const file = path.join(repoRoot, '.env.local');
  if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw new Error('Unsafe configuration file');
  let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, 'gm');
    for (const match of content.matchAll(pattern)) {
      const existing = match[0].slice(match[0].indexOf('=') + 1).trim();
      if (/^["']/.test(existing) && !existing.slice(1).includes(existing[0])) throw new Error('Multiline configuration must be edited on the server');
    }
    content = content.replace(pattern, '');
    content = content.trimEnd() + `\n${key}="${value}"\n`;
  }
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  Object.assign(process.env, updates);
}
export { isOfficialOpenAIBaseUrl };
function persistMigratedEnv(file: string, content: string): void {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, content, { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

export function migrateLegacyOpenAI(repoRoot: string, persist: typeof persistMigratedEnv = persistMigratedEnv): void {
  const file = path.join(repoRoot, '.env.local');
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) return;
  const content = fs.readFileSync(file, 'utf8');
  const read = (name: string): string => {
    const line = content.match(new RegExp(`^(?:export\\s+)?${name}\\s*=\\s*(.*)$`, 'm'))?.[1]?.trim() ?? '';
    return line.length >= 2 && (line[0] === '"' || line[0] === "'") && line.at(-1) === line[0] ? line.slice(1, -1) : line;
  };
  const url = read('OPENAI_BASE_URL');
  const key = read('OPENAI_API_KEY');
  if (!url || isOfficialOpenAIBaseUrl(url) || !key) return;
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash ||
      /[\r\n"'\\\x00]/.test(url) || /[\r\n"'\\\x00]/.test(key)) return;
  } catch { return; }
  const pendingUrl = read('AIRP_CUSTOM_OPENAI_PENDING_BASE_URL');
  const pendingKey = read('AIRP_CUSTOM_OPENAI_PENDING_API_KEY');
  if (pendingUrl || pendingKey) return;
  const previousGeneration = Number.parseInt(process.env.AIRP_CUSTOM_OPENAI_PENDING_GENERATION ?? '0', 10);
  const updates = {
    AIRP_CUSTOM_OPENAI_PENDING_BASE_URL: url,
    AIRP_CUSTOM_OPENAI_PENDING_API_KEY: key,
    AIRP_CUSTOM_OPENAI_PENDING_GENERATION: String(Number.isSafeInteger(previousGeneration) && previousGeneration >= 0 ? previousGeneration + 1 : 1),
  };
  let next = content;
  for (const [name, value] of Object.entries(updates)) {
    next = next.replace(new RegExp('^(?:export\\s+)?' + name + '\\s*=.*$', 'gm'), '');
    next = `${next.trimEnd()}\n${name}="${value}"\n`;
  }
  next = next.replace(/^(?:export\s+)?OPENAI_BASE_URL\s*=.*\n?/gm, '').replace(/^(?:export\s+)?OPENAI_API_KEY\s*=.*\n?/gm, '');
  persist(file, next);
  process.env.AIRP_CUSTOM_OPENAI_PENDING_BASE_URL = url;
  process.env.AIRP_CUSTOM_OPENAI_PENDING_API_KEY = key;
  process.env.AIRP_CUSTOM_OPENAI_PENDING_GENERATION = updates.AIRP_CUSTOM_OPENAI_PENDING_GENERATION;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
}

export interface OpenAIRefreshResult {
  status: 'discovering' | 'waiting' | 'activating' | 'success' | 'rolled-back' | 'cancelled' | 'error';
  count?: number;
  error?: string;
}

export function createConnectionSettingsRouter(repoRoot: string, deps?: {
  agentModels?: ConnectionTestDeps['agentModels'];
  refreshOpenAI?: () => Promise<OpenAIRefreshResult>;
  getOpenAIRefreshStatus?: () => OpenAIRefreshResult;
  cancelOpenAIRefresh?: () => Promise<OpenAIRefreshResult>;
}): Router {
  const router = Router();
  router.use('/connection-settings', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!localRequest(req)) return res.status(403).json({ error: 'Connection settings are available on localhost only.' });
    next();
  });
  router.get('/connection-settings', (_req, res) => {
    migrateLegacyOpenAI(repoRoot);
    const local = readLocalTtsConfig();
    const currentDefaults: Record<string, string> = { ...defaults, AIRP_TTS_LOCAL_BASE_URL: local.baseUrl,
      AIRP_TTS_LOCAL_VOICE: local.voice, AIRP_TTS_LOCAL_TIMEOUT_MS: String(local.timeoutMs) };
    const settings = Object.fromEntries(fields.map(key => [key, key.endsWith('_KEY') ? Boolean(process.env[key]?.trim()) : process.env[key] ?? currentDefaults[key]]));
    const snapshot = readCatalogSnapshot(repoRoot);
    const legacyUrl = process.env.OPENAI_BASE_URL?.trim();
    const officialConfigured = Boolean(process.env.OPENAI_API_KEY?.trim() && (!legacyUrl || isOfficialOpenAIBaseUrl(legacyUrl)));
    settings.OPENAI_API_KEY = officialConfigured;
    const activeGeneration = Number.parseInt(process.env.AIRP_CUSTOM_OPENAI_GENERATION ?? '', 10);
    const activeBaseUrl = process.env.AIRP_CUSTOM_OPENAI_BASE_URL?.replace(/\/+$/, '');
    const activeConfigured = Boolean(snapshot && process.env.AIRP_CUSTOM_OPENAI_BASE_URL?.trim() && process.env.AIRP_CUSTOM_OPENAI_API_KEY?.trim() &&
      Number.isSafeInteger(activeGeneration) && activeBaseUrl && snapshot.baseUrl === activeBaseUrl && snapshot.generation === activeGeneration && readCatalogGeneration(repoRoot) === activeGeneration);
    res.json({ ...settings, officialOpenAI: { configured: officialConfigured, available: officialConfigured },
      customOpenAI: { pendingConfigured: Boolean(process.env.AIRP_CUSTOM_OPENAI_PENDING_BASE_URL?.trim() && process.env.AIRP_CUSTOM_OPENAI_PENDING_API_KEY?.trim()),
        activeConfigured, activeModelCount: activeConfigured ? snapshot?.models.length ?? 0 : 0 } });
  });
  // Which way each capability goes: own key / local TTS / the signed-in account (ai-gateway.ts).
  router.get('/connection-settings/routes', (_req, res) => { res.json({ ok: true, ...aiRoutes() }); });
  router.post('/connection-settings', (req, res) => {
    if (!req.is('application/json') || req.headers['x-airp-settings'] !== '1') return res.status(403).json({ error: 'Invalid settings request' });
    try {
      saveConnectionSettings(repoRoot, req.body);
      return res.json({ ok: true });
    } catch {
      return res.status(400).json({ error: 'Could not save settings. Check the values and server file permissions.' });
    }
  });
  router.get('/connection-settings/refresh-openai', (_req, res) => {
    if (!deps?.getOpenAIRefreshStatus) return res.status(503).json({ status: 'error', error: 'refresh-unavailable' });
    return res.json(deps.getOpenAIRefreshStatus());
  });
  router.post('/connection-settings/refresh-openai', async (req, res) => {
    if (req.headers['x-airp-settings'] !== '1') return res.status(403).json({ error: 'Invalid settings request' });
    if (!deps?.refreshOpenAI) return res.status(503).json({ status: 'error', error: 'refresh-unavailable' });
    try {
      const result = await deps.refreshOpenAI();
      return res.status(result.status === 'error' || result.status === 'rolled-back' ? 409 : 200).json(result);
    } catch {
      return res.status(500).json({ status: 'error', error: 'refresh-failed' });
    }
  });
  router.post('/connection-settings/refresh-openai/cancel', async (req, res) => {
    if (req.headers['x-airp-settings'] !== '1') return res.status(403).json({ error: 'Invalid settings request' });
    if (!deps?.cancelOpenAIRefresh) return res.status(503).json({ status: 'error', error: 'refresh-unavailable' });
    try { return res.json(await deps.cancelOpenAIRefresh()); }
    catch { return res.status(500).json({ status: 'error', error: 'cancel-failed' }); }
  });
  // Live self-test of every configured service.
  // Same localhost guard as the settings themselves: it spends a few tokens and
  // one syllable of TTS per run, and its details name the models in use.
  router.post('/connection-settings/test', async (req, res) => {
    if (req.headers['x-airp-settings'] !== '1') return res.status(403).json({ error: 'Invalid settings request' });
    const checks = await runConnectionTests({ agentModels: deps?.agentModels ?? (async () => null) });
    res.json({ ok: true, checks, ranAt: new Date().toISOString() });
  });
  return router;
}
