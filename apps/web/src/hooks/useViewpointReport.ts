import { visibleWorldBounds } from '../lib/camera.js';
import { useEffect, useRef } from 'react';
import {
  VIEWPOINT_MIN_INTERVAL_MS,
  VIEWPOINT_HEARTBEAT_MS,
  quantiseViewRect,
  viewpointKey,
} from '@airp/shared/viewpoint';
import type { CameraApi } from '../state/useCamera.js';

/**
 * Report the player's viewpoint to `POST /api/viewpoint` (05 §5).
 *
 * Shape borrowed from Nodesign's `useViewpointReport`, but every dependency and
 * source is AIRP's, with three deliberate differences (05 §5.3):
 *
 * 1. TRIGGER SOURCE: the camera is NOT in React state (`useCamera.ts`), so we
 *    `subscribe` instead of putting `cam.x` in the deps array. `subscribe`
 *    fires immediately with the current view, so the first frame already reports.
 * 2. KEY WRITTEN BEFORE THE TIMER: a moving camera would otherwise keep
 *    re-arming the throttle timer and the trailing edge could starve forever.
 * 3. QUANTISATION VIA THE SHARED FUNCTION: no inline grid arithmetic here, so
 *    the browser and the server can never disagree (00 §5.3, §11.1).
 * 4. SLOW HEARTBEAT (05 §5.3.1): a still player still re-reports, or the
 *    10-minute TTL expires and cascades `layer_files` / `cast` away.
 */

export interface UseViewpointReportInput {
  /** Live camera view. Subscribe-based, NOT React state. */
  camera: CameraApi;
  /** Current layer, same id space as GET /api/layer. */
  layer: string;
  /** Player's backpack size; the LIST is section 02's `bag`. */
  bagCount: number;
  /** false ⇒ never report (the agent's own view page; 05 §5.4). */
  enabled?: boolean;
}

interface ViewpointReport {
  layer: string;
  camera: { x: number; y: number; w: number; h: number };
  bagCount: number;
  selected: string[];
}

export function useViewpointReport({
  camera,
  layer,
  bagCount,
  enabled = true,
}: UseViewpointReportInput): void {
  const lastRef = useRef<{ key: string; at: number; timer: number | null }>({
    key: '',
    at: 0,
    timer: null,
  });

  useEffect(() => {
    if (!enabled) return undefined;

    const send = (payload: ViewpointReport) => {
      lastRef.current.at = Date.now();
      lastRef.current.timer = null;
      // fire-and-forget: a dropped report is one stale minute at worst (00 §11).
      void fetch('/api/viewpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {
        /* one lost frame of viewpoint is not worth a toast */
      });
    };

    const check = () => {
      const cam = camera.getCam();
      const vp = camera.getViewport();
      if (!vp.w || !vp.h || !Number.isFinite(cam.x) || !Number.isFinite(cam.y) || !Number.isFinite(cam.z)) {
        return; // nothing sane to report yet
      }
      // World-space visible rect — the SAME camera model as lib/camera.ts,
      // projection included: on the map the screen covers a stretched diamond
      // of floor, and what the agents are told the player can see is that
      // diamond's bounding box. Quantised by the shared function.
      const bounds = visibleWorldBounds(vp.w, vp.h, cam, camera.getProjection());
      const rect = quantiseViewRect({
        x: bounds.left,
        y: bounds.top,
        w: bounds.right - bounds.left,
        h: bounds.bottom - bounds.top,
      });
      const key = viewpointKey({ layer, camera: rect, selected: [], bagCount });
      const st = lastRef.current;
      const silentFor = Date.now() - st.at;
      // Slow heartbeat (00 §5.1.1): report on the clock even when the key is
      // unchanged, or the 10-min TTL expires and cascades layer_files / cast away.
      if (key === st.key && silentFor < VIEWPOINT_HEARTBEAT_MS) return;

      const payload = { layer, camera: rect, bagCount, selected: [] as string[] };
      const wait = Math.max(0, VIEWPOINT_MIN_INTERVAL_MS - (Date.now() - st.at));
      window.clearTimeout(st.timer ?? undefined);
      // Record the key NOW, before the timer: otherwise a moving camera keeps
      // re-arming the timer and the trailing edge can starve forever.
      st.key = key;
      st.timer = wait === 0 ? (send(payload), null) : window.setTimeout(() => send(payload), wait);
    };

    const unsubscribe = camera.subscribe(check); // fires immediately (useCamera.ts)
    return () => {
      unsubscribe();
      window.clearTimeout(lastRef.current.timer ?? undefined);
      lastRef.current.timer = null;
    };
  }, [camera, layer, bagCount, enabled]);
}
