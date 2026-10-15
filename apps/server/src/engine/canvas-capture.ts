import path from 'node:path';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readCanvasSnapshot } from '@airp/shared';
import type { CanvasSnapshotIdentity, LocalWorldStore } from '@airp/shared';
import {
  CANVAS_CAPTURE_TIMEOUT_MS,
  CanvasBrowserError,
  captureCanvasPage,
  withCanvasBrowserGate,
} from './canvas-browser.js';

/**
 * Shared capture orchestration for both consumers of the Playwright screenshot
 * capability: the HTTP perception route
 * (`POST /api/canvas/screenshot`, extension tool transport) and the canvas
 * arranger state machine (screenshotPolicy `before` / `after` evidence,
 * the design notes). The route adds auth (capability token, loopback,
 * same-origin) on top; this layer owns everything below that: snapshot
 * reconciliation, the read-only perception page, the serial browser gate, the
 * one re-capture on identity drift, and the world archive write.
 */

export const ARRANGE_SCREENSHOT_VIEWPORT = { width: 1600, height: 900 } as const;

/** The canvas changed while the capture ran; identity could not be re-proven. */
export class CanvasCaptureConflict extends Error {
  readonly requested: CanvasSnapshotIdentity;
  readonly observed: CanvasSnapshotIdentity;
  constructor(requested: CanvasSnapshotIdentity, observed: CanvasSnapshotIdentity) {
    super('screenshot_canvas conflicted: the canvas changed while the screenshot was being captured.');
    this.name = 'CanvasCaptureConflict';
    this.requested = requested;
    this.observed = observed;
  }
}

/** Canonical AIRP_WEB_ORIGIN parse; null means "capability unavailable". */
export function configuredCanvasOrigin(): URL | null {
  const raw = process.env.AIRP_WEB_ORIGIN?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url;
  } catch {
    return null;
  }
}

export interface CanvasLayerCapture {
  png: Uint8Array;
  width: number;
  height: number;
  /** Identity of the read window the PNG was verified against. */
  identity: CanvasSnapshotIdentity;
  renderedGeometry: Array<{ path: string; x: number; y: number; w: number; h: number }>;
  geometryEvidence: 'read' | 'mismatch' | 'unavailable';
}

/**
 * Capture one layer through the read-only perception page. Fails closed on
 * missing origin, drifted snapshot identity (one re-capture, then
 * `CanvasCaptureConflict`), unplaced rows, and any browser/ready failure.
 */
export async function captureLayerSnapshot(
  store: LocalWorldStore,
  input: { layer: string; snapshotId: string; viewport: { width: number; height: number }; timeoutMs?: number; signal?: AbortSignal },
): Promise<CanvasLayerCapture> {
  const origin = configuredCanvasOrigin();
  if (!origin) throw new CanvasBrowserError('unsupported', 'screenshot_canvas unavailable: the canvas web origin is not configured.');
  const snapshot = await readCanvasSnapshot(store, { layer: input.layer });
  if (snapshot.identity.snapshotId !== input.snapshotId) {
    throw new CanvasCaptureConflict({ ...snapshot.identity, snapshotId: input.snapshotId }, snapshot.identity);
  }
  if (snapshot.unplaced.length > 0) {
    throw new CanvasBrowserError(
      'internal',
      'screenshot_canvas failed: the current layer has unplaced items; seat them before requesting a screenshot.',
      { reason: 'unplaced', paths: snapshot.unplaced.map((row) => row.path) },
    );
  }
  const url = new URL('/', origin);
  url.searchParams.set('airpPerception', '1');
  url.searchParams.set('layer', snapshot.layer.id);
  url.searchParams.set('snapshotId', snapshot.identity.snapshotId);
  const capture = async (): Promise<CanvasLayerCapture> => withCanvasBrowserGate(
    async (browser, signal) => {
      const captured = await captureCanvasPage(browser, {
        url: url.toString(),
        viewport: input.viewport,
        expectedLayer: snapshot.layer.id,
        expectedSnapshotId: snapshot.identity.snapshotId,
        expectedPaths: snapshot.rows.map((row) => row.path),
      }, signal);
      return {
        png: captured.png,
        width: captured.dimensions.width,
        height: captured.dimensions.height,
        identity: snapshot.identity,
        renderedGeometry: captured.evidence.renderedGeometry,
        geometryEvidence: captured.evidence.geometryEvidence,
      };
    },
    { signal: input.signal, timeoutMs: input.timeoutMs ?? CANVAS_CAPTURE_TIMEOUT_MS },
  );
  let captured = await capture();
  let observed = await readCanvasSnapshot(store, { layer: input.layer });
  if (observed.identity.snapshotId !== snapshot.identity.snapshotId) {
    // One re-capture; still drifting is a conflict.
    try {
      captured = await capture();
    } catch (error) {
      observed = await readCanvasSnapshot(store, { layer: input.layer }).catch(() => observed);
      throw new CanvasCaptureConflict({ ...snapshot.identity, snapshotId: input.snapshotId }, observed.identity);
    }
    observed = await readCanvasSnapshot(store, { layer: input.layer });
    if (observed.identity.snapshotId !== snapshot.identity.snapshotId) {
      throw new CanvasCaptureConflict({ ...snapshot.identity, snapshotId: input.snapshotId }, observed.identity);
    }
  }
  return captured;
}

/**
 * Archive one arrange evidence PNG under `.airpworld/arrange/` (atomic
 * tmp+rename, same pattern as the store's own journals — `.airpworld` is the
 * architecture-state tree and is not writable through `store.writeFile`).
 * Returns the world-relative path; never an absolute path (06 §4.5).
 */
export async function saveArrangeScreenshot(
  store: LocalWorldStore,
  operationId: string,
  phase: 'before' | 'after',
  png: Uint8Array,
): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error('Invalid arrange operation id for screenshot archive.');
  const dir = path.join(store.worldRoot, '.airpworld', 'arrange');
  const finalPath = path.join(dir, `${operationId}-${phase}.png`);
  const tmpPath = path.join(dir, `.${operationId}-${phase}.${randomUUID().slice(0, 8)}.tmp`);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(tmpPath, png);
    await rename(tmpPath, finalPath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
  return `.airpworld/arrange/${operationId}-${phase}.png`;
}
