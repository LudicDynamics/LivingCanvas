import type { CanvasSnapshotIdentity, CanvasWorldRect } from './canvas-snapshot.js';

/** Exact request accepted by the server-side screenshot transport (06 §4.5). */
export interface CanvasScreenshotRequest {
  worldId: string;
  layer: string;
  snapshotId: string;
  captureCapability: string;
  viewport: { width: number; height: number };
  region?: CanvasWorldRect;
}

/** Successful in-memory PNG capture and its DOM evidence. */
export interface CanvasScreenshotResponse {
  ok: true;
  identity: CanvasSnapshotIdentity;
  image: { data: string; mimeType: 'image/png'; width: number; height: number };
  region: CanvasWorldRect | null;
  renderedGeometry: Array<{ path: string; x: number; y: number; w: number; h: number }>;
  geometryEvidence: 'read' | 'mismatch' | 'unavailable';
}

/** A screenshot whose read window changed while the browser was capturing. */
export interface CanvasScreenshotConflict {
  ok: false;
  code: 'conflict';
  error: 'screenshot_canvas conflicted: the canvas changed while the screenshot was being captured.';
  requested: CanvasSnapshotIdentity;
  observed: CanvasSnapshotIdentity;
}

export type CanvasScreenshotResult = CanvasScreenshotResponse | CanvasScreenshotConflict;
