/**
 * The voice call's fast brain: a character's spoken answer in one streamed
 * model call, without the agent (Sense the design notes, voice.rs).
 *
 * The full character agent (pi-rp: reads files, may call tools, thinks) takes
 * 5–15 s to its first word. On a call that is a dead line, the caller speaks
 * again, voice-live cancels the turn, and the agent piles up behind itself. So
 * a line said over a call (`character_prompt` relayed by voice-live-brain.ts)
 * is answered here instead:
 *
 *   - system prompt = the character's own definition (the same profile files
 *     its agent reads: `characters/<id>/preset.json` `profile` slot, else
 *     README.md and the other notes), the world's language, a short brief of
 *     the character's recent conversation (its own session file) and the rule
 *     "spoken reply: short, 1–3 sentences, no stage directions";
 *   - no tools; thinking off; the same model connection the character agent
 *     uses (its saved / world / default model; an own key from
 *     `.pi/agent/models.json`, else the Worldlines account / service through
 *     `gatewayFetch`, the way the agents' own proxy goes);
 *   - deltas go up as `character_delta` the moment they arrive, cleaned for
 *     speech (createSpokenStream: no （…） / *…* / 【…】); the full text goes to
 *     the canvas fan-out, the same frames the agent's answer used to produce;
 *   - a new prompt or `character_abort` aborts the HTTP stream at once and
 *     nothing more of that turn goes up — never a stale frame, never a wedge;
 *   - a finished exchange is recorded into the character's own session in the
 *     background (`record`), so the agent knows what was said on the call.
 *
 * `AIRP_VOICE_BRAIN=agent` keeps the old path (every line through the agent).
 * `AIRP_VOICE_BRAIN_MODEL` overrides the model id (same provider connection).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  createSpokenStream,
  parseCharacterSession,
  parseFrontmatter,
  isRealExchange,
  VOICE_CALL_CUSTOM_TYPE,
  type ChatExchange,
} from '@airp/shared';
import { gatewayFetch, readAiGateway } from '../ai-gateway.js';
import { DEFAULT_MODEL_PREFERENCES, readModelPreferences, type ModelPreference } from './model-preferences.js';

export type VoiceBrainMode = 'fast' | 'agent';

/** Fast unless `AIRP_VOICE_BRAIN=agent` (also `full` / `off`): then every call line goes through the agent. */
export function voiceBrainModeFromEnv(env: NodeJS.ProcessEnv = process.env): VoiceBrainMode {
  const raw = (env.AIRP_VOICE_BRAIN ?? '').trim().toLowerCase();
  return ['agent', 'full', 'off', '0', 'false', 'no'].includes(raw) ? 'agent' : 'fast';
}

// ——————————————————————————————————————————————————————————————————————
// The model connection
// ——————————————————————————————————————————————————————————————————————

export interface VoiceModel {
  baseUrl: string;
  apiKey: string;
  model: string;
  request: typeof fetch;
  /** Which way it goes, for the log line. Never a key. */
  via: 'own' | 'gateway';
}

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown; } catch { return undefined; }
}

/**
 * The character agent's model for this save — the saved pick, else the world's
 * hint (passed in: engine/world-models.ts), else the default — and how to reach
 * it: the provider's own key from `.pi/agent/models.json` (`$VAR` resolved from
 * env; OpenAI's built-in from OPENAI_API_KEY), else the Worldlines AI service
 * (signed in, a trial guest, or AIRP_AI_BASE) exactly as the agents reach it
 * through the loopback proxy. Null when neither exists.
 */
