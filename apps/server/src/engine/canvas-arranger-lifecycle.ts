import { randomUUID } from 'node:crypto';
import {
  ActionError,
  FUNCTIONAL_ARRANGER_ROLE,
  FUNCTIONAL_ARRANGER_SCOPE,
  createActionService,
  readCanvasSnapshot,
  resolveFunctionalArrangerActor,
} from '@airp/shared';
import type { ArrangeCanvasDetails, ArrangeScreenshotEvidence, CanvasSnapshot, LocalWorldStore } from '@airp/shared';
import {
  ARRANGE_SCREENSHOT_VIEWPORT,
  CanvasCaptureConflict,
  captureLayerSnapshot,
  saveArrangeScreenshot,
} from './canvas-capture.js';

/**
 * Canvas arrangement runtime — server-internal, no agent process.
 *
 * History: this runtime used to spawn a pi-rp "canvas-arranger" LLM agent
 * whose tool schema already forbade coordinates and whose
 * every decision (mode, policies, fences) was supplied by the HTTP request or
 * computed server-side. The 2026-09-18 de-agenting ruling removed the model
 * process: the brief's fixed sequence (read → arrange → verify) is now this
 * deterministic state machine calling `ActionService.arrangeCanvas` in
 * process. The HTTP contract (routes/canvas-arranger.ts), identity shapes,
 * frame emissions and failure semantics are unchanged; `view_canvas` /
 * `screenshot_canvas` survive as general agent tools in extensions/tools.ts.
 *
 * Screenshot evidence (2026-09-18 second-batch ruling, the design notes):
 * `before` / `after` captures ride the shared Playwright layer
 * (engine/canvas-capture.ts) and archive under `.airpworld/arrange/` in the
 * world tree. Demanded captures that cannot be produced keep the outcome
 * honest (pre: `failed`, no write; post: `partial`, rows retained; drifted
 * identity: `conflict`), never a pretended capture (06 §4.3). A clean layer
 * (`overlaps=[]`) is a verified no-op with no capture: before/after would be
 * identical.
 */

export interface CanvasArrangeRequest {
  worldId: string;
  layer: string;
  mode: 'grid' | 'circle' | 'row';
  requestId: string;
  expectedRevision: number;
  expectedCanvasVersion: number;
  snapshotId: string;
  screenshotPolicy: 'none' | 'before' | 'after' | 'before_and_after';
}

/**
 * Public request shape: the fence group — `requestId`,
 * `expectedRevision`, `expectedCanvasVersion`, `snapshotId` — is either
 * provided IN FULL (player HTTP entry, replay-safe) or omitted ENTIRELY
 * (agent intent: the server reads a fresh snapshot and owns the fence).
 * A partial fence is rejected: half a fence looks like safety and isn't.
 */
export type CanvasArrangeIntent = Omit<CanvasArrangeRequest, 'requestId' | 'expectedRevision' | 'expectedCanvasVersion' | 'snapshotId'> & {
  requestId?: string;
  expectedRevision?: number;
  expectedCanvasVersion?: number;
  snapshotId?: string;
};

export interface CanvasArrangeAccepted {
  ok: true;
  operationId: string;
  requestId: string;
  worldId: string;
  layer: string;
  agentId: 'canvas-arranger';
  turnId: `functional:canvas-arranger:${string}`;
  stage: 'accepted';
}

export type CanvasArrangerRuntimeSignal = {
  type: 'started' | 'committed' | 'verified' | 'failed' | 'cancelled' | 'conflict';
  operationId: string;
  requestId: string;
  worldId: string;
  savePath: string;
  layer: string;
  agentId: 'canvas-arranger';
  turnId: `functional:canvas-arranger:${string}`;
  error?: 'timeout' | 'cancelled' | 'conflict' | 'verification_failed' | 'unproven_latest' | 'screenshot_failed' | 'arrange_rejected';
  outcome?: 'completed' | 'partial' | 'failed' | 'cancelled' | 'conflict';
  result?: ArrangeCanvasDetails;
};

export interface CanvasArrangerOperation extends CanvasArrangeRequest {
  operationId: string;
  agentId: 'canvas-arranger';
  turnId: `functional:canvas-arranger:${string}`;
  cancelRequested: boolean;
  committed: boolean;
  terminal: boolean;
  outcome?: 'completed' | 'partial' | 'failed' | 'cancelled' | 'conflict';
  result?: ArrangeCanvasDetails;
}

export interface CanvasArrangeCaptureInput {
  operationId: string;
  layer: string;
  snapshotId: string;
  phase: 'before' | 'after';
}

