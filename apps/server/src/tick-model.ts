/**
 * Character tick v2 — the model behind 「角色自己说话」.
 *
 * One cheap call per intent / chatter beat, on the same text model as the server's other small jobs:
 * an own DeepSeek key, else the Worldlines AI service — the signed-in account, or the trial guest
 * (`readAiGateway(…, { guest: true })`). The engine (packages/shared actions/tick.ts) only ever sees a
 * `TickModelRunner`: give it a request, get the raw answer back or null. Null is always fine: the beat
 * goes on by the v1 rules and the player sees no difference.
 *
 *   - Prefetch: the page says a beat has started (`POST /api/tick/prefetch`, the player's input just
 *     arrived); the route asks the engine what the next beat would need and `startTickPrefetch` fires it
 *     while the writer answers. The beat (`POST /api/turn-end`) takes it when the key still matches and
 *     waits at most `TICK_WAIT_MS` more (and never past `TICK_CALL_MS` since it started); a late answer
 *     is dropped and the request aborted.
 *   - Quiet: tick calls carry `x-airp-quiet: 1` — the browser runtime's gateway fetch then never opens
 *     the sign-in panel for them (a guest outside the trial world, a wallet that is empty); the header is
 *     not forwarded. A refusal (401 / 402 / 403 / 429 / 503) stops tick calls for this save for
 *     `TICK_REFUSED_MS`.
 *   - Tier: `guest` when the call would ride on the trial guest's token, else `registered` (an own key
 *     counts as registered): it picks the per-run cap (`tick.modelCap`).
 *   - Stub (`AIRP_TICK_MODEL_STUB=1`): no network; picks the first offered option and speaks one of the
 *     person's own `voice` samples. For screenshots and local checks only — never in production.
 */
import type { TickModelReply, TickModelRequest, TickModelRunner } from '@airp/shared';
import { tickCallCredits } from '@airp/shared';
import { accountSignedIn, gatewayFetch, readAiGateway } from './ai-gateway.js';

/** After the beat ends, wait at most this long for the answer. */
export const TICK_WAIT_MS = 2000;
/** A call never runs longer than this from when it was sent. */
export const TICK_CALL_MS = 6000;
/** After the service refused, no tick calls for this save for this long. */
export const TICK_REFUSED_MS = 10 * 60_000;
export const QUIET_HEADER = 'x-airp-quiet';

interface Endpoint {
  baseUrl: string;
  apiKey: string;
  request: typeof fetch;
  tier: 'registered' | 'guest';
}

function endpointOf(env: NodeJS.ProcessEnv, request: typeof fetch): Endpoint | null {
  const own = env.DEEPSEEK_API_KEY?.trim() ?? '';
  if (own) return { baseUrl: (env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com').replace(/\/+$/, ''), apiKey: own, request, tier: 'registered' };
  const gateway = readAiGateway(env, { guest: true });
  if (!gateway) return null;
  const tier: 'registered' | 'guest' = gateway.account && !accountSignedIn() ? 'guest' : 'registered';
  return { baseUrl: gateway.base, apiKey: gateway.apiKey, request: (url, init) => gatewayFetch(gateway, String(url), init, request), tier };
}

interface Prefetch {
  key: string;
  started: number;
  controller: AbortController;
  reply: Promise<TickModelReply | null>;
}

const prefetches = new Map<string, Prefetch>();
const refused = new Map<string, number>();

/** The prefetch / beat key without the option list: the beat re-checks the answer against its own options. */
const matchKey = (key: string) => key.split(':').slice(0, -1).join(':');

/** Pure: the stub's answer — the first option, one of the person's own voice samples. */
export function stubTickAnswer(req: TickModelRequest): string {
  const options = [...req.user.matchAll(/^- ([a-z0-9][a-z0-9-]*) \[([a-z]+)/gm)].map((m) => ({ id: m[1], verb: m[2] }));
  const voice = /How you talk: (.+)$/m.exec(req.user)?.[1] ?? '';
  const samples = [...voice.matchAll(/「([^」]+)」/g)].map((m) => m[1]);
  const pick = options[0];
  const line = samples.length ? samples[(req.key.length + (pick?.id.length ?? 0)) % samples.length] : null;
  return JSON.stringify({
    move: pick?.id ?? '',
    say: pick && pick.verb !== 'invite' && pick.verb !== 'note' ? line : null,
    invite: pick?.verb === 'invite' ? line : null,
    note: pick?.verb === 'note' && line ? { title: '', body: line } : null,
    mood: 'dots',
  });
}

async function call(endpoint: Endpoint, req: TickModelRequest, signal: AbortSignal, env: NodeJS.ProcessEnv): Promise<{ reply: TickModelReply | null; refused: boolean }> {
  const model = env.AIRP_TICK_MODEL?.trim() || 'deepseek-v4-flash';
  let res: Response;
  try {
    res = await endpoint.request(`${endpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.apiKey}`, [QUIET_HEADER]: '1' },
      body: JSON.stringify({
        model,
        thinking: { type: 'disabled' },
        temperature: 0.8,
        max_tokens: req.maxTokens,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
      }),
      signal,
    });
  } catch {
    return { reply: null, refused: false };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { reply: null, refused: [401, 402, 403, 429, 503].includes(res.status) };
  }
  const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[]; usage?: unknown } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return { reply: null, refused: false };
  return { reply: { content, credits: tickCallCredits(data?.usage) }, refused: false };
}

