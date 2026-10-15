import { randomBytes } from 'node:crypto';
import { Router, type Request } from 'express';
import {
  readCanvasSnapshot,
  type CanvasScreenshotConflict,
  type CanvasScreenshotRequest,
  type CanvasScreenshotResponse,
  type CanvasSnapshot,
  type CanvasSnapshotIdentity,
  type CanvasWorldRect,
  type LocalWorldStore,
} from '@airp/shared';
import { CanvasBrowserError } from '../engine/canvas-browser.js';
import {
  CanvasCaptureConflict,
  captureLayerSnapshot,
  configuredCanvasOrigin,
} from '../engine/canvas-capture.js';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_CAPABILITIES = 128;
const CAPABILITY_TTL_MS = 30_000;
const VIEWPORT_MIN = { width: 320, height: 240 };
const VIEWPORT_MAX = { width: 2560, height: 1600 };

type Capability = {
  worldId: string;
  layer: string;
  snapshotId: string;
  turnId: string;
  store: LocalWorldStore;
  expiresAt: number;
};

const capabilities = new Map<string, Capability>();

function localRequest(req: Request, origin: URL): boolean {
  const remote = req.socket.remoteAddress;
  if (remote && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false;
  if (req.headers.forwarded || req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']) return false;
  try {
    const host = new URL(`http://${req.headers.host ?? ''}`).host;
    if (host !== origin.host) return false;
    const requestOrigin = req.headers.origin;
    return !requestOrigin || requestOrigin === origin.origin;
  } catch {
    return false;
  }
}

function unavailable(message: string, status = 501): { status: number; body: Record<string, unknown> } {
  return {
    status,
    body: { ok: false, code: 'unsupported', error: `screenshot_canvas unavailable: ${message}`, details: { reason: message } },
  };
}

function invalid(error: string): { status: number; body: Record<string, unknown> } {
  return { status: 400, body: { ok: false, code: 'invalid_argument', error, details: { reason: error } } };
}

function validateRect(value: unknown): value is CanvasWorldRect {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rect = value as Record<string, unknown>;
  return ['x', 'y', 'w', 'h'].every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key])) && Number(rect.w) >= 50 && Number(rect.h) >= 50;
}

function validateViewport(value: unknown): value is { width: number; height: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const viewport = value as Record<string, unknown>;
  return Number.isInteger(viewport.width) && Number.isInteger(viewport.height) &&
    Number(viewport.width) >= VIEWPORT_MIN.width && Number(viewport.width) <= VIEWPORT_MAX.width &&
    Number(viewport.height) >= VIEWPORT_MIN.height && Number(viewport.height) <= VIEWPORT_MAX.height;
}

function capabilityFor(token: string, store: LocalWorldStore): Capability | null {
  const capability = capabilities.get(token);
  if (!capability || capability.store !== store) return null;
  if (capability.expiresAt <= Date.now()) {
    capabilities.delete(token);
    return null;
  }
  return capability;
}

function issueCapability(input: Omit<Capability, 'store'>, store: LocalWorldStore): string {
  for (const [token, capability] of capabilities) {
    if (capability.expiresAt <= Date.now()) capabilities.delete(token);
  }
  while (capabilities.size >= MAX_CAPABILITIES) {
    const oldest = capabilities.keys().next().value;
    if (typeof oldest !== 'string') break;
    capabilities.delete(oldest);
  }
  const token = randomBytes(24).toString('base64url');
  capabilities.set(token, { ...input, store });
  return token;
}

function conflictResponse(requested: CanvasSnapshotIdentity, observed: CanvasSnapshotIdentity): { status: 409; body: CanvasScreenshotConflict & { details: Record<string, unknown> } } {
  return {
    status: 409,
    body: {
      ok: false,
      code: 'conflict',
      error: 'screenshot_canvas conflicted: the canvas changed while the screenshot was being captured.',
      requested,
      observed,
      details: { reason: 'snapshot_changed', expectedSnapshotId: requested.snapshotId, observedSnapshotId: observed.snapshotId },
    },
  };
}

function requestedIdentity(snapshot: CanvasSnapshot, expectedSnapshotId: string): CanvasSnapshotIdentity {
  return { ...snapshot.identity, snapshotId: expectedSnapshotId };
}