export type CanvasArrangeCaptureFn = (input: CanvasArrangeCaptureInput) => Promise<ArrangeScreenshotEvidence>;

export interface CanvasArrangerRuntimeOptions {
  getActiveStore: () => LocalWorldStore | null;
  onRuntimeSignal?: (signal: CanvasArrangerRuntimeSignal) => void;
  /** Evidence seam; defaults to the shared Playwright layer + world archive. */
  captureEvidence?: CanvasArrangeCaptureFn;
  /** Capture viewport for the default seam (tool callers pick their own). */
  screenshotViewport?: { width: number; height: number };
}

/** Static policy → demanded capture phases (closed set, 06 §4.5). */
const SCREENSHOT_PHASES: Record<CanvasArrangeRequest['screenshotPolicy'], { before: boolean; after: boolean }> = {
  none: { before: false, after: false },
  before: { before: true, after: false },
  after: { before: false, after: true },
  before_and_after: { before: true, after: true },
};

const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;

class ArrangerTimeout extends Error {}

/** An expected execution failure with a machine-readable signal code. */
class ArrangerFailure extends Error {
  constructor(public readonly code: NonNullable<CanvasArrangerRuntimeSignal['error']>) {
    super(`Canvas arrangement failed: ${code}.`);
  }
}

function totalTimeoutMs(): number {
  const value = Number(process.env.AIRP_ARRANGER_TOTAL_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TOTAL_TIMEOUT_MS;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ArrangerTimeout()), ms);
    timer.unref?.();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function sameRequest(a: CanvasArrangerOperation, b: CanvasArrangeRequest): boolean {
  return a.worldId === b.worldId && a.layer === b.layer && a.requestId === b.requestId &&
    a.mode === b.mode && a.expectedRevision === b.expectedRevision &&
    a.expectedCanvasVersion === b.expectedCanvasVersion && a.snapshotId === b.snapshotId &&
    a.screenshotPolicy === b.screenshotPolicy;
}

/** `ArrangeCanvasDetails` for a layer that already satisfies overlaps=[]. */
function noOpResult(operation: CanvasArrangerOperation, snapshot: CanvasSnapshot): ArrangeCanvasDetails {
  return {
    kind: 'cards',
    action: 'arrangeCanvas',
    operationId: operation.operationId,
    layer: snapshot.layer.id,
    mode: operation.mode,
    canvasVersion: snapshot.identity.canvasVersion,
    canvasRevision: snapshot.identity.canvasRevision,
    snapshotIdBefore: snapshot.identity.snapshotId,
    snapshotIdAfter: snapshot.identity.snapshotId,
    cards: snapshot.rows.map(({ path, x, y, z, w, h }) => ({ path, x, y, z, w, h })),
    movedCount: 0,
    overlapCount: 0,
    committed: false,
    expectedRevision: operation.expectedRevision,
    revision: operation.expectedRevision,
    expectedCanvasVersion: operation.expectedCanvasVersion,
  };
}

export class CanvasArrangerRuntime {
  private readonly opts: CanvasArrangerRuntimeOptions;
  private readonly screenshotViewport: { width: number; height: number };
  private readonly operations = new Map<string, CanvasArrangerOperation>();
  private readonly inFlightByWorld = new Map<string, string>();
  private readonly operationByRequest = new Map<string, string>();
  private readonly runs = new Map<string, Promise<void>>();
  private readonly savePathByOperation = new WeakMap<CanvasArrangerOperation, string>();

  constructor(options: CanvasArrangerRuntimeOptions) {
    this.opts = options;
    this.screenshotViewport = options.screenshotViewport ?? ARRANGE_SCREENSHOT_VIEWPORT;
  }

  async start(request: CanvasArrangeIntent): Promise<CanvasArrangeAccepted> {
    const originStore = this.opts.getActiveStore();
    if (!originStore) throw new Error('No active world is available.');
    const resolved = await this.resolveRequest(request);
    this.validateRequest(resolved);
    if (this.opts.getActiveStore() !== originStore) throw new Error('The active world changed.');
    const requestKey = `${resolved.worldId}\u0000${resolved.requestId}`;
    const previousId = this.operationByRequest.get(requestKey);
    if (previousId) {
      const previous = this.operations.get(previousId)!;
      if (!sameRequest(previous, resolved)) throw new Error('Canvas arrangement requestId was reused with different input.');
      return this.accepted(previous);
    }
    const existingId = this.inFlightByWorld.get(resolved.worldId);
    if (existingId) {
      const existing = this.operations.get(existingId)!;
      if (!sameRequest(existing, resolved)) throw new Error('Canvas arrangement is already in progress for this world.');
      return this.accepted(existing);
    }
    const operationId = randomUUID();
    const turnId = `functional:canvas-arranger:${randomUUID()}` as `functional:canvas-arranger:${string}`;
    const operation: CanvasArrangerOperation = {
      ...resolved, operationId, agentId: 'canvas-arranger', turnId,
      cancelRequested: false, committed: false, terminal: false,
    };
    this.savePathByOperation.set(operation, originStore.worldRoot);
    this.operations.set(operationId, operation);
    this.operationByRequest.set(requestKey, operationId);
    this.inFlightByWorld.set(resolved.worldId, operationId);
    const run = this.run(operation);
    this.runs.set(operationId, run);
    void run.finally(() => this.runs.delete(operationId));
    return this.accepted(operation);
  }

