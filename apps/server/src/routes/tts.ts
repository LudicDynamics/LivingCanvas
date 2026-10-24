import { Router, type Response as ExpressResponse } from 'express';
import fs from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { ALIAS_DESCRIPTORS, LOCAL_VOICE_HOSTED_FALLBACK, characterVoiceOf, inferVoiceProfile, worldFamilyOf, resolveVoice, resolveVoiceFor, sanitiseTtsText, parseFrontmatter, voiceEntry, worldLanguageOf, TtsRequestSchema, type LocalWorldStore, type RosterProfile, type WorldLanguage } from '@airp/shared';
import { builtinCandidates } from '../builtin-voices.js';
import { castFromPlay } from '../play-voice.js';
import { FishTtsError, isFishGatewayModel, readFishTtsConfig, synthesiseFish, ttsProviderOf } from './fish-tts.js';
import { LocalTtsError, localTtsEmotion, localTtsEnabled, localTtsHash, readLocalTtsConfig, selectLocalVoice, synthesiseLocal } from './local-tts.js';
import { AiQuotaError, accountAccessToken, accountSignedIn, aiModels, gatewayFetch, guestVoiceHere, quotaBody, quotaErrorOf, quotaStatus, readAiGateway, type AiGateway } from '../ai-gateway.js';

/**
 * Server-side TTS: the ONE synthesis point.
 *
 * `POST /api/tts` takes one page of character dialogue, checks the on-disk
 * content-addressed cache, and on a miss calls DashScope `qwen3-tts-flash`,
 * downloads the resulting OSS wav and writes it atomically before returning a
 * local URL. `GET /api/tts/audio/:file` serves that wav back.
 *
 * There is deliberately NO module-level state (no cached config, no client):
 * every request re-reads env and the active store, so tests may set env after
 * import and an operator may rotate the key without a restart.
 *
 * TTS is a performance, not state: it never writes `events`,
 * never emits a WS frame and never touches `assets/audio/`.
 */

/** DashScope caps `text` at 512 tokens ≈ 600 chars; 500 is the conservative pick. */
const MAX_TEXT_CHARS = 500;
/**
 * Structural sanity gate only. The palette lookup below is what decides, so a
 * space is legal here: `Eldric Sage` is ONE DashScope voice, and the old
 * no-space regex silently rewrote it to the default.
 */
const VOICE_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;
/** Content-addressed cache file: `hashOf(...)` output. */
const FILE_RE = /^[a-f0-9]{20}\.wav$/;
/** World locale short code → DashScope `language_type`. */
const LANGUAGE_MAP: Record<string, string> = { ja: 'Japanese', en: 'English', zh: 'Chinese', 'zh-CN': 'Chinese', ko: 'Korean' };

function worldChangedResponse(res: ExpressResponse): ExpressResponse {
  return res.status(409).json({
    ok: false,
    code: 'world_changed',
    error: 'The active world changed before this voice request could be handled.',
  });
}

const DEFAULTS = {
  // The dated snapshot `qwen3-tts-flash-2025-11-27` was retired by DashScope (HTTP 404 「Model not exist」, 2026-10-10);
  // the rolling alias keeps working.
  model: 'qwen3-tts-flash',
  baseUrl: 'https://dashscope-intl.aliyuncs.com/api/v1',
  timeoutMs: 15000,
  voice: 'Cherry',
} as const;

export interface TtsConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  defaultVoice: string;
  /** The Worldlines AI service, only when there is no DashScope key (ai-gateway.ts). */
  gateway: AiGateway | null;
}

/**
 * Re-read env on EVERY request, never at module load:
 * the test harness sets env after import and expects it to take effect.
 */
export function readTtsConfig(): TtsConfig {
  const timeoutRaw = Number(process.env.AIRP_TTS_TIMEOUT_MS);
  const apiKey = process.env.DASHSCOPE_API_KEY ?? '';
  return {
    apiKey,
    // Trailing slashes are stripped so `/services/...` always concatenates cleanly.
    baseUrl: (process.env.AIRP_TTS_BASE_URL ?? DEFAULTS.baseUrl).replace(/\/+$/, ''),
    model: process.env.AIRP_TTS_MODEL ?? DEFAULTS.model,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULTS.timeoutMs,
    defaultVoice: process.env.AIRP_TTS_DEFAULT_VOICE ?? DEFAULTS.voice,
    gateway: apiKey.trim() ? null : readAiGateway(),
  };
}

/**
 * Cache keys include the effective delivery instructions for instruct models,
 * so changing voice direction cannot reuse ordinary or stale audio.
 */
export function hashOf(model: string, voice: string, languageType: string, text: string, instructions = ''): string {
  return createHash('sha256')
    .update(`${model}|${voice}|${languageType}|${text}${instructions ? `|delivery:${instructions}` : ''}`)
    .digest('hex')
    .slice(0, 20);
}

