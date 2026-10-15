import { catchUpOnOpen, deliverReturnDigest } from './living-return.js';
import { modelAvailable, NO_MODEL_CODE, NO_MODEL_MESSAGE } from './engine/model-availability.js';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import { cpSync, existsSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { LocalWorldStore, chatBeatsEnabled, createActionService, initializeMissingCharacterPresence, isValidCharacterId, prepareLoop, prepareRun, settleTurnCursor, WsCommandSchema, worldScopedCommandMatchesSave } from '@airp/shared';
import { parseWsAllowedOrigins, registerGatewayUpgrades } from './gateway/upgrade.js';
import { AgentLifecycleManager } from './engine/lifecycle.js';
import { userId, worldsRoot } from './engine/user-root.js';
import { assertCharacterLaunchable } from './engine/launch.js';
import { ChatEndCoordinator, summarizeChatWithModel } from './engine/chat-summary.js';
import { readWorldSettings } from './engine/world-settings.js';
import { EventBridge } from './engine/event-bridge.js';
import { countServerPlayerTurn } from './engine/player-turn.js';
import { createWorldRouter } from './routes/world.js';
import { LiveCallRegistry } from './engine/live-session.js';
import { createTtsRouter } from './routes/tts.js';
import { createLiveRouter } from './routes/live.js';
import { createConnectionSettingsRouter, migrateLegacyOpenAI } from './routes/connection-settings.js';
import { createSttRouter } from './routes/stt.js';
import { createAiProxyRouter } from './ai-gateway.js';
import { gatewayWorld, setGatewayWorldSource } from './gateway-world.js';
import { worldKeyOfRoot } from './world-shelf.js';
import { DiceSettler } from './engine/dice-settle.js';
import { WriterFastPath } from './engine/writer-fast-path.js';
import { handleSttStream, STT_STREAM_PATH } from './engine/stt-stream.js';
import { handleVoiceLiveStream, VOICE_LIVE_STREAM_PATH } from './engine/voice-live-proxy.js';
import { resolveVoiceLiveCast, voiceLiveCharacterOf, voiceLiveSavePathOf, voiceLiveSessionUrl } from './engine/voice-live-cast.js';
import { resolveVoiceLiveUrl, voiceLiveRelaysBrain, voiceLiveSocketUrl, voiceLiveUpstreamHeaders } from './engine/voice-provider.js';
import { createBrainRelay } from './engine/voice-live-brain.js';
import { startHeartbeat } from './gateway/heartbeat.js';
import { closeCanvasBrowser } from './engine/canvas-browser.js';
import { createCanvasPerceptionRouter } from './routes/canvas-perception.js';
import { createClosedRunRouter } from './routes/closed-run.js';
import { createPanelsRouter } from './routes/panels.js';
import { createWorkshopArtRouter } from './routes/workshop-art.js';
import { createWorkshopThemeRouter } from './routes/workshop-theme.js';
import { createWorkshopMusicRouter } from './routes/workshop-music.js';
import { createNpcRouter } from './routes/npc.js';
import { createStreamRouter } from './routes/stream.js';
import { createAmbientRouter } from './routes/ambient.js';
import { createSyncRouter } from './routes/sync.js';
import { createRemoteRouter } from './routes/remote.js';
import { installGuestMigration } from './sync/guest-session.js';
import { createAccountDataRouter } from './routes/account-data.js';
import { createBoardRouter } from './routes/board.js';
import { createProfileRouter } from './routes/profile.js';
import { createPlansRouter } from './routes/plans.js';
import { writerReplyTurn } from './engine/npc-talk.js';
import { CanvasArrangerRuntime } from './engine/canvas-arranger-lifecycle.js';
import { createCanvasArrangerRouter } from './routes/canvas-arranger.js';
import { createBrowserRuntimeRouter } from './routes/browser-runtime.js';
import { createModeRouter, startDeployMode } from './deploy-mode.js';
import { isAuthoringWorld, worldBuildingBrief } from './world-workshop.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = process.env.AIRP_REPO_ROOT || path.resolve(__dirname, '../../..');
const VENDOR_CLI = path.join(REPO_ROOT, 'vendor/pi-rp/packages/coding-agent/dist/cli.js');
const WEB_DIST = path.join(REPO_ROOT, 'apps/web/dist');
// ONE local config file: `.env.local`. The
// connection-settings panel writes it and people hand-edit it, so there is no
// second file that can silently shadow a key. The former `.local.env` override
// file is no longer read: a key left there would win over the one everybody
// edits, which is exactly how two dead keys hid a valid one (2026-09-26).
const localEnv = path.join(REPO_ROOT, '.env.local');
if (existsSync(localEnv)) process.loadEnvFile(localEnv);
const retiredOverrides = path.join(REPO_ROOT, '.local.env');
if (existsSync(retiredOverrides)) {
  console.warn('[AIRP Server] .local.env is no longer read; move its lines into .env.local and delete it.');
}

// Load .env before ANY AIRP_* / DASHSCOPE_* read. Node native, no dotenv
// dependency. A missing file is normal (CI / first checkout),
// and a malformed one degrades to the ambient env rather than refusing to boot.
try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env'));
} catch {
  /* no .env → ambient env */
}
try {
  migrateLegacyOpenAI(REPO_ROOT);
} catch {
  console.warn('[AIRP Server] OpenAI legacy credentials could not be migrated; the existing configuration was retained.');
}