export function createCanvasPerceptionRouter(getActiveStore: () => LocalWorldStore | null): Router {
  const router = Router();
  router.use('/canvas/screenshot', (req, res, next) => {
    if (req.headers['content-length'] && Number(req.headers['content-length']) > MAX_BODY_BYTES) {
      return res.status(413).json({ ok: false, code: 'invalid_argument', error: 'screenshot_canvas request is too large.', details: { reason: 'body_too_large' } });
    }
    const origin = configuredCanvasOrigin();
    if (!origin) return res.status(501).json(unavailable('the canvas web origin is not configured.').body);
    if (!localRequest(req, origin)) return res.status(403).json(unavailable('the current user\'s canvas identity is unavailable.', 403).body);
    next();
  });

  // This narrow local issuer gives the extension a server-issued opaque token;
  // the capture endpoint itself never accepts a caller-created principal.
  router.post('/canvas/screenshot/capability', async (req, res) => {
    const capabilityKeys = ['worldId', 'layer', 'snapshotId', 'turnId'];
    if (Object.keys(req.body ?? {}).some((key) => !capabilityKeys.includes(key))) return res.status(400).json(invalid('Capability requests accept only worldId, layer, snapshotId, and turnId.').body);
    const store = getActiveStore();
    if (!store) return res.status(409).json({ ok: false, code: 'no_active_world', error: 'Choose a world or start a new save.' });
    const worldId = typeof req.body?.worldId === 'string' ? req.body.worldId.trim() : '';
    const layer = typeof req.body?.layer === 'string' ? req.body.layer.trim() : '';
    const snapshotId = typeof req.body?.snapshotId === 'string' ? req.body.snapshotId.trim() : '';
    const turnId = typeof req.body?.turnId === 'string' ? req.body.turnId.trim() : '';
    if (!worldId || !layer || !snapshotId || !turnId) return res.status(400).json(invalid('worldId, layer, snapshotId, and turnId are required.').body);
    try {
      const manifest = await store.getManifest();
      if (manifest.id !== worldId) return res.status(409).json({ ok: false, code: 'conflict', error: 'The active world changed while requesting a screenshot capability.' });
      const snapshot = await readCanvasSnapshot(store, { layer });
      if (snapshot.identity.snapshotId !== snapshotId) return res.status(409).json(conflictResponse(requestedIdentity(snapshot, snapshotId), snapshot.identity).body);
      const expiresAt = Date.now() + CAPABILITY_TTL_MS;
      const captureCapability = issueCapability({ worldId, layer: snapshot.layer.id, snapshotId, turnId, expiresAt }, store);
      return res.json({ ok: true, captureCapability, expiresAt, worldId, layer: snapshot.layer.id, snapshotId });
    } catch (error) {
      return res.status(500).json({ ok: false, code: 'internal', error: error instanceof Error ? error.message : 'Could not issue screenshot capability.', details: { reason: 'capability_issue_failed' } });
    }
  });

  router.post('/canvas/screenshot', async (req, res) => {
    const body = req.body as Partial<CanvasScreenshotRequest> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json(invalid('screenshot_canvas request must be an object.').body);
    const allowedRequestKeys = ['worldId', 'layer', 'snapshotId', 'captureCapability', 'viewport', 'region'];
    if (Object.keys(body).some((key) => !allowedRequestKeys.includes(key))) return res.status(400).json(invalid('screenshot_canvas accepts only worldId, layer, snapshotId, captureCapability, viewport, and region.').body);
    const worldId = typeof body.worldId === 'string' ? body.worldId.trim() : '';
    const layer = typeof body.layer === 'string' ? body.layer.trim() : '';
    const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId.trim() : '';
    const captureCapability = typeof body.captureCapability === 'string' ? body.captureCapability.trim() : '';
    if (!worldId || !layer || !snapshotId || !captureCapability) return res.status(501).json(unavailable('the current user\'s canvas identity is unavailable.').body);
    const viewportValue: unknown = body.viewport;
    if (!validateViewport(viewportValue)) return res.status(400).json(invalid('viewport must be an integer width/height within 320x240 to 2560x1600.').body);
    const viewport = viewportValue;
    if (body.region !== undefined && !validateRect(body.region)) return res.status(400).json(invalid('region must contain finite x, y, w, h with w/h >= 50.').body);
    const store = getActiveStore();
    if (!store) return res.status(409).json({ ok: false, code: 'conflict', error: 'The active world changed while capturing the canvas.', details: { reason: 'no_active_world' } });
    const capability = capabilityFor(captureCapability, store);
    if (!capability || capability.worldId !== worldId || capability.layer !== layer || capability.snapshotId !== snapshotId) return res.status(501).json(unavailable('the current user\'s canvas identity is unavailable.').body);
    try {
      const manifest = await store.getManifest();
      if (manifest.id !== worldId) return res.status(409).json({ ok: false, code: 'conflict', error: 'The active world changed while capturing the canvas.', details: { reason: 'world_changed' } });
      const snapshot = await readCanvasSnapshot(store, { layer });
      if (snapshot.identity.snapshotId !== snapshotId) return res.status(409).json(conflictResponse(requestedIdentity(snapshot, snapshotId), snapshot.identity).body);
      if (snapshot.unplaced.length > 0) return res.status(500).json({ ok: false, code: 'internal', error: 'screenshot_canvas failed: the current layer has unplaced items; seat them before requesting a screenshot.', details: { reason: 'unplaced', paths: snapshot.unplaced.map((row) => row.path) } });
      const requestAbort = new AbortController();
      req.once('aborted', () => requestAbort.abort());
      res.once('close', () => {
        if (!res.writableFinished) requestAbort.abort();
      });
      let captured;
      try {
        captured = await captureLayerSnapshot(store, {
          layer: snapshot.layer.id,
          snapshotId: snapshot.identity.snapshotId,
          viewport,
          signal: requestAbort.signal,
        });
      } catch (error) {
        if (error instanceof CanvasCaptureConflict) return res.status(409).json(conflictResponse(error.requested, error.observed).body);
        throw error;
      }
      const response: CanvasScreenshotResponse = {
        ok: true,
        identity: snapshot.identity,
        image: { data: Buffer.from(captured.png).toString('base64'), mimeType: 'image/png', width: captured.width, height: captured.height },
        region: body.region ?? null,
        renderedGeometry: captured.renderedGeometry,
        geometryEvidence: captured.geometryEvidence,
      };
      return res.json(response);
    } catch (error) {
      if (error instanceof CanvasBrowserError) {
        const status = error.code === 'unsupported' ? 501 : error.code === 'cancelled' ? 499 : 500;
        return res.status(status).json({ ok: false, code: error.code, error: error.message, details: error.details ?? { reason: error.code } });
      }
      return res.status(500).json({ ok: false, code: 'internal', error: error instanceof Error ? error.message : 'screenshot_canvas failed: the browser could not capture the canvas.', details: { reason: 'capture_failed' } });
    }
  });
  return router;
}

export function resetCanvasPerceptionForTests(): void {
  capabilities.clear();
}