/** Ordinary Flash does not support instruction control; never send ignored options. */
export function deliveryInstructions(model: string, voice: string): string {
  if (!/^qwen3-tts-instruct-flash(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return '';
  const identity = voice === 'Cherry' || voice === 'Nini'
    ? 'Use a natural youthful feminine speaking voice, not a child voice. '
    : 'Preserve the selected speaker identity and natural vocal register. ';
  return identity +
    'Speak as if talking quietly face to face, at a comfortable conversational pace. ' +
    'Use relaxed phrasing and small, context-appropriate emotional changes. Keep pitch stable and unforced. ' +
    'Avoid exaggerated rises, sing-song delivery, theatrical breathiness, artificial laughter, shouting and announcer-style emphasis. ' +
    'Read only the supplied text; do not speak these instructions.';
}

/** Upstream failure carrier: a typed marker beats string-matching the message. */
class TtsUpstreamError extends Error {
  constructor(
    public kind: 'timeout' | 'upstream',
    message: string,
    /** The service's HTTP status, when it answered. */
    public status?: number,
    /** The service's error code, when it said one (guest_tts_exhausted …). */
    public code?: string,
  ) {
    super(message);
    this.name = 'TtsUpstreamError';
  }
}

/**
 * A trial guest's voice ends here (the Worldlines platform services/ai, guest speech): the guest voice allowance used up
 * (429 guest_tts_exhausted), past the trial world (403 guest_world_only / guest_not_allowed) or the trial cannot be
 * checked (503 guest_trial_unavailable). Never retried: signing in brings the voices back.
 */
const GUEST_VOICE_STOPS = new Set(['guest_tts_exhausted', 'guest_world_only', 'guest_not_allowed', 'guest_trial_unavailable']);
/** The AI service refused the caller (401 / 403, or a guest's voice stop): every voice would be refused the same way. */
function isAccountRefusal(err: unknown): boolean {
  return err instanceof TtsUpstreamError && (err.status === 401 || err.status === 403 || GUEST_VOICE_STOPS.has(err.code ?? ''));
}
/** The answer that stops the page asking for voices this session and says once that signing in brings them. */
const REQUIRES_ACCOUNT = { status: 401, code: 'tts_requires_account', error: 'Voices need a Worldlines account.' } as const;
const requiresAccountBody = (reason?: string) => ({ ok: false as const, code: REQUIRES_ACCOUNT.code, error: REQUIRES_ACCOUNT.error, ...(reason ? { reason } : {}) });

/** Map a `synthesise` throw onto the frozen error matrix. */
function mapSynthError(err: unknown): { status: number; code: string; error: string; reason?: string } {
  // The service refused the caller (signed out, a guest past the trial world or out of guest voice): not a broken
  // upstream. The page stops asking for this session and says once that signing in brings the voices.
  if (isAccountRefusal(err)) {
    const reason = (err as TtsUpstreamError).code;
    return { ...REQUIRES_ACCOUNT, ...(reason && GUEST_VOICE_STOPS.has(reason) ? { reason } : {}) };
  }
  if (err instanceof TtsUpstreamError && err.kind === 'timeout') {
    return { status: 504, code: 'tts_timeout', error: err.message };
  }
  if (err instanceof TtsUpstreamError) {
    return { status: 502, code: 'tts_upstream', error: err.message };
  }
  const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
  if (aborted) return { status: 504, code: 'tts_timeout', error: 'TTS request timed out' };
  return { status: 502, code: 'tts_upstream', error: err instanceof Error ? err.message : String(err) };
}

/** A wav container is `RIFF....WAVE` — the 4-byte sigil plus the 4-byte form type. */
function isWav(buf: Buffer): boolean {
  return (
    buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE'
  );
}

/**
 * Synthesise one page of text via DashScope → download → return the wav bytes.
 * A single `AbortController` covers BOTH hops (the design notes: the timeout is a
 * total budget including the download).
 */
export async function synthesise(opts: {
  text: string;
  voice: string;
  languageType: string; // already mapped: 'Auto' | 'Chinese' | 'English' | 'Japanese' | 'Korean' | … (never the short code)
  apiKey: string;
  baseUrl: string; // e.g. https://dashscope-intl.aliyuncs.com/api/v1
  model: string; // e.g. qwen3-tts-flash
  timeoutMs: number; // total budget incl. the OSS download
}): Promise<Buffer> {
  // Step 1 — request shape (qwen3-tts-flash.md §1.1/§1.2/§2.1/§2.2). `language_type`
  // keeps its underscore: a camelCase key is silently ignored by DashScope.
  const endpoint = `${opts.baseUrl}/services/aigc/multimodal-generation/generation`;
  const instructions = deliveryInstructions(opts.model, opts.voice);
  const payload = {
    model: opts.model,
    input: {
      text: opts.text,
      voice: opts.voice,
      language_type: opts.languageType,
      ...(instructions ? { instructions, optimize_instructions: false } : {}),
    },
  };
  const headers = {
    Authorization: `Bearer ${opts.apiKey}`,
    'Content-Type': 'application/json',
  };

  // Step 2 — fire, under the total budget.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw new TtsUpstreamError('timeout', `TTS request timed out after ${opts.timeoutMs}ms`);
      }
      throw err;
    }

    // Step 3 — `output.audio.url` (qwen3-tts-flash.md §3). `res.ok` is the primary
    // verdict; `code`/`message` are only folded into the error text.
    if (!res.ok) throw new TtsUpstreamError('upstream', `DashScope HTTP ${res.status}`);
    const data = (await res.json()) as {
      status_code?: number;
      code?: string;
      message?: string;
      output?: { audio?: { url?: string } };
      usage?: { characters?: number };
    };
    const audioUrl = data.output?.audio?.url;
    if (typeof audioUrl !== 'string' || audioUrl === '') {
      throw new TtsUpstreamError(
        'upstream',
        `DashScope response has no output.audio.url: ${data.code ?? ''} ${data.message ?? ''}`.trim()
      );
    }

    // Step 4 — download now. The OSS URL is a SIGNED link that expires (24h,
    // qwen3-tts-flash.md §5.3), so caching the wav is the only correct posture.
    let audioRes: Response;
    try {
      audioRes = await fetch(audioUrl, { signal: ac.signal });
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw new TtsUpstreamError('timeout', `TTS download timed out after ${opts.timeoutMs}ms`);
      }
      throw err;
    }
    if (!audioRes.ok) throw new TtsUpstreamError('upstream', `OSS download HTTP ${audioRes.status}`);
    const buf = Buffer.from(await audioRes.arrayBuffer());

    // Magic-byte gate: an error page must never be cached.
    // The cache is content-addressed and the browser never retries a failed
    // decode, so a poisoned file would be permanent.
    if (!isWav(buf)) {
      throw new TtsUpstreamError('upstream', 'OSS download is not a RIFF/WAVE file');
    }
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One page through the Worldlines AI service (`POST <base>/audio/speech`,
 * OpenAI-shaped, wav back). `voice` is the id the service's provider knows: a
 * DashScope voice for the Qwen model, the studio voice name (`setsuna`) for the
 * local model. `language` is DashScope's `language_type` spelling; `emotion`
 * only means something to the local model. A quota stop throws AiQuotaError.
 */