export function voiceModelEndpoint(
  repoRoot: string,
  worldRoot: string,
  opts: { env?: NodeJS.ProcessEnv; request?: typeof fetch; worldHint?: ModelPreference | null } = {},
): VoiceModel | null {
  const env = opts.env ?? process.env;
  const request = opts.request ?? fetch;
  const preference = readModelPreferences(worldRoot).character ?? opts.worldHint ?? DEFAULT_MODEL_PREFERENCES.character;
  const model = (env.AIRP_VOICE_BRAIN_MODEL ?? '').trim() || preference.model;
  const gateway = (): VoiceModel | null => {
    const g = readAiGateway(env, { guest: true });
    if (!g) return null;
    return { baseUrl: g.base, apiKey: g.apiKey, model, via: 'gateway', request: (url, init) => gatewayFetch(g, String(url), init, request) };
  };
  // The browser runtime / a configured service: every agent goes there.
  if ((env.AIRP_AI_BASE ?? '').trim()) return gateway();
  const config = readJson(path.join(repoRoot, '.pi', 'agent', 'models.json'));
  const providers = isObject(config) && isObject(config.providers) ? config.providers : {};
  const entry = providers[preference.provider];
  if (isObject(entry) && typeof entry.baseUrl === 'string' && (entry.api === undefined || entry.api === 'openai-completions')) {
    const raw = typeof entry.apiKey === 'string' ? entry.apiKey : '';
    const variable = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(raw)?.[1];
    const key = variable ? (env[variable] ?? '').trim() : raw.trim();
    if (key) return { baseUrl: entry.baseUrl.replace(/\/+$/, ''), apiKey: key, model, via: 'own', request };
    return gateway();
  }
  if (preference.provider === 'openai') {
    const key = (env.OPENAI_API_KEY ?? '').trim();
    if (key) return { baseUrl: (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''), apiKey: key, model, via: 'own', request };
    return gateway();
  }
  // A provider this server cannot speak to directly (not OpenAI-compatible):
  // the flash model on the same text path the server's own small jobs use.
  const flash = (env.AIRP_VOICE_BRAIN_MODEL ?? '').trim() || 'deepseek-v4-flash';
  const own = (env.DEEPSEEK_API_KEY ?? '').trim();
  if (own) return { baseUrl: (env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com').replace(/\/+$/, ''), apiKey: own, model: flash, via: 'own', request };
  const viaGateway = gateway();
  return viaGateway ? { ...viaGateway, model: flash } : null;
}

// ——————————————————————————————————————————————————————————————————————
// The character, the language, the brief
// ——————————————————————————————————————————————————————————————————————

const SOUL_MAX_CHARS = 8000;
const PROFILE_FALLBACK = ['README.md', 'personality.md', 'identity.md', 'memory.md', 'relationships.md', 'unspoken.md', 'likes-and-fears.md', 'near-term.md', 'long-term.md', 'diary.md'];

function inside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function body(text: string): string {
  return parseFrontmatter(text).body.trim();
}

export interface CharacterSoul {
  name: string;
  /** The character's definition as its agent reads it (frontmatter stripped). */
  text: string;
}

/**
 * The profile the character's agent is given: the preset's `block` items and
 * its `file` slot (`options.path` under `options.baseDir`), in that order —
 * else `characters/<id>/README.md` and the usual notes. Bounded; never throws.
 */
export function readCharacterSoul(worldRoot: string, characterId: string): CharacterSoul {
  const dir = path.join(worldRoot, 'characters', characterId);
  let name = characterId;
  try {
    const fm = parseFrontmatter(fs.readFileSync(path.join(dir, 'README.md'), 'utf8')).frontmatter;
    if (typeof fm?.name === 'string' && fm.name.trim()) name = fm.name.trim();
  } catch { /* no README: the id */ }
  const parts: string[] = [];
  const preset = readJson(path.join(dir, 'preset.json'));
  let files: string[] | null = null;
  let baseDir = dir;
  if (isObject(preset) && Array.isArray(preset.items)) {
    for (const item of preset.items) {
      if (!isObject(item)) continue;
      if (item.kind === 'block' && typeof item.content === 'string' && item.content.trim()) parts.push(item.content.trim());
      if (item.kind === 'slot' && item.slot === 'file' && isObject(item.options)) {
        const list = Array.isArray(item.options.path) ? item.options.path : typeof item.options.path === 'string' ? [item.options.path] : [];
        files = list.filter((p): p is string => typeof p === 'string');
        if (typeof item.options.baseDir === 'string') baseDir = path.resolve(worldRoot, item.options.baseDir);
      }
    }
  }
  for (const rel of files ?? PROFILE_FALLBACK) {
    const file = path.resolve(baseDir, rel);
    if (!inside(worldRoot, file)) continue;
    try {
      const text = body(fs.readFileSync(file, 'utf8'));
      if (text) parts.push(text);
    } catch { /* missing: skipped, like the preset's onMissing: skip */ }
  }
  let text = parts.join('\n\n');
  if (text.length > SOUL_MAX_CHARS) text = `${text.slice(0, SOUL_MAX_CHARS)}…`;
  return { name, text };
}

/** world.json `locale` (or `language`) → a BCP-47-ish tag; '' when the world says nothing. */
export function worldLanguage(worldRoot: string): string {
  const manifest = readJson(path.join(worldRoot, 'world.json'));
  if (!isObject(manifest)) return '';
  for (const key of ['locale', 'language', 'lang']) {
    const value = manifest[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function languageLine(locale: string): string {
  const tag = locale.toLowerCase();
  if (tag.startsWith('zh')) return 'Speak Chinese (简体中文), the language of this world.';
  if (tag.startsWith('ja')) return 'Speak Japanese (日本語), the language of this world.';
  if (tag.startsWith('ko')) return 'Speak Korean (한국어), the language of this world.';
  if (tag.startsWith('en')) return 'Speak English, the language of this world.';
  return 'Answer in the language the player speaks.';
}

/** The newest exchanges of the character's own session, oldest first. */
export function sessionBrief(jsonl: string | null, lastN = 6, maxChars = 1600): ChatExchange[] {
  if (!jsonl) return [];
  const picked = parseCharacterSession(jsonl).exchanges.filter((e) => isRealExchange(e)).slice(-lastN);
  const out: ChatExchange[] = [];
  let used = 0;
  for (let i = picked.length - 1; i >= 0; i--) {
    const cost = picked[i].player.length + picked[i].reply.length;
    if (out.length && used + cost > maxChars) break;
    out.unshift(picked[i]);
    used += cost;
  }
  return out;
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

export function voiceSystemPrompt(a: { soul: CharacterSoul; language: string; brief: readonly ChatExchange[]; scene?: string }): string {
  const lines = [
    `You are ${a.soul.name}. Speak only as ${a.soul.name}, in the first person, and stay fully in character.`,
    '',
    '<character>',
    a.soul.text || `(${a.soul.name})`,
    '</character>',
  ];
  if (a.scene?.trim()) lines.push('', '<scene>', clip(a.scene.trim(), 1200), '</scene>');
  if (a.brief.length) {
    lines.push('', '<recent-conversation>');
    for (const e of a.brief) {
      lines.push(`Player: ${clip(e.player, 300)}`, `${a.soul.name}: ${clip(e.reply, 300)}`);
    }
    lines.push('</recent-conversation>');
  }
  lines.push(
    '',
    `This is a live voice call with the player: they hear what you say. ${languageLine(a.language)}`,
    'Spoken reply only: short, 1–3 sentences, the way people talk. No stage directions, no actions or narration in brackets or asterisks, no emotion tags, no markdown, no lists. Do not describe what you do — say it.',
  );
  return lines.join('\n');
}

// ——————————————————————————————————————————————————————————————————————
// One streamed call
// ——————————————————————————————————————————————————————————————————————

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

/** The model's text deltas as they arrive (OpenAI-compatible SSE). Aborts with `signal`. */
export async function* streamChatDeltas(ep: VoiceModel, messages: ChatMessage[], signal: AbortSignal, maxTokens = 220): AsyncGenerator<string> {
  const res = await ep.request(`${ep.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ep.apiKey}` },
    body: JSON.stringify({
      model: ep.model,
      ...(/deepseek/i.test(ep.model) ? { thinking: { type: 'disabled' } } : {}),
      stream: true,
      temperature: 0.8,
      max_tokens: maxTokens,
      messages,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {});
    if (res.status === 402 || res.status === 429) throw new Error(`the model refused the call (HTTP ${res.status}: credits or quota)`);
    throw new Error(`the model answered HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, nl).trim();
        pending = pending.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        let msg: { choices?: Array<{ delta?: { content?: unknown } }> };
        try { msg = JSON.parse(data); } catch { continue; }
        const delta = msg.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) yield delta;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// ——————————————————————————————————————————————————————————————————————
// The brain of one call
// ——————————————————————————————————————————————————————————————————————

export interface FastBrainDeps {
  characterId: string;
  worldRoot: string;
  /** Resolved per turn (a sign-in or a model change mid-call takes effect next line). */
  model(): VoiceModel | null;
  soul(): CharacterSoul;
  language(): string;
  /** The character's session file (char-<id>.jsonl), or null. Read once per call. */
  readSession(): string | null;
  /** Record a finished exchange into the character's history. Background; its failure is only logged. */
  record(player: string, reply: string): Promise<void>;
  /** A frame for the canvas fan-out (full text: the dialogue shows what she said, stage directions and all). */
  broadcast?(frame: Record<string, unknown>): void;
  /** No first word by then → the turn fails (a non-fatal notice on the call). */
  firstTokenTimeoutMs?: number;
  log?(line: string): void;
}

export interface FastBrain {
  /** voice-live's `character_start`: the scene it was given (`recentContext`). */
  start(recentContext?: string): void;
  /** One line said over the call. Supersedes (aborts) any turn still running. */
  prompt(message: string): void;
  /** Barge-in / `character_abort`: stop now; nothing more of that turn goes up. */
  abort(): void;
  /** The call ended. Resolves once the pending history records have settled (bounded by the caller). */
  close(): Promise<void>;
  /** For tests / the log: is a turn streaming? */
  busy(): boolean;
}

/** How many of this call's own turns ride along as chat messages. */
const CALL_TURNS = 8;

/**
 * `up(frame)` sends one brain frame back to voice-live (the relay wraps and
 * save-scopes it). Frames: `character_delta` (speech-clean), `character_idle`,
 * `error` — the ones voice-live's RelayCharacterBrain reads.
 */
export function createFastBrain(deps: FastBrainDeps, up: (frame: Record<string, unknown>) => void): FastBrain {
  const { characterId, worldRoot } = deps;
  const log = deps.log ?? ((line: string) => console.log(line));
  const firstTokenMs = deps.firstTokenTimeoutMs ?? 15_000;
  let scene = '';
  let brief: ChatExchange[] | null = null;
  const call: ChatMessage[] = [];
  interface Turn { controller: AbortController; id: number; message: string; full: string; settled: boolean }
  let current: Turn | null = null;
  let seq = 0;
  let closed = false;
  const records = new Set<Promise<void>>();

  const frame = (type: string, extra: Record<string, unknown> = {}) => ({ type, characterId, savePath: worldRoot, ...extra });
  const fan = (type: string, extra: Record<string, unknown> = {}) => {
    try { deps.broadcast?.(frame(type, extra)); } catch { /* the fan-out is best-effort */ }
  };

  const record = (player: string, reply: string) => {
    const p = deps.record(player, reply).catch((err: unknown) => {
      log(`[AIRP VoiceBrain] could not record the call line into ${characterId}'s history: ${err instanceof Error ? err.message : String(err)}`);
    });
    records.add(p);
    void p.finally(() => records.delete(p));
  };

  /** This call's memory of a turn: once, whichever way it ended. */
  const settle = (turn: Turn, reply: string | null) => {
    if (turn.settled) return;
    turn.settled = true;
    call.push({ role: 'user', content: turn.message });
    if (reply) call.push({ role: 'assistant', content: reply });
  };

  const run = async (turn: Turn) => {
    const { id, controller, message } = turn;
    const live = () => !closed && current?.id === id && !controller.signal.aborted;
    const started = Date.now();
    let fanned = false;
    let firstAt: number | null = null;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (firstAt !== null) return;
      timedOut = true;
      controller.abort(new Error('first-token timeout'));
    }, firstTokenMs);
    try {
      const ep = deps.model();
      if (!ep) throw new Error('no model is connected for the character (no key, not signed in)');
      brief ??= sessionBrief(deps.readSession());
      const system = voiceSystemPrompt({ soul: deps.soul(), language: deps.language(), brief, scene });
      const messages: ChatMessage[] = [{ role: 'system', content: system }, ...call.slice(-CALL_TURNS * 2), { role: 'user', content: message }];
      const spoken = createSpokenStream({ names: [deps.soul().name] });
      for await (const delta of streamChatDeltas(ep, messages, controller.signal)) {
        if (!live()) return;
        if (firstAt === null) {
          firstAt = Date.now();
          log(`[AIRP VoiceBrain] ${characterId}: first token ${firstAt - started} ms (${ep.via}, ${ep.model})`);
        }
        turn.full += delta;
        fan('character_delta', { delta });
        fanned = true;
        const say = spoken.push(delta);
        if (say) up(frame('character_delta', { delta: say }));
      }
      if (!live()) return;
      const tail = spoken.end();
      if (tail) up(frame('character_delta', { delta: tail }));
      up(frame('character_idle'));
      const text = turn.full.trim();
      settle(turn, text);
      log(`[AIRP VoiceBrain] ${characterId}: reply done in ${Date.now() - started} ms (${text.length} chars)`);
      if (text) record(message, text);
    } catch (err) {
      // Superseded or barged in (`stop` already kept what she had begun): nothing goes up.
      if (!timedOut && !live()) return;
      const reason = timedOut ? 'the character took too long to answer' : err instanceof Error ? err.message : String(err);
      log(`[AIRP VoiceBrain] ${characterId}: turn failed: ${reason}`);
      settle(turn, null);
      if (!closed) up(frame('error', { message: reason }));
    } finally {
      clearTimeout(timer);
      if (fanned) { fan('character_message', { text: turn.full.trim() }); fan('character_idle'); }
      if (current?.id === id) current = null;
    }
  };

  /** Abort the running turn now; the call remembers what was said of it. */
  const stop = () => {
    const turn = current;
    current = null;
    if (!turn) return;
    settle(turn, turn.full.trim() ? `${turn.full.trim()}…` : null);
    turn.controller.abort();
  };

  return {
    start(recentContext?: string) {
      if (typeof recentContext === 'string') scene = recentContext;
    },
    prompt(message: string) {
      if (closed) return;
      stop();
      const text = message.trim();
      if (!text) { up(frame('character_idle')); return; }
      const turn: Turn = { controller: new AbortController(), id: ++seq, message: text, full: '', settled: false };
      current = turn;
      void run(turn);
    },
    abort() { stop(); },
    async close() {
      if (closed) return;
      closed = true;
      stop();
      await Promise.allSettled([...records]);
    },
    busy() { return current !== null; },
  };
}

// ——————————————————————————————————————————————————————————————————————
// Into her history
// ——————————————————————————————————————————————————————————————————————

/** The two calls of the agent's RPC client this needs (vendor RpcClient). */
export interface HistoryClient {
  appendMessage(args: { customType: string; content: string; display?: boolean; details?: unknown }): Promise<{ entryId: string }>;
  navigateTree(targetId: string): Promise<unknown>;
}

/** The lifecycle calls this needs (engine/lifecycle.ts). */
export interface HistoryHost {
  ensureCharacter(characterId: string, worldRoot: string): Promise<HistoryClient>;
  submitCharacterTurn<T>(characterId: string, run: () => Promise<T>): Promise<T>;
}

/** What the agent reads (a user-role note in its context): plain, in the world's own words. */
export function callExchangeNote(player: string, reply: string): string {
  return `[Voice call] Over the phone, the player said: ${player}\nYou answered aloud: ${reply}`;
}

/**
 * One finished call exchange into the character's own session: a pi-rp
 * `custom_message` (customType `voice-call`, details `{ player, reply }` — the
 * chat summary and the message drawer count it as an exchange,
 * shared/rules/chat-transcript.ts) and then `navigateTree` onto it, which is
 * what puts an appended entry into the running agent's context (rpc-client.ts
 * `appendMessage`). Queued as one of her turns, so it never lands in the middle
 * of a turn she is giving in the dialogue.
 */
export async function recordCallExchange(host: HistoryHost, characterId: string, worldRoot: string, player: string, reply: string): Promise<void> {
  const client = await host.ensureCharacter(characterId, worldRoot);
  await host.submitCharacterTurn(characterId, async () => {
    const { entryId } = await client.appendMessage({
      customType: VOICE_CALL_CUSTOM_TYPE,
      content: callExchangeNote(player, reply),
      display: false,
      details: { player, reply },
    });
    await client.navigateTree(entryId);
  });
}
