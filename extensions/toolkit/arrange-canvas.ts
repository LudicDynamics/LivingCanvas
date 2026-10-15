import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { ActionError } from '../../packages/shared/dist/index.js';
import { fail, ok } from './result.js';

/**
 * `arrange_canvas` — agent-initiated canvas arrangement (the design notes,
 * 2026-09-18 third ruling). Writer and character agents state INTENT only;
 * the deterministic server-side state machine owns everything else: it reads
 * a fresh snapshot, mints the version fences, runs the collision kernel, and
 * verifies the result. The tool never accepts coordinates, and unlike the
 * pre-de-agenting shell it does NOT require a `view_canvas` fence — agents
 * are initiators, not fence couriers.
 *
 * Transport is the server HTTP contract (`POST /api/canvas/arrange` without a
 * fence → fresh-fence mode, then `GET /api/canvas/arrange/:id` until the
 * terminal outcome). Evidence screenshots, when demanded via
 * `screenshotPolicy`, are archived under `.airpworld/arrange/` in the world
 * tree and their world-relative paths are cited in the receipt.
 */

const MODES = ['grid', 'circle', 'row'] as const;
const POLICIES = ['none', 'before', 'after', 'before_and_after'] as const;
const POLL_INTERVAL_MS = 150;
const POLL_TIMEOUT_MS = 60_000;

interface ArrangerOperationView {
  operationId: string;
  requestId: string;
  worldId: string;
  layer: string;
  terminal: boolean;
  committed: boolean;
  outcome?: 'completed' | 'partial' | 'failed' | 'cancelled' | 'conflict';
  error?: string;
  result?: { movedCount?: number; screenshotEvidence?: Array<{ phase: string; path: string; width: number; height: number; snapshotId: string }> } & Record<string, unknown>;
}

function serverOrigin(): URL {
  const raw = process.env.AIRP_WEB_ORIGIN?.trim();
  if (!raw) throw new ActionError({ code: 'unsupported', message: 'arrange_canvas unavailable: the canvas server origin is not configured.', details: { reason: 'origin_unconfigured' } });
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('bad protocol');
    return url;
  } catch {
    throw new ActionError({ code: 'unsupported', message: 'arrange_canvas unavailable: the canvas server origin is not configured.', details: { reason: 'origin_invalid' } });
  }
}

function transportError(status: number, body: unknown): ActionError {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const message = typeof record.error === 'string' && record.error.trim() !== '' ? record.error : `arrange_canvas failed: the server returned HTTP ${status}.`;
  const code = status === 409 ? 'conflict' : status === 404 ? 'not_found' : status === 400 ? 'invalid_argument' : status === 501 ? 'unsupported' : 'internal';
  return new ActionError({ code, message, details: record.details ?? { status } });
}

