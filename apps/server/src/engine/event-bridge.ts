import fs from 'node:fs';
import { createReasoningFilter, stripReasoning, type ReasoningFilter } from './reasoning-guard.js';
import path from 'node:path';
import type { WebSocketServer } from 'ws';
import type { JsonAgentSessionEvent } from '../../../../vendor/pi-rp/packages/coding-agent/dist/index.js';
import { parseFrontmatter, cardKindOf, layerOfDir, dirOf, entityName, isLayerDir, characterIdOfPath, characterRootConfigOf, REPLAY_TURNS, REPLAY_BUFFER_KEEP, REPLAY_FRAME_ALLOWLIST, type LocalWorldStore } from '@airp/shared';
import { extractContentPrefix } from './chalk-delta.js';
import { billingStopOf } from '../ai-gateway.js';
import {
  ActivityProjector,
  type ActivityTurnContext,
  type ChildActivityEnvelope,
} from './agent-activity.js';

export type EventSource = 'writer' | 'character';

/** Tail-read cadence. */
const TAIL_POLL_MS = 1000;
/** fs.watch debounce for the `file_changed` frame (B0 behaviour, unchanged). */
const WATCH_DEBOUNCE_MS = 150;

/**
 * Canvas SQLite is an implementation detail, not a world-content change.
 * Position/footprint writes already have their own explicit frames (or no
 * frame), while history.db is still drained below. Broadcasting a generic
 * file_changed for SQLite pages makes one footprint write cause an extra
 * layer fetch—and therefore a second reseat—visible as a card jump.
 */
export function shouldBroadcastFileChanged(relativePath: string): boolean {
  return ![
    '.airpworld/canvas.db',
    '.airpworld/canvas.db-wal',
    '.airpworld/canvas.db-shm',
  ].includes(relativePath);
}

/**
 * Pulls the concatenated text blocks out of an assistant message.
 *
 * pi-rp message content is either a plain string or a block array; only `text`
 * blocks land on the canvas, so thinking/toolCall blocks are dropped here.
 */
export function messageText(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: string; text?: string } => typeof block === 'object' && block !== null)
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

/**
 * Pure: take the newest `turns` COMPLETE turns out of a serialized-frame
 * buffer. A turn ends at `writer_idle`.
 *
 * We trim at turn boundaries on BOTH ends, so what we return is only whole
 * turns:
 *  - HEAD trim: the oldest included turn is NEVER truncated — we start after
 *    the (turns+1)th `writer_idle` from the tail.
 *  - TAIL trim: frames after the LAST `writer_idle` (a trailing half-turn,
 *    e.g. the writer is mid-turn, or it died and never emitted `writer_idle`)
 *    are dropped.
 * A buffer with no `writer_idle` at all → `[]`.
 *
 * Non-JSON lines are replayed verbatim but do not count toward the turn budget.
 *
 * Mirrors `~/projects/an earlier Worldlines project/services/gateway/session-host.mjs:80-100`
 * with two substitutions: rivet cuts on `agent_end` (AIRP cuts on the FRAME
 * `writer_idle` — decision C, the design notes; `agent_end` never reaches the
 * frame surface), and rivet only declares the HEAD trim (its docstring says
 * "最旧一轮不截断") whereas we also trim the tail (decision I).
 */
export function replayWindow(buffer: readonly string[], turns = REPLAY_TURNS): string[] {
  // HEAD trim: walk back to the (turns+1)th `writer_idle` and start after it.
  // Fewer than turns+1 turn ends → the oldest included turn is the first frame.
  let head = 0;
  let found = 0;
  for (let i = buffer.length - 1; i >= 0; i -= 1) {
    if (!isWriterIdleLine(buffer[i])) continue;
    found += 1;
    if (found === turns + 1) {
      head = i + 1;
      break;
    }
  }
  // TAIL trim: drop the trailing half-turn after the LAST `writer_idle`. No
  // turn end at all → there is no complete turn to replay.
  for (let i = buffer.length - 1; i >= head; i -= 1) {
    if (isWriterIdleLine(buffer[i])) return buffer.slice(head, i + 1);
  }
  return [];
}

/** A ring entry is a serialized frame; a malformed line is replayed verbatim
 * but must never count as a turn boundary. */
function isWriterIdleLine(line: string): boolean {
  try {
    return (JSON.parse(line) as { type?: unknown } | null)?.type === 'writer_idle';
  } catch {
    return false;
  }
}

/**
 * Replay the buffered `chalk` argument fragments as `writer_delta` frames
 *. Each frame carries the newly-decoded suffix since
 * the previous fragment, so the frontend accumulates ink progressively. If the
 * extractor ever lags the authoritative `content`, one final `mode:'replace'`
 * frame snaps the frontend to the truth (never a double-paste — R3/P1-1).
 */