  /**
   * Fence resolution: full fence passes through
   * untouched; a fully omitted fence is minted from a fresh read — the agent
   * states intent, the server owns the snapshot identity. A partial fence is
   * rejected here and at the HTTP edge.
   */
  private async resolveRequest(request: CanvasArrangeIntent): Promise<CanvasArrangeRequest> {
    if (!request || typeof request !== 'object') throw new Error('Invalid canvas arrangement request.');
    const fenceKeys = ['requestId', 'expectedRevision', 'expectedCanvasVersion', 'snapshotId'] as const;
    const provided = fenceKeys.filter((key) => request[key] !== undefined);
    if (provided.length > 0 && provided.length < fenceKeys.length) {
      throw new Error('Canvas arrangement fence must be provided in full or omitted entirely.');
    }
    const worldId = request.worldId?.trim() ? request.worldId : 'active';
    if (provided.length === fenceKeys.length) {
      return { ...request, worldId } as CanvasArrangeRequest;
    }
    const store = this.opts.getActiveStore();
    if (!store) throw new Error('No active world is available.');
    const snapshot = await readCanvasSnapshot(store, { layer: request.layer });
    if (snapshot.layer.id !== request.layer) throw new Error(`Canvas layer "${request.layer}" is unavailable.`);
    return {
      ...request,
      worldId,
      requestId: request.requestId ?? randomUUID(),
      expectedRevision: await store.getMaxSeq(),
      expectedCanvasVersion: snapshot.identity.canvasVersion,
      snapshotId: snapshot.identity.snapshotId,
    };
  }

  get(operationId: string): CanvasArrangerOperation | null {
    const operation = this.operations.get(operationId);
    return operation ? { ...operation } : null;
  }

  async cancel(operationId: string): Promise<{ ok: true; operationId: string; requestId: string; worldId: string; layer: string; stage: 'cancel_requested' | 'already_completed' | 'already_cancelled' }> {
    const operation = this.operations.get(operationId);
    if (!operation) throw new Error('Canvas arrangement operation was not found.');
    if (operation.terminal && operation.outcome === 'cancelled') return { ...this.cancelAck(operation), stage: 'already_cancelled' };
    if (operation.terminal) return { ...this.cancelAck(operation), stage: 'already_completed' };
    operation.cancelRequested = true;
    return { ...this.cancelAck(operation), stage: 'cancel_requested' };
  }

  async stopAll(): Promise<void> {
    for (const operation of this.operations.values()) {
      if (!operation.terminal) operation.cancelRequested = true;
    }
    await Promise.all([...this.runs.values()].map((run) => run.catch(() => {})));
  }

  private accepted(operation: CanvasArrangerOperation): CanvasArrangeAccepted {
    return {
      ok: true, operationId: operation.operationId, requestId: operation.requestId,
      worldId: operation.worldId, layer: operation.layer, agentId: 'canvas-arranger',
      turnId: operation.turnId, stage: 'accepted',
    };
  }

  private cancelAck(operation: CanvasArrangerOperation) {
    return { ok: true as const, operationId: operation.operationId, requestId: operation.requestId, worldId: operation.worldId, layer: operation.layer };
  }

  private validateRequest(request: CanvasArrangeRequest): void {
    if (!request || typeof request !== 'object') throw new Error('Invalid canvas arrangement request.');
    if (!request.worldId || !request.layer || !request.requestId || !request.snapshotId) throw new Error('Canvas arrangement identity is incomplete.');
    if (!/^[^\\/\n\r]+(?:\/[^\\/\n\r]+)*$/.test(request.layer) || request.layer.split('/').includes('..')) throw new Error('Invalid canvas layer.');
    if (!['grid', 'circle', 'row'].includes(request.mode)) throw new Error('Invalid canvas arrangement mode.');
    if (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 0 || !Number.isInteger(request.expectedCanvasVersion) || request.expectedCanvasVersion < 0) throw new Error('Invalid canvas version fence.');
    if (!{ none: true, before: true, after: true, before_and_after: true }[request.screenshotPolicy]) throw new Error('Invalid screenshot policy.');
  }