// The build mode (config/.env.local | config/.env.remote, packages/shared/src/deploy-mode) — after the key
// files (they win), before any service URL is read. Throws (exit non-zero) on a missing or half-set mode.
const MODE = startDeployMode(path.resolve(__dirname, '../../..'));
console.log(`[AIRP Server] mode: ${MODE.label}`);

// Config is read per request and the failure reaches the client as 503, so this
// startup warn is a convenience, not the only signal.
if (!process.env.DASHSCOPE_API_KEY) {
  console.warn(
    '[AIRP TTS] DASHSCOPE_API_KEY not set; online TTS and local voice fallback are unavailable.'
  );
}

const app = express();
const server = http.createServer(app);
// `noServer` + an explicit upgrade hook keeps path/origin policy together.
// Origin mismatch returns HTTP 403 before the WS handshake; the `/ws` protocol
// mismatch instead upgrades then sends its close CODE, because destroying the
// raw socket would leave the client with 1006 and no `closeKind`.
// The `/ws/stt` branch MUST call `handleUpgrade` + `emit('connection')` too:
// under `noServer` the implicit upgrade handler is gone, so returning early
// would never open the socket and voice input dies (§3.1 step 4).
const wss = new WebSocketServer({ noServer: true });

const allowedWsOrigins = parseWsAllowedOrigins(process.env.AIRP_WS_ALLOWED_ORIGINS);
registerGatewayUpgrades(server, wss, {
  sttPath: STT_STREAM_PATH,
  voiceLivePath: VOICE_LIVE_STREAM_PATH,
  allowedOrigins: allowedWsOrigins,
});

app.use(cors());
// Browser mode host routes (bundles, VFS image, model proxy) — localhost-only,
// mounted before express.json() so the model proxy forwards the raw body.
app.use('/api/browser-runtime', createBrowserRuntimeRouter(REPO_ROOT));
// The agents' way to the Worldlines AI service with this computer's account
// (ai-gateway.ts): loopback + per-process secret, raw body, before express.json().
app.use(createAiProxyRouter());
// A workshop cover upload rides in the JSON body as base64;
// this parser runs first for that one route so the global 100 kB ceiling below
// does not reject it. body-parser skips a body another parser already read.
app.use('/api/worlds/create', express.json({ limit: '12mb' }));
// The 素材 panel's picture upload: same base64 body, same ceiling.
app.use('/api/workshop/art/upload', express.json({ limit: '12mb' }));
app.use(express.json());
// GET /api/health (mode + version) and the login-off guard in front of /api/remote/login*.
app.use('/api', createModeRouter());

let activeStore: LocalWorldStore | null = null;
// Calls to the Worldlines AI service name the open world (X-Worldlines-World, ai-gateway.ts).
setGatewayWorldSource(() => (activeStore ? worldKeyOfRoot(REPO_ROOT, activeStore.worldRoot) : null));
// The guest trial: a sign-in on this device takes the trial saves into the account (sync/guest-session.ts).
installGuestMigration(REPO_ROOT);
const eventBridge = new EventBridge();
eventBridge.setWss(wss);

// Character overlay open-time high-water marks (03 §4.3). Module-level and
// in-process (server + lifecycle share this process); NOT persisted — an open
// overlay is transient, so a restart legitimately forgets it. `character_stop`
// pins the cursor to the value recorded at `character_start`, so events that
// happened to OTHER readers while the overlay was open are not swallowed.
const characterOpenHighWater = new Map<string, number>();
let warnedMissingHighWater = false;
function characterOpenHighWaterKey(worldRoot: string, characterId: string): string {
  return `${worldRoot}\u0000${characterId}`;
}

// A writer turn that ends with a 大失败 / 大成功 unpaid gets the world's default
// consequence.
const diceSettler = new DiceSettler((worldRoot) => (activeStore && activeStore.worldRoot === worldRoot ? activeStore : null));

// The writer's fast path: AIRP_WRITER_FAST_PATH=off|shadow|on, default off.
const writerFastPath = new WriterFastPath({ storeFor: (worldRoot) => (activeStore && activeStore.worldRoot === worldRoot ? activeStore : null) });

const lifecycle = new AgentLifecycleManager({
  repoRoot: REPO_ROOT,
  vendorCliPath: VENDOR_CLI,
  fastPath: writerFastPath,
  eventSink: (source, event, characterId, turnId, savePath) => {
    if (source === 'writer' && savePath) void diceSettler.onWriterEvent(event.type, savePath);
    return eventBridge.emitEngine(source, event, characterId, turnId, savePath);
  },
  activityFailureSink: (source, characterId, turnId, reason, savePath) =>
    eventBridge.failActivity(source, characterId, turnId, reason, savePath),
  frameSink: (message) => eventBridge.broadcast(message),
});
// A loop reset: the world files are already back at the
// loop start; the agents' conversations follow — characters forget, the writer's
// next beat starts a new thread.
eventBridge.onWorldEvent((event, worldRoot) => {
  if (event.type !== 'loop_reset') return;
  const loop = typeof event.detail.loop === 'number' ? event.detail.loop : 0;
  void lifecycle.resetForLoop(worldRoot, loop);
});