function emitChalkDeltas(
  push: (msg: Record<string, unknown>) => void,
  frags: string[],
  toolCallId: string,
  authoritative: unknown,
): void {
  let acc = '';
  let prev = '';
  for (const frag of frags) {
    acc += frag;
    const got = extractContentPrefix(acc);
    if (got.text.length > prev.length) {
      push({ type: 'writer_delta', source: 'writer', delta: got.text.slice(prev.length), toolCallId });
      prev = got.text;
    }
  }
  const truth = typeof authoritative === 'string' ? authoritative : '';
  if (truth && prev !== truth) {
    push({ type: 'writer_delta', source: 'writer', delta: truth, toolCallId, mode: 'replace' });
  }
}

/**
 * True when `relPath` is a member of SOME layer's `items` — the precondition for
 * `reconcileLanded` (front end) to ever reclaim the skeleton this frame seats.
 *
 * Seating a phantom for a path that belongs to no layer leaks it forever: the
 * card never enters `items`, so the handover never fires, and the entry keeps
 * occupying a seat in `phantomSeatFor`.
 *
 * Mirrors how each lane derives its members — deliberately WITHOUT calling the
 * store (`cardWritingFrame` is pure and runs on the synchronous map loop), but
 * reusing the ONE predicates that own each question:
 * - `world/**` is the layer tree — `isLayerDir` (`layers.ts`), the same call
 *   `deriveLayers` makes;
 * - `characters/<id>/**` is a nook page, minus the four root config files that
 *   `nookCardPaths` excludes via `characterRootConfigOf` (not public nook cards);
 * - `player/**`, `world.json`, and those root configs are in NO layer's `items`.
 *
 * `kind === 'gate'` (any README) is already rejected downstream, so the map
 * layer's own README needs no special case here.
 */
function isLayerMemberPath(relPath: string): boolean {
  if (isLayerDir(dirOf(relPath))) return true;
  return characterIdOfPath(relPath) !== null && characterRootConfigOf(relPath) === null;
}

/**
 * Build the `card_writing` presentation frame from a `write` tool's start event
 *. The writer is about to land a component card; this
 * tells the front end which seat, shape and title to sketch, so the card never
 * pops into existence.
 *
 * Pure: no I/O, never throws (the caller is the synchronous `mapEngineEvent`
 * loop — a throw here would drop every later frame). `content` absent or
 * unparseable → `kind` falls back to `'note'` (NOT `'default'`: `cardKindOf`'s
 * final return is `note`). `layer` is omitted when the path has no directory
 * **or** when the path is in no layer's `items`
 * — the front end reads a missing `layer` as "not a
 * layer card" and skips the skeleton, which is the one mechanism for both.
 *
 * Owner: the design notes
 */
function cardWritingFrame(
  source: EventSource,
  toolCallId: string,
  args: unknown,
): Record<string, unknown> {
  const a = args as { path?: unknown; content?: unknown } | undefined;
  const relPath = typeof a?.path === 'string' ? a.path : '';
  const content = typeof a?.content === 'string' ? a.content : '';
  const layer = layerOfDir(dirOf(relPath));
  const seatable = isLayerMemberPath(relPath);
  const fm = parseFrontmatter(content).frontmatter;
  const kind = cardKindOf(fm, path.basename(relPath));
  const frame: Record<string, unknown> = {
    type: 'card_writing',
    source,
    toolCallId,
    kind,
    title: entityName(fm, relPath),
  };
  // Omit `layer` when the path has no directory (F-2 §2) or belongs to no layer's
  // `items` (§10.4a): the front end reads a missing layer as "not a layer card"
  // and skips the skeleton (F-10 ruling O). One mechanism, two reasons.
  if (layer !== '' && seatable) frame.layer = layer;
  return frame;
}

/**
 * Translates one pi-rp `JsonAgentSessionEvent` into zero or more AIRP WS messages.
 *
 * Deliberately a pure function — the bridge (and the probe) can call it directly
 * without a live WebSocket. `toolArgs` is the caller-owned call-id → args map that
 * lets `tool_execution_end` recover the path a `write`/`chalk` targeted; the
 * function reads and prunes it, so a long session never accumulates entries.
 *
 * Presentation frames and world-event `type`s are two namespaces; everything
 * here is a transient frame driven by an engine result, never an event row.
 */
