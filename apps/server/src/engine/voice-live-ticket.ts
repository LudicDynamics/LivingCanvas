import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { VoiceLiveCast } from './voice-live-cast.js';
import { voiceLiveSessionUrl } from './voice-live-cast.js';
import { GATEWAY_WORLD_ID, WORLD_HEADER } from '../gateway-world.js';

/**
 * A call ticket: how the BROWSER gets onto ai.worldlines.gg's voice channel
 * without ever holding a credential.
 *
 *   browser ──POST /api/live/voice-live/ticket──▶ this server (or the seat, via the gateway)
 *           ◀── { mode: 'direct', url, protocols } ──  we asked ai with the account's token
 *   browser ──wss url, Sec-WebSocket-Protocol: protocols──▶ ai.worldlines.gg /v1/voice/live
 *                                                           ──tailnet + shared key──▶ voice-live
 *
 * The page's JavaScript never sees the account token (hosted: an HttpOnly
 * cookie at the seat gateway; local: this server's own session), so the
 * exchange is done server-side on the page's behalf, and only the ticket —
 * one use, a minute long, bound to that account — reaches the page. The
 * ticket rides `Sec-WebSocket-Protocol`, never the URL, so it stays out of
 * access logs.
 *
 * ai's side of the contract (proposed; this file is the only place it lives):
 *   POST {VOICE_LIVE_TICKETS_URL}            Authorization: Bearer <account token>
 *                                            X-Worldlines-Product: livingcanvas
 *   → 201 { ticket, url, expires_in, remaining_seconds? }   url = wss://…/v1/voice/live
 *   → 4xx { error: { code, message, billing_url?, resets_at? } }   402 / 429 when out of minutes
 *   WS  url?character=…&voice=…&language=…&brain=relay
 *       Sec-WebSocket-Protocol: worldlines.voice.v1, ticket.<ticket>
 *
 * No `VOICE_LIVE_TICKETS_URL` → `{ mode: 'proxy' }` and the page uses
 * `/ws/voice-live` through this server, as before.
 */

export const VOICE_PROTOCOL = 'worldlines.voice.v1';

/** Hosted: the seat gateway hands the account's access token to the seat for this one route. */
export const ACCESS_TOKEN_HEADER = 'x-airp-access-token';
export const SEAT_SECRET_HEADER = 'x-airp-seat-secret';

export type VoiceTicketAnswer =
  | { mode: 'proxy' }
  | { mode: 'direct'; url: string; protocols: string[]; expiresIn: number; remainingSeconds?: number }
  | { mode: 'error'; status: number; code: string; message: string; billingUrl?: string; resetsAt?: string };

export function voiceTicketsUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.VOICE_LIVE_TICKETS_URL ?? '').trim();
}

/**
 * The access token the gateway vouched for on this request, or null. Trusted
 * only together with the seats' own secret (`AIRP_SEAT_ACCESS_SECRET` — not the
 * sync one: a seat runs agents and must never be able to speak for the gateway
 * to sync), never from a client on its own.
 */
export function gatewayAccessToken(req: Pick<Request, 'headers'>, env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = (env.AIRP_SEAT_ACCESS_SECRET ?? '').trim();
  const sent = req.headers[SEAT_SECRET_HEADER];
  const token = req.headers[ACCESS_TOKEN_HEADER];
  if (secret.length < 16 || typeof sent !== 'string' || typeof token !== 'string' || !token) return null;
  const a = Buffer.from(sent);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b) ? token : null;
}

const TICKET = /^[A-Za-z0-9_-]{16,512}$/;

/** Ask ai for a ticket; never throws (a failure is an answer the page can show). */
export async function requestVoiceTicket(input: {
  ticketsUrl: string;
  accessToken: string;
  cast: VoiceLiveCast;
  product?: string;
  /** The open world (gateway-world.ts): billing counts the call under it. */
  world?: string | null;
  request?: typeof fetch;
}): Promise<VoiceTicketAnswer> {
  const request = input.request ?? fetch;
  let response: Response;
  try {
    response = await request(input.ticketsUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        'x-worldlines-product': input.product ?? 'livingcanvas',
        'content-type': 'application/json',
        accept: 'application/json',
        ...(input.world && GATEWAY_WORLD_ID.test(input.world) ? { [WORLD_HEADER]: input.world } : {}),
      },
      body: JSON.stringify({ character: input.cast.character ?? null }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { mode: 'error', status: 502, code: 'ticket_unreachable', message: 'The voice service could not be reached.' };
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = (body?.error ?? {}) as { code?: unknown; message?: unknown; billing_url?: unknown; resets_at?: unknown };
    // Kept for the page: where to get more minutes, and when this month's come back.
    const billingUrl = typeof error.billing_url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(error.billing_url) ? error.billing_url : undefined;
    const resetsAt = typeof error.resets_at === 'string' && !Number.isNaN(Date.parse(error.resets_at)) ? error.resets_at : undefined;
    return {
      mode: 'error',
      ...(billingUrl ? { billingUrl } : {}),
      ...(resetsAt ? { resetsAt } : {}),
      // The account's own refusals (signed out, no minutes left, too many calls) are the player's to see.
      status: [401, 402, 403, 429].includes(response.status) ? response.status : 502,
      code: typeof error.code === 'string' ? error.code : 'ticket_refused',
      message: typeof error.message === 'string' ? error.message : `The voice service answered HTTP ${response.status}.`,
    };
  }
  const ticket = typeof body?.ticket === 'string' ? body.ticket : '';
  const url = typeof body?.url === 'string' ? body.url : '';
  if (!TICKET.test(ticket) || !/^wss:\/\/[^/]+\/./.test(url)) {
    return { mode: 'error', status: 502, code: 'ticket_malformed', message: 'The voice service gave an unusable ticket.' };
  }
  return {
    mode: 'direct',
    url: voiceLiveSessionUrl(url, input.cast, { relayBrain: true }),
    protocols: [VOICE_PROTOCOL, `ticket.${ticket}`],
    expiresIn: typeof body?.expires_in === 'number' ? body.expires_in : 60,
    ...(typeof body?.remaining_seconds === 'number' ? { remainingSeconds: body.remaining_seconds } : {}),
  };
}
