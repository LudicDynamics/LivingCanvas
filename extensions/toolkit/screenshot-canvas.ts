import { Buffer } from 'node:buffer';
import { Type } from 'typebox';
import { defineTool, type AgentToolResult } from '@earendil-works/pi-coding-agent';
import type {
  CanvasScreenshotResponse,
  CanvasSnapshot,
} from '../../packages/shared/dist/index.js';
import { ActionError } from '../../packages/shared/dist/index.js';
import { currentTurnAnchor, } from './turn.js';
import { getActionService, worldStore } from './deps.js';
import { fail, okWithImage } from './result.js';

const REQUEST_TIMEOUT_MS = 30_000;
type ScreenshotDetails = CanvasScreenshotResponse & {
  screenshotPath: null;
  screenshotBytes: number;
  screenshot: { path: null; bytes: number; mimeType: 'image/png'; width: number; height: number };
};



function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requestError(status: number, payload: unknown): ActionError {
  const body = recordOf(payload);
  const rawCode = typeof body?.code === 'string' ? body.code : status === 409 ? 'conflict' : status === 501 ? 'unsupported' : 'internal';
  const allowed = new Set(['invalid_argument', 'not_found', 'conflict', 'unsupported', 'internal', 'write_failed']);
  const code = allowed.has(rawCode) ? rawCode as 'invalid_argument' | 'not_found' | 'conflict' | 'unsupported' | 'internal' | 'write_failed' : 'internal';
  const message = typeof body?.error === 'string' && body.error.trim() !== '' ? body.error : `screenshot_canvas failed: the server returned HTTP ${status}.`;
  const details = recordOf(body?.details) ?? { status };
  return new ActionError({ code, message, details });
}

async function fetchJson(url: string, init: RequestInit, signal: AbortSignal | undefined): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw requestError(response.status, payload);
    return payload;
  } catch (error) {
    if (error instanceof ActionError) throw error;
    if (controller.signal.aborted) throw new ActionError({ code: 'internal', message: 'screenshot_canvas cancelled before capture started.', details: { reason: 'aborted' } });
    throw new ActionError({ code: 'internal', message: 'screenshot_canvas failed: the screenshot server could not be reached.', details: { reason: 'transport' } });
  } finally {

    signal?.removeEventListener('abort', forwardAbort);
  }
}

function validImagePayload(payload: unknown): payload is CanvasScreenshotResponse {
  const body = recordOf(payload);
  const image = recordOf(body?.image);
  const identity = recordOf(body?.identity);
  return body?.ok === true && typeof body.renderedGeometry !== 'undefined' &&
    typeof body.geometryEvidence === 'string' && Array.isArray(body.renderedGeometry) &&
    typeof identity?.snapshotId === 'string' && typeof image?.data === 'string' && image.data.length > 0 && image.mimeType === 'image/png' &&
    Number.isInteger(image.width) && Number.isInteger(image.height);
}

/** Real same-canvas PNG perception; there is no summary fallback on failure. */
export const screenshotCanvasTool = defineTool({
  name: 'screenshot_canvas',
  label: 'Screenshot Canvas',
  description:
    'Capture a real PNG of the current world canvas layer through the server-side Playwright browser. ' +
    'The image is read-only visual evidence from the same layer and snapshot as view_canvas; it never accepts a URL or world root.',
  parameters: Type.Object({
    layer: Type.Optional(Type.String({ description: 'World layer id, for example map or world/room.' })),
    viewport: Type.Object({ width: Type.Integer(), height: Type.Integer() }, { description: 'Viewport in CSS pixels, 320x240 through 2560x1600.' }),
    region: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number(), w: Type.Number(), h: Type.Number() }, { description: 'Optional world rectangle crop; w/h must be at least 50.' })),
  }, { additionalProperties: false }),
  promptSnippet: 'screenshot_canvas(layer, viewport, region?) — capture a real PNG and DOM geometry for one canvas layer',
  promptGuidelines: [
    'Use view_canvas(auto) first when you need the canonical snapshot identity; screenshot_canvas is visual evidence, not a completion proof.',
    'Never infer a clean layout from the screenshot alone; verify current rows and full-layer overlaps after any write.',
  ],
  async execute(_toolCallId, params, signal, _onUpdate, ctx): Promise<AgentToolResult<ScreenshotDetails>> {
    try {
      const modelInput = ctx.model?.input;
      if (!Array.isArray(modelInput) || !modelInput.includes('image')) {
        throw new ActionError({ code: 'unsupported', message: 'screenshot_canvas is unavailable: the active model does not accept image content.', details: { reason: 'model_image_input_unavailable' } });
      }
      const summary = await getActionService(ctx).viewCanvas({ layer: params.layer, mode: 'auto' });
      const snapshot = summary.details as CanvasSnapshot;
      const manifest = await worldStore(ctx).getManifest();
      const origin = process.env.AIRP_WEB_ORIGIN?.trim();
      if (!origin) throw new ActionError({ code: 'unsupported', message: 'screenshot_canvas unavailable: the canvas web origin is not configured.', details: { reason: 'origin_unconfigured' } });
      const base = new URL(origin);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
        throw new ActionError({ code: 'unsupported', message: 'screenshot_canvas unavailable: the canvas web origin is not configured.', details: { reason: 'origin_invalid' } });
      }
      const turnId = currentTurnAnchor(ctx);
      const capabilityPayload = await fetchJson(new URL('/api/canvas/screenshot/capability', base).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-airp-canvas-client': 'extension' },
        body: JSON.stringify({ worldId: manifest.id, layer: snapshot.layer.id, snapshotId: snapshot.identity.snapshotId, turnId }),
      }, signal);
      const capabilityRecord = recordOf(capabilityPayload);
      const captureCapability = typeof capabilityRecord?.captureCapability === 'string' ? capabilityRecord.captureCapability : '';
      if (!captureCapability) throw new ActionError({ code: 'unsupported', message: 'screenshot_canvas unavailable: the current user\'s canvas identity is unavailable.', details: { reason: 'capability_missing' } });
      const request = {
        worldId: manifest.id,
        layer: snapshot.layer.id,
        snapshotId: snapshot.identity.snapshotId,
        captureCapability,
        viewport: params.viewport,
        ...(params.region ? { region: params.region } : {}),
      };
      const payload = await fetchJson(new URL('/api/canvas/screenshot', base).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-airp-canvas-client': 'extension' },
        body: JSON.stringify(request),
      }, signal);
      if (!validImagePayload(payload)) throw new ActionError({ code: 'internal', message: 'screenshot_canvas failed: the server returned an invalid PNG result.', details: { reason: 'invalid_response' } });
      const result = payload;
      if (result.identity.snapshotId !== snapshot.identity.snapshotId) {
        throw new ActionError({ code: 'conflict', message: 'screenshot_canvas conflicted: the canvas changed while the screenshot was being captured.', details: { requestedSnapshotId: snapshot.identity.snapshotId, observedSnapshotId: result.identity.snapshotId } });
      }
      const screenshotBytes = Buffer.byteLength(result.image.data, 'base64');
      const details: ScreenshotDetails = {
        ...result,
        screenshotPath: null,
        screenshotBytes,
        screenshot: { path: null, bytes: screenshotBytes, mimeType: 'image/png', width: result.image.width, height: result.image.height },
      };
      return okWithImage({ text: `Captured canvas screenshot for layer "${snapshot.layer.id}" (${result.image.width}×${result.image.height}).`, details }, result.image);
    } catch (error) {
      return fail(error);
    }
  },
});