export function mapEngineEvent(
  source: EventSource | 'functional',
  event: JsonAgentSessionEvent,
  toolArgs: Map<string, unknown>,
  characterId?: string,
  toolcallBuf?: Map<number, string[]>,
  turnIdOrContext: string | ActivityTurnContext = `orphan:${source}`,
  projector = new ActivityProjector(),
  savePath?: string,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const context: ActivityTurnContext = typeof turnIdOrContext === 'string'
    ? {
      source,
      agentId: source === 'character' ? `character:${characterId ?? 'unknown'}` : source,
      turnId: turnIdOrContext,
    }
    : turnIdOrContext;
  // Activity frames deliberately omit characterId; the stable character identity
  // is carried by `agentId`. Legacy presentation frames retain old routing metadata.
  const push = (msg: Record<string, unknown>, includeCharacterId = true) =>
    out.push({
      ...msg,
      ...(includeCharacterId && characterId === undefined ? {} : includeCharacterId ? { characterId } : {}),
      ...(savePath === undefined ? {} : { savePath }),
      timestamp: new Date().toISOString(),
    });
  const pushActivities = (frames: Record<string, unknown>[]) => {
    for (const frame of frames) push({ type: 'agent_activity', ...frame }, false);
  };
  switch (event.type) {
    case 'message_update': {
      const assistantEvent = event.assistantMessageEvent;
      // the design notes — the writer's narration is the `chalk` TOOL's
      // `content` argument, NOT its text reply ("text that lives only in your
      // reply never reaches the player"). So a writer `text_delta` produces NO
      // frame; the writer lane is driven by `toolcall_delta` buffered until
      // `toolcall_end` confirms the tool is `chalk` (its name is unknown while
      // the argument fragments stream — the design notes).
      if (assistantEvent?.type === 'text_delta' && assistantEvent.delta && source !== 'writer') {
        push({ type: 'character_delta', source, delta: assistantEvent.delta });
      } else if (assistantEvent?.type === 'toolcall_delta' && assistantEvent.delta && source === 'writer' && toolcallBuf) {
        const frags = toolcallBuf.get(assistantEvent.contentIndex) ?? [];
        frags.push(assistantEvent.delta);
        toolcallBuf.set(assistantEvent.contentIndex, frags);
      } else if (assistantEvent?.type === 'toolcall_end' && source === 'writer' && toolcallBuf) {
        // Deferred confirmation: only NOW is `toolCall.name` known.
        const frags = toolcallBuf.get(assistantEvent.contentIndex) ?? [];
        toolcallBuf.delete(assistantEvent.contentIndex);
        const tc = assistantEvent.toolCall as { id?: string; name?: string; arguments?: { content?: unknown } } | undefined;
        if (tc?.name === 'chalk' && typeof tc.id === 'string') {
          emitChalkDeltas(push, frags, tc.id, tc.arguments?.content);
        }
      }
      break;
    }
    case 'agent_activity': {
      // Engine-native subagent/command activity (pi-rp transient
      // AgentActivityEvent). The old hidden-custom-message relay
      // (airp_agent_activity) is gone: this event never touches the session
      // tree, so the only source is the engine forwarder itself. Projection
      // rules still apply: fixed 'functional'
      // source, allowlist-shaped identity, fail-closed on any deviation.
      const activity = event as unknown as Record<string, unknown>;
      const allowedKeys = new Set([
        'type', 'origin', 'agentId', 'turnId', 'toolCallId', 'toolName',
        'phase', 'args', 'details', 'isError', 'errorKind', 'timestamp',
      ]);
      const validIdentity =
        (activity.origin === 'subagent' || activity.origin === 'command') &&
        typeof activity.agentId === 'string' &&
        /^[a-z][a-z0-9-]{1,63}$/.test(activity.agentId) &&
        typeof activity.turnId === 'string' &&
        /^functional:[A-Za-z0-9._:-]{1,160}$/.test(activity.turnId);
      const validActivity =
        Object.keys(activity).every((key) => allowedKeys.has(key)) &&
        validIdentity &&
        typeof activity.toolCallId === 'string' &&
        activity.toolCallId.length > 0 &&
        activity.toolCallId.length <= 128 &&
        typeof activity.toolName === 'string' &&
        activity.toolName.length > 0 &&
        activity.toolName.length <= 128 &&
        (activity.isError === undefined || typeof activity.isError === 'boolean') &&
        (activity.errorKind === undefined ||
          ['tool_error', 'timeout', 'cancelled', 'agent_stopped'].includes(String(activity.errorKind)));
      if (validActivity) {
        const relayTurn: ActivityTurnContext = {
          source: 'functional',
          agentId: activity.agentId as string,
          turnId: activity.turnId as string,
        };
        const isStart = activity.phase === 'start';
        const relayEvent: ChildActivityEnvelope = {
          type: isStart ? 'tool_start' : 'tool_end',
          context: relayTurn,
          toolCallId: activity.toolCallId as string,
          toolName: activity.toolName as string,
          ...(activity.args !== undefined ? { args: activity.args } : {}),
          ...(activity.details !== undefined ? { details: activity.details } : {}),
          ...(activity.isError !== undefined ? { isError: activity.isError as boolean } : {}),
          ...(activity.errorKind !== undefined
            ? { errorKind: activity.errorKind as ChildActivityEnvelope['errorKind'] }
            : {}),
        };
        pushActivities(isStart
          ? projector.acceptToolStart(relayTurn, relayEvent)
          : projector.acceptToolEnd(relayTurn, relayEvent));
        if (!isStart && ['airp-init', 'scene-init', 'nook-init'].includes(relayEvent.toolName)) {
          const reason = relayEvent.errorKind === 'timeout'
            ? 'timeout'
            : relayEvent.errorKind === 'cancelled' ? 'cancelled' : 'agent_stopped';
          pushActivities(projector.failAgent(relayTurn, reason));
        }
      }
      break;
    }
    case 'message_end': {
      const message = event.message as unknown as Record<string, unknown> | undefined;
      if (message?.role === 'assistant') {
        const result = message as { stopReason?: string; errorMessage?: string };
        // A user-aborted turn is not a failure: the Stop control routes through
        // `abort` → `stopReason: 'aborted'`, so surfacing it as `error` would
        // show a red notice for the action the player just asked for.
        if (result.stopReason === 'error') {
          // A billing stop (402 claim_required / insufficient_credits / debt_limit, 429 quota_exceeded):
          // the turn ends here — pi does not retry it (ai-gateway.ts billingStopResponse says "billing") —
          // and the frame names the stop so the page shows ONE notice + the claim / account card for
          // the whole turn, whether the writer or a character hit it (useWorld billingNotice).
          const message = result.errorMessage || 'The agent could not finish this turn.';
          const billing = billingStopOf(message);
          push({ type: 'error', source, message, ...(billing ? { billing } : {}) });
          break;
        }
        if (result.stopReason === 'aborted') {
          push({ type: 'turn_aborted', source, reason: 'aborted' });
          break;
        }
        const text = messageText(message);
        if (text) {
          push({ type: source === 'writer' ? 'writer_message' : 'character_message', source, text });
        }
      }
      break;
    }
    case 'tool_execution_start': {
      toolArgs.set(event.toolCallId, event.args);
      push({ type: 'tool_start', source, toolName: event.toolName, toolCallId: event.toolCallId, args: event.args });
      pushActivities(projector.acceptToolStart(context, {
        type: 'tool_start',
        context,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      }));
      if (event.toolName === 'chalk') {
        push({ type: 'chalk_writing', source, toolCallId: event.toolCallId });
      }
      // Component cards: the writer's own `write` (not the chalk lane, not the
      // init subagents — their events do not bubble). Independent statement,
      // parallel to `pushActivities` above, so this hunk separates cleanly.
      if (event.toolName === 'write' && source === 'writer') {
        push(cardWritingFrame(source, event.toolCallId, event.args));
      }
      break;
    }
    case 'tool_execution_update': {
      // doc-tools/11 §6.3 — `generate_image` is the only long-running tool that
      // streams progress; it belongs to the presentation channel, not history.
      if (event.toolName === 'generate_image') {
        const d = ((event.partialResult as { details?: Record<string, unknown> } | null)?.details ?? {}) as Record<string, unknown>;
        push({
          type: 'image_generation_progress',
          source,
          toolCallId: event.toolCallId,
          stage: d.stage,
          elapsedMs: d.elapsedMs,
          width: d.width,
          height: d.height,
        });
      }
      break;
    }
    case 'tool_execution_end': {
      const args = toolArgs.get(event.toolCallId) as { path?: unknown } | undefined;
      toolArgs.delete(event.toolCallId);
      // pi-rp forwards the WHOLE AgentToolResult (agent/src/types.ts:361-375),
      // so a tool's `details` live under `result.details`, never on `result`.
      const r = (event.result ?? null) as Record<string, unknown> | null;
      const details = (r?.details ?? {}) as Record<string, unknown>;
      pushActivities(projector.acceptToolEnd(context, {
        type: 'tool_end',
        context,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args,
        details,
        isError: event.isError,
        errorKind: event.isError ? 'tool_error' : undefined,
      }));
      // A generate_image refused for billing (429 quota_exceeded / 402
      // insufficient_credits / claim_required): the client shows the same
      // notice + claim / redeem entry as a TTS or writer stop.
      const billing = event.isError && event.toolName === 'generate_image'
        ? billingStopOf(JSON.stringify(r?.content ?? r ?? ''))
        : null;
      push({
        type: 'tool_end',
        source,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        isError: event.isError,
        ...(billing ? { billing } : {}),
      });
      if (event.toolName === 'chalk' || event.toolName === 'write') {
        const landed: Record<string, unknown> = { type: 'chalk_landed', source, toolCallId: event.toolCallId };
        // doc-tools/02 §6.3: the path lives in `details.path`; the flat
        // `result.path` shape is legacy, kept so both work.
        const resultPath =
          (typeof r?.path === 'string' ? r.path : undefined) ??
          (typeof details.path === 'string' ? details.path : undefined);
        const targetPath = (typeof args?.path === 'string' ? args.path : undefined) ?? resultPath;
        if (targetPath) landed.path = targetPath;
        push(landed);
      }
      if (event.toolName === 'link' || event.toolName === 'arrange') {
        // doc-tools/09 §6.2: carry the details so the frontend patches in place
        // instead of re-fetching the whole layer.
        push({
          type: 'canvas_patched',
          source,
          layer: typeof details.layer === 'string' ? details.layer : undefined,
          kind: details.kind,
          action: details.action,
          links: Array.isArray(details.links) ? details.links : undefined,
          cards: Array.isArray(details.cards) ? details.cards : undefined,
        });
      }
      // A character's own skill check rolls inside skill_check:
      // same ceremony frame as roll_dice, from the nested roll.
      const rolledCheck = event.toolName === 'skill_check' && !event.isError && details.roll && typeof details.roll === 'object'
        ? details.roll as Record<string, unknown>
        : null;
      if (rolledCheck) {
        push({
          type: 'dice_result',
          source,
          path: rolledCheck.path,
          name: rolledCheck.name,
          dice: rolledCheck.dice,
          desc: rolledCheck.desc,
          expect: rolledCheck.expect,
          result: rolledCheck.result,
          passed: rolledCheck.passed,
          rolls: rolledCheck.rolls,
          crit: rolledCheck.crit,
          fumble: rolledCheck.fumble,
          layer: rolledCheck.layer,
          ...(rolledCheck.skill ? { skill: rolledCheck.skill } : {}),
          ...(typeof rolledCheck.outcome === 'string' ? { outcome: rolledCheck.outcome } : {}),
        });
      }
      if (event.toolName === 'roll_dice' && !event.isError) {
        // the design notes: the PRESENTATION frame is `dice_result`; the EVENT
        // stays `roll_resolved` and reaches the canvas via the tail reader.
        // Field names are frozen by the design notes — literally the same as
        // the HTTP response body so the frontend needs one type, not two.
        push({
          type: 'dice_result',
          source,
          path: details.path,
          name: details.name,
          dice: details.dice,
          desc: details.desc,
          expect: details.expect,
          result: details.result,
          passed: details.passed,
          rolls: details.rolls, // per-die faces, for the tumbling animation
          crit: details.crit, // big success banner
          fumble: details.fumble, // big failure banner
          layer: details.layer,
          ...(details.skill ? { skill: details.skill } : {}), // a skill check's tier line
          // The shared tier + its consequence chip.
          ...(typeof details.outcome === 'string' ? { outcome: details.outcome } : {}),
          ...(details.consequence && typeof details.consequence === 'object' ? { consequence: details.consequence } : {}),
        });
      }
      if (event.toolName === 'show' && !event.isError) {
        // doc-tools/10 §6.2: broadcast the ShowFrame verbatim. A missing frame is
        // warned about, never faked — "宁可什么都不演，也不要演错的".
        if (details.frame && typeof details.frame === 'object') {
          push(details.frame as Record<string, unknown>);
        } else {
          console.warn('[EventBridge] show returned no details.frame; nothing broadcast.');
        }
      }
      if (event.toolName === 'generate_image' && !event.isError) {
        push({
          type: 'image_landed',
          source,
          toolCallId: event.toolCallId,
          asset: details.asset,
          mimeType: details.mimeType,
          width: details.width,
          height: details.height,
          reused: !!details.reused,
        });
      }
      break;
    }
    case 'turn_end': {
      // A missing tool_execution_end must not strand a running capsule.
      pushActivities(projector.failTurn(context, 'agent_stopped'));
      break;
    }
    case 'agent_settled': {
      pushActivities(projector.failTurn(context, 'agent_stopped'));
      push({ type: source === 'writer' ? 'writer_idle' : 'character_idle', source });
      break;
    }
  }

  return out;
}

