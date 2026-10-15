import { z } from 'zod';

/**
 * Realtime-call transport shapes.
 *
 * The nook call is the third voice channel: a browser WebRTC media session
 * against `gpt-live-1`, whose delegated backend is the existing pi-rp
 * character agent. These schemas cover only the HTTP seam — the SDP is opaque
 * to us (the server forwards it verbatim to OpenAI) and `sessionId` is opaque
 * in the other direction.
 */

/** The languages the call front-end is primed for (same domain as TTS; Korean joined 2026-10-03). */
export const LIVE_LANGUAGES = ['en', 'ja', 'ko'] as const;
export type LiveLanguage = (typeof LIVE_LANGUAGES)[number];

/**
 * `POST /api/live/session`. `sdp` is the browser's raw SDP offer; we never
 * parse it. `language` primes the voice front-end's output language and
 * defaults to `en` server-side. `savePath` is the exact root captured when the
 * UI started this call; it is never inferred from the currently selected save.
 */
export const LiveSessionInputSchema = z.object({
  character: z.string().min(1),
  sdp: z.string().min(1),
  language: z.enum(LIVE_LANGUAGES).optional(),
  savePath: z.string().min(1).max(4096),
}).strict();
export type LiveSessionInput = z.infer<typeof LiveSessionInputSchema>;

/**
 * `POST /api/live/close`. Keyed by `character` and the captured `savePath`,
 * not `sessionId`: a character has at most one live call, so the character id
 * is stable while the OpenAI session id stays opaque and server-owned.
 */
export const LiveCloseInputSchema = z.object({
  character: z.string().min(1),
  savePath: z.string().min(1).max(4096),
}).strict();
export type LiveCloseInput = z.infer<typeof LiveCloseInputSchema>;
