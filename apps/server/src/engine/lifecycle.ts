import fs from 'node:fs';
import path from 'node:path';
import { discoverModels, readCatalogGeneration, readCatalogSnapshot, writeCatalogGeneration, writeCatalogSnapshot, isOfficialOpenAIBaseUrl, type CatalogModel, type CatalogSnapshot, type CredentialPair, ModelCatalogError, OFFICIAL_OPENAI_PROVIDER, OFFICIAL_OPENAI_MODEL, CUSTOM_OPENAI_PROVIDER } from './openai-model-catalog.js';
import { randomUUID } from 'node:crypto';
import { RpcClient } from '../../../../vendor/pi-rp/packages/coding-agent/dist/index.js';
import type { JsonAgentSessionEvent } from '../../../../vendor/pi-rp/packages/coding-agent/dist/index.js';

import { CHARACTER_ROLE_PREFIX } from '@airp/shared';

import { assertCharacterLaunchable, characterLaunch, hasExistingSession, retireSessionsForLoop, writerLaunch } from './launch.js';
import { agentSpawnEnv } from './agent-env.js';
import { isHiddenProvider, readModelPreferences, userFacingModels, writeModelPreferences, type ModelPreference } from './model-preferences.js';
import { AgentBeatRecorder, type WriterFastPath } from './writer-fast-path.js';
import { compactionDue, earlyReleaseEnabled, isLandingTool, isThinkingLevel, writerBeatThinking, writerCompactionFromEnv, writerThinkingConfigFromEnv, type ThinkingLevel } from './writer-beat-policy.js';
/** Raw WS frame produced by lifecycle itself (warmup replay), not by the engine event map. */
export type FrameSink = (message: Record<string, any>) => void;
/** Engine event sink — `eventBridge.emitEngine`. */
export type EventSink = (
  source: 'writer' | 'character',
  event: JsonAgentSessionEvent,
  characterId?: string,
  turnId?: string,
  savePath?: string,
) => void;
export type ActivityFailureSink = (
  source: 'writer' | 'character',
  characterId: string | undefined,
  turnId: string,
  reason: 'timeout' | 'cancelled' | 'agent_stopped',
  savePath?: string,
) => void;

export interface AgentLifecycleManagerOptions {
  repoRoot: string;
  vendorCliPath: string;
  eventSink?: EventSink;
  frameSink?: FrameSink;
  activityFailureSink?: ActivityFailureSink;
  /** The writer's fast path (engine/writer-fast-path.ts); absent = agent only. */
  fastPath?: WriterFastPath;
}
export interface OpenAIRefreshResult {
  status: 'discovering' | 'waiting' | 'activating' | 'success' | 'rolled-back' | 'cancelled' | 'error';
  count?: number;
  error?: string;
}

interface PendingOpenAIRefresh {
  worldRoot: string;
  worldEpoch: number;
  writerGeneration: number;
  pendingGeneration: string;
  pair: CredentialPair;
  status: OpenAIRefreshResult['status'];
  count?: number;
  error?: string;
  cancelled: boolean;
  ownsSwitchLock: boolean;
  abortController: AbortController;
  promise: Promise<void>;
  settled: boolean;
}
type CharacterStopStatus = 'deferred' | 'completed' | 'superseded' | 'error';

interface DeferredCharacterStop {
  characterId: string;
  worldRoot: string;
  worldEpoch: number;
  beforeStop: () => Promise<unknown>;
  processing: boolean;
  statusHandlers: Array<(status: CharacterStopStatus) => void>;
  terminalStatus?: CharacterStopStatus;
}

interface FileSnapshot { exists: boolean; contents: string; mode: number }

/**
 * `'character:nanami'` → `'nanami'`. Anything else (writer, empty id, other
 * keys) → `undefined`. Pure and exported so the derivation is unit-testable
 * without a live agent.
 *
 * Empty id returns `undefined` on purpose: the frontend falls back with
 * `detail.characterId ?? openOverlayId`, and `''` is not nullish.
 */
export function characterIdFromClientKey(clientKey: string): string | undefined {
  if (!clientKey.startsWith(CHARACTER_ROLE_PREFIX)) return undefined;
  const id = clientKey.slice(CHARACTER_ROLE_PREFIX.length);
  return id === '' ? undefined : id;
}

/** Warmup delay: give the engine a moment to finish restoring the resumed session. */
const WARMUP_DELAY_MS = { continued: 800 } as const;

/**
 * Crash-restart backoff (T0.5). The engine's RpcClient has no exit callback, so a
 * liveness probe notices death; these are the retry gaps, capped at 30s.
 */
const RESTART_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];
const MAX_RESTART_ATTEMPTS = 5;
const LIVENESS_PROBE_MS = 5000;
const DEFAULT_TURN_TIMEOUT_MS = 90000;
const MAX_TURN_DURATION_MS = 300000;

/**
 * Owns pi-rp agent processes: one writer per world (reused), one character per id,
 * plus liveness probing, backoff restart, turn timeout safeguards, and warmup replay
 * of the custom entries emitted before our event subscription existed.
 *
 * Everything protocol-level lives in the vendored `RpcClient` — this class never
 * touches stdio or JSONL framing.
 */
export class AgentLifecycleManager {
  private repoRoot: string;
  private vendorCliPath: string;
  private eventSink: EventSink | undefined;
  private frameSink: FrameSink | undefined;
  private activityFailureSink: ActivityFailureSink | undefined;

  private writer: RpcClient | null = null;
  private writerWorld: string | null = null;
  private writerPing: NodeJS.Timeout | null = null;
  private writerRestarts = 0;
  private writerEpoch = 0;
  private writerRestartGeneration = 0;
  private writerRestartRetry: { worldRoot: string; generation: number; epoch: number; timer: NodeJS.Timeout } | null = null;
  private characterClients = new Map<string, RpcClient>();
  private characterEpochs = new Map<string, number>();
  private characterWorldEpoch = 0;
  private characterWorldRoot: string | null | undefined;
  private characterWorldTransition = false;
  private turnStartedAt = new Map<string, number>();
  private turnTimeouts = new Map<string, NodeJS.Timeout>();
  private turnIds = new Map<string, string>();
  private writerQueue: Promise<void> = Promise.resolve();
  private queuedBeats = 0;
  /**
   * Per-beat thinking. `base` is the level the
   * writer process was launched with (the player's choice, default low) and is
   * what big beats use; ordinary beats switch to off. Tracked per client so a
   * restarted writer re-reads its own launch level.
   */
  private writerThinking: { client: RpcClient; base: ThinkingLevel; now: ThinkingLevel } | null = null;
  /**
   * A character's thinking during a voice call: off. A caller
   * hears reasoning time as dead air — its first token is what they are waiting
   * for — so a turn that arrives over a call (`character_prompt { via: 'voice' }`)
   * runs with thinking off, and the next typed turn gets the launch level back.
   * Keyed by client, so a restarted character re-reads its own launch level.
   */
  private characterThinking = new WeakMap<RpcClient, { base: ThinkingLevel; now: ThinkingLevel }>();
  /** A writer tool call failed during the running beat; the next beat thinks. */
  private writerBeatToolError = false;
  /**
   * The player beat now running. `landed` turns
   * true at its first page change: the player is released then, and ONE more
   * beat may wait behind this one instead of being refused. `waiting` is that
   * beat's ticket — a Stop cancels it before it ever prompts.
   */
  private writerBeat: { landed: boolean } | null = null;
  private fastPath: WriterFastPath | undefined;
  /** Shadow mode: the agent beat being recorded for the fast path's comparison log. */
  private writerRecorder: AgentBeatRecorder | null = null;
  private writerWaiting: { cancelled: boolean } | null = null;
  private writerToolPaths = new Map<string, unknown>();
  /**
   * One turn queue per character (the design notes:
   * 「这两个是一个Agent就好。」).
   *
   * The voice call and the dock are two mouths on ONE character — same process,
   * same memory, and that continuity is the point. But pi runs one turn at a
   * time (integration.md §7.1), so two mouths mean two callers racing for one
   * turn: voice-live with `VOICE_LIVE_BRAIN=airp` prompts over the canvas
   * WebSocket exactly as the dock does. Before this queue they could overlap.
   *
   * The writer's queue REJECTS a second beat; this one WAITS. A dock message
   * typed during a call must not be lost, and the player can see it is pending.
   */
  private characterTurnQueues = new Map<string, Promise<unknown>>();
  private characterTurnDepth = new Map<string, number>();
  private switchingModels = false;
  private openAIRefresh: PendingOpenAIRefresh | null = null;
  private stoppingAll = false;
  private deferredCharacterStops = new Map<string, DeferredCharacterStop>();
  private flushingCharacterStops: Promise<void> | null = null;
  private inFlightAgentDispatches = 0;
  private progress = new Map<string, { stage: string; startedAt: number; updatedAt: number }>();

  isModelSwitching() { return this.switchingModels; }
  isWorldRootCurrent(worldRoot: string): boolean {
    return !this.characterWorldTransition &&
      (this.characterWorldRoot === undefined || this.characterWorldRoot === worldRoot);
  }
  /** Monotonic across begin/complete, even when a save with the same root is reloaded. */
  getWorldEpoch(): number { return this.characterWorldEpoch; }
  isWorldIdentityCurrent(worldRoot: string, worldEpoch: number): boolean {
    return this.characterWorldEpoch === worldEpoch && this.isWorldRootCurrent(worldRoot);
  }