/** Read one websocket frame out of the sink in tests. */
interface BroadcastSink {
  clients: Iterable<{ readyState: number; send(payload: string): void }>;
}

export class EventBridge {
  private wss: BroadcastSink | null = null;
  /** Server-side reactions to world events (e.g. a loop reset retiring agent sessions). */
  private worldEventListeners: Array<(event: { type: string; detail: Record<string, unknown> }, worldRoot: string) => void> = [];
  private activityProjector = new ActivityProjector();
  private fileWatcher: fs.FSWatcher | null = null;
  private watchDebounceTimer: NodeJS.Timeout | null = null;
  private toolArgsByCallId = new Map<string, unknown>();
  /** Accumulated raw `toolcall_delta` fragments per contentIndex, until
   * `toolcall_end` reveals the tool name. */
  private toolcallBuf = new Map<number, string[]>();
  /** Per character (or source): the live reasoning filter of the reply being streamed (reasoning-guard.ts). */
  private reasoningFilters = new Map<string, ReasoningFilter>();
  /** Serialized frames already broadcast — the replay source. Bounded by
   *  REPLAY_BUFFER_KEEP; only names in REPLAY_FRAME_ALLOWLIST ever enter
   * (decision D, the design notes). */
  private replayRingsBySavePath = new Map<string, string[]>();