// Chat ends → the writer's summary and, when something was learned or promised,
// one quiet writer beat.
const chatEnds = new ChatEndCoordinator({
  summarize: (input) => summarizeChatWithModel(input),
  quietWriterTurn: (worldRoot, prompt) => lifecycle.submitWriter(worldRoot, prompt),
  beatsEnabled: (worldRoot) => chatBeatsEnabled(readWorldSettings(worldRoot)),
});

// Live voice calls. The registry is built here — the
// composition root — because two routers need it: `createLiveRouter` opens and
// closes calls, and `createWorldRouter` closes them all on world switch / save
// deletion (§2.4 freeze 3). Building it in either router would force the other
// to import it.
//
// `onVisibleFailure` rides the EXISTING character `error` frame rather than a
// new WS frame (§2.8): `useWorld` already forwards it to `airp:character-frame`
// (useWorld.ts:583), so a failed delegation reaches the browser visibly instead
// of stalling silently.
const liveCalls = new LiveCallRegistry({
  repoRoot: REPO_ROOT,
  lifecycle,
  readCharacterReadme: async (characterId, worldRoot) => {
    const store = activeStore;
    if (!store || store.worldRoot !== worldRoot) return null;
    try {
      return await store.readFile(`characters/${characterId}/README.md`);
    } catch {
      return null;
    }
  },
  onVisibleFailure: (characterId, reason, savePath) => {
    eventBridge.broadcast({ type: 'error', source: 'character', characterId, message: reason, savePath });
  },
});

// Open the first curated world and start its writer. A template is never played
// in place (that wrote play state into the repo): like `/api/worlds/load`, boot
// plays a copy under worlds/. The copy is stable per template so dev restarts
// keep progress instead of piling up saves.
const DEFAULT_SOURCE = path.resolve(REPO_ROOT, process.env.AIRP_WORLD ?? 'templates/wuwu');
const TEMPLATES_ROOT = path.join(REPO_ROOT, 'templates') + path.sep;
// The boot copy lands in the seat owner's save root, so a hosted player boots
// into THEIR default world rather than a shared one.
const DEFAULT_WORLD = DEFAULT_SOURCE.startsWith(TEMPLATES_ROOT)
  ? path.join(worldsRoot(REPO_ROOT), `${path.basename(DEFAULT_SOURCE)}-default`)
  : DEFAULT_SOURCE;
let bootStore: LocalWorldStore | null = null;
let bootCatchUp: Awaited<ReturnType<typeof catchUpOnOpen>> = null;
try {
  if (!existsSync(path.join(DEFAULT_SOURCE, 'world.json'))) throw new Error('Default world is unavailable');
  if (DEFAULT_WORLD !== DEFAULT_SOURCE && !existsSync(path.join(DEFAULT_WORLD, 'world.json'))) {
    cpSync(DEFAULT_SOURCE, DEFAULT_WORLD, {
      recursive: true,
      filter: (source) => !['.airpworld', '.pi'].includes(path.relative(DEFAULT_SOURCE, source).split(path.sep)[0]),
    });
    // A new run: pick this run's variants. No-op without `variants`.
    await prepareRun(DEFAULT_WORLD, { seed: process.env.AIRP_RUN_SEED });
  }
  // A looping world's starting point: taken once per save.
  await prepareLoop(DEFAULT_WORLD).catch((err) => console.warn('[Loop] no loop-start snapshot:', err instanceof Error ? err.message : String(err)));
  bootStore = new LocalWorldStore(DEFAULT_WORLD);
  await initializeMissingCharacterPresence(bootStore, { turn: `init:${randomUUID()}` });
  // A living world catches up on the time the player was away.
  bootCatchUp = await catchUpOnOpen(bootStore);
  // Align the tail cursor BEFORE exposing or watching the store. Initial
  // presence events stay in history and are not replayed to the old world.
  eventBridge.startTailReader(bootStore);
  eventBridge.watchWorld(DEFAULT_WORLD);
  activeStore = bootStore;
  bootStore = null;
  console.log(`[AIRP Server] Default world loaded: ${DEFAULT_WORLD} (user: ${userId()})`);
  // The frontend never calls /api/worlds/load, so without this the writer process
  // simply would not exist on the default path.
  lifecycle.startWriter(DEFAULT_WORLD).catch((err) => {
    console.warn('[AIRP Server] writer start failed:', err);
  });
  if (activeStore) {
    const opened = activeStore;
    void deliverReturnDigest(opened, bootCatchUp, (prompt) => lifecycle.submitWriter(opened.worldRoot, prompt));
  }
} catch (err) {
  if (bootStore) {
    try { bootStore.close(); } catch { /* The startup failure is already reported below. */ }
    bootStore = null;
  }
  eventBridge.close();
  activeStore = null;
  console.warn('[AIRP Server] No default world found, waiting for user selection.');
}

// API Routes
app.use(
  '/api',
  createWorldRouter(
    REPO_ROOT,
    lifecycle,
    eventBridge,
    () => activeStore,
    (s) => { activeStore = s; },
    liveCalls
  )
);

