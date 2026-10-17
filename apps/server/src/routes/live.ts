import { Router } from 'express';
import {
  LiveCloseInputSchema,
  LiveSessionInputSchema,
  isValidCharacterId,
  nookIdOf,
  parseFrontmatter,
  resolveLiveVoice,
  type LocalWorldStore,
  type LiveLanguage,
  characterVoiceOf,
} from '@airp/shared';
import {
  LiveCallError,
  readLiveConfig,
  type LiveCallRegistry,
} from '../engine/live-session.js';
import { resolveVoiceLiveCast } from '../engine/voice-live-cast.js';
import { gatewayAccessToken, requestVoiceTicket, voiceTicketsUrl } from '../engine/voice-live-ticket.js';
import { gatewayWorld } from '../gateway-world.js';
import { accountAccessToken, RemoteError } from '../sync/remote-client.js';
import {
  composeVoiceCallConfig,
  resolveVoiceLiveUrl,
  resolveVoiceProvider,
  voiceLiveEventsUrl,
} from '../engine/voice-provider.js';

/**
 * The realtime-call HTTP seam.
 *
 * Three routes, all under the `/api` prefix that `createWorldRouter` and
 * `createTtsRouter` already share. This router owns `/api/live*` and nothing
 * else, so mounting it after those two never shadows them.
 *
 * There is deliberately NO module-level state: every request re-reads env and
 * the active store, the same hard requirement TTS carries —
 * tests set env after import and expect it to take effect.
 *
 * `/api/live/config` MUST answer even with no active world: readiness is about
 * credentials, not about which save is open. Only
 * the session route carries `needsWorld` semantics, and it checks the nook
 * itself rather than relying on `createWorldRouter`'s middleware — that
 * middleware only guards paths inside its own router (world.ts:407-422).
 */
