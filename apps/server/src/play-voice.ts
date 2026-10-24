import fs from 'node:fs';
import path from 'node:path';
import { remoteConfigFile } from './sync/remote-client.js';

/**
 * Which voice a character speaks with comes from worldlines-play (play.worldlines.gg): play matches, pins
 * and falls back; this repo no longer bundles voice ids for that (the roster snapshot stays in the tree but TTS does not
 * read it). POST /v1/voice/cast → ordered candidates; the caller tries them in order.
 *
 * - Sent with the signed-in account's own token (the ai-gateway token hook). Signed out → play is not asked.
 * - Every answer is kept in memory and on disk (`play-voice-cache.json` beside remote.json, or AIRP_PLAY_CACHE): when play
 *   cannot be reached, the last answer for the same question is used.
 * - Neither → the caller uses its built-in fallback (builtin-voices.ts). Order: play → cache → builtin.
 * AIRP_PLAY_URL (default https://play.worldlines.gg; `off` = never ask, e.g. offline builds and tests).
 *
 * A line must not wait on a play that is not there: one request gets 1.5 s; any failure (DNS, connect,
 * timeout, 5xx) marks play "unavailable" for 5 minutes, process-wide and in memory only — meanwhile no request is sent at
 * all (cache / built-in answer at once); after the 5 minutes ONE request probes, the rest keep going without it until the
 * probe answers. Concurrent asks for the same question share one request (in-flight de-duplication).
 */

export const DEFAULT_PLAY_URL = 'https://play.worldlines.gg';
export const PLAY_PRODUCT = 'livingcanvas';
export const PLAY_TIMEOUT_MS = 1500;
export const PLAY_DOWN_MS = 5 * 60_000;

let clock: () => number = () => Date.now();
/** When play may be asked again (0 = up). */
let downUntil = 0;
let probing = false;
const inflight = new Map<string, Promise<PlayCastResult>>();

export interface PlayCandidate { provider: string; voiceId: string; title?: string; via: string }
export interface PlayCastQuery {
  family: string;
  character: string;
  lang: string;
  description?: string;
  traits?: { gender?: string; age?: string; tags?: string[] };
  providers: string[];
}
export type PlayCastResult =
  | { source: 'play' | 'cache'; candidates: PlayCandidate[] }
  | { source: 'none'; reason: 'sign_in_required' | 'play_unreachable' | 'play_off' };

export function playUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.AIRP_PLAY_URL ?? '').trim();
  if (/^(off|none|0|false)$/i.test(raw)) return null;
  return (raw || DEFAULT_PLAY_URL).replace(/\/+$/, '');
}

function cacheFile(env: NodeJS.ProcessEnv = process.env): string {
  return (env.AIRP_PLAY_CACHE ?? '').trim() || path.join(path.dirname(remoteConfigFile()), 'play-voice-cache.json');
}

const memory = new Map<string, PlayCandidate[]>();
let loadedFrom: string | null = null;

function keyOf(q: PlayCastQuery): string {
  return [PLAY_PRODUCT, q.family, q.character, q.lang, [...q.providers].join(','), q.description ?? '', JSON.stringify(q.traits ?? {})].join('\u0000');
}

function loadDisk(file: string) {
  if (loadedFrom === file) return;
  loadedFrom = file;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: Record<string, PlayCandidate[]> };
    for (const [k, v] of Object.entries(raw.entries ?? {})) if (Array.isArray(v) && !memory.has(k)) memory.set(k, v);
  } catch { /* no cache yet */ }
}

function saveDisk(file: string) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ schema: 'airp.play-voice-cache/1', entries: Object.fromEntries(memory) }) + '\n');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.warn(`[AIRP TTS] could not keep play's voice answer on disk: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Tests: forget the in-memory cache and the "unavailable" mark (the disk file is the test's own temp path). */
export function resetPlayVoiceCache() {
  memory.clear();
  loadedFrom = null;
  downUntil = 0;
  probing = false;
  inflight.clear();
  clock = () => Date.now();
}

/** Tests: the clock the 5-minute "unavailable" mark is measured with. */
export function setPlayVoiceClock(now: () => number) {
  clock = now;
}

/** Is play marked unavailable right now? (Past the 5 minutes, the first caller becomes the probe.) */
function skipPlay(): boolean {
  if (!downUntil) return false;
  if (clock() < downUntil || probing) return true;
  probing = true;
  return false;
}
function markDown(why: string) {
  if (!downUntil || probing) console.warn(`[AIRP TTS] play unavailable (${why}); not asking it for ${PLAY_DOWN_MS / 60_000} minutes.`);
  downUntil = clock() + PLAY_DOWN_MS;
  probing = false;
}
function markUp() {
  downUntil = 0;
  probing = false;
}

const okCandidate = (c: unknown): c is PlayCandidate =>
  typeof c === 'object' && c !== null && typeof (c as PlayCandidate).provider === 'string' && typeof (c as PlayCandidate).voiceId === 'string' && (c as PlayCandidate).voiceId.length <= 128;

/**
 * Ask play for the candidates. `token` = the signed-in account's access token (null = signed out).
 * Never throws: a network error, a timeout, a non-2xx or a malformed body all count as "unreachable".
 */
export async function castFromPlay(q: PlayCastQuery, token: string | null, request: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<PlayCastResult> {
  const base = playUrl(env);
  const file = cacheFile(env);
  loadDisk(file);
  const key = keyOf(q);
  const cached = (reason: 'sign_in_required' | 'play_unreachable' | 'play_off'): PlayCastResult => {
    const hit = memory.get(key);
    return hit ? { source: 'cache', candidates: hit } : { source: 'none', reason };
  };
  if (!base) return cached('play_off');
  if (!token) return cached('sign_in_required');
  const shared = inflight.get(key);
  if (shared) return shared.then((r) => (r.source === 'none' ? cached(r.reason) : r));
  if (skipPlay()) return cached('play_unreachable');
  const ask = askPlay(base, q, token, key, file, request, cached);
  inflight.set(key, ask);
  try {
    return await ask;
  } finally {
    inflight.delete(key);
  }
}

async function askPlay(base: string, q: PlayCastQuery, token: string, key: string, file: string, request: typeof fetch, cached: (reason: 'play_unreachable') => PlayCastResult): Promise<PlayCastResult> {
  try {
    const res = await request(`${base}/v1/voice/cast`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-worldlines-product': PLAY_PRODUCT },
      body: JSON.stringify({ product: PLAY_PRODUCT, ...q }),
      redirect: 'error',
      signal: AbortSignal.timeout(PLAY_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      // 5xx = play is not working; a 4xx (a refused token, a bad question) is about this request, not play's health
      if (res.status >= 500) markDown(`HTTP ${res.status}`);
      else {
        markUp();
        console.warn(`[AIRP TTS] play voice cast: HTTP ${res.status}`);
      }
      return cached('play_unreachable');
    }
    const body = (await res.json()) as { candidates?: unknown };
    markUp();
    if (!Array.isArray(body.candidates)) return cached('play_unreachable');
    const candidates = body.candidates.filter(okCandidate).map((c) => ({ provider: c.provider, voiceId: c.voiceId, via: String(c.via ?? ''), ...(typeof c.title === 'string' ? { title: c.title } : {}) }));
    memory.set(key, candidates);
    saveDisk(file);
    return { source: 'play', candidates };
  } catch (err) {
    markDown(err instanceof Error ? (err.cause as { code?: string } | undefined)?.code ?? err.name : String(err));
    return cached('play_unreachable');
  }
}