async function postJson(url: string, body: unknown, signal: AbortSignal | undefined): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw transportError(response.status, payload);
    return payload;
  } catch (error) {
    if (error instanceof ActionError) throw error;
    if (controller.signal.aborted) throw new ActionError({ code: 'internal', message: 'arrange_canvas cancelled before the server accepted it.', details: { reason: 'aborted' } });
    throw new ActionError({ code: 'internal', message: 'arrange_canvas failed: the arrangement server could not be reached.', details: { reason: 'transport' } });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function pollTerminal(origin: URL, operationId: string, signal: AbortSignal | undefined): Promise<ArrangerOperationView> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const controller = new AbortController();
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  try {
    while (Date.now() < deadline) {
      if (controller.signal.aborted) throw new ActionError({ code: 'internal', message: 'arrange_canvas cancelled while running.', details: { reason: 'aborted' } });
      const response = await fetch(new URL(`/api/canvas/arrange/${operationId}`, origin), { signal: controller.signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw transportError(response.status, payload);
      const operation = payload as ArrangerOperationView;
      if (operation?.terminal) return operation;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new ActionError({ code: 'internal', message: 'arrange_canvas timed out waiting for the arranger to finish.', details: { reason: 'timeout' } });
  } finally {
    signal?.removeEventListener('abort', forward);
  }
}

function receipt(operation: ArrangerOperationView): { text: string; details: Record<string, unknown> } {
  const outcome = operation.outcome ?? 'failed';
  const moved = operation.result?.movedCount ?? 0;
  const evidence = operation.result?.screenshotEvidence ?? [];
  const evidenceNote = evidence.length > 0
    ? ` Evidence: ${evidence.map((item) => `${item.phase} ${item.path}`).join('; ')}.`
    : '';
  const text = outcome === 'completed'
    ? `arrange_canvas completed: moved ${moved} card(s) into a clean layout on layer "${operation.layer}".${evidenceNote}`
    : outcome === 'conflict'
      ? `arrange_canvas conflicted: the canvas changed while arranging (${operation.error ?? 'conflict'}).${operation.committed ? ` The ${moved} moved card(s) are kept.` : ' Nothing was committed.'}`
      : outcome === 'partial'
        ? `arrange_canvas partially completed: cards were rearranged, but the confirmation screenshot failed (${operation.error ?? 'screenshot_failed'}).`
        : outcome === 'cancelled'
          ? 'arrange_canvas was cancelled before completion.'
          : `arrange_canvas failed: ${operation.error ?? 'failed'}. No cards were moved.`;
  return { text, details: { outcome, committed: operation.committed, movedCount: moved, evidence, requestId: operation.requestId } };
}

export const arrangeCanvasTool = defineTool({
  name: 'arrange_canvas',
  label: 'Arrange Canvas',
  description:
    'De-overlap the complete current layer through the deterministic server-side arranger. ' +
    'Unlike `arrange` with `layout` (which re-flows EVERY card from scratch), arrange_canvas only moves ' +
    'the cards that actually overlap and verifies the result. State intent only: the server reads the ' +
    'current canvas, owns all fences, and never accepts coordinates.',
  parameters: Type.Object(
    {
      layer: Type.String({ description: 'Exact canvas layer to arrange, e.g. "world/map".' }),
      mode: Type.Optional(Type.Union([Type.Literal('grid'), Type.Literal('circle'), Type.Literal('row')], { description: 'Seat layout; defaults to grid.' })),
      screenshotPolicy: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('before'), Type.Literal('after'), Type.Literal('before_and_after')], { description: 'Capture evidence screenshots around the arrangement; defaults to none.' })),
    },
    { additionalProperties: false },
  ),
  promptSnippet: 'arrange_canvas — de-overlap the whole layer (server owns coordinates and fences; no view needed first)',
  promptGuidelines: [
    'Intent only: pass the layer (and optionally a seat mode). The server reads the current canvas itself — no view_canvas fence and never any coordinates.',
    'With screenshotPolicy before/after/before_and_after the receipt cites archived evidence paths under .airpworld/arrange/ — quote them to the player as-is.',
    'A conflict outcome means the canvas changed mid-run; wait for the player to settle, then retry at most once.',
  ],
  async execute(_toolCallId: string, params: { layer: string; mode?: (typeof MODES)[number]; screenshotPolicy?: (typeof POLICIES)[number] }, signal?: AbortSignal): Promise<AgentToolResult<Record<string, unknown>>> {
    try {
      const origin = serverOrigin();
      const accepted = await postJson(new URL('/api/canvas/arrange', origin), {
        layer: params.layer,
        ...(params.mode ? { mode: params.mode } : {}),
        ...(params.screenshotPolicy ? { screenshotPolicy: params.screenshotPolicy } : {}),
      }, signal) as { operationId: string };
      const operation = await pollTerminal(origin, accepted.operationId, signal);
      if (operation.outcome === 'failed' || operation.outcome === 'cancelled') {
        throw new ActionError({ code: operation.outcome === 'cancelled' ? 'internal' : 'conflict', message: receipt(operation).text, details: receipt(operation).details });
      }
      return ok(receipt(operation));
    } catch (err) {
      return fail(err);
    }
  },
});