export function createLiveRouter(
  getActiveStore: () => LocalWorldStore | null,
  // The registry is built in `index.ts` (the composition root) so the world
  // router can call `closeAll()` on world switch / save deletion without the
  // two routers importing each other.
  registry: LiveCallRegistry
): Router {
  const router = Router();

  /**
   * Readiness only: never expose a key, and never either upstream base URL —
   * not OpenAI's, and not voice-live's. `available`
   * describes the ACTIVE provider, so the UI hides the call button rather than
   * rendering one that errors on click.
   *
   * `provider` rides this existing payload rather than a second route: the
   * browser already fetches this once before any call, and the answer it needs
   * ("which transport, and can it run") is one question, not two.
   */
  router.get('/live/config', (_req, res) => {
    const gptLive = readLiveConfig();
    const config = composeVoiceCallConfig({ provider: resolveVoiceProvider(), gptLive });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, ...config });
  });

  /**
   * voice-live's event log, through our origin.
   *
   * The same reverse-proxy rule as the socket: the debug panel asks the canvas,
   * the canvas asks voice-live, and the upstream address never reaches a
   * browser. Only the two documented query parameters are forwarded — passing
   * the query string through whole would let a page steer a request we make on
   * its behalf. Read-only, and it exists for debugging: a failure here is
   * reported, never fatal to anything else.
   */
  router.get('/live/voice-live/events', async (req, res) => {
    const target = new URL(voiceLiveEventsUrl(resolveVoiceLiveUrl()));
    for (const key of ['limit', 'session'] as const) {
      const value = req.query[key];
      if (typeof value === 'string' && value !== '') target.searchParams.set(key, value);
    }
    try {
      const upstream = await fetch(target, { signal: AbortSignal.timeout(5_000) });
      const body = await upstream.text();
      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(body);
    } catch (err) {
      // Status/name only: the address stays out of the response, and out of
      // anything the browser could read back.
      console.warn(
        `[AIRP VoiceLive] Event log unreachable (${err instanceof Error ? err.name : 'Error'}).`
      );
      return res.status(502).json({
        ok: false,
        code: 'voice_backend_unavailable',
        error: 'The voice backend is not reachable.',
      });
    }
  });

  /**
   * Open a call: validate, ensure the character agent exists, resolve a voice,
   * create the Live session and attach the sideband.
   *
   * Body: `{ character: string, sdp: string, savePath: string, language?: 'en' | 'ja' | 'ko' }`.
   * Success: `{ ok: true, sessionId, sdp, character, voice }`.
   *
   * Live sessions and tickets are save-scoped: callers submit the canonical
   * root captured at call initiation; a stale root is rejected before effects.
   */
  /**
   * A voice-live call ticket (voice-live-ticket.ts): the page connects to
   * ai.worldlines.gg directly with it. `{ mode: 'proxy' }` when no tickets URL
   * is configured — the page then calls through `/ws/voice-live` as before.
   * The cast (voice, language) is resolved here from the character's README,
   * exactly as for the proxied call; the page sends only the character id.
   */
  router.post('/live/voice-live/ticket', async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    const savePath = typeof req.body?.savePath === 'string' ? req.body.savePath : '';
    const storeAtStart = getActiveStore();
    if (!storeAtStart || !savePath || storeAtStart.worldRoot !== savePath || !registry.isWorldRootCurrent(savePath)) {
      return res.status(409).json({ mode: 'error', code: 'world_changed', message: 'The active world changed before the voice call could start.' });
    }
    const isCurrent = () =>
      getActiveStore() === storeAtStart && storeAtStart.worldRoot === savePath &&
      registry.isWorldRootCurrent(savePath);
    const ticketsUrl = voiceTicketsUrl();
    if (!ticketsUrl) return res.json({ mode: 'proxy' });
    const raw = typeof req.body?.characterId === 'string' ? req.body.characterId : '';
    const characterId = isValidCharacterId(raw) ? raw : undefined;
    let accessToken = gatewayAccessToken(req);
    if (!accessToken) {
      try {
        accessToken = await accountAccessToken();
      } catch (error) {
        if (!isCurrent()) return res.status(409).json({ mode: 'error', code: 'world_changed', message: 'The active world changed before the voice call could start.' });
        const signedOut = error instanceof RemoteError && error.status === 401;
        return res.status(signedOut ? 401 : 502).json({ mode: 'error', code: signedOut ? 'signed_out' : 'account_unreachable', message: error instanceof Error ? error.message : 'Account check failed.' });
      }
    }
    if (!isCurrent()) return res.status(409).json({ mode: 'error', code: 'world_changed', message: 'The active world changed before the voice call could start.' });
    if (!accessToken) return res.status(401).json({ mode: 'error', code: 'signed_out', message: 'Sign in with your account to make a voice call.' });
    const cast = await resolveVoiceLiveCast(storeAtStart, characterId);
    if (!isCurrent()) return res.status(409).json({ mode: 'error', code: 'world_changed', message: 'The active world changed before the voice call could start.' });
    const answer = await requestVoiceTicket({ ticketsUrl, accessToken, cast, world: gatewayWorld() });
    if (!isCurrent()) return res.status(409).json({ mode: 'error', code: 'world_changed', message: 'The active world changed before the voice call could start.' });
    if (answer.mode === 'error') return res.status(answer.status).json(answer);
    return res.json(answer);
  });

  router.post('/live/session', async (req, res) => {
    const parsed = LiveSessionInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: 'invalid_argument',
        error: 'character and sdp must be non-empty strings; language is en or ja; savePath is required',
      });
    }
    const { character, sdp, savePath } = parsed.data;
    const language: LiveLanguage = parsed.data.language ?? 'en';

    // The id shape is the security boundary — same gate as
    // `GET /api/nook` (world.ts:569), before the store is even consulted.
    if (!isValidCharacterId(character)) {
      return res.status(400).json({
        ok: false,
        code: 'invalid_argument',
        error: 'character must be a lower-kebab-case id',
      });
    }

    const store = getActiveStore();
    if (!store) {
      return res.status(409).json({
        ok: false,
        code: 'no_active_world',
        error: 'Choose a world or start a new save.',
      });
    }
    const worldEpoch = registry.captureWorldEpoch();
    const isCurrent = () =>
      getActiveStore() === store && store.worldRoot === savePath &&
      registry.isWorldIdentityCurrent(savePath, worldEpoch);
    if (!isCurrent()) {
      return res.status(409).json({
        ok: false,
        code: 'world_changed',
        error: 'The active world changed before the live call could be opened.',
      });
    }

    const nookId = nookIdOf(character)!;
    if ((await store.statKind(nookId)) !== 'dir') {
      if (!isCurrent()) return res.status(409).json({ ok: false, code: 'world_changed', error: 'The active world changed before the live call could be opened.' });
      return res.status(404).json({
        ok: false,
        code: 'not_found',
        error: `No such character: "${character}"`,
      });
    }
    if (!isCurrent()) return res.status(409).json({ ok: false, code: 'world_changed', error: 'The active world changed before the live call could be opened.' });

    // Voice resolution reads the SAME README `/api/characters` reads, so a
    // character's DashScope voice decides its Live voice through
    // the one mapping table. A missing or unknown
    // voice falls back to the default and the chosen name is echoed back.
    let voice = resolveLiveVoice(undefined);
    try {
      const { frontmatter } = parseFrontmatter(
        await store.readFile(`${nookId}/README.md`)
      );
      const declared = characterVoiceOf(frontmatter);
      voice = resolveLiveVoice(declared);
    } catch {
      // No README is not an error here: the call still works on the default voice.
    }
    if (!isCurrent()) return res.status(409).json({ ok: false, code: 'world_changed', error: 'The active world changed before the live call could be opened.' });

    try {
      const handle = await registry.open({
        characterId: character,
        sdp,
        language,
        voice,
        worldRoot: savePath,
      });
      if (!isCurrent()) {
        await registry.close(character, savePath).catch(() => {});
        return res.status(409).json({
          ok: false,
          code: 'world_changed',
          error: 'The active world changed before the live call could be opened.',
        });
      }
      return res.json({
        ok: true,
        sessionId: handle.sessionId,
        sdp: handle.sdp,
        character,
        voice: handle.voice,
      });
    } catch (err) {
      if (!isCurrent()) {
        return res.status(409).json({
          ok: false,
          code: 'world_changed',
          error: 'The active world changed before the live call could be opened.',
        });
      }
      const failure =
        err instanceof LiveCallError
          ? err
          : new LiveCallError('internal', 500, err instanceof Error ? err.message : String(err));
      return res.status(failure.status).json({
        ok: false,
        code: failure.code,
        error: failure.message,
      });
    }
  });

  /**
   * Hang up. Keyed by character (a character has at most one call, and the
   * OpenAI session id stays opaque and server-owned). Idempotent: closing a
   * call that already ended is a success, not an error.
   */
  router.post('/live/close', async (req, res) => {
    const parsed = LiveCloseInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: 'invalid_argument',
        error: 'character must be a non-empty string and savePath is required',
      });
    }
    if (!isValidCharacterId(parsed.data.character)) {
      return res.status(400).json({
        code: 'invalid_argument',
        error: 'character must be a lower-kebab-case id',
      });
    }
    const store = getActiveStore();
    if (!store || store.worldRoot !== parsed.data.savePath || !registry.isWorldRootCurrent(parsed.data.savePath)) {
      return res.status(409).json({
        ok: false,
        code: 'world_changed',
        error: 'The active world changed before the live call could be closed.',
      });
    }
    try {
      await registry.close(parsed.data.character, parsed.data.savePath);
    } catch (err) {
      // A failed teardown must not block the browser's cleanup (the design notes
      // §5.13): the registry already released its local state in the finally path.
      console.warn(
        `[AIRP Live] close failed for ${parsed.data.character}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    return res.json({ ok: true });
  });

  return router;
}

/** Re-exported so `index.ts` can wire world teardown to the same registry type. */
export type { LiveCallRegistry };