  private signal(operation: CanvasArrangerOperation, type: CanvasArrangerRuntimeSignal['type'], extra: Omit<Partial<CanvasArrangerRuntimeSignal>, 'type'> = {}): void {
    const savePath = this.savePathByOperation.get(operation);
    if (savePath === undefined) throw new Error('Canvas arrangement origin save path was lost.');
    this.opts.onRuntimeSignal?.({
      type, operationId: operation.operationId, requestId: operation.requestId,
      worldId: operation.worldId, savePath, layer: operation.layer, agentId: 'canvas-arranger',
      turnId: operation.turnId, ...extra,
    });
  }

  private finish(
    operation: CanvasArrangerOperation,
    outcome: NonNullable<CanvasArrangerOperation['outcome']>,
    error?: CanvasArrangerRuntimeSignal['error'],
  ): void {
    if (operation.terminal) return;
    operation.terminal = true;
    operation.outcome = outcome;
    this.inFlightByWorld.delete(operation.worldId);
    const type = outcome === 'conflict' ? 'conflict' : outcome === 'cancelled' ? 'cancelled' : outcome === 'completed' ? 'verified' : 'failed';
    this.signal(operation, type, { outcome, error, result: operation.result });
  }

  private throwIfCancelled(operation: CanvasArrangerOperation): void {
    if (operation.cancelRequested) throw new ArrangerFailure('cancelled');
  }

  /**
   * One demanded capture through the evidence seam. Cancel checks stay
   * outside the try: a cancel is a cancel, not a capture failure. Identity
   * drift maps to `conflict` (currentness unproven); everything else to
   * `screenshot_failed` — the run() mapper turns that into `failed` (nothing
   * committed) or `partial` (rows retained).
   */
  private async captureFor(
    operation: CanvasArrangerOperation,
    store: LocalWorldStore,
    phase: 'before' | 'after',
    snapshotId: string,
  ): Promise<ArrangeScreenshotEvidence> {
    this.throwIfCancelled(operation);
    const input: CanvasArrangeCaptureInput = { operationId: operation.operationId, layer: operation.layer, snapshotId, phase };
    try {
      return this.opts.captureEvidence
        ? await this.opts.captureEvidence(input)
        : await defaultCaptureEvidence(input, store, this.screenshotViewport);
    } catch (error) {
      if (error instanceof CanvasCaptureConflict) throw new ArrangerFailure('conflict');
      throw new ArrangerFailure('screenshot_failed');
    }
  }

  private async run(operation: CanvasArrangerOperation): Promise<void> {
    this.signal(operation, 'started');
    try {
      await withTimeout(this.execute(operation), totalTimeoutMs());
    } catch (error) {
      if (operation.terminal) return;
      if (error instanceof ArrangerFailure) {
        const outcome = error.code === 'conflict' ? 'conflict'
          : error.code === 'screenshot_failed' && operation.committed ? 'partial'
          : error.code === 'cancelled' ? 'cancelled' : 'failed';
        this.finish(operation, outcome, error.code);
        return;
      }
      const timedOut = error instanceof ArrangerTimeout;
      const outcome = operation.committed ? 'conflict' : operation.cancelRequested ? 'cancelled' : 'failed';
      const errorCode: CanvasArrangerRuntimeSignal['error'] = operation.committed ? 'unproven_latest' : timedOut ? 'timeout' : operation.cancelRequested ? 'cancelled' : 'arrange_rejected';
      this.finish(operation, outcome, errorCode);
    }
  }

  private async execute(operation: CanvasArrangerOperation): Promise<void> {
    const store = this.opts.getActiveStore();
    if (!store) throw new Error('No active world is available.');
    this.throwIfCancelled(operation);

    const snapshot = await readCanvasSnapshot(store, { layer: operation.layer });
    if (snapshot.layer.id !== operation.layer) throw new Error(`Canvas layer "${operation.layer}" is unavailable.`);

    if (snapshot.overlaps.length === 0) {
      // The layer already satisfies the completion proof; nothing is written
      // and no capture is demanded — before/after would be identical.
      operation.result = noOpResult(operation, snapshot);
      this.finish(operation, 'completed');
      return;
    }

    const phases = SCREENSHOT_PHASES[operation.screenshotPolicy];
    const evidenceBefore = phases.before
      ? [await this.captureFor(operation, store, 'before', snapshot.identity.snapshotId)]
      : [];

    await this.arrangeWithRetry(operation, store);
    await this.verify(operation, store, evidenceBefore);
  }