  private tailTimer: NodeJS.Timeout | null = null;
  /** Tail-read cursor: the highest `seq` already broadcast. */
  private lastSeq = 0;
  /** False until `getMaxSeq()` aligned the cursor — draining before that would replay all history. */
  private tailReady = false;
  /** Serialises drains — two concurrent reads would broadcast the same rows twice. */
  private draining: Promise<void> | null = null;
  /** The store the tail reader reads from; null until `startTailReader()`. */
  private tailStore: LocalWorldStore | null = null;
  /**
   * Bumped by every `startTailReader()` / `stopTailReader()`. A drain captures it
   * BEFORE its await; if a world switch happened in between, the stale batch is
   * discarded instead of writing `lastSeq` / broadcasting events from the OLD
   * world into the NEW one (REVIEW m-24).
   */
  private tailEpoch = 0;

  setWss(wss: WebSocketServer): void {
    this.wss = wss;
  }

  /**
   * Fan a frame out to every open client.
   *
   * Per-client try/catch: one half-dead socket must not abort the loop and starve
   * every other client. Without it a synchronous throw would propagate into the
   * drain loop, leaving `lastSeq` unadvanced — the tail reader would then retry
   * the SAME frame forever, stuck on that one bad socket.
   */
  broadcast(message: Record<string, unknown>): void {
    if (typeof message.savePath !== 'string' || !message.savePath) return;
    if (!this.wss) return;
    const payload = JSON.stringify(message);
    // Replay ring: after serialization, BEFORE
    // fan-out. An ALLOWLIST, not a denylist — the presentation frames have no
    // client-side dedupe and non-idempotent side effects (a replayed
    // `chalk_landed` would fire `playFoley` again), so they are kept out at the
    // SOURCE. `*_delta`, ritual and meta frames never enter (decision D).
    const type = message.type;
    if (typeof type === 'string' && (REPLAY_FRAME_ALLOWLIST as readonly string[]).includes(type)) {
      const savePath = message.savePath;
      const ring = this.replayRingsBySavePath.get(savePath) ?? [];
      ring.push(payload);
      if (ring.length > REPLAY_BUFFER_KEEP) ring.splice(0, ring.length - REPLAY_BUFFER_KEEP);
      this.replayRingsBySavePath.delete(savePath);
      this.replayRingsBySavePath.set(savePath, ring);
      while (this.replayRingsBySavePath.size > 8) {
        const oldest = this.replayRingsBySavePath.keys().next().value;
        if (oldest === undefined) break;
        this.replayRingsBySavePath.delete(oldest);
      }
    }
    for (const client of this.wss.clients) {
      if (client.readyState !== 1 /* OPEN */) continue;
      try {
        client.send(payload);
      } catch (err) {
        console.warn('[EventBridge] send failed, dropping frame for one client:', err);
      }
    }
  }