// TTS rides the same /api prefix. Express matches in order and the two routers
// own disjoint paths (/api/tts* vs /api/worlds… /api/asset…), so the second
// never shadows the first. Only getActiveStore is shared: TTS is HTTP-only and
// must never touch the WS fan-out.
app.use('/api', createTtsRouter(REPO_ROOT, () => activeStore, root => lifecycle.isWorldRootCurrent(root)));
// Realtime voice calls. Mounted after `createWorldRouter`
// on purpose: that router's `needsWorld` middleware is scoped to its own paths
// (world.ts:407-422), so `/api/live/config` stays answerable with no world
// while `/api/live/session` does its own nook check.
app.use('/api', createLiveRouter(() => activeStore, liveCalls));
app.use('/api', createConnectionSettingsRouter(REPO_ROOT, {
  // The self-test probes the models the agents actually run on; `modelStatus`
  // starts the writer if needed, exactly as the Agents panel does.
  agentModels: async () => {
    if (!activeStore) return null;
    const status = await lifecycle.modelStatus(activeStore.worldRoot, false);
    return { writer: status.writer.model, characters: status.characters };
  },
  refreshOpenAI: async () => activeStore
    ? lifecycle.refreshOpenAICatalog(activeStore.worldRoot)
    : { status: 'error', error: 'no-active-world' },
  getOpenAIRefreshStatus: () => lifecycle.getOpenAIRefreshStatus(),
  cancelOpenAIRefresh: () => lifecycle.cancelOpenAIRefresh(),
}));
// Player voice input: HTTP-only, no world needed.
app.use('/api', createSttRouter());
// Server-side Canvas DOM screenshots: active-world/read-only only, no WS transport.
app.use('/api', createCanvasPerceptionRouter(() => activeStore));
// Closed worlds: the clock and the ending, read-only.
app.use('/api', createClosedRunRouter(() => activeStore));
// Player / world / character panels: declared states as prose, read-only.
app.use('/api', createPanelsRouter(() => activeStore));
// The message drawer's history: everything said in this save, rebuilt from the log and the sessions, read-only.
app.use('/api', createStreamRouter(() => activeStore));
// Creation-mode art: the 素材 panel's slots, prompts and pictures. Draft workshop worlds only.
app.use('/api', createWorkshopArtRouter({ getStore: () => activeStore }));
// Creation-mode 设定: the draft's world type, rules and structure, editable again.
app.use('/api', createWorkshopThemeRouter({ getStore: () => activeStore }));
app.use('/api', createWorkshopMusicRouter({ getStore: () => activeStore }));
// NPC cards: one player line → one writer turn in the
// NPC's voice, recorded on the card. HTTP, not WS: the reply is the response.
app.use('/api', createNpcRouter({
  getStore: () => activeStore,
  askWriter: (worldRoot, prompt) => {
    if (!modelAvailable(REPO_ROOT)) return Promise.reject(new Error(NO_MODEL_MESSAGE));
    return writerReplyTurn(lifecycle, worldRoot, prompt);
  },
}));
// Ambient life: read-only barks / emotes for the canvas.
app.use('/api', createAmbientRouter({ getStore: () => activeStore }));
// Canvas arranger: the "Arrange this layer"
// button. The runtime existed since 80853e9 but was never mounted, so the
// button always answered 404 ("arrangement unavailable"). Since the
// 2026-09-18 de-agenting ruling it is a server-internal state machine (no
// model process): it reads the canvas snapshot, calls the arrangeCanvas action
// kernel in process, and verifies full-layer overlaps=[] before settling. The
// committed layout is pushed as `canvas_patched` (source `functional`, the
// shape CanvasArrangeControl waits for); the start and the terminal outcome
// ride `agent_activity`.
const canvasArranger = new CanvasArrangerRuntime({
  getActiveStore: () => activeStore,
  onRuntimeSignal: (signal) => {
    const identity = {
      agentId: signal.agentId, operationId: signal.operationId, requestId: signal.requestId,
      turnId: signal.turnId, layer: signal.layer, savePath: signal.savePath, timestamp: new Date().toISOString(),
    };
    if (signal.type === 'started') {
      eventBridge.broadcast({
        type: 'agent_activity', source: 'functional', ...identity, operation: 'edit', phase: 'started',
      });
      return;
    }
    if (signal.type === 'committed' && signal.result) {
      eventBridge.broadcast({
        type: 'canvas_patched', source: 'functional', ...identity, kind: 'cards', action: 'arranged',
        cards: signal.result.cards.map(({ path, x, y, z }) => ({ path, x, y, z })),
      });
    }
    if (signal.type === 'verified' || signal.type === 'failed' || signal.type === 'conflict' || signal.type === 'cancelled') {
      const outcome = signal.outcome ?? (signal.type === 'verified' ? 'completed' : signal.type);
      const evidence = signal.result?.screenshotEvidence?.map(({ phase, path, width, height }) => ({ phase, path, width, height }));
      eventBridge.broadcast({
        type: 'agent_activity', source: 'functional', ...identity, operation: 'edit',
        phase: outcome === 'completed' ? 'completed' : 'failed', outcome,
        ...(signal.error ? { error: signal.error } : {}),
        changedCount: signal.result?.movedCount ?? 0,
        ...(evidence?.length ? { evidence } : {}),
        details: { outcome, verified: outcome === 'completed', overlaps: outcome === 'completed' ? [] : undefined, movedCount: signal.result?.movedCount ?? 0 },
      });
    }
  },
});
app.use('/api', createCanvasArrangerRouter(canvasArranger));
// Local ↔ remote. `/api/sync/*` is the hosted
// half (a local server acting for a signed-in account, identified by the seat
// gateway: tenant drafts and the public area); `/api/remote/*` is the local
// half, localhost only, which signs the owner in to their account and calls a
// hosted AIRP with that session.
app.use('/api', createSyncRouter(REPO_ROOT));
app.use('/api', createRemoteRouter(REPO_ROOT, { getActiveStore: () => activeStore }));
// The account's settings / favorites / ratings / save summaries in the data service (sync/account-data.ts).
app.use('/api', createAccountDataRouter());
// 公告 / 社区 (sync/board.ts): the lobby board's feed, comments and posts, in the data service.
app.use('/api', createBoardRouter());
// 个人页面: this computer's saves (endings, CGs) + the account's chronicle and wallet.
app.use('/api', createProfileRouter(REPO_ROOT));
// 托管方案 preview: a flag only, nothing is sold.
app.use('/api', createPlansRouter());