  /** Fresh read → fence → arrange, with one uncommitted-conflict retry. */
  private async arrangeWithRetry(operation: CanvasArrangerOperation, store: LocalWorldStore): Promise<void> {
    const actor = resolveFunctionalArrangerActor(FUNCTIONAL_ARRANGER_ROLE, FUNCTIONAL_ARRANGER_SCOPE);
    const service = createActionService(store, actor.actor, { turn: operation.turnId, agentScope: actor.agentScope });
    for (let attempt = 0; ; attempt++) {
      this.throwIfCancelled(operation);
      const snapshot = await readCanvasSnapshot(store, { layer: operation.layer });
      if (snapshot.layer.id !== operation.layer) throw new Error(`Canvas layer "${operation.layer}" is unavailable.`);
      try {
        const result = await service.arrangeCanvas({
          operationId: operation.operationId,
          layer: operation.layer,
          mode: operation.mode,
          expectedRevision: operation.expectedRevision,
          expectedCanvasVersion: snapshot.identity.canvasVersion,
          snapshotId: snapshot.identity.snapshotId,
          policy: 'deoverlap',
          allowMoveStableCards: true,
          preserveLinks: true,
        });
        operation.committed = true;
        operation.result = result.details as ArrangeCanvasDetails;
        this.signal(operation, 'committed', { result: operation.result });
        return;
      } catch (error) {
        const conflict = error instanceof ActionError && (error as unknown as { code?: string }).code === 'conflict';
        if (!conflict || attempt >= 1) throw error;
      }
    }
  }

  private async verify(operation: CanvasArrangerOperation, store: LocalWorldStore, evidenceBefore: ArrangeScreenshotEvidence[]): Promise<void> {
    if (!operation.committed) {
      this.finish(operation, 'failed', 'verification_failed');
      return;
    }
    try {
      const [snapshot, currentRevision] = await Promise.all([
        readCanvasSnapshot(store, { layer: operation.layer }),
        store.getMaxSeq(),
      ]);
      if (currentRevision !== operation.expectedRevision) {
        this.finish(operation, 'conflict', 'conflict');
        return;
      }
      if (snapshot.layer.id !== operation.layer || snapshot.overlaps.length !== 0) {
        this.finish(operation, 'conflict', 'verification_failed');
        return;
      }
      if (operation.result && snapshot.identity.canvasVersion < operation.result.canvasVersion) {
        this.finish(operation, 'conflict', 'unproven_latest');
        return;
      }
      if (operation.result) {
        operation.result = {
          ...operation.result,
          snapshotIdAfter: snapshot.identity.snapshotId,
          canvasVersion: snapshot.identity.canvasVersion,
          canvasRevision: snapshot.identity.canvasRevision,
          overlapCount: snapshot.overlaps.length,
        };
      }
      if (operation.cancelRequested) {
        this.finish(operation, 'cancelled', 'cancelled');
        return;
      }
      if (operation.result) {
        // Post capture runs only on the verified path; a demanded capture that
        // cannot be produced maps to `partial` (rows retained), identity drift
        // to `conflict` — evidence never pretends.
        let evidence = evidenceBefore;
        if (SCREENSHOT_PHASES[operation.screenshotPolicy].after) {
          evidence = [...evidenceBefore, await this.captureFor(operation, store, 'after', snapshot.identity.snapshotId)];
        }
        if (evidence.length > 0) operation.result = { ...operation.result, screenshotEvidence: evidence };
      }
      // `finish` emits the single terminal `verified` signal.
      this.finish(operation, 'completed');
    } catch (error) {
      if (error instanceof ArrangerFailure && error.code === 'cancelled') throw error;
      if (error instanceof ArrangerFailure) {
        this.finish(operation, error.code === 'conflict' ? 'conflict' : operation.committed ? 'partial' : 'failed', error.code);
        return;
      }
      this.finish(operation, 'conflict', 'unproven_latest');
    }
  }
}

/** Default evidence seam: shared Playwright layer + `.airpworld/arrange/` archive. */
async function defaultCaptureEvidence(
  input: CanvasArrangeCaptureInput,
  store: LocalWorldStore,
  viewport: { width: number; height: number },
): Promise<ArrangeScreenshotEvidence> {
  const captured = await captureLayerSnapshot(store, { layer: input.layer, snapshotId: input.snapshotId, viewport });
  const archivePath = await saveArrangeScreenshot(store, input.operationId, input.phase, captured.png);
  return {
    phase: input.phase,
    path: archivePath,
    width: captured.width,
    height: captured.height,
    snapshotId: captured.identity.snapshotId,
  };
}
