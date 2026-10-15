import { readTtsConfig, synthesise } from './tts.js';
import { localTtsEnabled, readLocalTtsConfig, synthesiseLocal } from './local-tts.js';
import { readSttConfig } from './stt.js';
import { readLiveConfig } from '../engine/live-session.js';
import { isHiddenProvider } from '../engine/model-preferences.js';

/**
 * Connection self-test: one round of live probes
 * against every configured service, so "the character never answers" can be
 * told apart from "the key is missing" without reading server logs.
 *
 * Probes are cheap and real: a 5-token chat completion per model, a one-syllable
 * synthesis per TTS engine, a metadata GET for STT. Every probe has its own
 * timeout; the whole run never takes longer than the slowest probe.
 */

export interface ConnectionCheck {
  id: string;
  label: string;
  status: 'ok' | 'failed' | 'skipped';
  ms: number;
  detail: string;
}

export interface AgentModels {
  writer: { provider: string; id: string } | null;
  characters: Array<{ id: string; model: { provider: string; id: string } | null }>;
}

export interface ConnectionTestDeps {
  /** Current agent models, or null when no world is open. Starting the writer is the caller's choice. */
  agentModels: () => Promise<AgentModels | null>;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Slow upstreams are reported, not waited for: the app's own turn budget is 90s. */
export const PROBE_TIMEOUT_MS = 25_000;

const DEEPSEEK_BASE = 'https://api.deepseek.com';
const OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1';

function errorText(err: unknown): string {
  if (err instanceof Error) return err.name === 'TimeoutError' || err.name === 'AbortError' ? `no reply within ${PROBE_TIMEOUT_MS / 1000}s` : err.message;
  return String(err);
}

async function timed(id: string, label: string, run: () => Promise<string>, now: () => number): Promise<ConnectionCheck> {
  const start = now();
  try {
    const detail = await run();
    return { id, label, status: 'ok', ms: now() - start, detail };
  } catch (err) {
    return { id, label, status: 'failed', ms: now() - start, detail: errorText(err) };
  }
}

const skipped = (id: string, label: string, detail: string): ConnectionCheck => ({ id, label, status: 'skipped', ms: 0, detail });

/** A 5-token chat completion; the reply text is the evidence. */
export async function probeChat(opts: { baseUrl: string; apiKey: string; model: string; tokenField: 'max_tokens' | 'max_completion_tokens'; fetch?: typeof fetch }): Promise<string> {
  const doFetch = opts.fetch ?? fetch;
  const response = await doFetch(`${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opts.model, [opts.tokenField]: 5, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
  let content = '';
  try { content = String(JSON.parse(text)?.choices?.[0]?.message?.content ?? ''); } catch { throw new Error('unreadable reply'); }
  return `${opts.model} → "${content.trim().slice(0, 40) || '(empty)'}"`;
}

/** Route an agent model to the API that serves it. Gateways without a direct probe are reported as skipped. */
function agentProbe(model: { provider: string; id: string }, doFetch: typeof fetch): (() => Promise<string>) | string {
  if (model.provider === 'deepseek') {
    const apiKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
    if (!apiKey) return 'DEEPSEEK_API_KEY is not set';
    return () => probeChat({ baseUrl: DEEPSEEK_BASE, apiKey, model: model.id, tokenField: 'max_tokens', fetch: doFetch });
  }
  if (model.provider === 'openai') {
    const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
    if (!apiKey) return 'OPENAI_API_KEY is not set';
    return () => probeChat({ baseUrl: (process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE).trim(), apiKey, model: model.id, tokenField: 'max_completion_tokens', fetch: doFetch });
  }
  return `no direct probe for provider "${model.provider}"; the agent process itself is running`;
}

export async function runConnectionTests(deps: ConnectionTestDeps): Promise<ConnectionCheck[]> {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const checks: Array<Promise<ConnectionCheck>> = [];

  // --- raw providers -------------------------------------------------------
  const deepseekKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
  checks.push(deepseekKey
    ? timed('deepseek', 'DeepSeek API', () => probeChat({ baseUrl: DEEPSEEK_BASE, apiKey: deepseekKey, model: 'deepseek-chat', tokenField: 'max_tokens', fetch: doFetch }), now)
    : Promise.resolve(skipped('deepseek', 'DeepSeek API', 'DEEPSEEK_API_KEY is not set')));

  const openaiKey = (process.env.OPENAI_API_KEY ?? '').trim();
  const openaiBase = (process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE).trim();
  checks.push(openaiKey
    ? timed('openai', 'OpenAI-compatible API', () => probeChat({ baseUrl: openaiBase, apiKey: openaiKey, model: 'gpt-4.1-mini', tokenField: 'max_completion_tokens', fetch: doFetch }), now)
    : Promise.resolve(skipped('openai', 'OpenAI-compatible API', 'OPENAI_API_KEY is not set')));

  // --- agents: the models the writer and each character actually use ------
  const agents = await deps.agentModels().catch((err) => ({ error: errorText(err) }));
  if (agents === null) {
    checks.push(Promise.resolve(skipped('writer', 'Writer', 'no world is open')));
  } else if ('error' in agents) {
    checks.push(Promise.resolve({ id: 'writer', label: 'Writer', status: 'failed', ms: 0, detail: `agent process: ${agents.error}` }));
  } else {
    const entries: Array<[string, string, { provider: string; id: string } | null]> = [
      ['writer', 'Writer', agents.writer],
      ...agents.characters.map((c): [string, string, { provider: string; id: string } | null] => [`character:${c.id}`, `Character · ${c.id}`, c.model]),
    ];
    for (const [id, label, model] of entries) {
      if (!model) { checks.push(Promise.resolve(skipped(id, label, 'no model selected'))); continue; }
      // A provider Worldlines no longer offers (model-preferences.ts HIDDEN_PROVIDERS) is never named here.
      if (isHiddenProvider(model.provider)) { checks.push(Promise.resolve(skipped(id, label, 'this model\'s provider is no longer offered; choose another model in Agents → Model'))); continue; }
      const probe = agentProbe(model, doFetch);
      checks.push(typeof probe === 'string'
        ? Promise.resolve(skipped(id, label, `${model.provider}/${model.id}: ${probe}`))
        : timed(id, label, probe, now));
    }
  }

  // --- voice ----------------------------------------------------------------
  // Through the Worldlines AI service a probe would bill the player's account
  // for nothing: reported as routed, not run.
  const viaService = 'through the Worldlines AI service (not probed: it bills the account)';
  const tts = readTtsConfig();
  checks.push(!tts.apiKey.trim() && tts.gateway
    ? Promise.resolve(skipped('tts-online', 'TTS · DashScope', viaService))
    : tts.apiKey.trim()
    ? timed('tts-online', 'TTS · DashScope', async () => {
        const wav = await synthesise({ text: '嗯。', voice: tts.defaultVoice, languageType: 'Chinese', apiKey: tts.apiKey, baseUrl: tts.baseUrl, model: tts.model, timeoutMs: Math.min(tts.timeoutMs, PROBE_TIMEOUT_MS) });
        return `${tts.model} / ${tts.defaultVoice}, ${Math.round(wav.length / 1024)} KB`;
      }, now)
    : Promise.resolve(skipped('tts-online', 'TTS · DashScope', 'DASHSCOPE_API_KEY is not set')));

  const local = readLocalTtsConfig();
  checks.push(local.baseUrl && localTtsEnabled()
    ? timed('tts-local', 'TTS · local', async () => {
        const wav = await synthesiseLocal({ ...local, timeoutMs: Math.min(local.timeoutMs, PROBE_TIMEOUT_MS) }, '嗯。', 'zh', 'normal');
        return `${local.baseUrl} / ${local.voice}, ${Math.round(wav.length / 1024)} KB`;
      }, now)
    : Promise.resolve(skipped('tts-local', 'TTS · local', localTtsEnabled() ? 'AIRP_TTS_LOCAL_BASE_URL is not set' : 'local TTS is off (AIRP_LOCAL_TTS)')));

  const stt = readSttConfig();
  checks.push(stt.viaGateway
    ? Promise.resolve(skipped('stt', 'Voice input (STT)', viaService))
    : stt.apiKey
    ? timed('stt', 'Voice input (STT)', async () => {
        const response = await doFetch(`${stt.baseUrl}/models/${encodeURIComponent(stt.model)}`, { headers: { Authorization: `Bearer ${stt.apiKey}` }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        if (!response.ok) throw new Error(`HTTP ${response.status} for model ${stt.model}`);
        return `${stt.model} available`;
      }, now)
    : Promise.resolve(skipped('stt', 'Voice input (STT)', 'OPENAI_API_KEY is not set')));

  const live = readLiveConfig();
  checks.push(Promise.resolve(live.available
    ? { id: 'live', label: 'GPT Live', status: 'ok', ms: 0, detail: `${live.model}, key present (sessions are only opened on a call)` }
    : skipped('live', 'GPT Live', live.reason ?? 'unavailable')));

  return Promise.all(checks);
}