function send(worldRoot: string, endpoint: Endpoint, req: TickModelRequest, env: NodeJS.ProcessEnv, stub: boolean): Prefetch {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TICK_CALL_MS);
  const reply = stub
    ? Promise.resolve<TickModelReply | null>({ content: stubTickAnswer(req), credits: 1.2 })
    : call(endpoint, req, controller.signal, env).then((r) => {
        if (r.refused) refused.set(worldRoot, Date.now() + TICK_REFUSED_MS);
        return r.reply;
      });
  void reply.finally(() => clearTimeout(timer));
  return { key: req.key, started: Date.now(), controller, reply };
}

const withDeadline = <T>(p: Promise<T | null>, ms: number, onLate: () => void): Promise<T | null> =>
  new Promise((resolve) => {
    if (ms <= 0) {
      onLate();
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      onLate();
      resolve(null);
    }, ms);
    p.then((v) => {
      clearTimeout(timer);
      resolve(v);
    }, () => {
      clearTimeout(timer);
      resolve(null);
    });
  });

export interface TickModelHost {
  /** The runner for this save's beat, or null (no model here, or the service refused lately). */
  runner(worldRoot: string): TickModelRunner | null;
  /** The tier a call would be billed to now (for the prefetch's cap check), or null. */
  tier(): 'registered' | 'guest' | null;
  /** Fire the next beat's call now (replaces an older prefetch for this save). */
  prefetch(worldRoot: string, req: TickModelRequest): boolean;
}

export function createTickModelHost(env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch): TickModelHost {
  const stub = (env.AIRP_TICK_MODEL_STUB ?? '').trim() === '1';
  const endpoint = (): Endpoint | null => (stub ? { baseUrl: 'stub', apiKey: 'stub', request, tier: 'registered' } : endpointOf(env, request));
  const blocked = (worldRoot: string) => (refused.get(worldRoot) ?? 0) > Date.now();
  return {
    tier: () => endpoint()?.tier ?? null,
    prefetch(worldRoot, req) {
      const ep = endpoint();
      if (!ep || blocked(worldRoot)) return false;
      const old = prefetches.get(worldRoot);
      if (old && old.key === req.key) return true;
      old?.controller.abort();
      prefetches.set(worldRoot, send(worldRoot, ep, req, env, stub));
      return true;
    },
    runner(worldRoot) {
      const ep = endpoint();
      if (!ep || blocked(worldRoot)) return null;
      return {
        tier: ep.tier,
        answer: async (req) => {
          const pre = prefetches.get(worldRoot);
          prefetches.delete(worldRoot);
          if (pre && matchKey(pre.key) === matchKey(req.key)) {
            const left = Math.min(TICK_WAIT_MS, TICK_CALL_MS - (Date.now() - pre.started));
            return withDeadline(pre.reply, left, () => pre.controller.abort());
          }
          pre?.controller.abort();
          const fresh = send(worldRoot, ep, req, env, stub);
          return withDeadline(fresh.reply, TICK_WAIT_MS, () => fresh.controller.abort());
        },
      };
    },
  };
}

/** Tests: forget prefetches and refusals. */
export function resetTickModelHost(): void {
  for (const p of prefetches.values()) p.controller.abort();
  prefetches.clear();
  refused.clear();
}