  async modelStatus(worldRoot: string, includeModels = true) {
    const writer = this.switchingModels && this.writer && this.writerWorld === worldRoot
      ? this.writer
      : await this.startWriter(worldRoot);
    const [state, models] = await Promise.all([writer.getState(), includeModels ? writer.getAvailableModels() : Promise.resolve([])]);
    const characters = await Promise.all([...this.characterClients].map(async ([id, client]) => {
      const s = await client.getState();
      return { id, model: s.model ? { provider: s.model.provider, id: s.model.id } : null, thinking: s.thinkingLevel };
    }));
    const snapshot = readCatalogSnapshot(this.repoRoot);
    const activeGeneration = Number.parseInt(process.env.AIRP_CUSTOM_OPENAI_GENERATION ?? '', 10);
    const activeBaseUrl = process.env.AIRP_CUSTOM_OPENAI_BASE_URL?.replace(/\/+$/, '');
    const customConfigured = Boolean(snapshot && process.env.AIRP_CUSTOM_OPENAI_BASE_URL?.trim() && process.env.AIRP_CUSTOM_OPENAI_API_KEY?.trim() &&
      Number.isSafeInteger(activeGeneration) && activeBaseUrl && snapshot.baseUrl === activeBaseUrl && snapshot.generation === activeGeneration && readCatalogGeneration(this.repoRoot) === activeGeneration);
    const officialBaseUrl = (process.env.OPENAI_BASE_URL ?? '').trim();
    const officialConfigured = Boolean(process.env.OPENAI_API_KEY?.trim() && (!officialBaseUrl || isOfficialOpenAIBaseUrl(officialBaseUrl)));
    const visibleModels = userFacingModels(models).filter(model => model.provider !== 'openai' &&
      (model.provider !== OFFICIAL_OPENAI_PROVIDER || model.id === OFFICIAL_OPENAI_MODEL) &&
      (model.provider !== CUSTOM_OPENAI_PROVIDER || customConfigured));
    return { world: worldRoot, preferences: readModelPreferences(worldRoot),
      officialOpenAI: { configured: officialConfigured, available: officialConfigured },
      customOpenAI: { pendingConfigured: Boolean(process.env.AIRP_CUSTOM_OPENAI_PENDING_BASE_URL?.trim() && process.env.AIRP_CUSTOM_OPENAI_PENDING_API_KEY?.trim()),
        activeConfigured: customConfigured, activeModelCount: customConfigured ? snapshot?.models.length ?? 0 : 0 },
      // The launch level, not the per-beat switch (§2): an ordinary beat runs with thinking off.
      writer: { model: state.model ? { provider: state.model.provider, id: state.model.id } : null, thinking: this.writerThinking?.client === writer ? this.writerThinking.base : state.thinkingLevel },
      characters, models: visibleModels.map(model => ({
        provider: model.provider,
        id: model.id,
        name: snapshot?.models.find(candidate => candidate.id === model.id)?.name ?? model.id,
      })),
      busy: this.switchingModels || this.queuedBeats > 0 || this.turnStartedAt.size > 0 || this.characterTurnDepth.size > 0 || state.isStreaming,
      progress: Object.fromEntries(this.progress), active: [...this.turnStartedAt.keys()], queued: this.queuedBeats };
  }

  getOpenAIRefreshStatus(): OpenAIRefreshResult {
    const refresh = this.openAIRefresh;
    return refresh ? { status: refresh.status, ...(refresh.count === undefined ? {} : { count: refresh.count }), ...(refresh.error ? { error: refresh.error } : {}) } : { status: 'error', error: 'not-started' };
  }

  async refreshOpenAICatalog(worldRoot: string): Promise<OpenAIRefreshResult> {
    const existing = this.openAIRefresh;
    if (existing && !existing.settled) {
      if (existing.status !== 'cancelled') return this.getOpenAIRefreshStatus();
      await existing.promise;
    }
    this.assertWorldAvailable(worldRoot);
    if (this.switchingModels) return { status: 'error', error: 'model-switch-in-progress' };
    const baseUrl = process.env.AIRP_CUSTOM_OPENAI_PENDING_BASE_URL?.trim() ?? '';
    const apiKey = process.env.AIRP_CUSTOM_OPENAI_PENDING_API_KEY?.trim() ?? '';
    const pendingGeneration = process.env.AIRP_CUSTOM_OPENAI_PENDING_GENERATION ?? '';
    if (!baseUrl || !apiKey) return { status: 'error', error: 'missing-credentials' };
    if (!/^\d+$/.test(pendingGeneration)) return { status: 'error', error: 'pending-generation-missing' };
    const refresh: PendingOpenAIRefresh = {
      worldRoot, worldEpoch: this.characterWorldEpoch, writerGeneration: this.writerRestartGeneration,
      pendingGeneration, pair: { baseUrl, apiKey }, status: 'discovering', cancelled: false, ownsSwitchLock: false, abortController: new AbortController(), settled: false,
      promise: Promise.resolve(),
    };
    this.openAIRefresh = refresh;
    refresh.promise = this.runOpenAIRefresh(refresh).catch(async () => {
      refresh.status = 'error';
      refresh.error = 'refresh-failed';
      if (refresh.ownsSwitchLock) await this.finishOpenAIRefreshLock(refresh);
    }).finally(() => { refresh.settled = true; });
    return this.getOpenAIRefreshStatus();
  }

  async cancelOpenAIRefresh(): Promise<OpenAIRefreshResult> {
    const refresh = this.openAIRefresh;
    if (!refresh || refresh.settled) return this.getOpenAIRefreshStatus();
    if (refresh.status === 'activating') return this.getOpenAIRefreshStatus();
    refresh.cancelled = true;
    refresh.abortController.abort();
    refresh.status = 'cancelled';
    return this.getOpenAIRefreshStatus();
  }

  private openAIRefreshIsCurrent(refresh: PendingOpenAIRefresh): boolean {
    return !refresh.cancelled && !this.characterWorldTransition &&
      (this.characterWorldRoot === undefined || this.characterWorldRoot === refresh.worldRoot) &&
      this.characterWorldEpoch === refresh.worldEpoch &&
      this.writerRestartGeneration === refresh.writerGeneration &&
      process.env.AIRP_CUSTOM_OPENAI_PENDING_GENERATION === refresh.pendingGeneration &&
      process.env.AIRP_CUSTOM_OPENAI_PENDING_BASE_URL === refresh.pair.baseUrl &&
      process.env.AIRP_CUSTOM_OPENAI_PENDING_API_KEY === refresh.pair.apiKey;
  }