// Serve static frontend files from apps/web/dist
app.use(express.static(WEB_DIST));

// SPA fallback for frontend client routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
  res.sendFile(path.join(WEB_DIST, 'index.html'));
});

// WebSocket client connection handling
wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  // Connection-scoped liveness wiring (the design notes step 7 / §8, REVIEW
  // M2): it MUST live here, not in `startHeartbeat`, because the sweeper only
  // walks `wss.clients` when its timer fires and would never seed a connection
  // created after the last sweep. Applies to `/ws/stt` too — harmless, since
  // RFC 6455 answers protocol pings automatically. Without the pong reset a live
  // socket stays `false` and is terminated on the next sweep (~every 60s).
  // `ws` types do not declare `isAlive` (the rivet idiom); a structural alias
  // keeps the annotation local instead of augmenting the global `ws` module.
  const liveness = ws as WebSocket & { isAlive?: boolean };
  liveness.isAlive = true;
  ws.on('pong', () => {
    liveness.isAlive = true;
  });
  // Live voice input has its own socket; it never joins the event fan-out.
  if (req.url?.startsWith(STT_STREAM_PATH)) {
    handleSttStream(ws);
    return;
  }
  // The voice-live call is a byte pipe to another process (the design notes
  // §3). It carries audio, not canvas frames, so it never joins the fan-out and
  // never gets the replay — `voice-live-proxy.ts` owns this socket entirely.
  if (req.url?.startsWith(VOICE_LIVE_STREAM_PATH)) {
    const storeAtOpen = activeStore;
    const savePath = voiceLiveSavePathOf(req.url);
    if (!storeAtOpen || !savePath || storeAtOpen.worldRoot !== savePath || !lifecycle.isWorldRootCurrent(savePath)) {
      ws.send(JSON.stringify({ type: 'error', where: 'proxy', message: 'The active world changed before the voice call could start.' }));
      ws.close(1008, 'world changed');
      return;
    }
    const isCurrent = () =>
      activeStore === storeAtOpen && activeStore?.worldRoot === savePath && lifecycle.isWorldRootCurrent(savePath);
    // Cast the call in the character's own voice (voice-live-cast.ts): without
    // this, voice-live speaks every character in its one configured voice.
    const characterId = voiceLiveCharacterOf(req.url);
    const cast = resolveVoiceLiveCast(storeAtOpen, characterId).then((resolved) => {
      if (!isCurrent()) throw new Error('The active world changed before the voice call could start.');
      return voiceLiveSessionUrl(voiceLiveSocketUrl(resolveVoiceLiveUrl()), resolved, {
        relayBrain: voiceLiveRelaysBrain() && !!characterId,
      });
    });
    const relayBrain = voiceLiveRelaysBrain() && !!characterId;
    handleVoiceLiveStream(ws, {
      isCurrent,
      upstreamUrl: cast,
      headers: voiceLiveUpstreamHeaders(process.env, gatewayWorld()),
      brain: relayBrain && characterId
        ? (send) => createBrainRelay(
            characterId,
            savePath,
            `ws://127.0.0.1:${PORT}/ws?v=1`,
            send,
            undefined,
            isCurrent,
          )
        : undefined,
    });
    return;
  }
  console.log('[AIRP WS] Client connected');

  ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));

  // Replay the last complete turns to this client before live frames flow
  //. Synchronous by design: no frame can interleave
  // between the ring snapshot and `replay_done`.
  eventBridge.replayTo(ws, activeStore?.worldRoot ?? null);

  ws.on('message', async (raw: string) => {
    try {
      const frame = JSON.parse(raw.toString());
      const parsed = WsCommandSchema.safeParse(frame);
      if (!parsed.success) {
        // Close malformed/unknown command frames before any save lookup or dispatch.
        // Never echo an untrusted frame or its prompt.
        ws.close(1008, 'invalid command');
        return;
      }
      const data = parsed.data;
      const storeAtMessageStart = activeStore;
      const scopedSavePath = data.savePath;
      const isCharacterCommand = data.type === 'character_start' || data.type === 'character_prompt' ||
        data.type === 'character_abort' || data.type === 'character_stop' || data.type === 'character_talk_end';
      const characterId = isCharacterCommand ? data.characterId : undefined;
      if (!worldScopedCommandMatchesSave(data, storeAtMessageStart?.worldRoot ?? null, (root) => lifecycle.isWorldRootCurrent(root))) {
        ws.send(JSON.stringify({
          type: 'error',
          source: isCharacterCommand ? 'character' : 'writer',
          characterId,
          message: 'The active world changed before this command could be handled.',
          savePath: scopedSavePath,
        }));
        return;
      }
      if (lifecycle.isModelSwitching() && ['writer_prompt', 'airp_init', 'character_start', 'character_prompt'].includes(data.type)) {
        ws.send(JSON.stringify({ type: 'error', source: isCharacterCommand ? 'character' : 'writer', characterId, message: 'Models are switching. Please try again shortly.', savePath: scopedSavePath }));
        return;
      }

      // No key, no account, no gateway: say so at once instead of starting an
      // agent that can never answer (the page shows a notice + a settings button).
      if (['writer_prompt', 'character_prompt'].includes(data.type) && !modelAvailable(REPO_ROOT)) {
        ws.send(JSON.stringify({ type: 'error', code: NO_MODEL_CODE, source: data.type === 'writer_prompt' ? 'writer' : 'character', characterId, message: NO_MODEL_MESSAGE, savePath: scopedSavePath }));
        return;
      }

      if (data.type === 'writer_prompt') {
        const storeAtStart = storeAtMessageStart;
        const worldPath = scopedSavePath;
        try {
          if (!storeAtStart || !worldPath) throw new Error('No active world');
          lifecycle.assertWriterWorldAvailable(worldPath);
          // The player's message to the writer is one turn of a clock that moves by turns (engine/player-turn.ts).
          await countServerPlayerTurn(storeAtStart, 'request');
          if (data.mode === 'steer') {
            await lifecycle.dispatchWriterCommand(worldPath, (writer) => {
              if (activeStore !== storeAtStart || activeStore?.worldRoot !== worldPath) throw new Error('The active world changed before the writer command could be sent.');
              return writer.steer(data.message);
            });
          } else if (data.mode === 'followUp') {
            await lifecycle.dispatchWriterCommand(worldPath, (writer) => {
              if (activeStore !== storeAtStart || activeStore?.worldRoot !== worldPath) throw new Error('The active world changed before the writer command could be sent.');
              return writer.followUp(data.message);
            });
          } else {
            // An authoring session (the author inside their own workshop world)
            // gets the building brief ahead of the request: the writer must
            // build the world, not narrate a turn.
            const manifest = await storeAtStart.getManifest().catch(() => null) as Record<string, unknown> | null;
            if (activeStore !== storeAtStart || activeStore?.worldRoot !== worldPath) {
              throw new Error('The active world changed before the writer turn could start.');
            }
            lifecycle.assertWriterWorldAvailable(worldPath);
            const brief = manifest && isAuthoringWorld(worldPath, manifest) ? `${worldBuildingBrief(manifest)}\n\n` : '';
            void lifecycle.submitWriter(worldPath,
              `${brief}[Current Layer] ${typeof data.layer === 'string' ? data.layer : 'map'}\n[${brief ? 'Author Request' : 'Player Request'}] ${data.message}`
            ).catch(err => ws.send(JSON.stringify({ type: 'error', source: 'writer', message: err.message, savePath: worldPath })));
          }
        } catch (err: unknown) {
          console.error('[AIRP WS] Writer prompt failed:', err);
          ws.send(JSON.stringify({ type: 'error', source: 'writer', message: err instanceof Error ? err.message : String(err), savePath: worldPath }));
        }
      } else if (data.type === 'airp_init') {
        // Initialization is a direct writer command (not submitWriter), so
        // bind it to the active save before dispatch.
        const storeAtStart = storeAtMessageStart;
        const worldPath = scopedSavePath;
        try {
          if (!storeAtStart || !worldPath) throw new Error('No active world');
          lifecycle.assertWriterWorldAvailable(worldPath);
          const initPayload = {
            kind: data.kind,
            target: data.target,
            by: data.by === 'player' ? 'player' : 'engine',
            ...(typeof data.request === 'string' && data.request !== '' ? { request: data.request } : {}),
            ...(data.template === true ? { template: true } : {}),
          };
          void lifecycle
            .dispatchWriterCommand(worldPath, async (writer) => {
              if (activeStore !== storeAtStart || activeStore?.worldRoot !== worldPath) throw new Error('The active world changed before initialization could be sent.');
              // Initializers inherit the session's thinking level; an ordinary beat may have left it off.
              await lifecycle.restoreWriterThinking(writer);
              if (activeStore !== storeAtStart || activeStore?.worldRoot !== worldPath) throw new Error('The active world changed before initialization could be sent.');
              return writer.prompt(`/airp-init ${JSON.stringify(initPayload)}`);
            })
            .catch((err: unknown) => {
              console.warn('[AIRP WS] airp_init dispatch failed:', err instanceof Error ? err.message : String(err));
              ws.send(JSON.stringify({
                type: 'error',
                source: 'writer',
                message: err instanceof Error ? err.message : String(err),
                savePath: worldPath,
              }));
            });
        } catch (err: unknown) {
          ws.send(JSON.stringify({
            type: 'error',
            source: 'writer',
            message: err instanceof Error ? err.message : String(err),
            savePath: worldPath,
          }));
        }
      } else if (data.type === 'writer_abort' || data.type === 'abort') {
        const storeAtStart = storeAtMessageStart;
        const worldPath = scopedSavePath;
        try {
          if (!storeAtStart || !worldPath || activeStore !== storeAtStart || storeAtStart.worldRoot !== worldPath) throw new Error('The active world changed before the writer abort could be handled.');
          await lifecycle.abortWriter(worldPath);
        } catch (err: unknown) {
          ws.send(JSON.stringify({
            type: 'error',
            source: 'writer',
            message: err instanceof Error ? err.message : String(err),
            savePath: worldPath,
          }));
        }
      } else if (data.type === 'character_start') {
        const characterId = String(data.characterId);
        const storeAtStart = storeAtMessageStart;
        const worldPath = scopedSavePath;
        try {
          if (!storeAtStart || !worldPath) throw new Error('No active world for the character agent');
          // Pin the open-time high-water BEFORE spawning (03 §4.3): the close
          assertCharacterLaunchable(worldPath, String(data.characterId));
          // path settles the cursor to this seq, so "world changed while the
          // overlay was open" is reported on the NEXT open instead of being
          // swallowed. A failed read must not block opening (doc 00 §11).
          if (storeAtStart?.worldRoot === worldPath) {
            try {
              characterOpenHighWater.set(characterOpenHighWaterKey(worldPath, characterId), await storeAtStart.getMaxSeq());
            } catch (err) {
              console.warn('[AIRP WS] character open high-water read failed:', err);
            }
          }
          if (activeStore !== storeAtStart || storeAtStart?.worldRoot !== worldPath) {
            throw new Error('The active world changed while the character was starting.');
          }
          if (activeStore) chatEnds.noteOpened(activeStore, String(data.characterId));
          await lifecycle.ensureCharacter(data.characterId, worldPath);
        } catch (err: unknown) {
          console.error('[AIRP WS] Character start failed:', err);
          ws.send(JSON.stringify({ type: 'error', source: 'character', characterId: data.characterId, message: err instanceof Error ? err.message : String(err), savePath: worldPath }));
        }
      } else if (data.type === 'character_prompt') {
        // Resolve the request's source once. A queued turn must never read the
        // mutable active store later and silently move from save A to save B.
        const characterId = String(data.characterId);
        const storeAtStart = storeAtMessageStart;
        const worldPath = scopedSavePath;
        let character = worldPath && lifecycle.getCharacterWorld(characterId) === worldPath ? lifecycle.getCharacter(data.characterId) : null;
        if (!character) {
          try {
            if (!worldPath || !storeAtStart) throw new Error('No active world for the character agent');
            assertCharacterLaunchable(worldPath, characterId);
            const openKey = characterOpenHighWaterKey(worldPath, characterId);
            if (storeAtStart?.worldRoot === worldPath && !characterOpenHighWater.has(openKey)) {
              try {
                characterOpenHighWater.set(openKey, await storeAtStart.getMaxSeq());
              } catch (err) {
                console.warn('[AIRP WS] character open high-water read failed:', err);
              }
            }
            if (activeStore !== storeAtStart || storeAtStart?.worldRoot !== worldPath) {
              throw new Error('The active world changed while the character was starting.');
            }
            character = await lifecycle.ensureCharacter(characterId, worldPath);
          } catch (err: unknown) {
            console.error('[AIRP WS] Character start (on prompt) failed:', err);
            ws.send(JSON.stringify({ type: 'error', source: 'character', characterId: data.characterId, message: err instanceof Error ? err.message : String(err), savePath: worldPath }));
            return;
          }
        }
        const turnSavePath = worldPath;
        // One line said to a character is one turn of a clock that moves by turns (engine/player-turn.ts).
        if (storeAtStart?.worldRoot === turnSavePath) await countServerPlayerTurn(storeAtStart, 'talk');
        // The companion dock may never close: a quiet chat ends on its own.
        if (activeStore && isValidCharacterId(String(data.characterId))) chatEnds.armIdle(activeStore, String(data.characterId));
        try {
          if (!turnSavePath || activeStore !== storeAtStart || storeAtStart?.worldRoot !== turnSavePath) {
            throw new Error('The active world changed before the character turn could start.');
          }
          lifecycle.assertWorldAvailable(turnSavePath);
          if (data.mode === 'steer') {
            // `steer` injects into the turn already running — that is pi's
            // documented way to add information mid-turn (integration.md §7.1),
            // so it must NOT be queued behind that turn.
            await lifecycle.dispatchCharacterCommand(characterId, turnSavePath, client => {
              if (activeStore !== storeAtStart || activeStore?.worldRoot !== turnSavePath) throw new Error('The active world changed before the character steer could be sent.');
              return client.steer(data.message);
            });
          } else {
            // One agent, one turn at a time. The voice
            // call and the dock are two mouths on the SAME character process,
            // so this prompt waits for whatever that character is already
            // saying rather than opening a second turn on one pi client.
            //
            // The message is never dropped: it waits its turn and is answered
            // in order. A queue that is genuinely too deep refuses loudly
            // through the `error` frame below, which the dock already renders.
            // What is NOT yet built is a "queued" badge — `CharacterFrame` is a
            // closed five-type union (character-frame-queue.ts), so saying so
            // on the wire is its own change.
            let client = character;
            await lifecycle.submitCharacterTurn(characterId, async () => {
              const send = () => {
                if (activeStore !== storeAtStart || activeStore?.worldRoot !== turnSavePath) throw new Error('The active world changed before the character turn was sent.');
                return data.mode === 'followUp' ? client.followUp(data.message) : client.prompt(data.message);
              };
              try {
                return await send();
              } catch (err) {
                // The agent this turn was given has gone (a world switch or a
                // crash stopped it): start it again once and resend, rather
                // than telling the player the turn could not finish.
                if (!(err instanceof Error && err.message === 'Client not started') || !turnSavePath) throw err;
                if (activeStore !== storeAtStart || storeAtStart?.worldRoot !== turnSavePath) {
                  throw new Error('The active world changed before the character turn could retry.');
                }
                client = await lifecycle.ensureCharacter(characterId, turnSavePath);
                if (activeStore !== storeAtStart || storeAtStart?.worldRoot !== turnSavePath) {
                  throw new Error('The active world changed while the character turn was restarting.');
                }
                return send();
              }
            });
          }
        } catch (err: unknown) {
          console.error('[AIRP WS] Character prompt failed:', err);
          ws.send(JSON.stringify({ type: 'error', source: 'character', characterId: data.characterId, message: err instanceof Error ? err.message : String(err), savePath: turnSavePath }));
        }
      } else if (data.type === 'character_abort') {
        const characterId = String(data.characterId);
        const storeAtStart = storeAtMessageStart;
        const worldPath = scopedSavePath;
        try {
          if (!storeAtStart || !worldPath || activeStore !== storeAtStart || storeAtStart.worldRoot !== worldPath) {
            throw new Error('The active world changed before the character could be aborted.');
          }
          await lifecycle.abortCharacter(characterId, worldPath);
        } catch (err: unknown) {
          console.warn('[AIRP WS] Character abort rejected:', err instanceof Error ? err.message : String(err));
          ws.send(JSON.stringify({
            type: 'error',
            source: 'character',
            characterId,
            message: err instanceof Error ? err.message : String(err),
            savePath: worldPath,
          }));
        }
      } else if (data.type === 'character_talk_end') {
        // A chat ended but the agent stays (a voice call hung up while the
        // dialogue is open, the nook closed): only the writer's summary.
        if (storeAtMessageStart && isValidCharacterId(String(data.characterId))) {
          void chatEnds.end(storeAtMessageStart, String(data.characterId), { via: data.via === 'voice' ? 'voice' : 'dialogue', beat: data.beat !== false });
        }
      } else if (data.type === 'character_stop') {
        const characterId = String(data.characterId);
        const storeAtStart = storeAtMessageStart;
        const worldPath = scopedSavePath;
        try {
          if (!storeAtStart || !worldPath || activeStore !== storeAtStart || storeAtStart.worldRoot !== worldPath) {
            throw new Error('The active world changed before the character could be stopped.');
          }
          await lifecycle.stopCharacterWithAction(characterId, worldPath, async () => {
            // Record the beat BEFORE retiring the process: the action layer reads
            // characters/<id>/README.md for `detail.name` (doc-21 §3.3), and a
            // stopped client can no longer be asked anything.
            // The chat's `character_talked` event — real exchange count from the
            // character's own session, plus a short summary for the writer — is
            // recorded in the background (engine/chat-summary.ts): the session
            // file outlives the process, so it never holds up the stop, and a
            // chat with no real exchange records nothing.
            if (isValidCharacterId(characterId)) {
              void chatEnds.end(storeAtStart, characterId, { via: data.via === 'voice' ? 'voice' : 'dialogue', beat: data.beat !== false });
            }
            // Settle the character's read cursor on CLOSE (03 §4.3 call point 3) —
            // never on open (a crash / misclick would swallow the span forever).
            // The pinned seq is the open-time high-water; a missing key (e.g. the
            // server restarted mid-overlay) degrades to `getMaxSeq()` + one warn.
            const key = characterOpenHighWaterKey(worldPath, characterId);
            const pinned = characterOpenHighWater.get(key);
            if (pinned === undefined && !warnedMissingHighWater) {
              warnedMissingHighWater = true;
              console.warn(`[AIRP WS] character_stop for "${key}" has no open high-water; falling back to the max seq`);
            }
            const opts = pinned === undefined ? {} : { seq: pinned };
            await settleTurnCursor(storeAtStart, `character:${key}`, opts);
            // Close consumes the overlay: forget the pinned high-water.
            characterOpenHighWater.delete(key);
          }, status => {
            try { ws.send(JSON.stringify({ type: 'character_stop_status', characterId, status, savePath: worldPath })); }
            catch { /* The close intent continues even if its socket has already gone away. */ }
          });
        } catch (err: unknown) {
          ws.send(JSON.stringify({ type: 'error', source: 'character', characterId,
            message: err instanceof Error ? err.message : String(err), savePath: worldPath }));
        }
      }
    } catch (err: unknown) {
      console.error('[AIRP WS Error]', err);
    }
  });

  ws.on('close', () => {
    console.log('[AIRP WS] Client disconnected');
  });
});

// 30s protocol-level ping + one-missed-pong terminate.
// Started after the connection handler is registered and before `listen`, so no
// connection can be created without the liveness wiring above.
const heartbeat = startHeartbeat(wss);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
// Loopback by default: a dev server on 0.0.0.0 lets anyone on the same network
// spend our TTS / live / STT keys. Containers opt in with AIRP_HOST=0.0.0.0.
const HOST = process.env.AIRP_HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`[AIRP Server] Listening on http://${HOST}:${PORT} and http://localhost:${PORT}`);
});

// Retire every spawned agent and browser on shutdown.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    heartbeat.stop();
    void Promise.all([lifecycle.stopAll(), canvasArranger.stopAll()]).finally(async () => {
      await closeCanvasBrowser();
      process.exit(0);
    });
  });
}
