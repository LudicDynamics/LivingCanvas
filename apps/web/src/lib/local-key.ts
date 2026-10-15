/**
 * 「使用 Worldlines 额度」 ↔ on the browser version
 * the player may run chat, images, character voices (TTS) and voice input (STT)
 * on their own provider keys.
 *
 *   - Stored ONLY in this browser on this device: localStorage `airp.localModelKey`
 *     (try/catch like every other local preference). Never in a world file, never
 *     in the in-tab VFS, never in the synced preferences (account-data-app.ts
 *     readSyncedPrefs is a whitelist and does not read it), never sent to a
 *     Worldlines server. 「清除本机密钥」 removes it.
 *   - Several providers, one per job
 *     one key list (provider + address + key) and, per
 *     capability (对话 / 生图 / 语音合成 TTS / 语音识别 STT), 「Worldlines 账号」 or one
 *     of those keys with a model — e.g. chat on DeepSeek, voices and images on
 *     OpenAI, voice input on Groq in the same session. Adding a key moves every
 *     capability it can do that is still on Worldlines; a capability already on
 *     another key stays there until the player moves it (the panel offers it).
 *     A custom OpenAI-compatible service carries the jobs the player ticks.
 *   - The in-tab runtime gets the routes by message (browser-mode.ts → Worker) and
 *     sends those requests straight from this tab to the provider
 *     (apps/browser-runtime/src/platform/local-key.ts). Switching takes effect
 *     from the next request, no reload.
 *   - Stays on Worldlines whatever is chosen: Voice Live calls (the browser cannot
 *     open the realtime sideband with the player's key — see docs) and the studio
 *     voices (`local-tts`, e.g. Nanami's own voice), which fall back to the
 *     provider's standard voice when Worldlines is not reachable.
 *   - Providers must allow a browser to call them (CORS). Checked 2026-10-03 with
 *     a preflight from https://canvas.worldlines.gg: DeepSeek, OpenAI (chat, images,
 *     speech, transcription), OpenRouter, General Compute, Gemini's OpenAI endpoint
 *     (chat; its /images/generations answers 404 without a key, so images are not
 *     offered), Groq (chat, transcriptions), SiliconFlow, Together, Fireworks,
 *     Mistral allow it (the 401 answers carry Access-Control-Allow-Origin too);
 *     Anthropic's API does not — so it is not offered.
 */

export const LOCAL_KEY_STORAGE = 'airp.localModelKey';
export const LOCAL_KEY_EVENT = 'airp:local-key-changed';

export type ModelSource = 'worldlines' | 'local';
export type PresetId = 'deepseek' | 'openai' | 'openrouter' | 'generalcompute' | 'gemini' | 'groq' | 'siliconflow' | 'together' | 'fireworks' | 'mistral' | 'custom';
/** How the runtime adapts request bodies (platform/local-key.ts LocalKeyFlavor). */
export type Flavor = 'deepseek' | 'openai' | 'openrouter' | 'custom';
export type Capability = 'chat' | 'image' | 'tts' | 'stt';
export const CAPABILITIES: readonly Capability[] = ['chat', 'image', 'tts', 'stt'];

/** `caps`: a custom service only — the jobs the player ticked (absent = chat). */
export interface KeyEntry { id: string; preset: PresetId; base: string; key: string; caps?: Capability[] }
/** `via`: 'worldlines' or a KeyEntry id. */
export interface CapabilityChoice { via: string; model: string; voice?: string }
export interface LocalKeySettings {
  source: ModelSource;
  keys: KeyEntry[];
  use: Record<Capability, CapabilityChoice>;
}

export interface LocalKeyPreset {
  id: PresetId;
  /** Shown as is (a provider's name) or through t() for 「其他」. */
  label: string;
  base: string;
  /** What this provider's key can carry here, with suggested models (first = default). */
  models: Partial<Record<Capability, readonly string[]>>;
  /** What 「测试连接」 GETs: a cheap authenticated read (never a completion). */
  check: string;
  /** Known context windows (tokens) per chat model; newly started agents compact within it. */
  contextWindows?: Readonly<Record<string, number>>;
}