export async function synthesiseViaGateway(opts: {
  gateway: AiGateway;
  model: string;
  text: string;
  voice: string;
  language?: string;
  instructions?: string;
  emotion?: string;
  timeoutMs: number;
  /**
   * The service fell back to another provider for this line (OpenAI → qwen-tts,
   * `X-Worldlines-TTS-Fallback`). It already retried; we only report it.
   */
  onProviderFallback?: (detail: string) => void;
}): Promise<Buffer> {
  let res: Response;
  try {
    res = await gatewayFetch(opts.gateway, `${opts.gateway.base}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.gateway.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        input: opts.text,
        voice: opts.voice,
        response_format: 'wav',
        ...(opts.language && opts.language !== 'Auto' ? { language: opts.language } : {}),
        ...(opts.instructions ? { instructions: opts.instructions } : {}),
        ...(opts.emotion ? { emotion: opts.emotion } : {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new TtsUpstreamError('timeout', `TTS request timed out after ${opts.timeoutMs}ms`);
    }
    throw err;
  }
  const quota = await quotaErrorOf(res);
  if (quota) { await res.body?.cancel().catch(() => {}); throw quota; }
  if (!res.ok) {
    const code = (await res.json().catch(() => null) as { error?: { code?: unknown } } | null)?.error?.code;
    throw new TtsUpstreamError('upstream', `Worldlines AI HTTP ${res.status}${typeof code === 'string' && code ? ` (${code})` : ''}`, res.status, typeof code === 'string' ? code : undefined);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // Same gate as the DashScope path: an error page must never be cached.
  if (!isWav(buf)) throw new TtsUpstreamError('upstream', 'Worldlines AI speech is not a RIFF/WAVE file');
  const fallback = res.headers.get('x-worldlines-tts-fallback');
  if (fallback) opts.onProviderFallback?.(`${fallback}${res.headers.get('x-worldlines-tts-provider') ? ` → ${res.headers.get('x-worldlines-tts-provider')}` : ''}`);
  return buf;
}

/**
 * The voices go through the Worldlines AI service on the account's token, and nobody is signed in: a signed-out
 * player (or a guest outside the trial worlds — the service hears guests in the trial worlds only) gets no voice at
 * all, so the page is told up front (`requiresAccount`) instead of asking for every line and reading a 401 each time.
 */
export async function ttsNeedsAccount(config: Pick<TtsConfig, 'apiKey' | 'gateway'>, signedIn: () => Promise<boolean> = voiceSessionHere): Promise<boolean> {
  return !config.apiKey.trim() && config.gateway?.account === true && !(await signedIn());
}
/**
 * The AI service through the player's own Worldlines account, when they are signed in: voices then
 * always go through it, so a signed-in player needs no TTS key. Signed out, a guest of the trial in a trial world
 * (packages/shared guest-trial rules; the `__airpGuestToken` hook decides) goes the same way on the guest token,
 * marked `guest` (its voice stops ask for sign-in, never for credits). null when signed out otherwise, or the
 * gateway is not an account one (a service key configured by an operator keeps the old order).
 */
export async function accountGatewayFor(
  signedIn: () => Promise<boolean> = accountHere,
  guestHere: () => Promise<boolean> = guestVoiceHere,
): Promise<(AiGateway & { guest?: true }) | null> {
  if (await signedIn()) {
    const gateway = readAiGateway();
    return gateway?.account === true ? gateway : null;
  }
  if (!(await guestHere())) return null;
  const gateway = readAiGateway(process.env, { guest: true });
  return gateway?.account === true ? { ...gateway, guest: true } : null;
}
/** Somebody this computer may be heard as: the signed-in account, or a guest in a trial world. */
async function voiceSessionHere(): Promise<boolean> {
  return (await accountHere()) || guestVoiceHere();
}
/** A session in remote.json, or the account-token hook (sync/remote-client.ts) has a token; null without a session, no network. */
async function accountHere(): Promise<boolean> {
  if (accountSignedIn()) return true;
  const hook = (globalThis as { __airpAccountToken?: (o: { force?: boolean }) => Promise<string | null> }).__airpAccountToken;
  try { return Boolean(hook && await hook({})); } catch { return false; }
}

/**
 * Same-dir temp + rename, mirroring `LocalWorldStore.writeFileAtomic`
 * (local-store.ts:174-188). Same-dir is REQUIRED: rename is atomic only within
 * one filesystem. The temp name carries pid + random because two concurrent
 * requests (two pages prefetched at once) may synthesise the SAME hash and race.
 *
 * `FILE_RE` never matches `.tmp-…`, so a crash between write and rename leaves
 * garbage that can never be mistaken for a cache hit.
 */
async function writeAtomic(abs: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, abs);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Assemble the TTS routes. Mounted alongside `createWorldRouter` on `/api`.
 * Nothing here is module-level state: every request re-reads env and the
 * active store, so tests may set env after import (hard requirement, §10).
 */
export function createTtsRouter(
  repoRoot: string,
  getActiveStore: () => LocalWorldStore | null,
  isWorldRootCurrent: (worldRoot: string) => boolean,
  writeCacheAtomic: typeof writeAtomic = writeAtomic,
): Router {
  const router = Router();

  // Public readiness only: never expose credentials or gateway URLs.
  router.get('/tts/config', async (_req, res) => {
    const config = readTtsConfig();
    res.setHeader('Cache-Control', 'no-store');
    const localUrl = readLocalTtsConfig().baseUrl;
    const localTts = localTtsEnabled();
    const ownLocal = Boolean(localUrl && localTts);
    const fish = readFishTtsConfig();
    const signedIn = await accountGatewayFor();
    const ownFish = !signedIn && ttsProviderOf() === 'fish' && Boolean(fish.apiKey);
    const requiresAccount = !signedIn && !ownLocal && !ownFish && await ttsNeedsAccount(config);
    res.json({
      configured: Boolean(signedIn || ownFish || config.apiKey.trim() || ownLocal || (config.gateway && !requiresAccount)),
      ...(requiresAccount ? { requiresAccount: true } : {}),
      model: signedIn ? (aiModels().ttsFish || aiModels().tts) : ownFish ? `fish-audio/${fish.model}` : config.model,
      defaultVoice: config.defaultVoice,
      // The studio voice through the service is experimental and opt-in per
      // browser (`X-AIRP-TTS-Local: 1`); an own local URL keeps it always on.
      // The browser lists it only when its local-TTS feature toggle is on too.
      experimentalLocal: Boolean(config.gateway && !localUrl),
      // AIRP_LOCAL_TTS=1 on this server: the studio voice settings are shown.
      localTts,
    });
  });

  /**
   * Synthesise one page of character dialogue.
   * Request body is validated by TtsRequestSchema; savePath is only a scope check,
   * never a world selector. Success/error bodies retain the existing TTS contract.
   */
  router.post('/tts', async (req, res) => {
    // Step 0 — per-request config.
    const config = readTtsConfig();

    // Step 1 — the caller's captured canonical root must still be active before
    // reading manifest/character data or consulting a world-local audio cache.
    const store = getActiveStore();
    if (!store) {
      return res.status(400).json({ ok: false, code: 'no_active_world', error: 'No active world' });
    }
    const requestedSavePath = (req.body as { savePath?: unknown } | null)?.savePath;
    if (typeof requestedSavePath !== 'string' || requestedSavePath !== store.worldRoot ||
      !isWorldRootCurrent(requestedSavePath)) {
      return worldChangedResponse(res);
    }
    const scopeIsCurrent = (): boolean =>
      getActiveStore() === store && store.worldRoot === requestedSavePath && isWorldRootCurrent(requestedSavePath);

    const parsed = TtsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, code: 'invalid_argument', error: 'invalid TTS request body' });
    }
    const {
      text: rawText,
      voice: rawVoice,
      language: rawLanguage,
      characterId,
      emotion: rawEmotion,
    } = parsed.data;
    if (rawText.trim() === '') {
      return res
        .status(400)
        .json({ ok: false, code: 'invalid_argument', error: 'text must be a non-empty string' });
    }

    // Step 3 — clean before truncation, hashing, cache lookup, and synthesis.
    // The helper is pure and idempotent; this server-side pass is mandatory even
    // when the browser already performed its preflight.
    const cleanedText = sanitiseTtsText(rawText);
    if (cleanedText === '') {
      return res
        .status(400)
        .json({ ok: false, code: 'invalid_argument', error: 'text must be a non-empty string' });
    }

    // Step 4 — truncate BEFORE hashing, so the cache key matches the text that
    // was actually sent. Truncation keeps the performance alive rather than
    // failing silently; `truncated` reaches the client.
    let text = cleanedText;
    let truncated = false;
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS);
      truncated = true;
    }

    // Step 5 — cast the voice by WORLD LANGUAGE × declared timbre
    //
    // The world's `locale` is the authority; the request's `language` only
    // stands in when the manifest cannot be read. A voice bound to another
    // language is re-cast on the same gender's nearest tone. A typo is still
    // not silently accepted: it plays on the default, and `check:voices` fails.
    let manifest: Awaited<ReturnType<LocalWorldStore['getManifest']>> | null = null;
    try { manifest = await store.getManifest(); } catch { /* legacy / half-written world */ }
    if (!scopeIsCurrent()) return worldChangedResponse(res);
    const worldLanguage: WorldLanguage = worldLanguageOf(
      (manifest as { locale?: unknown } | null)?.locale ?? rawLanguage
    );
    const defaultVoice =
      resolveVoiceFor(config.defaultVoice, worldLanguage) ?? resolveVoice(config.defaultVoice) ?? DEFAULTS.voice;
    const requestedVoice = typeof rawVoice === 'string' ? rawVoice.trim() : '';
    let voice = defaultVoice;
    if (requestedVoice !== '') {
      if (!VOICE_RE.test(requestedVoice)) {
        console.warn(
          `[AIRP TTS] reject malformed voice "${requestedVoice}"; falling back to "${config.defaultVoice}"`
        );
      } else {
        const cast = resolveVoiceFor(requestedVoice, worldLanguage);
        voice = cast ?? defaultVoice;
        if (cast === null) {
          console.warn(
            `[AIRP TTS] unknown voice "${requestedVoice}" (not in the palette, docs/tts/07); ` +
              `falling back to "${config.defaultVoice}"`
          );
        }
      }
    }

    // Step 6 — world locale short code → DashScope `language_type`.
    // The world's language wins over whatever the request says, so the voice and
    // the words agree. Without a readable manifest, the request's language.
    const languageType = manifest && (manifest as { locale?: unknown }).locale !== undefined
      ? LANGUAGE_MAP[worldLanguage]
      : typeof rawLanguage === 'string' ? (LANGUAGE_MAP[rawLanguage] ?? 'Auto') : 'Auto';

    // Character-local studio voice gets first refusal — but ONLY when it speaks
    // the world's language and matches the character's gender (`selectLocalVoice`).
    // There is no translation bridge any more: a Japanese studio voice in a
    // Chinese world used to read a Japanese translation of every line, which is
    // how Vera spoke Japanese in 雾坞镇 · 中文. Now that world
    // simply gets her online voice, in Chinese.
    // Without a local URL of our own, the Worldlines AI service carries the
    // studio voice (its `local-tts` model reaches the voice server over its tailnet).
    const local = readLocalTtsConfig();
    // That route is EXPERIMENTAL: only when
    // this browser opted in, and any failure plays the cloud voice below.
    const needsAccount = await ttsNeedsAccount(config);
    const accountGateway = await accountGatewayFor();
    // a trial guest (accountGatewayFor): a credits stop is the end of the trial — sign in, never 「redeem / top up」
    const guestGateway = accountGateway?.guest === true;
    const viaGateway = !local.baseUrl && req.get('x-airp-tts-local') === '1' && !needsAccount ? config.gateway : null;
    // Hidden by default: an own local URL counts only with the
    // feature on, so a stale AIRP_TTS_LOCAL_BASE_URL never routes a character.
    const ownLocal = Boolean(local.baseUrl) && localTtsEnabled(req.get('x-airp-tts-local'));
    if ((ownLocal || viaGateway) && typeof characterId === 'string' && manifest) {
      try {
        const registered = manifest.characters?.some(character => character.id === characterId);
        let declared: Record<string, unknown> = {};
        if (registered && /^[a-z0-9][a-z0-9-]*$/.test(characterId)) {
          try { declared = parseFrontmatter(await store.readFile(`characters/${characterId}/README.md`)).frontmatter ?? {}; } catch { /* legacy */ }
        }
        if (!scopeIsCurrent()) return worldChangedResponse(res);
        const selected = registered
          ? selectLocalVoice(manifest.id, characterId, worldLanguage, characterVoiceOf(declared))
          : null;
        if (selected) {
          const localConfig = { ...local, voice: selected, ...(viaGateway ? { baseUrl: `${viaGateway.base}#${aiModels().ttsLocal}` } : {}) };
          const emotion = localTtsEmotion(rawEmotion);
          const localFile = `${localTtsHash(localConfig, text, worldLanguage, emotion)}.wav`;
          const localAbs = path.join(store.worldRoot, '.airpworld', 'tts-cache', localFile);
          const cached = existsSync(localAbs);
          if (!cached) {
            const wav = viaGateway
              ? await synthesiseViaGateway({ gateway: viaGateway, model: aiModels().ttsLocal, text, voice: selected, language: worldLanguage, emotion, timeoutMs: local.timeoutMs })
              : await synthesiseLocal(localConfig, text, worldLanguage, emotion);
            if (!scopeIsCurrent()) return worldChangedResponse(res);
            await writeCacheAtomic(localAbs, wav);
            if (!scopeIsCurrent()) return worldChangedResponse(res);
          }
          return res.json({ ok: true, url: `/api/tts/audio/${localFile}`, cached, characters: text.length, truncated });
        }
      } catch (error) {
        if (!scopeIsCurrent()) return worldChangedResponse(res);
        // A quota stop is the account's, not the voice server's: the online
        // voice would be refused the same way.
        if (error instanceof AiQuotaError) return viaGateway && guestGateway ? res.status(401).json(requiresAccountBody('guest_credits')) : res.status(quotaStatus(error)).json(quotaBody(error));
        const reason = error instanceof LocalTtsError ? error.message : error instanceof Error ? error.name : 'Error';
        console.warn(`[AIRP TTS] Local character TTS failed (${reason}); falling back to online TTS.`);
        res.setHeader('X-AIRP-TTS-Fallback', 'local-to-online');
      }
    }

    // Step 6b — which voice, which provider: worldlines-play decides. POST play /v1/voice/cast with the
    // signed-in account's token → ordered candidates { provider, voiceId } (manual voice → pinned auto-cast → same cell →
    // other provider → the language's fallbacks; native speakers only). No voice ids are taken from this repo's roster
    // snapshot any more. play cannot be asked (signed out / unreachable) → its last answer (play-voice.ts cache) → the
    // built-in fallback table (builtin-voices.ts). X-AIRP-Voice-Source says which: play | cache | builtin.
    //   Route: signed in to a Worldlines account → the AI service, whatever keys are local (the player needs no TTS
    //   key); otherwise an own Fish key (FISH_AUDIO_API_KEY / FISH_API_KEY) and/or own DashScope key; otherwise the
    //   service the old way (it asks for an account). Only providers reachable on that route are asked for.
    //   Candidates are tried in order; one that fails right now (402 / 5xx / timeout / network) gives way to the next
    //   (a Fish failure answered by qwen is marked X-AIRP-TTS-Fallback: fish-to-qwen). A quota stop ends it.
    const fish = readFishTtsConfig();
    const fishKey = ttsProviderOf() === 'fish' && Boolean(fish.apiKey);
    const useGateway = accountGateway ?? (!config.apiKey && !fishKey ? config.gateway : null);
    const gatewayFishModel = useGateway ? aiModels().ttsFish : '';
    const qwenGatewayModel = isFishGatewayModel(aiModels().tts) ? DEFAULTS.model : aiModels().tts;
    const reach = {
      fish: useGateway ? Boolean(gatewayFishModel) : fishKey,
      dashscope: useGateway ? true : Boolean(config.apiKey),
    };
    let profile: RosterProfile = {};
    let character: string | undefined;
    let description = '';
    if (typeof characterId === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(characterId) && manifest) {
      const row = manifest.characters?.find(c => c.id === characterId) as { description?: unknown } | undefined;
      if (row) {
        let declaredGender: unknown;
        try { declaredGender = parseFrontmatter(await store.readFile(`characters/${characterId}/README.md`)).frontmatter?.gender; } catch { /* legacy */ }
        if (!scopeIsCurrent()) return worldChangedResponse(res);
        character = characterId;
        description = typeof row.description === 'string' ? row.description : '';
        profile = inferVoiceProfile(description, declaredGender);
      }
    }
    // the author's declared voice tells sex × age where the text does not (wise-elder = an old man)
    const aliasOf = (n: string) => voiceEntry(n)?.alias ?? voiceEntry(LOCAL_VOICE_HOSTED_FALLBACK[n] ?? '')?.alias ?? n;
    const descriptor = requestedVoice ? ALIAS_DESCRIPTORS[aliasOf(requestedVoice)] : undefined;
    profile = { ...profile, gender: profile.gender ?? descriptor?.gender, age: profile.age ?? descriptor?.age };
    // the language to cast in: the world's; unknown (no manifest locale, no usable request language → `Auto`) = zh, the
    // language of the default voice (Cherry) — never a guess at English
    const castLanguage: WorldLanguage = languageType === 'Auto' ? 'zh' : worldLanguage;
    const providers = (['fish', 'dashscope'] as const).filter(p => reach[p]);
    // nothing reachable: still look the line up in the cache under the qwen model, then answer tts_unconfigured below
    const castProviders: ('fish' | 'dashscope')[] = providers.length ? [...providers] : ['dashscope'];
    let source: 'play' | 'cache' | 'builtin' = 'builtin';
    let candidates: { provider: 'fish' | 'dashscope'; voiceId: string }[] = [];
    if (character && manifest?.id) {
      const asked = await castFromPlay(
        { family: String(manifest.id).replace(/-(?:zh|jp|ja|ko|en)$/, ''), character, lang: castLanguage, ...(description ? { description } : {}), traits: { ...(profile.gender ? { gender: profile.gender } : {}), ...(profile.age ? { age: profile.age } : {}) }, providers: castProviders },
        accountGateway && !guestGateway ? await accountAccessToken() : null,
      );
      if (!scopeIsCurrent()) return worldChangedResponse(res);
      if (asked.source !== 'none') {
        candidates = asked.candidates.flatMap(c => (castProviders as string[]).includes(c.provider) ? [{ provider: c.provider as 'fish' | 'dashscope', voiceId: c.voiceId }] : []);
        if (candidates.length) source = asked.source;
      }
    }
    if (!candidates.length) {
      // the team's assigned voice for this character (builtin-voices.ts BUILTIN_ASSIGNED) on a Fish route; else
      // the author's own voice (as written, or as the palette resolved it) — never the configured default standing in
      const declared = (requestedVoice ? [requestedVoice, voice] : []).find(d => d && builtinCandidates({ providers: castProviders, lang: castLanguage, gender: profile.gender, age: profile.age, declared: d }).some(c => c.voiceId === d));
      candidates = builtinCandidates({ providers: castProviders, lang: castLanguage, gender: profile.gender, age: profile.age, declared, declaredFirst: declared === requestedVoice, ...(character && manifest?.id ? { family: worldFamilyOf(manifest.id), character } : {}) }).map(c => ({ provider: c.provider as 'fish' | 'dashscope', voiceId: c.voiceId }));
      source = 'builtin';
    }
    if (!candidates.length) {
      // qwen speaks only its own language and there is no native voice of this sex on any reachable provider
      console.warn(`[AIRP TTS] no ${castLanguage} voice for this character on the reachable providers (${castProviders.join(', ')}); refusing.`);
      return res.status(503).json({ ok: false, code: 'tts_voice_unavailable', reason: 'no_native_voice', error: `No ${castLanguage} voice is available for this character here.` });
    }
    res.setHeader('X-AIRP-Voice-Source', source);

    // Step 7 — per candidate: cache lookup (`existsSync` is enough: atomic writes guarantee "present ⇒ complete"),
    // else synthesise; the cache key is always the voice actually spoken, and a failed attempt writes nothing.
    const cacheDir = path.join(store.worldRoot, '.airpworld', 'tts-cache');
    const plan = (c: { provider: 'fish' | 'dashscope'; voiceId: string }) => {
      const ownFish = c.provider === 'fish' && !useGateway;
      const gatewayFish = c.provider === 'fish' && Boolean(useGateway);
      const model = ownFish ? `fish-audio/${fish.model}` : gatewayFish ? gatewayFishModel : useGateway ? qwenGatewayModel : config.model;
      const instructions = c.provider === 'fish' ? '' : deliveryInstructions(model, c.voiceId);
      const file = `${hashOf(model, c.voiceId, languageType, text, instructions)}.wav`;
      return { ...c, ownFish, gatewayFish, model, instructions, file, abs: path.join(cacheDir, file) };
    };
    const tries = candidates.slice(0, 3).map(plan);
    let file = tries[0]!.file;
    let abs = tries[0]!.abs;
    let wav: Buffer | undefined;
    let lastErr: unknown;
    let fishFailed = false;
    for (const [i, t] of tries.entries()) {
      if (!scopeIsCurrent()) return worldChangedResponse(res);
      if (existsSync(t.abs)) {
        if (fishFailed && t.provider === 'dashscope') res.setHeader('X-AIRP-TTS-Fallback', 'fish-to-qwen');
        return res.json({ ok: true, url: `/api/tts/audio/${t.file}`, cached: true, characters: text.length, truncated });
      }
      if (i === 0) {
        // Step 8 — key check comes AFTER the first cache probe on purpose: an already synthesised page keeps playing
        // even if the key was withdrawn.
        if (!t.ownFish && !useGateway && !config.apiKey && !config.gateway) {
          console.warn('[AIRP TTS] Online TTS unavailable: neither FISH_AUDIO_API_KEY nor DASHSCOPE_API_KEY is set.');
          return res.status(503).json({ ok: false, code: 'tts_unconfigured', error: 'DASHSCOPE_API_KEY is not set' });
        }
        if (needsAccount && !t.ownFish && !accountGateway) {
          return res.status(401).json(requiresAccountBody());
        }
      }
      try {
        wav = t.ownFish
          ? await synthesiseFish({ text, referenceId: t.voiceId, config: fish })
          : !useGateway
          ? await synthesise({ text, voice: t.voiceId, languageType, apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model, timeoutMs: config.timeoutMs })
          : await synthesiseViaGateway({
            gateway: useGateway, model: t.model, text, voice: t.voiceId, language: languageType, instructions: t.instructions, timeoutMs: config.timeoutMs,
            onProviderFallback: (detail) => {
              console.warn(`[AIRP TTS] The AI service fell back to another voice provider (${detail}).`);
              res.setHeader('X-AIRP-TTS-Fallback', 'provider');
            },
          });
        file = t.file;
        abs = t.abs;
        if (fishFailed && t.provider === 'dashscope') res.setHeader('X-AIRP-TTS-Fallback', 'fish-to-qwen');
        break;
      } catch (err) {
        if (!scopeIsCurrent()) return worldChangedResponse(res);
        if (err instanceof AiQuotaError && guestGateway) {
          console.warn('[AIRP TTS] Guest voice stopped: the trial credits are used up (sign in).');
          return res.status(401).json(requiresAccountBody('guest_credits'));
        }
        if (err instanceof AiQuotaError) {
          console.warn('[AIRP TTS] Online TTS stopped: the Worldlines plan quota is used up.');
          return res.status(quotaStatus(err)).json(quotaBody(err));
        }
        // the service refusing the caller is not this voice's fault: the next one would be refused the same way
        if (isAccountRefusal(err)) { lastErr = err; break; }
        lastErr = err;
        if (t.provider === 'fish') fishFailed = true;
        const reason = err instanceof FishTtsError || err instanceof Error ? err.message : String(err);
        if (i + 1 < tries.length) console.warn(`[AIRP TTS] ${t.provider} voice failed (${reason}); trying the next candidate.`);
      }
    }
    if (!wav) {
      const err = lastErr;
      const mapped: ReturnType<typeof mapSynthError> = err instanceof FishTtsError
        ? err.kind === 'timeout'
          ? { status: 504, code: 'tts_timeout', error: err.message }
          : { status: 502, code: 'tts_upstream', error: err.message }
        : mapSynthError(err);
      // The reason ("DashScope HTTP 429", a timeout…) carries no key or URL.
      console.warn(`[AIRP TTS] Online TTS failed (${mapped.code}: ${mapped.error}).`);
      return res.status(mapped.status).json({ ok: false, code: mapped.code, error: mapped.error, ...(mapped.reason ? { reason: mapped.reason } : {}) });
    }
    if (!scopeIsCurrent()) return worldChangedResponse(res);
    try {
      await writeCacheAtomic(abs, wav);
      if (!scopeIsCurrent()) return worldChangedResponse(res);
    } catch (err) {
      if (!scopeIsCurrent()) return worldChangedResponse(res);
      // Synthesis succeeded but did not land — the next request re-synthesises
      // the same hash, so this is idempotent and safe.
      console.warn(
        `[AIRP TTS] failed to cache ${file} in ${path.relative(repoRoot, cacheDir) || cacheDir}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return res.status(500).json({
        ok: false,
        code: 'internal',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Step 8 — the frozen five-field success body.
    return res.json({
      ok: true,
      url: `/api/tts/audio/${file}`,
      cached: false,
      characters: text.length,
      truncated,
    });
  });

  /**
   * Serve one cached wav. Content-addressed ⇒ immutable ⇒ a year-long cache.
   * The name shape is checked FIRST (it subsumes any `..` attempt), then the
   * `/api/audio` triple belt: resolve + prefix check + symlink re-check
   *.
   */
  router.get('/tts/audio/:file', (req, res) => {
    const notFound = (status: number, error: string) =>
      res.status(status).json({ ok: false, code: 'not_found', error });

    const store = getActiveStore();
    if (!store) return notFound(404, 'No active world');

    const file = String(req.params.file ?? '');
    if (!FILE_RE.test(file)) return notFound(403, 'invalid audio file name');

    const cacheDir = path.join(store.worldRoot, '.airpworld', 'tts-cache');
    try {
      const abs = path.resolve(cacheDir, file);
      if (!abs.startsWith(cacheDir + path.sep)) {
        return notFound(403, 'path escapes tts cache root');
      }
      // `realpathSync` throws when the file is missing, which the catch turns
      // into the 404 the client expects.
      const real = realpathSync(abs);
      if (!real.startsWith(realpathSync(cacheDir) + path.sep)) {
        return notFound(403, 'path escapes tts cache root (symlink)');
      }
      res.sendFile(abs, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }, (err) => {
        if (err && !res.headersSent) notFound(404, err.message);
      });
    } catch (err) {
      notFound(404, err instanceof Error ? err.message : String(err));
    }
  });

  return router;
}