  /**
   * Send the last `turns` complete turns to ONE freshly-connected socket, then
   * the boundary frame. Synchronous: registration and snapshot happen in the
   * same tick, so a live frame can never interleave into the middle of a
   * replayed turn (no reordering, no interleaving).
   *
   * That same-tick guarantee does NOT make duplicate frames harmless: the
   * presentation frames have NO client-side dedupe and their effects are not
   * idempotent (a replayed `chalk_landed` fires `playFoley('paper-slide')` again,
   * a replayed `show_frame` re-runs the whole performance). So duplicates are
   * kept out at the SOURCE, by the allowlist: any frame with a non-idempotent
   * side effect is never put in the ring in the first place (decision D).
   */
  replayTo(client: { readyState: number; send(payload: string): void }, savePath: string | null): void {
    const lines = savePath
      ? replayWindow(this.replayRingsBySavePath.get(savePath) ?? [])
      : [];
    // Report the COMPLETE turns actually sent (decision H): the ring may hold
    // fewer than REPLAY_TURNS (fresh server), so the count is observed here, not
    // assumed. Every whole turn the window returns ends in `writer_idle`.
    let turns = 0;
    for (const line of lines) if (isWriterIdleLine(line)) turns += 1;
    if (client.readyState !== 1 /* OPEN */) return;
    // Per-send try/catch: a half-dead socket must not abort the rest of the
    // replay, nor bubble out of `wss.on('connection')` (same discipline as
    // `broadcast`, the design notes step 6).
    for (const line of lines) {
      try {
        client.send(line);
      } catch (err) {
        console.warn('[EventBridge] replay send failed, continuing with next frame:', err);
      }
    }
    try {
      client.send(JSON.stringify({ type: 'replay_done', turns, timestamp: new Date().toISOString(), savePath }));
    } catch (err) {
      console.warn('[EventBridge] replay_done send failed:', err);
    }
  }