  private async runOpenAIRefresh(refresh: PendingOpenAIRefresh): Promise<void> {
    let staged: { baseUrl: string; models: CatalogModel[] };
    try {
      staged = await discoverModels(refresh.pair, fetch, refresh.abortController.signal);
    } catch (error) {
      if (refresh.cancelled || this.characterWorldEpoch !== refresh.worldEpoch) {
        refresh.status = 'cancelled';
        return;
      }
      refresh.status = 'error';
      refresh.error = error instanceof ModelCatalogError ? error.category : 'discovery-failed';
      return;
    }
    if (!this.openAIRefreshIsCurrent(refresh)) {
      refresh.status = refresh.cancelled || this.characterWorldEpoch !== refresh.worldEpoch ? 'cancelled' : 'error';
      refresh.error = refresh.status === 'error' ? 'configuration-changed' : undefined;
      return;
    }
    const previous = readCatalogSnapshot(this.repoRoot);
    const preferences = readModelPreferences(refresh.worldRoot);
    for (const preference of Object.values(preferences)) {
      if (preference?.provider === CUSTOM_OPENAI_PROVIDER && previous?.models.some(model => model.id === preference.model) &&
        !staged.models.some(model => model.id === preference.model)) {
        refresh.status = 'error';
        refresh.error = 'saved-custom-model-would-be-removed';
        return;
      }
    }
    if (this.switchingModels) {
      refresh.status = 'error';
      refresh.error = 'model-switch-in-progress';
      return;
    }
    this.switchingModels = true;
    refresh.ownsSwitchLock = true;
    refresh.status = 'waiting';
    while (await this.openAIAgentsBusy(refresh.worldRoot)) {
      if (!this.openAIRefreshIsCurrent(refresh)) {
        refresh.status = refresh.cancelled || this.characterWorldEpoch !== refresh.worldEpoch ? 'cancelled' : 'error';
        refresh.error = refresh.status === 'error' ? 'configuration-changed' : undefined;
        await this.finishOpenAIRefreshLock(refresh);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!this.openAIRefreshIsCurrent(refresh)) {
      refresh.status = refresh.cancelled || this.characterWorldEpoch !== refresh.worldEpoch ? 'cancelled' : 'error';
      refresh.error = refresh.status === 'error' ? 'configuration-changed' : undefined;
      await this.finishOpenAIRefreshLock(refresh);
      return;
    }
    refresh.status = 'activating';
    const envFile = path.join(this.repoRoot, '.env.local');
    const catalogFile = path.join(this.repoRoot, '.airp-openai-catalog.json');
    const generationFile = path.join(this.repoRoot, '.airp-openai-generation.json');
    let priorEnvFile: FileSnapshot;
    let priorCatalogFile: FileSnapshot;
    let priorGenerationFile: FileSnapshot;
    try {
      priorEnvFile = this.captureFile(envFile);
      priorCatalogFile = this.captureFile(catalogFile);
      priorGenerationFile = this.captureFile(generationFile);
    } catch {
      refresh.status = 'error';
      refresh.error = 'unsafe-config-file';
      await this.finishOpenAIRefreshLock(refresh);
      return;
    }
    const activeNames = ['AIRP_CUSTOM_OPENAI_BASE_URL', 'AIRP_CUSTOM_OPENAI_API_KEY', 'AIRP_CUSTOM_OPENAI_GENERATION'] as const;
    const priorEnv = Object.fromEntries(activeNames.map(name => [name, process.env[name]])) as Record<typeof activeNames[number], string | undefined>;
    const wasWriterActive = this.writer !== null && this.writerWorld === refresh.worldRoot;
    const charactersToRestart = [...this.characterClients.keys()].filter(id => this.characterWorlds.get(id) === refresh.worldRoot);
    const priorGeneration = readCatalogGeneration(this.repoRoot);
    const generation = Math.max(priorGeneration, Number.parseInt(process.env.AIRP_CUSTOM_OPENAI_GENERATION ?? '0', 10) || 0) + 1;
    const snapshot: CatalogSnapshot = { generation, baseUrl: staged.baseUrl, models: staged.models };
    let runtimesStopped = false;
    try {
      const nextEnv = this.updateEnvironmentFile(priorEnvFile, {
        AIRP_CUSTOM_OPENAI_BASE_URL: staged.baseUrl,
        AIRP_CUSTOM_OPENAI_API_KEY: refresh.pair.apiKey,
        AIRP_CUSTOM_OPENAI_GENERATION: String(generation),
      });
      this.writeFileAtomically(envFile, nextEnv);
      writeCatalogSnapshot(this.repoRoot, snapshot);
      writeCatalogGeneration(this.repoRoot, generation);
      process.env.AIRP_CUSTOM_OPENAI_BASE_URL = staged.baseUrl;
      process.env.AIRP_CUSTOM_OPENAI_API_KEY = refresh.pair.apiKey;
      process.env.AIRP_CUSTOM_OPENAI_GENERATION = String(generation);
      runtimesStopped = true;
      if (wasWriterActive) {
        await this.stopWriterInternal();
        this.assertWorldAvailable(refresh.worldRoot);
      }
      if (!this.isOpenAIRefreshWorldCurrent(refresh)) throw new Error('world-changed');
      await this.startWriterInternal(refresh.worldRoot, true);
      if (!this.isOpenAIRefreshWorldCurrent(refresh)) throw new Error('world-changed');
      for (const characterId of charactersToRestart) {
        if (!this.isOpenAIRefreshWorldCurrent(refresh)) throw new Error('world-changed');
        await this.stopCharacterInternal(characterId);
        await this.startCharacterInternal(characterId, refresh.worldRoot, true);
      }
      if (!this.isOpenAIRefreshWorldCurrent(refresh)) throw new Error('world-changed');
      const writer = this.writer;
      if (!writer || this.writerWorld !== refresh.worldRoot) throw new Error('writer-not-active');
      const models = await writer.getAvailableModels();
      if (!this.isOpenAIRefreshWorldCurrent(refresh)) throw new Error('world-changed');
      const official = models.filter(model => model.provider === OFFICIAL_OPENAI_PROVIDER);
      if (official.length !== 1 || official[0].id !== OFFICIAL_OPENAI_MODEL) throw new Error('official-model-runtime-invalid');
      const customIds = models.filter(model => model.provider === CUSTOM_OPENAI_PROVIDER).map(model => model.id).sort();
      const expectedIds = staged.models.map(model => model.id).sort();
      if (customIds.length !== expectedIds.length || customIds.some((id, index) => id !== expectedIds[index])) throw new Error('custom-model-runtime-invalid');
      refresh.status = 'success';
      refresh.count = staged.models.length;
    } catch {
      const worldChanged = !this.isOpenAIRefreshWorldCurrent(refresh);
      try {
        this.restoreFile(envFile, priorEnvFile);
        this.restoreFile(catalogFile, priorCatalogFile);
        this.restoreFile(generationFile, priorGenerationFile);
        for (const name of activeNames) {
          const value = priorEnv[name];
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      } catch {
        refresh.status = 'error';
        refresh.error = 'rollback-failed';
        return;
      }
      if (worldChanged) {
        refresh.status = refresh.cancelled ? 'cancelled' : 'error';
        refresh.error = refresh.cancelled ? undefined : 'world-changed';
      } else if (runtimesStopped) {
        try {
          await this.stopWriterInternal();
          if (wasWriterActive) await this.startWriterInternal(refresh.worldRoot, true);
          for (const characterId of charactersToRestart) {
            if (this.characterWorlds.get(characterId) === refresh.worldRoot) await this.stopCharacterInternal(characterId);
            await this.startCharacterInternal(characterId, refresh.worldRoot, true);
          }
          refresh.status = 'rolled-back';
          refresh.error = 'activation-failed';
        } catch {
          refresh.status = 'error';
          refresh.error = 'rollback-failed';
        }
      } else {
        refresh.status = 'rolled-back';
        refresh.error = 'activation-failed';
      }
    } finally {
      if (refresh.ownsSwitchLock) await this.finishOpenAIRefreshLock(refresh);
    }
  }

  private isOpenAIRefreshWorldCurrent(refresh: PendingOpenAIRefresh): boolean {
    return !refresh.cancelled && !this.stoppingAll && !this.characterWorldTransition && this.characterWorldEpoch === refresh.worldEpoch &&
      (this.characterWorldRoot === undefined || this.characterWorldRoot === refresh.worldRoot);
  }
  private async openAIAgentsBusy(worldRoot: string): Promise<boolean> {
    if (this.inFlightAgentDispatches > 0 || this.queuedBeats > 0 || this.turnStartedAt.size > 0 || this.characterTurnDepth.size > 0 ||
      this.characterStarting.size > 0 || this.writerStarting !== null) return true;
    if (this.writer && this.writerWorld === worldRoot && (await this.writer.getState()).isStreaming) return true;
    for (const [id, client] of this.characterClients) {
      if (this.characterWorlds.get(id) === worldRoot && (await client.getState()).isStreaming) return true;
    }
    return false;
  }

  private captureFile(file: string): FileSnapshot {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe model catalog configuration file.');
      return { exists: true, contents: fs.readFileSync(file, 'utf8'), mode: stat.mode & 0o777 };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { exists: false, contents: '', mode: 0o600 };
      throw error;
    }
  }

  private restoreFile(file: string, snapshot: FileSnapshot): void {
    if (!snapshot.exists) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return;
    }
    this.writeFileAtomically(file, snapshot.contents, snapshot.mode);
  }