export const LOCAL_KEY_PRESETS: readonly LocalKeyPreset[] = [
  // deepseek-flash: DeepSeek's current official id; deepseek-v4-flash still accepted
  { id: 'deepseek', label: 'DeepSeek', base: 'https://api.deepseek.com', check: '/models',
    models: { chat: ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'] } },
  { id: 'openai', label: 'OpenAI', base: 'https://api.openai.com/v1', check: '/models',
    models: { chat: ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini', 'gpt-4o-mini'], image: ['gpt-image-1', 'gpt-image-1-mini'], tts: ['gpt-4o-mini-tts', 'tts-1'], stt: ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'] } },
  // OpenRouter's /models is public: /key is the authenticated read.
  { id: 'openrouter', label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', check: '/key',
    models: { chat: ['deepseek/deepseek-chat', 'openai/gpt-5-mini', 'google/gemini-2.5-flash'] } },
  // General Compute: OpenAI-compatible chat only; models from GET /models that day, CORS `*`.
  { id: 'generalcompute', label: 'General Compute', base: 'https://api.generalcompute.com/v1', check: '/models',
    models: { chat: ['gpt-oss-120b', 'deepseek-v3.2', 'deepseek-v3.1', 'gemma-4-31B-it', 'minimax-m2.7'] },
    contextWindows: { 'gpt-oss-120b': 128000, 'deepseek-v3.2': 32000, 'gemma-4-31B-it': 128000, 'minimax-m2.7': 192000 } },
  // Below (2026-10-03): preflight from https://canvas.worldlines.gg allowed (POST + GET /models, 401 with ACAO).
  // Gemini's OpenAI-compatible endpoint: chat only — /images/generations answered 404 to a keyless POST
  // (chat answered 400 "Missing Authorization"), /audio/* 404. Its /models ids carry a `models/` prefix.
  { id: 'gemini', label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', check: '/models',
    models: { chat: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'] },
    contextWindows: { 'gemini-2.5-flash': 1048576, 'gemini-2.5-pro': 1048576, 'gemini-2.5-flash-lite': 1048576 } },
  // Groq: chat + Whisper transcription (OpenAI shapes).
  { id: 'groq', label: 'Groq', base: 'https://api.groq.com/openai/v1', check: '/models',
    models: { chat: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct'], stt: ['whisper-large-v3-turbo', 'whisper-large-v3'] } },
  // Chat only: their image / audio endpoints are not OpenAI-shaped (or not checked).
  { id: 'siliconflow', label: 'SiliconFlow', base: 'https://api.siliconflow.cn/v1', check: '/models',
    models: { chat: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-235B-A22B', 'moonshotai/Kimi-K2-Instruct'] } },
  { id: 'together', label: 'Together AI', base: 'https://api.together.xyz/v1', check: '/models',
    models: { chat: ['deepseek-ai/DeepSeek-V3', 'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'openai/gpt-oss-120b'] } },
  { id: 'fireworks', label: 'Fireworks AI', base: 'https://api.fireworks.ai/inference/v1', check: '/models',
    models: { chat: ['accounts/fireworks/models/deepseek-v3', 'accounts/fireworks/models/gpt-oss-120b'] } },
  { id: 'mistral', label: 'Mistral', base: 'https://api.mistral.ai/v1', check: '/models',
    models: { chat: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'] } },
  // Any other OpenAI-compatible service: the jobs the player ticks (KeyEntry.caps), models typed in.
  { id: 'custom', label: 'Other OpenAI-compatible service', base: '', check: '/models',
    models: { chat: [], image: [], tts: [], stt: [] } },
];

/** OpenAI speech voices for characters whose voice has no direct equivalent. */
export const TTS_VOICES: readonly string[] = ['coral', 'marin', 'cedar', 'alloy', 'ash', 'ballad', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

/** Providers a player may look for that a browser cannot call directly (no CORS): listed, not offered. */
export const BROWSER_BLOCKED_PROVIDERS: readonly string[] = ['Anthropic (Claude)'];

export const presetOf = (id: string): LocalKeyPreset => LOCAL_KEY_PRESETS.find((p) => p.id === id) ?? LOCAL_KEY_PRESETS[0];

const readCaps = (raw: unknown): Capability[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  return CAPABILITIES.filter((cap) => raw.includes(cap));
};

type CapsOf = Pick<KeyEntry, 'preset'> & { caps?: readonly Capability[] };

/** The jobs this key can do: its provider's (a custom service: what the player ticked, chat when nothing was said). */
export function capabilitiesOf(entry: CapsOf): Capability[] {
  if (entry.preset === 'custom') return entry.caps ? CAPABILITIES.filter((cap) => entry.caps!.includes(cap)) : ['chat'];
  return CAPABILITIES.filter((cap) => presetOf(entry.preset).models[cap] !== undefined);
}
export const supports = (entry: CapsOf, cap: Capability): boolean => capabilitiesOf(entry).includes(cap);

/** The providers offered for one job (the empty-table hint: 「先添加一个能做这件事的服务商」). */
export function presetsFor(cap: Capability): LocalKeyPreset[] {
  return LOCAL_KEY_PRESETS.filter((p) => p.id !== 'custom' && p.models[cap] !== undefined);
}

export const WORLDLINES = 'worldlines';

export function defaultLocalKeySettings(): LocalKeySettings {
  return { source: 'worldlines', keys: [], use: { chat: { via: WORLDLINES, model: '' }, image: { via: WORLDLINES, model: '' }, tts: { via: WORLDLINES, model: '', voice: 'coral' }, stt: { via: WORLDLINES, model: '' } } };
}

/** A base the key may be sent to: https (http only on this machine), no credentials / query, never a Worldlines host. */
export function providerBase(raw: string): string | null {
  let u: URL;
  try { u = new URL(String(raw ?? '').trim()); } catch { return null; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase();
  if (host === 'worldlines.gg' || host.endsWith('.worldlines.gg')) return null;
  return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
}

/** Why this key cannot be saved (a messages.json key), or null. */
export function keyProblem(e: Pick<KeyEntry, 'base' | 'key'>): string | null {
  if (!providerBase(e.base)) return 'Enter an https address of an OpenAI-compatible service (not a Worldlines address).';
  const k = String(e.key ?? '').trim();
  if (!k) return 'Enter your API key.';
  if (/\s/.test(k) || k.length > 1024) return 'That does not look like an API key.';
  return null;
}

const newId = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The jobs a key carries ({@link capabilitiesOf}; old name). */
export const defaultCapabilities = capabilitiesOf;

/** Models typed for a custom service's jobs when it is added (its preset has none to suggest). */
export type JobModels = Partial<Record<Capability, string>>;

/**
 * What adding this key would do: `takes` = its jobs still on Worldlines (moved at once),
 * `elsewhere` = its jobs already on another working key (left there; the panel offers to move them).
 */
export function keyPlan(s: LocalKeySettings, entry: CapsOf & { id?: string }): { takes: Capability[]; elsewhere: { cap: Capability; via: string }[] } {
  const takes: Capability[] = [];
  const elsewhere: { cap: Capability; via: string }[] = [];
  for (const cap of capabilitiesOf(entry)) {
    const via = s.use[cap].via;
    if (entry.id && via === entry.id) continue;
    if (s.keys.some((k) => k.id === via && supports(k, cap))) elsewhere.push({ cap, via });
    else takes.push(cap);
  }
  return { takes, elsewhere };
}

const modelFor = (entry: KeyEntry, cap: Capability, typed?: string) => (typed ?? '').trim() || presetOf(entry.preset).models[cap]?.[0] || '';

/**
 * Add (or replace by id) a key. It takes each job it can do that is on Worldlines
 * (or on a key that is gone / cannot do it); a job on another working key is not
 * stolen. Jobs it can no longer do (a custom service's untick) go back to Worldlines.
 */
export function upsertKey(s: LocalKeySettings, input: Omit<KeyEntry, 'id'> & { id?: string }, models: JobModels = {}): LocalKeySettings {
  const preset = presetOf(input.preset).id;
  const caps = preset === 'custom' ? readCaps(input.caps) : undefined;
  const entry: KeyEntry = { id: input.id ?? newId(), preset, base: providerBase(input.base) ?? input.base.trim(), key: input.key.trim(), ...(caps ? { caps } : {}) };
  const keys = s.keys.some((k) => k.id === entry.id) ? s.keys.map((k) => (k.id === entry.id ? entry : k)) : [...s.keys, entry];
  const use = { ...s.use };
  for (const cap of CAPABILITIES) {
    if (!supports(entry, cap)) {
      if (use[cap].via === entry.id) use[cap] = { ...use[cap], via: WORLDLINES };
      continue;
    }
    if (keys.some((k) => k.id === use[cap].via && k.id !== entry.id && supports(k, cap))) continue;
    const model = use[cap].via === entry.id && use[cap].model && !models[cap] ? use[cap].model : modelFor(entry, cap, models[cap]);
    use[cap] = { ...use[cap], via: entry.id, model };
  }
  return { ...s, keys, use };
}

/** A custom service's ticks changed: same rules as adding it (new jobs from Worldlines, unticked ones back). */
export function setKeyCaps(s: LocalKeySettings, id: string, caps: readonly Capability[]): LocalKeySettings {
  const entry = s.keys.find((k) => k.id === id);
  if (!entry || entry.preset !== 'custom') return s;
  return upsertKey(s, { ...entry, caps: [...caps] });
}

/** Remove one key; what used it goes back to Worldlines. */
export function removeKey(s: LocalKeySettings, id: string): LocalKeySettings {
  const use = { ...s.use };
  for (const cap of CAPABILITIES) if (use[cap].via === id) use[cap] = { ...use[cap], via: WORLDLINES };
  return { ...s, keys: s.keys.filter((k) => k.id !== id), use };
}

/** One capability onto a key (its default model unless one is given) or back to Worldlines. */
export function chooseFor(s: LocalKeySettings, cap: Capability, via: string, model?: string): LocalKeySettings {
  const entry = s.keys.find((k) => k.id === via && supports(k, cap));
  const next = entry ? { via, model: model ?? (s.use[cap].via === via ? s.use[cap].model : presetOf(entry.preset).models[cap]?.[0] ?? '') } : { via: WORLDLINES, model: s.use[cap].model };
  return { ...s, use: { ...s.use, [cap]: { ...s.use[cap], ...next } } };
}

function readChoice(raw: unknown, fallback: CapabilityChoice): CapabilityChoice {
  if (!raw || typeof raw !== 'object') return fallback;
  const c = raw as Partial<CapabilityChoice>;
  return {
    via: typeof c.via === 'string' ? c.via : fallback.via,
    model: typeof c.model === 'string' ? c.model : fallback.model,
    ...(typeof c.voice === 'string' ? { voice: c.voice } : fallback.voice ? { voice: fallback.voice } : {}),
  };
}

export function readLocalKey(storage: Pick<Storage, 'getItem'> | null): LocalKeySettings {
  const fallback = defaultLocalKeySettings();
  try {
    const raw = storage?.getItem(LOCAL_KEY_STORAGE);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<LocalKeySettings>;
    const keys = Array.isArray(v.keys)
      ? v.keys.filter((k): k is KeyEntry => !!k && typeof k.id === 'string' && typeof k.key === 'string' && typeof k.base === 'string')
        .map((k) => {
          const preset = presetOf(k.preset).id;
          const caps = preset === 'custom' ? readCaps(k.caps) : undefined;
          return { id: k.id, preset, base: k.base, key: k.key, ...(caps ? { caps } : {}) };
        })
      : [];
    const use = { ...fallback.use };
    for (const cap of CAPABILITIES) use[cap] = readChoice((v.use as Record<string, unknown> | undefined)?.[cap], fallback.use[cap]);
    return { source: v.source === 'local' ? 'local' : 'worldlines', keys, use };
  } catch { return fallback; }
}

export function writeLocalKey(storage: Pick<Storage, 'setItem'> | null, s: LocalKeySettings): boolean {
  try { storage?.setItem(LOCAL_KEY_STORAGE, JSON.stringify(s)); return !!storage; } catch { return false; }
}

/** 「清除本机密钥」: every key and its settings leave this browser; everything goes back to Worldlines. */
export function clearLocalKey(storage: Pick<Storage, 'removeItem'> | null): void {
  try { storage?.removeItem(LOCAL_KEY_STORAGE); } catch { /* storage blocked */ }
}

export interface RuntimeRoute { base: string; key: string; model: string; flavor: Flavor; voice?: string; contextWindow?: number }
export type RuntimeRoutes = Partial<Record<Capability, RuntimeRoute>>;

const flavorOf = (entry: KeyEntry, base: string): Flavor =>
  entry.preset === 'deepseek' || entry.preset === 'openai' || entry.preset === 'openrouter' ? entry.preset
    : /(^|\.)deepseek\.com$/i.test(new URL(base).hostname) ? 'deepseek' : 'custom';

/** What the in-tab runtime gets (platform/local-key.ts LocalKeyRoutes); {} = everything on Worldlines. */
export function runtimeRoutes(s: LocalKeySettings): RuntimeRoutes {
  const out: RuntimeRoutes = {};
  if (s.source !== 'local') return out;
  for (const cap of CAPABILITIES) {
    const choice = s.use[cap];
    const entry = s.keys.find((k) => k.id === choice.via);
    if (!entry || keyProblem(entry) || !choice.model.trim() || !supports(entry, cap)) continue;
    const base = providerBase(entry.base)!;
    const contextWindow = cap === 'chat' ? presetOf(entry.preset).contextWindows?.[choice.model.trim()] : undefined;
    out[cap] = {
      base, key: entry.key.trim(), model: choice.model.trim(), flavor: flavorOf(entry, base),
      ...(cap === 'tts' && choice.voice ? { voice: choice.voice } : {}), ...(contextWindow ? { contextWindow } : {}),
    };
  }
  return out;
}

/** The label of a key in lists: the provider's name, or the host for 「其他」. */
export function keyLabel(entry: Pick<KeyEntry, 'preset' | 'base'>): string {
  if (entry.preset !== 'custom') return presetOf(entry.preset).label;
  try { return new URL(providerBase(entry.base)!).hostname; } catch { return entry.base; }
}

/**
 * 「从 .env.local 读取」: the local LivingCanvas config,
 * read in this page only — the file is never uploaded. Every usable key in it:
 * DEEPSEEK_API_KEY (+ DEEPSEEK_BASE_URL), OPENAI_API_KEY (+ OPENAI_BASE_URL).
 */
export function keysFromEnvFile(text: string): Omit<KeyEntry, 'id'>[] {
  const env: Record<string, string> = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    env[m[1]] = v.trim();
  }
  const usable = (k: string | undefined): k is string => !!k && !/^(\$|<|your|xxx|changeme)/i.test(k) && !/\s/.test(k);
  const out: Omit<KeyEntry, 'id'>[] = [];
  if (usable(env.DEEPSEEK_API_KEY)) out.push({ preset: 'deepseek', base: providerBase(env.DEEPSEEK_BASE_URL ?? '') ?? presetOf('deepseek').base, key: env.DEEPSEEK_API_KEY });
  if (usable(env.OPENAI_API_KEY)) {
    const base = providerBase(env.OPENAI_BASE_URL ?? '');
    const official = !base || new URL(base).hostname === 'api.openai.com';
    out.push({ preset: official ? 'openai' : 'custom', base: official ? presetOf('openai').base : base!, key: env.OPENAI_API_KEY });
  }
  return out;
}

/** `sk-…abcd`: enough to recognise a saved key, never the key. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (!k) return '';
  return k.length <= 8 ? '••••' : `${k.slice(0, 3)}…${k.slice(-4)}`;
}

export type TestResult =
  | { ok: true; models: string[] }
  | { ok: false; reason: 'invalid' | 'unauthorized' | 'blocked' | 'http'; status?: number; problem?: string };

/**
 * 「测试连接」: one authenticated GET (`/models`, or the preset's own read) straight
 * from this page to the provider — no completion, nothing spent. A fetch that
 * throws is a network / CORS refusal (the browser hides which).
 */
export async function testKey(entry: Pick<KeyEntry, 'preset' | 'base' | 'key'>, request: typeof fetch): Promise<TestResult> {
  const problem = keyProblem(entry);
  if (problem) return { ok: false, reason: 'invalid', problem };
  const base = providerBase(entry.base)!;
  let res: Response;
  try {
    res = await request(`${base}${presetOf(entry.preset).check}`, { headers: { authorization: `Bearer ${entry.key.trim()}` }, credentials: 'omit', redirect: 'error', cache: 'no-store' });
  } catch {
    return { ok: false, reason: 'blocked' };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', status: res.status };
  if (!res.ok) return { ok: false, reason: 'http', status: res.status };
  const body = await res.json().catch(() => null) as { data?: unknown } | null;
  const models = Array.isArray(body?.data) ? (body!.data as { id?: unknown }[]).map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean) : [];
  return { ok: true, models };
}

export type JobTestResult =
  | { ok: true; listed: boolean | null; models: string[] }
  | { ok: false; reason: 'invalid' | 'unauthorized' | 'blocked' | 'http' | 'no-model' | 'unsupported'; status?: number; problem?: string };

/** `models/gemini-2.5-flash` (Gemini's list) and `gemini-2.5-flash` are the same model. */
const sameModel = (listed: string, chosen: string) => listed === chosen || listed.replace(/^models\//, '') === chosen.replace(/^models\//, '');

/**
 * A job's 「测试」: no generation, nothing spent. The key's authenticated read
 * (testKey), then — when that was not already the list — `GET /models`; `listed`
 * says whether the chosen model id is in it (null: the provider listed nothing,
 * so it cannot be told).
 */
export async function testJob(entry: Pick<KeyEntry, 'preset' | 'base' | 'key'> & { caps?: readonly Capability[] }, cap: Capability, model: string, request: typeof fetch): Promise<JobTestResult> {
  if (!supports(entry, cap)) return { ok: false, reason: 'unsupported' };
  const chosen = String(model ?? '').trim();
  if (!chosen) return { ok: false, reason: 'no-model' };
  const first = await testKey(entry, request);
  if (!first.ok) return first;
  let models = first.models;
  if (presetOf(entry.preset).check !== '/models') {
    try {
      const res = await request(`${providerBase(entry.base)}/models`, { headers: { authorization: `Bearer ${entry.key.trim()}` }, credentials: 'omit', redirect: 'error', cache: 'no-store' });
      const body = res.ok ? await res.json().catch(() => null) as { data?: unknown } | null : null;
      models = Array.isArray(body?.data) ? (body!.data as { id?: unknown }[]).map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean) : [];
    } catch { models = []; }
  }
  return { ok: true, listed: models.length ? models.some((m) => sameModel(m, chosen)) : null, models };
}

// ── the page's copy, with listeners (the panels and the runtime) ────────────

type Runtime = (routes: RuntimeRoutes) => unknown;
let runtime: Runtime | null = null;
let snapshot: LocalKeySettings | null = null;
const listeners = new Set<() => void>();

const pageStorage = (): Storage | null => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };

export function localKeySettings(): LocalKeySettings {
  snapshot ??= readLocalKey(pageStorage());
  return snapshot;
}

function changed(next?: LocalKeySettings): void {
  snapshot = next ?? readLocalKey(pageStorage());
  void runtime?.(runtimeRoutes(snapshot));
  for (const l of listeners) l();
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCAL_KEY_EVENT)); } catch { /* no listeners */ }
}

export function subscribeLocalKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Save and apply at once (the runtime switches from the next request). False =
 * storage blocked: the settings still apply until this tab closes.
 */
export function saveLocalKey(s: LocalKeySettings): boolean {
  const ok = writeLocalKey(pageStorage(), s);
  changed(s);
  return ok;
}

export function forgetLocalKey(): void {
  clearLocalKey(pageStorage());
  changed(defaultLocalKeySettings());
}

/** Only the browser runtime on the Worldlines gateway offers the switch (browser-mode.ts registers it). */
export function localKeyAvailable(): boolean { return runtime !== null; }

/** browser-mode.ts: how to hand the current routes to the in-tab runtime. Also follows other tabs' changes. */
export function registerLocalKeyRuntime(apply: Runtime): void {
  runtime = apply;
  for (const l of listeners) l();
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => { if (e.key === LOCAL_KEY_STORAGE || e.key === null) changed(); });
  }
}

/** The plan line's 「对话：…」 part: the chat provider's name on a local key, else null (Worldlines credits). */
export function chatKeyLabel(s: LocalKeySettings): string | null {
  if (!runtimeRoutes(s).chat) return null;
  const entry = s.keys.find((k) => k.id === s.use.chat.via);
  return entry ? keyLabel(entry) : null;
}