  /** Fan an engine event out to every WS client as the mapped AIRP frames. */
  emitEngine(
    source: EventSource,
    event: JsonAgentSessionEvent,
    characterId?: string,
    turnId?: string,
    savePath?: string,
  ): void {
    // A buffered tool-call that never reached `toolcall_end` (aborted turn)
    // would leak across turns; clear it when the turn settles.
    if (event.type === 'message_end' || event.type === 'agent_settled') {
      this.toolcallBuf.clear();
    }
    const guardKey = characterId ?? source;
    for (const message of mapEngineEvent(
      source,
      event,
      this.toolArgsByCallId,
      characterId,
      this.toolcallBuf,
      turnId ?? `orphan:${source}`,
      this.activityProjector,
      savePath,
    )) {
      // A character's spoken line never carries the model's reasoning (reasoning-guard.ts).
      if (message.type === 'character_delta' && typeof message.delta === 'string') {
        let filter = this.reasoningFilters.get(guardKey);
        if (!filter) this.reasoningFilters.set(guardKey, filter = createReasoningFilter());
        const delta = filter.push(message.delta);
        if (delta) this.broadcast({ ...message, delta });
        continue;
      }
      if (message.type === 'character_message' && typeof message.text === 'string') {
        const tail = this.reasoningFilters.get(guardKey)?.end();
        this.reasoningFilters.delete(guardKey);
        if (tail) this.broadcast({ ...message, type: 'character_delta', delta: tail, text: undefined });
        const text = stripReasoning(message.text);
        if (text) this.broadcast({ ...message, text });
        continue;
      }
      this.broadcast(message);
    }
    if (event.type === 'message_end' || event.type === 'agent_settled') this.reasoningFilters.delete(guardKey);
  }
  /**
   * A functional agent (the canvas arranger, the design notes) runs in its own
   * RPC session and names itself: its `agentId` is the context, never derived
   * from `source`. Only the activity frames fan out — the writer/character
   * presentation frames (`*_idle`, `character_delta`, `chalk_*`) belong to the
   * narrative lanes and would mislead the reader panel.
   */
  emitFunctional(agentId: string, event: JsonAgentSessionEvent, turnId: string, savePath?: string): void {
    const context: ActivityTurnContext = { source: 'functional', agentId, turnId };
    for (const message of mapEngineEvent(
      'functional', event, this.toolArgsByCallId, undefined, undefined, context, this.activityProjector, savePath,
    )) {
      if (message.type === 'agent_activity') this.broadcast(message);
    }
  }
  failFunctional(agentId: string, turnId: string, reason: 'timeout' | 'cancelled' | 'agent_stopped', savePath?: string): void {
    const context: ActivityTurnContext = { source: 'functional', agentId, turnId };
    for (const frame of this.activityProjector.failTurn(context, reason)) {
      this.broadcast({ ...frame, ...(savePath === undefined ? {} : { savePath }) });
    }
  }
  failActivity(
    source: EventSource,
    characterId: string | undefined,
    turnId: string,
    reason: 'timeout' | 'cancelled' | 'agent_stopped',
    savePath?: string,
  ): void {
    const context: ActivityTurnContext = {
      source,
      agentId: source === 'character' ? `character:${characterId ?? 'unknown'}` : source,
      turnId,
    };
    for (const frame of this.activityProjector.failTurn(context, reason)) {
      this.broadcast({ ...frame, ...(savePath === undefined ? {} : { savePath }) });
    }
  }
  /**
   * the design notes — the ONE channel that carries world events to the
   * frontend. Extensions cannot touch the WS (00 §1), so the server polls the
   * `events` table they write.
   *
   * Contract: `appendEvent` returns only after COMMIT, so
   * every `seq` we read is final and monotonic; a missing row just means the
   * debounce has not elapsed and the next drain will see it.
   */
  /** Run `listener` for every world event the tail reads (after it is broadcast). Never throws into the tail. */
  onWorldEvent(listener: (event: { type: string; detail: Record<string, unknown> }, worldRoot: string) => void): void {
    this.worldEventListeners.push(listener);
  }