  private writeFileAtomically(file: string, contents: string, mode = 0o600): void {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, contents, { mode, flag: 'wx' });
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }

  private updateEnvironmentFile(snapshot: FileSnapshot, updates: Record<string, string>): string {
    let contents = snapshot.contents;
    for (const [key, value] of Object.entries(updates)) {
      contents = contents.replace(new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, 'gm'), '');
      contents = `${contents.trimEnd()}\n${key}="${value}"\n`;
    }
    return contents;
  }
  async changeModel(worldRoot: string, role: 'writer' | 'character', preference: ModelPreference) {
    const officialUrl = (process.env.OPENAI_BASE_URL ?? '').trim();
    const officialConfigured = Boolean(process.env.OPENAI_API_KEY?.trim() && (!officialUrl || isOfficialOpenAIBaseUrl(officialUrl)));
    // A provider Worldlines no longer offers is refused before any agent starts (model-preferences.ts).
    if (isHiddenProvider(preference.provider)) throw new Error('This model is not available in the engine.');
    if (preference.provider === 'openai') throw new Error('This OpenAI account model cannot be selected in AIRP.');
    if (preference.provider === OFFICIAL_OPENAI_PROVIDER && (preference.model !== OFFICIAL_OPENAI_MODEL || !officialConfigured)) {
      throw new Error('The official OpenAI model is unavailable until its official API key is configured.');
    }
    if (preference.provider === CUSTOM_OPENAI_PROVIDER) {
      const snapshot = readCatalogSnapshot(this.repoRoot);
      const generation = Number.parseInt(process.env.AIRP_CUSTOM_OPENAI_GENERATION ?? '', 10);
      if (!process.env.AIRP_CUSTOM_OPENAI_BASE_URL || !process.env.AIRP_CUSTOM_OPENAI_API_KEY || !snapshot ||
        !Number.isSafeInteger(generation) || snapshot.baseUrl !== process.env.AIRP_CUSTOM_OPENAI_BASE_URL.replace(/\/+$/, '') ||
        snapshot.generation !== generation || readCatalogGeneration(this.repoRoot) !== generation ||
        !snapshot.models.some(model => model.id === preference.model)) throw new Error('This custom OpenAI model is not active.');
    }
    if (this.switchingModels || this.queuedBeats || this.turnStartedAt.size) throw new Error('Wait for the current turn to finish before changing models.');
    this.switchingModels = true;
    const previous = readModelPreferences(worldRoot);
    try {
      const writer = await this.startWriterInternal(worldRoot, true);
      const models = await writer.getAvailableModels();
      if (isHiddenProvider(preference.provider) || !models.some(m => m.provider === preference.provider && m.id === preference.model)) throw new Error('This model is not available in the engine.');
      writeModelPreferences(worldRoot, { ...previous, [role]: preference });
      if (role === 'writer') {
        await this.stopWriterInternal();
        const next = await this.startWriterInternal(worldRoot, true);
        const state = await next.getState();
        if (state.model?.id !== preference.model || state.model?.provider !== preference.provider) throw new Error('The engine did not activate the selected model.');
      } else {
        for (const id of new Set([...this.characterClients.keys(), ...this.characterStarting.keys()])) {
          await this.stopCharacterInternal(id);
          const next = await this.startCharacterInternal(id, worldRoot, true);
          const state = await next.getState();
          if (state.model?.id !== preference.model || state.model?.provider !== preference.provider) throw new Error('The character did not activate the selected model.');
        }
      }
    } catch (error) {
      writeModelPreferences(worldRoot, previous);
      if (role === 'writer') await this.stopWriterInternal();
      else for (const id of new Set([...this.characterClients.keys(), ...this.characterStarting.keys()])) await this.stopCharacterInternal(id);
      throw error;
    } finally {
      await this.flushDeferredCharacterStops();
      this.releaseModelSwitchLock();
    }
    return this.modelStatus(worldRoot);
  }
  private assertModelRequestAvailable(model: { provider: string; id: string } | null | undefined): void {
    if (model === null || model === undefined) return;
    if (model.provider === OFFICIAL_OPENAI_PROVIDER) {
      const baseUrl = (process.env.OPENAI_BASE_URL ?? '').trim();
      const configured = Boolean(process.env.OPENAI_API_KEY?.trim() && (!baseUrl || isOfficialOpenAIBaseUrl(baseUrl)));
      if (!configured || model.id !== OFFICIAL_OPENAI_MODEL) throw new Error('The selected official OpenAI model has no configured official key.');
    } else if (model.provider === CUSTOM_OPENAI_PROVIDER) {
      const snapshot = readCatalogSnapshot(this.repoRoot);
      const generation = Number.parseInt(process.env.AIRP_CUSTOM_OPENAI_GENERATION ?? '', 10);
      if (!snapshot || !Number.isSafeInteger(generation) || snapshot.generation !== generation ||
        snapshot.baseUrl !== process.env.AIRP_CUSTOM_OPENAI_BASE_URL?.replace(/\/+$/, '') ||
        readCatalogGeneration(this.repoRoot) !== generation || !process.env.AIRP_CUSTOM_OPENAI_API_KEY?.trim() ||
        !snapshot.models.some(candidate => candidate.id === model.id)) {
        throw new Error('The selected custom OpenAI model is no longer active.');
      }
    }
  }

  private writerStarting: { world: string; generation: number; promise: Promise<RpcClient> } | null = null;

  /** Resolve player beats in order, including their file updates. */
  submitWriter(worldRoot: string, message: string): Promise<void> {
    if (this.characterWorldTransition || (this.characterWorldRoot !== undefined && this.characterWorldRoot !== worldRoot)) {
      return Promise.reject(new Error('The active world changed.'));
    }
    if (this.switchingModels) return Promise.reject(new Error('Models are switching. Please try again shortly.'));
    // Behind a beat that has already landed, one more beat waits its turn (§3):
    // it starts only after that beat truly settles, so the two never overlap.
    const behindLanded = this.queuedBeats === 1 && this.writerBeat?.landed === true && this.writerWaiting === null;
    if ((this.queuedBeats > 0 || this.turnStartedAt.has('writer')) && !behindLanded) return Promise.reject(new Error('The writer is still resolving your previous action. Wait or stop it before continuing.'));
    const ticket = behindLanded ? { cancelled: false } : null;
    if (ticket) this.writerWaiting = ticket;
    this.queuedBeats++;
    const queuedWorld = this.writerStarting?.world ?? this.writerWorld;
    const pending = this.writerQueue.catch(() => {}).then(async () => {
      if (ticket) {
        if (this.writerWaiting === ticket) this.writerWaiting = null;
        if (ticket.cancelled) throw new Error('The writer stopped before your next action started.');
      }
      if (queuedWorld && (this.writerStarting?.world ?? this.writerWorld) !== queuedWorld) throw new Error('The active world changed.');
      if (this.characterWorldTransition || (this.characterWorldRoot !== undefined && this.characterWorldRoot !== worldRoot)) {
        throw new Error('The active world changed.');
      }
      // The fast path: `on` answers the beat in
      // one call when it may; `shadow` runs it beside the agent and only logs.
      const fast = this.fastPath;
      const fastMode = fast?.mode() ?? 'off';
      if (fast && fastMode === 'on' && await this.runFastBeat(fast, worldRoot, message)) return;
      let shadow: Promise<{ finish(agent: AgentBeatRecorder | null): Promise<void> } | null> | null = null;
      const recorder = fast && fastMode === 'shadow' ? new AgentBeatRecorder() : null;
      if (fast && recorder) shadow = fast.shadow(worldRoot, message).catch(() => null);
      let client: RpcClient;
      try {
        client = await this.startWriter(worldRoot);
        const state = await client.getState();
        this.assertModelRequestAvailable(state.model);
        await this.applyBeatThinking(client, state.thinkingLevel, message);
      } catch (error) {
        // The agent never ran: the shadow still logs what the fast path would have done.
        if (shadow) void shadow.then((s) => s?.finish(null)).catch(() => {});
        throw error;
      }
      const beat = { landed: false };
      this.writerBeat = beat;
      this.writerRecorder = recorder;
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { off(); void client.abort().catch(() => {}); reject(new Error('Writer response timed out. Please try again.')); }, MAX_TURN_DURATION_MS);
          const off = client.onEvent(event => {
            if (event.type !== 'agent_settled') return;
            clearTimeout(timer);
            off();
            resolve();
          });
          client.prompt(message).catch(error => { clearTimeout(timer); off(); reject(error); });
        });
      } finally {
        if (this.writerBeat === beat) this.writerBeat = null;
        if (this.writerRecorder === recorder) this.writerRecorder = null;
        if (shadow) void shadow.then((s) => s?.finish(recorder)).catch(() => {});
      }
    });
    const tracked = pending.finally(() => {
      this.queuedBeats--;
      if (ticket && this.writerWaiting === ticket) this.writerWaiting = null;
    });
    // Between beats, not inside one (§4): a beat that arrives meanwhile waits
    // behind the compaction on the same queue, so the two never overlap.
    const compacted = tracked.catch(() => {}).then(() => this.compactWriterIfDue(worldRoot));
    this.writerQueue = compacted;
    return tracked;
  }

  /**
   * One beat on the fast path (`AIRP_WRITER_FAST_PATH=on`). True = answered;
   * false = the agent takes this beat (§5: pre-route, no model, the model asked
   * for the agent, nothing streamed…). Frames ride the existing chalk lane; the
   * synthetic `agent_start` / `agent_settled` go through the writer's own sink,
   * so the dice settle and `writer_idle` happen exactly as after an agent turn.
   */
  private async runFastBeat(fast: WriterFastPath, worldRoot: string, message: string): Promise<boolean> {
    const gate = await fast.gate(worldRoot, message);
    if (!gate.ok) {
      if (gate.reason !== 'off') console.info(`[AIRP FastPath] agent beat: ${gate.reason}`);
      return false;
    }
    const beat = { landed: false };
    this.writerBeat = beat;
    this.turnStartedAt.set('writer', Date.now());
    const turnId = `writer:${randomUUID()}`;
    try {
      const result = await fast.run(worldRoot, message, {
        frame: (m) => {
          if (m.type === 'agent_progress' && m.landed === true) beat.landed = true;
          this.frameSink?.({ ...m, savePath: worldRoot, timestamp: new Date().toISOString() });
        },
        event: (e) => this.eventSink?.('writer', e as unknown as JsonAgentSessionEvent, undefined, turnId, worldRoot),
      }, gate);
      if (!result.handled) console.info(`[AIRP FastPath] beat → agent: ${result.fallback}`);
      return result.handled;
    } finally {
      this.turnStartedAt.delete('writer');
      if (this.writerBeat === beat) this.writerBeat = null;
    }
  }

  /**
   * Fold old beats into a summary once the writer's context passes the
   * threshold. Runs after a beat settles, never
   * while another beat waits (that one goes first; the next gap compacts).
   * pi-rp's own compaction keeps the recent `keepRecentTokens` verbatim and
   * summarises the rest with the writer preset's compaction prompts. Never
   * throws: a failed compaction leaves the session as it was.
   */
  private async compactWriterIfDue(worldRoot: string): Promise<void> {
    const cfg = writerCompactionFromEnv();
    const client = this.writer;
    if (!cfg.enabled || !client || this.writerWorld !== worldRoot || this.queuedBeats > 0 || this.switchingModels) return;
    try {
      const stats = await client.getSessionStats();
      if (!compactionDue(stats.contextUsage?.tokens, cfg)) return;
      if (this.writer !== client || this.queuedBeats > 0) return;
      // The summary call runs on the session's thinking level; under the
      // adaptive policy (§2) it gets none — the next beat sets its own level.
      if (writerThinkingConfigFromEnv().mode === 'adaptive') await this.setWriterThinking(client, 'off');
      await client.compact();
    } catch (error) {
      console.warn('[AIRP Lifecycle] writer compaction failed:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Choose this beat's thinking level and switch
   * the writer only when it changes. `current` is the client's reported level,
   * read once per process as the base. A failed switch keeps the beat going on
   * whatever level the writer already has.
   */
  private async applyBeatThinking(client: RpcClient, current: unknown, message: string): Promise<void> {
    if (this.writerThinking?.client !== client) {
      const base = isThinkingLevel(current) ? current : 'low';
      this.writerThinking = { client, base, now: base };
    }
    const lastBeatToolError = this.writerBeatToolError;
    this.writerBeatToolError = false;
    const { level } = writerBeatThinking(message, { base: this.writerThinking.base, lastBeatToolError, config: writerThinkingConfigFromEnv() });
    await this.setWriterThinking(client, level);
  }

  private async setWriterThinking(client: RpcClient, level: ThinkingLevel): Promise<void> {
    const tracked = this.writerThinking;
    if (!tracked || tracked.client !== client || tracked.now === level) return;
    try {
      await client.setThinkingLevel(level);
      tracked.now = level;
    } catch (error) {
      console.warn('[AIRP Lifecycle] writer thinking level switch failed:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Put the writer back on its launch level before a command that is not a
   * player beat (`/airp-init`): its subagents inherit the session level, and an
   * initializer should not run on an ordinary beat's "off".
   */
  async restoreWriterThinking(client: RpcClient): Promise<void> {
    const tracked = this.writerThinking;
    if (tracked?.client === client) await this.setWriterThinking(client, tracked.base);
  }

  /**
   * Put a character on the thinking level for where this turn came from: off for
   * a voice call, its launch level otherwise. Switches only when it changes; a
   * failed switch keeps the turn going on whatever level the character has.
   * Called inside `submitCharacterTurn`, so it never races the turn before it.
   */
  async applyCharacterThinking(client: RpcClient, via: 'dialogue' | 'voice'): Promise<void> {
    try {
      let tracked = this.characterThinking.get(client);
      if (!tracked) {
        if (via !== 'voice') return; // never switched: nothing to restore
        const current = (await client.getState()).thinkingLevel;
        const base = isThinkingLevel(current) ? current : 'low';
        tracked = { base, now: base };
        this.characterThinking.set(client, tracked);
      }
      const level: ThinkingLevel = via === 'voice' ? 'off' : tracked.base;
      if (tracked.now === level) return;
      await client.setThinkingLevel(level);
      tracked.now = level;
    } catch (error) {
      console.warn('[AIRP Lifecycle] character thinking level switch failed:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * A loop reset: every
   * character agent stops and its thread is forgotten; the writer finishes the
   * beat it is on, then its thread is set aside so the next beat starts a new
   * one — the new loop's context is the engine's recap, not the old loop's talk.
   * Queued behind the writer's beats; never throws.
   */
  resetForLoop(worldRoot: string, loop: number): Promise<void> {
    const run = this.writerQueue.catch(() => {}).then(async () => {
      if (this.characterWorldRoot !== undefined && this.characterWorldRoot !== worldRoot) return;
      await this.stopCharacters().catch(() => {});
      if (this.writer && this.writerWorld === worldRoot) await this.stopWriterInternal().catch(() => {});
      retireSessionsForLoop(worldRoot, loop);
    }).catch((error) => {
      console.warn('[AIRP Lifecycle] loop reset could not retire agent sessions:', error);
    });
    this.writerQueue = run;
    return run;
  }

  /**
   * How many turns may wait behind the running one before we refuse. A
   * character eight turns behind has already lost the thread, and an unbounded
   * queue would turn a stuck agent into unbounded memory.
   */
  private static readonly MAX_QUEUED_CHARACTER_TURNS = 8;

  /** Turns waiting or running for this character. 0 means the next one starts at once. */
  queuedCharacterTurns(characterId: string): number {
    return this.characterTurnDepth.get(characterId) ?? 0;
  }

  /**
   * Run one character turn, serialised against every other turn for the SAME
   * character. Different characters still run in parallel — they are different
   * processes.
   *
   * Every path that opens a turn must go through here: the dock's
   * `character_prompt`, and the live call's delegation. A caller that prompts
   * its client directly re-opens the race this exists to close.
   *
   * `steer` deliberately does NOT belong here — it is pi's way of injecting
   * into a turn that is already running (integration.md §7.1), so queueing it
   * behind that turn would defeat its only purpose.
   */
  submitCharacterTurn<T>(characterId: string, run: () => Promise<T>): Promise<T> {
    if (this.switchingModels) return Promise.reject(new Error('Models are switching. Please try again shortly.'));
    const sourceRoot = this.characterWorlds.get(characterId);
    if (
      this.characterWorldTransition ||
      (this.characterWorldRoot !== undefined && sourceRoot !== this.characterWorldRoot)
    ) return Promise.reject(new Error('The active world changed.'));
    const depth = this.queuedCharacterTurns(characterId);
    if (depth >= AgentLifecycleManager.MAX_QUEUED_CHARACTER_TURNS) {
      return Promise.reject(new Error('This character is still answering earlier messages. Wait for it to catch up.'));
    }
    const epoch = this.characterEpochs.get(characterId) ?? 0;
    const worldEpoch = this.characterWorldEpoch;
    this.characterTurnDepth.set(characterId, depth + 1);
    const previous = this.characterTurnQueues.get(characterId) ?? Promise.resolve();
    // `.catch` first: one failed turn must not poison every turn behind it.
    const pending = previous.catch(() => {}).then(async () => {
      if (
        (this.characterEpochs.get(characterId) ?? 0) !== epoch ||
        this.characterWorldEpoch !== worldEpoch ||
        this.characterWorldTransition ||
        this.characterWorlds.get(characterId) !== sourceRoot ||
        (this.characterWorldRoot !== undefined && sourceRoot !== this.characterWorldRoot)
      ) {
        throw new Error('This character turn belongs to a save that is no longer active.');
      }
      const client = this.characterClients.get(characterId);
      if (client) this.assertModelRequestAvailable((await client.getState()).model);
      return run();
    });
    const tracked = pending.finally(() => {
      const left = this.queuedCharacterTurns(characterId) - 1;
      if (left <= 0) {
        this.characterTurnDepth.delete(characterId);
        this.characterTurnQueues.delete(characterId);
      } else {
        this.characterTurnDepth.set(characterId, left);
      }
    });
    // The chain holds the settled promise, not the rejecting one, so a later
    // turn never sees an unhandled rejection from an earlier one.
    this.characterTurnQueues.set(characterId, tracked.catch(() => {}));
    return tracked;
  }

  constructor(options: AgentLifecycleManagerOptions) {
    this.repoRoot = options.repoRoot;
    this.vendorCliPath = options.vendorCliPath;
    this.eventSink = options.eventSink;
    this.frameSink = options.frameSink;
    this.activityFailureSink = options.activityFailureSink;
    this.fastPath = options.fastPath;
  }

  private cancelWriterRestart(): void {
    if (!this.writerRestartRetry) return;
    clearTimeout(this.writerRestartRetry.timer);
    this.writerRestartRetry = null;
  }

  /** Fence character work and writer retries before a world-load await begins. */
  beginWorldTransition(): void {
    this.characterWorldTransition = true;
    if (this.openAIRefresh && !this.openAIRefresh.settled) {
      this.openAIRefresh.cancelled = true;
      this.openAIRefresh.abortController.abort();
      this.openAIRefresh.status = 'cancelled';
    }
    this.characterWorldEpoch += 1;
    this.writerRestartGeneration += 1;
    this.cancelWriterRestart();
    const characters = new Set([
      ...this.characterClients.keys(),
      ...this.characterStarting.keys(),
      ...this.characterTurnQueues.keys(),
      ...this.characterTurnDepth.keys(),
    ]);
    for (const characterId of characters) {
      this.characterEpochs.set(characterId, (this.characterEpochs.get(characterId) ?? 0) + 1);
    }
  }

  /** Publish the new root only after its store is active, or restore after a failed load. */
  completeWorldTransition(worldRoot: string | null): void {
    this.characterWorldRoot = worldRoot;
    this.characterWorldTransition = false;
    this.characterWorldEpoch += 1;
    const writer = this.writer;
    if (worldRoot !== null && writer && this.writerWorld === worldRoot && this.turnStartedAt.has('writer')) {
      this.armTurnTimeout('writer', writer, 'writer', worldRoot, this.writerEpoch);
    }
  }

  assertWorldAvailable(worldRoot: string): void {
    if (this.characterWorldTransition) throw new Error('A world transition is in progress.');
    if (this.characterWorldRoot !== undefined && this.characterWorldRoot !== worldRoot) {
      throw new Error('The active world changed.');
    }
  }

  /**
   * Start (or reuse) the world's writer.
   *
   * Reuse is deliberate: re-spawning the writer for the same world appends a
   * redundant `preset_change` entry to the session file every time. A different
   * world retires the old process first.
   */
  async startWriter(worldRoot: string): Promise<RpcClient> {
    return this.startWriterInternal(worldRoot, false);
  }

  private async startWriterInternal(worldRoot: string, allowDuringModelSwitch: boolean): Promise<RpcClient> {
    this.assertWorldAvailable(worldRoot);
    if (this.switchingModels && !allowDuringModelSwitch) throw new Error('Models are switching. Please try again shortly.');
    if (this.writer && this.writerWorld === worldRoot) {
      this.cancelWriterRestart();
      return this.writer;
    }
    if (this.writerStarting?.world === worldRoot && this.writerStarting.generation === this.writerRestartGeneration) {
      return this.writerStarting.promise;
    }
    const retry = this.writerRestartRetry;
    if (
      retry?.worldRoot === worldRoot &&
      retry.generation === this.writerRestartGeneration &&
      retry.epoch === this.writerEpoch
    ) {
      this.cancelWriterRestart();
      return this.startWriterForGeneration(worldRoot, retry.generation, allowDuringModelSwitch);
    }
    this.cancelWriterRestart();
    this.writerRestarts = 0;
    const generation = ++this.writerRestartGeneration;
    return this.startWriterForGeneration(worldRoot, generation, allowDuringModelSwitch);
  }

  private async startWriterForGeneration(worldRoot: string, generation: number, allowDuringModelSwitch = false): Promise<RpcClient> {
    if (this.switchingModels && !allowDuringModelSwitch) throw new Error('Models are switching. Please try again shortly.');
    if (generation !== this.writerRestartGeneration) throw new Error('The active world changed.');
    if (this.writerStarting) {
      if (this.writerStarting.world === worldRoot && this.writerStarting.generation === generation) {
        return this.writerStarting.promise;
      }
      await this.writerStarting.promise.catch(() => {});
      if (generation !== this.writerRestartGeneration) throw new Error('The active world changed.');
      this.assertWorldAvailable(worldRoot);
    }
    const promise = this.startWriterProcess(worldRoot, generation);
    this.writerStarting = { world: worldRoot, generation, promise };
    try {
      return await promise;
    } catch (error) {
      if (
        generation === this.writerRestartGeneration &&
        !this.characterWorldTransition &&
        (this.characterWorldRoot === undefined || this.characterWorldRoot === worldRoot) &&
        this.writer === null
      ) {
        this.scheduleWriterRestart(worldRoot, generation, this.writerEpoch);
      }
      throw error;
    } finally {
      if (this.writerStarting?.promise === promise) this.writerStarting = null;
    }
  }

  private async startWriterProcess(worldRoot: string, generation: number): Promise<RpcClient> {
    if (
      generation !== this.writerRestartGeneration ||
      this.characterWorldTransition ||
      (this.characterWorldRoot !== undefined && this.characterWorldRoot !== worldRoot)
    ) throw new Error('The active world changed.');
    if (this.writer && this.writerWorld === worldRoot) return this.writer;
    if (this.writer) await this.retireWriterProcess();
    if (generation !== this.writerRestartGeneration) throw new Error('The active world changed.');
    this.assertWorldAvailable(worldRoot);

    const epoch = ++this.writerEpoch;
    const continued = hasExistingSession(worldRoot);
    const spec = writerLaunch(this.repoRoot, worldRoot, this.vendorCliPath);
    const client = new RpcClient({
      cliPath: spec.cliPath,
      cwd: spec.cwd,
      args: spec.args,
      // Secrets the agent was not given are withheld (agent-env.ts).
      env: agentSpawnEnv(spec.env),
    });
    client.onEvent((event) => this.handleEngineEvent('writer', event, 'writer', client, worldRoot, epoch));

    try {
      await client.start();
    } catch (error) {
      if (this.writerEpoch === epoch) this.writerEpoch += 1;
      await client.stop().catch(() => {});
      throw error;
    }
    if (this.writerEpoch !== epoch || generation !== this.writerRestartGeneration) {
      await client.stop().catch(() => {});
      throw new Error('The active world changed while the writer was starting.');
    }
    this.writer = client;
    this.writerWorld = worldRoot;
    this.writerRestarts = 0;

    this.scheduleLivenessProbe(worldRoot);
    this.scheduleWarmup(client, continued ? 'continued' : 'none', worldRoot, epoch);
    return client;
  }

  getWriter(): RpcClient | null {
    return this.writer;
  }

  assertWriterWorldAvailable(worldRoot: string): RpcClient {
    this.assertWorldAvailable(worldRoot);
    if (this.switchingModels) throw new Error('Models are switching. Please try again shortly.');
    if (!this.writer || this.writerWorld !== worldRoot) {
      throw new Error('The writer is not active for the requested world.');
    }
    return this.writer;
  }

  async dispatchWriterCommand<T>(worldRoot: string, dispatch: (writer: RpcClient) => Promise<T>): Promise<T> {
    const writer = this.assertWriterWorldAvailable(worldRoot);
    const worldEpoch = this.characterWorldEpoch;
    const writerGeneration = this.writerRestartGeneration;
    const writerEpoch = this.writerEpoch;
    this.inFlightAgentDispatches++;
    try {
      this.assertModelRequestAvailable((await writer.getState()).model);
      this.assertWorldAvailable(worldRoot);
      if (this.characterWorldEpoch !== worldEpoch || this.writerRestartGeneration !== writerGeneration ||
        this.writerEpoch !== writerEpoch || this.writer !== writer || this.writerWorld !== worldRoot) {
        throw new Error('The active writer changed before the command was sent.');
      }
      return await dispatch(writer);
    } finally { this.inFlightAgentDispatches--; }
  }
  async abortWriter(worldRoot: string): Promise<void> {
    this.assertWorldAvailable(worldRoot);
    // A fast beat has no writer process to stop.
    if (this.fastPath?.abort(worldRoot)) return;
    const writer = this.writer;
    if (!writer || this.writerWorld !== worldRoot) throw new Error('The writer is not active for the requested world.');
    const worldEpoch = this.characterWorldEpoch;
    const writerGeneration = this.writerRestartGeneration;
    const writerEpoch = this.writerEpoch;
    this.inFlightAgentDispatches++;
    try {
      if (this.characterWorldEpoch !== worldEpoch || this.writerRestartGeneration !== writerGeneration ||
        this.writerEpoch !== writerEpoch || this.writer !== writer || this.writerWorld !== worldRoot) {
        throw new Error('The active writer changed before it could be aborted.');
      }
      // Stop means the beat the player is waiting on (§3): a beat queued behind a
      // landed one is dropped before it prompts, and the landed one's tail ends too.
      if (this.writerWaiting) this.writerWaiting.cancelled = true;
      await writer.abort();
    } finally { this.inFlightAgentDispatches--; }
  }

  async dispatchCharacterCommand<T>(characterId: string, worldRoot: string, dispatch: (client: RpcClient) => Promise<T>): Promise<T> {
    this.assertWorldAvailable(worldRoot);
    if (this.switchingModels) throw new Error('Models are switching. Please try again shortly.');
    const client = this.characterClients.get(characterId);
    if (!client || this.characterWorlds.get(characterId) !== worldRoot) throw new Error('The character agent is no longer active in this world.');
    const worldEpoch = this.characterWorldEpoch;
    const characterEpoch = this.characterEpochs.get(characterId) ?? 0;
    this.inFlightAgentDispatches++;
    try {
      this.assertModelRequestAvailable((await client.getState()).model);
      this.assertWorldAvailable(worldRoot);
      if (this.characterWorldEpoch !== worldEpoch || (this.characterWorldRoot !== undefined && this.characterWorldRoot !== worldRoot) ||
        this.characterEpochs.get(characterId) !== characterEpoch || this.characterClients.get(characterId) !== client ||
        this.characterWorlds.get(characterId) !== worldRoot) throw new Error('The active character changed before the command was sent.');
      return await dispatch(client);
    } finally { this.inFlightAgentDispatches--; }
  }

  /** One serialized start per character; direct restarts and ensure callers join the same promise. */
  private characterStarting = new Map<string, { world: string; generation: number; promise: Promise<RpcClient>; client?: RpcClient }>();
  private characterWorlds = new Map<string, string>();

  async startCharacter(characterId: string, worldRoot: string): Promise<RpcClient> {
    return this.startCharacterInternal(characterId, worldRoot, false);
  }

  private async startCharacterInternal(characterId: string, worldRoot: string, allowDuringModelSwitch: boolean): Promise<RpcClient> {
    this.assertWorldAvailable(worldRoot);
    assertCharacterLaunchable(worldRoot, characterId);
    const currentGeneration = this.characterEpochs.get(characterId) ?? 0;
    const inFlight = this.characterStarting.get(characterId);
    if (inFlight?.world === worldRoot && inFlight.generation === currentGeneration) return inFlight.promise;
    const live = this.characterClients.get(characterId);
    if (live && !inFlight && this.characterWorlds.get(characterId) === worldRoot) return live;

    if (this.switchingModels && !allowDuringModelSwitch) throw new Error('Models are switching. Please try again shortly.');
    // Advance before any await so concurrent ensure/direct callers cannot claim
    // the same generation or commit two clients for one actor.
    const generation = currentGeneration + 1;
    this.characterEpochs.set(characterId, generation);
    const worldEpoch = this.characterWorldEpoch;
    const promise = this.startCharacterProcess(characterId, worldRoot, generation, worldEpoch, inFlight);
    this.characterStarting.set(characterId, { world: worldRoot, generation, promise });
    try {
      return await promise;
    } finally {
      if (this.characterStarting.get(characterId)?.promise === promise) this.characterStarting.delete(characterId);
    }
  }

  /** Narrow client creation seam so lifecycle tests can exercise real start fencing without spawning pi. */
  private createCharacterClient(options: ConstructorParameters<typeof RpcClient>[0]): RpcClient {
    return new RpcClient(options);
  }
  private async startCharacterProcess(
    characterId: string,
    worldRoot: string,
    generation: number,
    worldEpoch: number,
    previous?: { world: string; generation: number; promise: Promise<RpcClient>; client?: RpcClient },
  ): Promise<RpcClient> {

    if (previous) await previous.promise.catch(() => {});
    this.assertCurrentCharacterStart(characterId, worldRoot, generation, worldEpoch);
    await this.retireCharacterClient(characterId);
    this.assertCurrentCharacterStart(characterId, worldRoot, generation, worldEpoch);

    const spec = characterLaunch(this.repoRoot, worldRoot, this.vendorCliPath, characterId);
    const client = this.createCharacterClient({
      cliPath: spec.cliPath,
      cwd: spec.cwd,
      args: spec.args,
      // Secrets the agent was not given are withheld (agent-env.ts).
      env: agentSpawnEnv(spec.env),
    });
    const starting = this.characterStarting.get(characterId);
    if (starting?.generation === generation) starting.client = client;
    client.onEvent((event) =>
      this.handleEngineEvent('character', event, `${CHARACTER_ROLE_PREFIX}${characterId}`, client, worldRoot, generation, worldEpoch)
    );

    try {
      await client.start();
    } catch (error) {
      if (this.isCurrentCharacterStart(characterId, worldRoot, generation, worldEpoch)) {
        await this.retireCharacterClient(characterId);
      }
      await client.stop().catch(() => {});
      throw error;
    }
    if (!this.isCurrentCharacterStart(characterId, worldRoot, generation, worldEpoch)) {
      await client.stop().catch(() => {});
      throw new Error('The active world changed while the character was starting.');
    }
    this.characterClients.set(characterId, client);
    this.characterWorlds.set(characterId, worldRoot);
    return client;
  }

  private isCurrentCharacterStart(characterId: string, worldRoot: string, generation: number, worldEpoch: number): boolean {
    return !this.characterWorldTransition &&
      generation === (this.characterEpochs.get(characterId) ?? 0) &&
      worldEpoch === this.characterWorldEpoch &&
      (this.characterWorldRoot === undefined || this.characterWorldRoot === worldRoot);
  }

  private assertCurrentCharacterStart(characterId: string, worldRoot: string, generation: number, worldEpoch: number): void {
    if (!this.isCurrentCharacterStart(characterId, worldRoot, generation, worldEpoch)) {
      throw new Error('The active world changed while the character was starting.');
    }
  }

  private async retireCharacterClient(characterId: string): Promise<void> {
    const clientKey = `character:${characterId}`;
    const starting = this.characterStarting.get(characterId);
    const savePath = this.characterWorlds.get(characterId) ?? starting?.world;
    const turnId = this.turnIds.get(clientKey);
    if (turnId) this.activityFailureSink?.('character', characterId, turnId, 'cancelled', savePath);
    this.clearTurnTimeout(clientKey);
    this.turnStartedAt.delete(clientKey);
    this.turnIds.delete(clientKey);
    const clients = new Set(
      [this.characterClients.get(characterId), starting?.client].filter((client): client is RpcClient => client !== undefined),
    );
    this.characterClients.delete(characterId);
    this.characterWorlds.delete(characterId);
    await Promise.all([...clients].map((client) => client.stop().catch(() => {})));
  }

  /**
   * The character's agent for this world, started once. Concurrent opens and
   * direct starts share one promise; model changes explicitly stop then ensure
   * the replacement under the selected world/model.
   */
  async ensureCharacter(characterId: string, worldRoot: string): Promise<RpcClient> {
    this.assertWorldAvailable(worldRoot);
    const inFlight = this.characterStarting.get(characterId);
    const currentGeneration = this.characterEpochs.get(characterId) ?? 0;
    if (inFlight?.world === worldRoot && inFlight.generation === currentGeneration) return inFlight.promise;
    const live = this.characterClients.get(characterId);
    if (live && !inFlight && this.characterWorlds.get(characterId) === worldRoot) return live;
    return this.startCharacter(characterId, worldRoot);
  }

  getCharacter(characterId: string): RpcClient | null {
    return this.characterClients.get(characterId) ?? null;
  }

  getCharacterWorld(characterId: string): string | null {
    return this.characterWorlds.get(characterId) ?? null;
  }

  async abortCharacter(characterId: string, worldRoot: string): Promise<void> {
    this.assertWorldAvailable(worldRoot);
    if (this.switchingModels) throw new Error('Models are switching. Please try again shortly.');
    const client = this.characterClients.get(characterId);
    if (!client || this.characterWorlds.get(characterId) !== worldRoot) {
      throw new Error('The character agent is no longer active in this world.');
    }
    this.inFlightAgentDispatches++;
    try { await client.abort(); }
    finally { this.inFlightAgentDispatches--; }
  }
  async stopCharacterWithAction(
    characterId: string,
    worldRoot: string,
    beforeStop: () => Promise<unknown>,
    onStatus: (status: CharacterStopStatus) => void = () => {},
  ): Promise<CharacterStopStatus> {
    if (!this.isWorldRootCurrent(worldRoot)) {
      this.notifyCharacterStopHandlers([onStatus], 'superseded');
      return 'superseded';
    }
    this.assertWorldAvailable(worldRoot);
    const key = `${worldRoot}\u0000${characterId}`;
    const existing = this.deferredCharacterStops.get(key);
    if (this.switchingModels) {
      if (existing?.terminalStatus) {
        this.notifyCharacterStopHandlers([onStatus], existing.terminalStatus);
        return existing.terminalStatus;
      }
      const intent = existing ?? {
        characterId, worldRoot, worldEpoch: this.characterWorldEpoch, beforeStop, processing: false, statusHandlers: [],
      };
      this.deferredCharacterStops.set(key, intent);
      intent.statusHandlers.push(onStatus);
      this.notifyCharacterStopHandlers([onStatus], 'deferred');
      return 'deferred';
    }
    if (existing?.terminalStatus) this.deferredCharacterStops.delete(key);
    const worldEpoch = this.characterWorldEpoch;
    this.inFlightAgentDispatches++;
    try {
      if (!this.isWorldRootCurrent(worldRoot) || this.characterWorldEpoch !== worldEpoch) {
        this.notifyCharacterStopHandlers([onStatus], 'superseded');
        return 'superseded';
      }
      let actionFailed = false;
      try { await beforeStop(); } catch { actionFailed = true; }
      const sameWorld = !this.characterWorldTransition && this.characterWorldEpoch === worldEpoch &&
        (this.characterWorldRoot === undefined || this.characterWorldRoot === worldRoot);
      if (!sameWorld) {
        this.notifyCharacterStopHandlers([onStatus], actionFailed ? 'error' : 'superseded');
        return actionFailed ? 'error' : 'superseded';
      }
      let stopFailed = false;
      try { await this.stopCharacterInternal(characterId); } catch { stopFailed = true; }
      const status = actionFailed || stopFailed ? 'error' : 'completed';
      this.notifyCharacterStopHandlers([onStatus], status);
      return status;
    } finally { this.inFlightAgentDispatches--; }
  }

  private notifyCharacterStopHandlers(handlers: Array<(status: CharacterStopStatus) => void>, status: CharacterStopStatus): void {
    for (const handler of handlers) {
      try { handler(status); } catch { /* Socket teardown cannot undo a committed close. */ }
    }
  }
  private async flushDeferredCharacterStops(): Promise<void> {
    if (this.flushingCharacterStops) return this.flushingCharacterStops;
    const flush = this.processDeferredCharacterStops();
    this.flushingCharacterStops = flush;
    try { await flush; }
    finally { if (this.flushingCharacterStops === flush) this.flushingCharacterStops = null; }
  }
  private releaseModelSwitchLock(): void {
    this.switchingModels = false;
    for (const [key, intent] of this.deferredCharacterStops) {
      if (intent.terminalStatus) this.deferredCharacterStops.delete(key);
    }
  }
  private async finishOpenAIRefreshLock(refresh: PendingOpenAIRefresh): Promise<void> {
    if (!refresh.ownsSwitchLock) return;
    const status = refresh.status;
    const count = refresh.count;
    const error = refresh.error;
    refresh.ownsSwitchLock = false;
    refresh.status = 'activating';
    await this.flushDeferredCharacterStops();
    this.releaseModelSwitchLock();
    refresh.status = status;
    refresh.count = count;
    refresh.error = error;
  }

  private async processDeferredCharacterStops(): Promise<void> {
    for (;;) {
      const entry = [...this.deferredCharacterStops].find(([, intent]) => !intent.processing && !intent.terminalStatus);
      if (!entry) return;
      const [, intent] = entry;
      intent.processing = true;
      const currentBeforeStop = !this.characterWorldTransition &&
        this.characterWorldEpoch === intent.worldEpoch &&
        (this.characterWorldRoot === undefined || this.characterWorldRoot === intent.worldRoot);
      if (!currentBeforeStop) {
        intent.terminalStatus = 'superseded';
        this.notifyCharacterStopHandlers(intent.statusHandlers, 'superseded');
        continue;
      }
      let actionFailed = false;
      try { await intent.beforeStop(); } catch { actionFailed = true; }
      const sameWorld = !this.characterWorldTransition && this.characterWorldEpoch === intent.worldEpoch &&
        (this.characterWorldRoot === undefined || this.characterWorldRoot === intent.worldRoot);
      let status: CharacterStopStatus;
      if (!sameWorld) status = actionFailed ? 'error' : 'superseded';
      else {
        let stopFailed = false;
        try { await this.stopCharacterInternal(intent.characterId); } catch { stopFailed = true; }
        status = actionFailed || stopFailed ? 'error' : 'completed';
      }
      intent.terminalStatus = status;
      this.notifyCharacterStopHandlers(intent.statusHandlers, status);
    }
  }

  async stopCharacter(characterId: string): Promise<void> {
    if (this.switchingModels && !this.characterWorldTransition && !this.stoppingAll) {
      throw new Error('Models are switching. Please try again shortly.');
    }
    await this.stopCharacterInternal(characterId);
  }

  private async stopCharacterInternal(characterId: string): Promise<void> {
    this.characterEpochs.set(characterId, (this.characterEpochs.get(characterId) ?? 0) + 1);
    await this.retireCharacterClient(characterId);
  }

  /** Stops all active character agents and invalidates every turn on world change. */
  async stopCharacters(): Promise<void> {
    if (this.switchingModels && !this.characterWorldTransition && !this.stoppingAll) throw new Error('Models are switching. Please try again shortly.');
    this.characterWorldEpoch += 1;
    const characters = new Set([
      ...this.characterClients.keys(),
      ...this.characterStarting.keys(),
      ...this.characterTurnQueues.keys(),
      ...this.characterTurnDepth.keys(),
    ]);
    await Promise.all([...characters].map((id) => this.stopCharacter(id)));
  }

  async stopWriter(): Promise<void> {
    if (this.switchingModels && !this.characterWorldTransition && !this.stoppingAll) {
      throw new Error('Models are switching. Please try again shortly.');
    }
    await this.stopWriterInternal();
  }

  private async stopWriterInternal(): Promise<void> {
    this.writerRestartGeneration += 1;
    this.cancelWriterRestart();
    await this.retireWriterProcess();
  }

  private async retireWriterProcess(): Promise<void> {
    const savePath = this.writerWorld;
    const turnId = this.turnIds.get('writer');
    this.writerEpoch += 1;
    if (turnId) this.activityFailureSink?.('writer', undefined, turnId, 'cancelled', savePath ?? undefined);
    this.progress.delete('writer');
    this.clearTurnTimeout('writer');
    this.turnStartedAt.delete('writer');
    this.turnIds.delete('writer');
    if (this.writerPing) {
      clearInterval(this.writerPing);
      this.writerPing = null;
    }
    const client = this.writer;
    this.writer = null;
    this.writerWorld = null;
    if (client) await client.stop().catch(() => {});
  }

  async stopAll(): Promise<void> {
    this.stoppingAll = true;
    if (this.openAIRefresh && !this.openAIRefresh.settled) {
      this.openAIRefresh.cancelled = true;
      this.openAIRefresh.abortController.abort();
      this.openAIRefresh.status = 'cancelled';
    }
    try { await Promise.all([this.stopWriter(), this.stopCharacters()]); }
    finally { this.stoppingAll = false; }
  }

  private isCurrentAgentClient(
    source: 'writer' | 'character',
    clientKey: string,
    client: RpcClient,
    savePath: string,
    epoch: number,
    worldEpoch?: number,
  ): boolean {
    if (source === 'writer') {
      return !this.characterWorldTransition &&
        (this.characterWorldRoot === undefined || this.characterWorldRoot === savePath) &&
        epoch === this.writerEpoch &&
        (this.writer === null || this.writer === client) &&
        (this.writerWorld === null || this.writerWorld === savePath);
    }
    const characterId = characterIdFromClientKey(clientKey);
    if (
      characterId === undefined ||
      this.characterWorldTransition ||
      (this.characterWorldRoot !== undefined && this.characterWorldRoot !== savePath) ||
      epoch !== (this.characterEpochs.get(characterId) ?? 0) ||
      worldEpoch !== this.characterWorldEpoch
    ) return false;
    const active = this.characterClients.get(characterId);
    const activeWorld = this.characterWorlds.get(characterId);
    return (active === undefined || active === client) &&
      (activeWorld === undefined || activeWorld === savePath);
  }

  private handleEngineEvent(
    source: 'writer' | 'character',
    event: JsonAgentSessionEvent,
    clientKey: string,
    client: RpcClient,
    savePath: string,
    epoch: number,
    worldEpoch?: number,
  ): void {
    if (!this.isCurrentAgentClient(source, clientKey, client, savePath, epoch, worldEpoch)) return;
    const stages: Record<string, string> = { agent_start: 'Reading the scene', message_update: 'Writing the response', tool_execution_start: 'Updating the world', agent_settled: 'Ready for your next action' };
    let stage = stages[event.type];
    if (event.type === 'tool_execution_start') stage = event.toolName === 'chalk' ? 'Writing Chalk' : ['look_at', 'read', 'view_canvas'].includes(event.toolName) ? 'Reading the scene' : 'Updating the world';
    if (event.type === 'tool_execution_end' && event.toolName === 'chalk' && !event.isError) stage = 'Chalk is ready · finishing world updates';
    // §3: the beat's first page change releases the player; every later progress
    // frame of this beat says `landed` so the page stays released until it settles.
    if (source === 'writer' && event.type === 'tool_execution_start') {
      this.writerToolPaths.set(event.toolCallId, (event.args as { path?: unknown } | undefined)?.path);
    } else if (source === 'writer' && event.type === 'tool_execution_end') {
      const toolPath = this.writerToolPaths.get(event.toolCallId);
      this.writerToolPaths.delete(event.toolCallId);
      const beat = this.writerBeat;
      if (beat && !beat.landed && earlyReleaseEnabled() && isLandingTool(event.toolName, toolPath, event.isError)) {
        beat.landed = true;
        stage = 'Chalk is ready · finishing world updates';
      }
    } else if (source === 'writer' && event.type === 'agent_settled') {
      this.writerToolPaths.clear();
    }
    const landed = source === 'writer' && this.writerBeat?.landed === true && event.type !== 'agent_settled';
    if (stage) {
      const now = Date.now();
      const previous = this.progress.get(clientKey);
      // Keep the landed indication during the final model response.
      if (event.type !== 'message_update' || !previous?.stage.startsWith('Chalk is ready')) {
        this.progress.set(clientKey, { stage, startedAt: event.type === 'agent_start' ? now : previous?.startedAt ?? now, updatedAt: now });
        if (event.type !== 'message_update' || stage !== previous?.stage) {
          this.frameSink?.({ type: 'agent_progress', source, savePath, ...(source === 'character' ? { characterId: clientKey.slice(10) } : {}), ...this.progress.get(clientKey), busy: event.type !== 'agent_settled', ...(landed ? { landed: true } : {}) });
        }
      } else if (previous) {
        this.progress.set(clientKey, { ...previous, updatedAt: now });
      }
    }
    if (source === 'writer' && event.type === 'tool_execution_end' && event.isError) this.writerBeatToolError = true;
    if (event.type === 'agent_start') {
      // Keep the legacy run-level watchdog; no turn identity is allocated here.
      this.turnStartedAt.set(clientKey, Date.now());
      this.armTurnTimeout(clientKey, client, source, savePath, epoch, worldEpoch);
    } else if (event.type === 'turn_start') {
      const previousTurnId = this.turnIds.get(clientKey);
      if (previousTurnId) this.activityFailureSink?.(source, characterIdFromClientKey(clientKey), previousTurnId, 'agent_stopped', savePath);
      const nextTurnId = `${source}:${randomUUID()}`;
      this.turnIds.set(clientKey, nextTurnId);
      this.turnStartedAt.set(clientKey, Date.now());
      this.armTurnTimeout(clientKey, client, source, savePath, epoch, worldEpoch);
    } else if (event.type === 'turn_end' || event.type === 'agent_settled') {
      this.clearTurnTimeout(clientKey);
      this.turnStartedAt.delete(clientKey);
    } else if (this.turnStartedAt.has(clientKey) && ['message_update', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end'].includes(event.type)) {
      this.armTurnTimeout(clientKey, client, source, savePath, epoch, worldEpoch);
    }
    let activeTurnId = this.turnIds.get(clientKey);
    if (!activeTurnId && ['tool_execution_start', 'tool_execution_update', 'tool_execution_end'].includes(event.type)) {
      activeTurnId = `orphan:${randomUUID()}`;
      this.turnIds.set(clientKey, activeTurnId);
    }
    if (source === 'writer') this.writerRecorder?.onEvent(event as unknown as { type: string });
    this.eventSink?.(source, event, characterIdFromClientKey(clientKey), activeTurnId, savePath);
    if (event.type === 'turn_end' || event.type === 'agent_settled') this.turnIds.delete(clientKey);
  }

  private armTurnTimeout(
    clientKey: string,
    client: RpcClient,
    source: 'writer' | 'character',
    savePath: string,
    epoch: number,
    worldEpoch?: number,
  ): void {
    const idleBudget = Number(process.env.AIRP_TURN_TIMEOUT_MS) > 0 ? Number(process.env.AIRP_TURN_TIMEOUT_MS) : DEFAULT_TURN_TIMEOUT_MS;
    this.clearTurnTimeout(clientKey);
    const remaining = MAX_TURN_DURATION_MS - (Date.now() - (this.turnStartedAt.get(clientKey) ?? Date.now()));
    const delay = Math.max(0, Math.min(idleBudget, remaining));
    const timer = setTimeout(() => {
      if (!this.isCurrentAgentClient(source, clientKey, client, savePath, epoch, worldEpoch)) return;
      console.warn(
        `[AIRP Lifecycle] ${clientKey} exceeded ${remaining <= idleBudget ? 'total turn' : 'inactivity'} budget; aborting turn`
      );
      const turnId = this.turnIds.get(clientKey);
      if (turnId) this.activityFailureSink?.(source, characterIdFromClientKey(clientKey), turnId, 'timeout', savePath);
      this.turnStartedAt.delete(clientKey);
      this.turnIds.delete(clientKey);
      client.abort().catch(() => {});
      this.frameSink?.({
        type: 'turn_aborted',
        source,
        savePath,
        ...(source === 'character' ? { characterId: clientKey.slice('character:'.length) } : {}),
        reason: 'timeout',
        message: 'The writer took too long to respond. You can try again; completed world changes are kept.',
        timestamp: new Date().toISOString(),
      });
    }, delay);
    timer.unref?.();
    this.turnTimeouts.set(clientKey, timer);
  }

  private clearTurnTimeout(clientKey: string): void {
    const existing = this.turnTimeouts.get(clientKey);
    if (existing) {
      clearTimeout(existing);
      this.turnTimeouts.delete(clientKey);
    }
  }

  /**
   * The engine client exposes no exit event, so poll it: a dead process makes every
   * request throw. `startWriter` is what the retry path calls, so its reuse guard
   * makes a spurious probe harmless — but only clear `writer` once, on real death.
   */
  private scheduleLivenessProbe(worldRoot: string): void {
    const client = this.writer;
    const epoch = this.writerEpoch;
    if (!client) return;
    this.writerPing = setInterval(() => {
      client.getSessionStats().catch(() => {
        if (!this.isCurrentAgentClient('writer', 'writer', client, worldRoot, epoch)) return;
        void this.handleWriterDeath(worldRoot, client, epoch);
      });
    }, LIVENESS_PROBE_MS);
  }

  private async handleWriterDeath(worldRoot: string, client: RpcClient, epoch: number): Promise<void> {
    if (!this.isCurrentAgentClient('writer', 'writer', client, worldRoot, epoch)) return;
    if (this.writerPing) {
      clearInterval(this.writerPing);
      this.writerPing = null;
    }
    const turnId = this.turnIds.get('writer');
    if (turnId) this.activityFailureSink?.('writer', undefined, turnId, 'agent_stopped', worldRoot);
    this.turnIds.delete('writer');
    this.turnStartedAt.delete('writer');
    this.writer = null;
    this.writerWorld = null;
    this.writerEpoch += 1;
    this.scheduleWriterRestart(worldRoot, this.writerRestartGeneration, this.writerEpoch);
  }

  private scheduleWriterRestart(worldRoot: string, generation: number, epoch: number): void {
    if (
      this.characterWorldTransition ||
      generation !== this.writerRestartGeneration ||
      epoch !== this.writerEpoch ||
      this.writer !== null
    ) return;
    if (
      this.writerRestartRetry?.worldRoot === worldRoot &&
      this.writerRestartRetry.generation === generation &&
      this.writerRestartRetry.epoch === epoch
    ) return;
    this.cancelWriterRestart();
    if (this.writerRestarts >= MAX_RESTART_ATTEMPTS) {
      console.error(
        `[AIRP Lifecycle] writer for "${worldRoot}" failed to restart ${MAX_RESTART_ATTEMPTS} times; giving up (manual restart required)`
      );
      return;
    }
    const delay = RESTART_BACKOFF_MS[Math.min(this.writerRestarts, RESTART_BACKOFF_MS.length - 1)];
    this.writerRestarts += 1;
    console.warn(`[AIRP Lifecycle] writer restart scheduled in ${delay}ms (attempt ${this.writerRestarts}/${MAX_RESTART_ATTEMPTS})`);
    const timer = setTimeout(() => {
      if (this.writerRestartRetry?.timer === timer) this.writerRestartRetry = null;
      if (
        this.characterWorldTransition ||
        generation !== this.writerRestartGeneration ||
        epoch !== this.writerEpoch ||
        this.writer !== null
      ) return;
      this.startWriterForGeneration(worldRoot, generation).catch((error) => {
        console.error('[AIRP Lifecycle] writer restart failed:', error);
      });
    }, delay);
    this.writerRestartRetry = { worldRoot, generation, epoch, timer };
    timer.unref?.();
  }

  /**
   * Pull the introspected session's custom entries back over the wire (T0.6).
   *
   * pi-rp's rpc-mode subscribes to session events only inside `rebindSession()`, which
   * runs *after* the `session_start` hook — so anything emitted during session setup
   * (choice groups, opening-tree nodes, …) reaches nobody. Those live in the session's
   * custom entries and are recoverable on demand; we ask for them once a resumed writer
   * is up and re-broadcast them as `replay_entry` frames.
   *
   * `get_messages` is deliberately **not** used. In AIRP the narrative is chalk markdown
   * on disk and chat history never reaches the canvas (doc-05 §5) — replaying messages
   * would only push the writer's intermediate reasoning back at the player.
   */
  private scheduleWarmup(client: RpcClient, tier: 'continued' | 'none', savePath: string, epoch: number): void {
    if (tier === 'none') return;
    const timer = setTimeout(() => {
      if (!this.isCurrentAgentClient('writer', 'writer', client, savePath, epoch)) return;
      void (async () => {
        const entries = await client
          .getEntries()
          .then((result) => result.entries)
          .catch(() => null);
        if (!this.isCurrentAgentClient('writer', 'writer', client, savePath, epoch)) return;

        for (const entry of entries ?? []) {
          if (entry.type === 'custom') {
            this.frameSink?.({ type: 'replay_entry', source: 'writer', savePath, entry });
          }
        }
      })();
    }, WARMUP_DELAY_MS.continued);
    timer.unref?.();
  }
}