  async drainWorldEvents(): Promise<void> {
    if (this.draining) return this.draining; // serialise; two reads would duplicate rows
    const store = this.tailStore;
    const epoch = this.tailEpoch;
    // `!tailReady` guard: fs.watch can fire between startTailReader() and the
    // getMaxSeq() resolve. Draining then would start from 0 and replay the whole
    // history at the frontend. The ~1s fallback timer covers that gap.
    if (!store || !this.tailReady) return;

    this.draining = (async () => {
      try {
        const events = await store.getEventsSince(this.lastSeq);
        // World switch during the await: `store` is now closed and its seq
        // belongs to another history.db. Drop the batch — advancing lastSeq or
        // broadcasting here would leak the old world's events into the new one.
        if (epoch !== this.tailEpoch || store !== this.tailStore) return;
        // Advance BEFORE broadcasting: a throw inside broadcast must not make us
        // re-read and re-send the same batch forever.
        for (const event of events) {
          this.lastSeq = event.seq; // `getEventsSince` is ASC by seq (01 §3.3)
          this.broadcast({ type: 'world_event', event, timestamp: new Date().toISOString(), savePath: store.worldRoot });
          for (const listener of this.worldEventListeners) {
            try {
              listener(event, store.worldRoot);
            } catch (err) {
              console.warn('[EventBridge] world event listener failed:', err);
            }
          }
        }
      } catch (err) {
        // Do NOT advance on read failure — a caught error with a bumped cursor
        // would drop those events permanently.
        console.warn('[EventBridge] tail read failed; cursor unchanged:', err);
      } finally {
        this.draining = null;
      }
    })();
    return this.draining;
  }

  /**
   * Align the cursor and start polling.
   *
   * `getMaxSeq` at start is deliberate: we do NOT replay
   * history, otherwise a fresh server would re-enact every event since the world
   * was created. Call again after a world switch — the new history.db has its own
   * sequence, and a stale cursor could permanently skip events.
   *
   * MUST run BEFORE `watchWorld()`: the watcher kicks `drain()`, and aligning
   * first keeps "align, then listen" unambiguous.
   */
  startTailReader(store: LocalWorldStore): void {
    this.stopTailReader(); // bumps tailEpoch: discards any in-flight drain
    const epoch = this.tailEpoch; // captured AFTER the bump, so it names this start
    this.tailStore = store;
    void store
      .getMaxSeq()
      .then((max) => {
        // A newer start may have happened while this read was in flight — its
        // cursor belongs to another history.db, so this value must not win.
        if (epoch !== this.tailEpoch) return;
        this.lastSeq = max;
      })
      .catch((err) => {
        console.warn('[EventBridge] getMaxSeq failed; starting from 0 (history will replay):', err);
        if (epoch !== this.tailEpoch) return;
        this.lastSeq = 0;
      })
      .finally(() => {
        // The alignment is async, so a newer startTailReader()/stopTailReader()
        // may have run while getMaxSeq was in flight. Installing the timer then
        // would leave a reader alive for a world nobody is watching (and a
        // second start would stack a second interval). Same epoch discipline as
        // the drain guard below, applied to the startup path.
        if (epoch !== this.tailEpoch) return;
        this.tailReady = true;
        this.tailTimer = setInterval(() => {
          void this.drainWorldEvents();
        }, TAIL_POLL_MS);
        this.tailTimer.unref?.();
      });
  }

  stopTailReader(): void {
    if (this.tailTimer) {
      clearInterval(this.tailTimer);
      this.tailTimer = null;
    }
    this.tailStore = null;
    this.tailReady = false;
    // Invalidate any in-flight drain: it captured the OLD epoch and will drop its
    // batch on resolve instead of writing lastSeq / broadcasting (REVIEW m-24).
    this.tailEpoch += 1;
    this.draining = null;
  }

  watchWorld(worldRoot: string): void {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }

    try {
      this.fileWatcher = fs.watch(worldRoot, { recursive: true }, (eventType, filename) => {
        // the design notes: keep history.db visible to the tail reader, but
        // do not turn canvas SQLite implementation writes into content refreshes.
        // Position writes already emit card_position/canvas_patched; footprint
        // writes intentionally emit no frame and must not cause a second fetch.
        const rel = (filename ?? '').split(path.sep).join('/');
        const ignored =
          !shouldBroadcastFileChanged(rel) ||
          rel.startsWith('.airpworld/assets/') ||
          rel.startsWith('.airpworld/sessions/') ||
          rel.startsWith('node_modules/') ||
          rel.includes('/node_modules/');

        // Always kick the tail reader, even for an ignored path or an undefined
        // `filename` (some platforms never supply one): something wrote, and a
        // history.db write is precisely the case this reader exists for.
        // `drainWorldEvents` is a no-op until `tailReady`, so this is safe during
        // startup.
        void this.drainWorldEvents();
        if (ignored || !rel) return;

        if (this.watchDebounceTimer) clearTimeout(this.watchDebounceTimer);
        this.watchDebounceTimer = setTimeout(() => {
          this.broadcast({
            type: 'file_changed',
            eventType,
            savePath: worldRoot,
            timestamp: new Date().toISOString(),
          });
        }, WATCH_DEBOUNCE_MS);
      });
    } catch (err) {
      console.warn('[EventBridge] Could not watch world directory:', err);
    }
  }

  close(): void {
    this.stopTailReader();
    this.activityProjector.clear();
    // Drop the replay source: frames from the closed world must not replay into
    // a later connection.
    this.replayRingsBySavePath.clear();
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
      this.watchDebounceTimer = null;
    }
  }
}
