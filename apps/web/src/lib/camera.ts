/**
 * Camera math — pure functions, no React, no DOM.
 * Constants/formulas mirror the v3 prototype (角色-世界v3.html/src/App.tsx §1.2)
 * and stay isomorphic with the server-side hashInt used for deterministic rot.
 */

export interface Cam {
  x: number;
  y: number;
  z: number;
}

/** Zoom clamp range (v3 L18). */
export const Z_MIN = 0.28;
export const Z_MAX = 2.2;
/** Above this zoom, large text shadows are disproportionately expensive to repaint. */
export const HIGH_ZOOM_RENDER_THRESHOLD = 1.3;
/** The compact paint profile releases below this zoom: the gap to
 * HIGH_ZOOM_RENDER_THRESHOLD is hysteresis, so a zoom resting near the
 * threshold cannot flap the whole-document paint profile every frame. */
export const HIGH_ZOOM_RELEASE_THRESHOLD = 1.2;

/**
 * Whether the canvas should use its compact high-zoom paint profile, given the
 * eased zoom and the profile currently in effect. Entering compact happens at
 * the render threshold; releasing only happens below the release threshold, so
 * a zoom resting between the two holds its current profile.
 */
export function compactPaintFor(z: number, current: boolean): boolean {
  if (!Number.isFinite(z)) return current;
  if (z >= HIGH_ZOOM_RENDER_THRESHOLD) return true;
  if (z < HIGH_ZOOM_RELEASE_THRESHOLD) return false;
  return current;
}
/** Interpolation coefficient per frame (v3 L80). */
export const LERP_K = 0.13;
/** Snap thresholds when close enough to target (v3 L81-83). */
export const SNAP_XY = 0.1;
export const SNAP_Z = 0.001;

/** Clamp zoom to [Z_MIN, Z_MAX]. */
export function clampZ(z: number): number {
  return Math.min(Z_MAX, Math.max(Z_MIN, z));
}

/** One easing step of c toward t, in place; snaps axes that are close enough (v3 L80-85). */
export function lerpCam(c: Cam, t: Cam): void {
  c.x += (t.x - c.x) * LERP_K;
  c.y += (t.y - c.y) * LERP_K;
  c.z += (t.z - c.z) * LERP_K;
  if (Math.abs(t.x - c.x) < SNAP_XY) c.x = t.x;
  if (Math.abs(t.y - c.y) < SNAP_XY) c.y = t.y;
  if (Math.abs(t.z - c.z) < SNAP_Z) c.z = t.z;
}

/**
 * Wheel zoom anchored at the cursor (v3 L120-124). `cam` is the anchor basis:
 * pass the commanded target so chunked wheel events compose without drift
 * (identical to current at rest). The returned Cam is the next target.
 */
export function zoomAt(
  sx: number,
  sy: number,
  vw: number,
  vh: number,
  cam: Cam,
  deltaY: number,
  view: ViewProjection = 'canvas'
): Cam {
  const factor = Math.pow(1.0016, -deltaY);
  const nz = clampZ(cam.z * factor);
  // The world point under the cursor stays under the cursor: find it with the
  // old zoom, then solve for the camera that puts it back there at the new one.
  // Both steps go through the projection, so this holds on the map as well.
  const before = unprojectOffset((sx - vw / 2) / cam.z, (sy - vh / 2) / cam.z, view);
  const after = unprojectOffset((sx - vw / 2) / nz, (sy - vh / 2) / nz, view);
  const wx = cam.x + before.x;
  const wy = cam.y + before.y;
  return { x: wx - after.x, y: wy - after.y, z: nz };
}

/**
 * Screen (viewport-relative px) → world coordinates. The single entry point for
 * pointer→world conversions (drag math must go through here, never hand-rolled).
 */
export function screenToWorld(
  sx: number,
  sy: number,
  vw: number,
  vh: number,
  cam: Cam,
  view: ViewProjection = 'canvas'
): { x: number; y: number } {
  const offset = unprojectOffset((sx - vw / 2) / cam.z, (sy - vh / 2) / cam.z, view);
  return { x: cam.x + offset.x, y: cam.y + offset.y };
}

/** World point → viewport-relative screen px. The inverse of `screenToWorld`, through the same projection. */
export function worldToScreen(
  wx: number,
  wy: number,
  vw: number,
  vh: number,
  cam: Cam,
  view: ViewProjection = 'canvas'
): { x: number; y: number } {
  const offset = projectOffset(wx - cam.x, wy - cam.y, view);
  return { x: vw / 2 + offset.x * cam.z, y: vh / 2 + offset.y * cam.z };
}

/**
 * A pointer MOVEMENT on screen → the world movement it means. Drag and pan are
 * deltas, not positions, so they cannot use `screenToWorld` (which is anchored
 * at the viewport centre) — but they must still go through the projection: on
 * the map, dragging the mouse straight right moves a card diagonally across the
 * floor, and hand-rolling `dx / z` there would drag it the wrong way.
 */
export function screenDeltaToWorld(
  dx: number,
  dy: number,
  z: number,
  view: ViewProjection = 'canvas'
): { x: number; y: number } {
  return unprojectOffset(dx / z, dy / z, view);
}

/** Single-transform-layer CSS (v3 L89). On the map the floor matrix sits between zoom and pan. */
export function worldTransform(vw: number, vh: number, cam: Cam, view: ViewProjection = 'canvas'): string {
  const floor = view === 'map' ? ` ${MAP_FLOOR_MATRIX}` : '';
  return `translate(${vw / 2}px, ${vh / 2}px) scale(${cam.z})${floor} translate(${-cam.x}px, ${-cam.y}px)`;
}

/* ---------- the map projection ---------- */

/**
 * How the layer is looked at. `canvas` is the flat infinite canvas that shipped;
 * `map` is the team's 45° tabletop view (「2d 45度角的地图的模式」).
 *
 * The map is a PROJECTION of the same world, not a second world: every card and
 * every character keeps the x/y it already has, read as a point on the floor.
 * Nothing on the server, in the schema or in the arranger knows which view is
 * on screen.
 */
export type ViewProjection = 'canvas' | 'map';

/**
 * The floor, as a 2×2 linear map from world offset to screen offset: rotate
 * 45°, then squash the vertical to half. That is the classic 2:1 dimetric view
 * of tabletop and strategy games — the grid's squares become diamonds twice as
 * wide as they are tall.
 *
 * Deliberately 2D, not `rotateX()`. A 3D tilt needs `perspective`, makes the
 * inverse depend on the viewer's distance, and pushes every card through the
 * 3D compositor; an affine map has an exact inverse and costs what the flat
 * canvas costs.
 *
 *   screen.x = a·x + c·y        a =  √½   c = −√½
 *   screen.y = b·x + d·y        b =  √½/2 d =  √½/2
 */
export const MAP_FLOOR = {
  a: Math.SQRT1_2,
  b: Math.SQRT1_2 / 2,
  c: -Math.SQRT1_2,
  d: Math.SQRT1_2 / 2,
} as const;

/** The same map as a CSS `matrix()`, in CSS argument order (a, b, c, d, e, f). */
export const MAP_FLOOR_MATRIX =
  `matrix(${MAP_FLOOR.a}, ${MAP_FLOOR.b}, ${MAP_FLOOR.c}, ${MAP_FLOOR.d}, 0, 0)`;

/** World offset → screen offset, before zoom. Identity on the canvas. */
export function projectOffset(x: number, y: number, view: ViewProjection = 'canvas'): { x: number; y: number } {
  if (view !== 'map') return { x, y };
  const { a, b, c, d } = MAP_FLOOR;
  return { x: a * x + c * y, y: b * x + d * y };
}

/** Screen offset (already divided by zoom) → world offset. The exact inverse of `projectOffset`. */
export function unprojectOffset(x: number, y: number, view: ViewProjection = 'canvas'): { x: number; y: number } {
  if (view !== 'map') return { x, y };
  const { a, b, c, d } = MAP_FLOOR;
  const det = a * d - b * c;
  return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
}

/**
 * The axis-aligned WORLD rectangle that covers everything the viewport shows.
 * On the canvas that is just the screen divided by zoom; on the map the screen
 * unprojects to a rotated, stretched quadrilateral of floor, and this is its
 * bounding box — which is what anything that paints "the visible floor" (the
 * grid sheet) has to cover.
 */
export function visibleWorldBounds(
  vw: number,
  vh: number,
  cam: Cam,
  view: ViewProjection = 'canvas'
): { left: number; top: number; right: number; bottom: number } {
  const z = cam.z || 1;
  const corners = [
    [-vw / 2, -vh / 2], [vw / 2, -vh / 2], [vw / 2, vh / 2], [-vw / 2, vh / 2],
  ].map(([sx, sy]) => unprojectOffset(sx / z, sy / z, view));
  const xs = corners.map(point => point.x + cam.x);
  const ys = corners.map(point => point.y + cam.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/** Deterministic 32-bit-ish hash — isomorphic with the server's rot derivation. */
export function hashInt(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
export type Projection = 'layer' | 'nook' | 'dialogue';

/** Camera memory keys shared with Canvas' currentLayer save/restore calls. */
export function cameraSlot(projection: Projection, identity: string, callerSlot?: string): string {
  if (projection === 'layer') return identity;
  if (projection === 'nook') return identity.startsWith('characters/') ? identity : `characters/${identity}`;
  return `dialogue:${identity}:${callerSlot ?? 'root'}`;
}

export interface ProjectionTarget {
  projection: Projection;
  identity: string;
  slot: string;
}

export function projectionTarget(
  projection: Projection,
  identity: string,
  callerSlot?: string,
): ProjectionTarget {
  return { projection, identity, slot: cameraSlot(projection, identity, callerSlot) };
}

export interface CameraMemoryFrame {
  caller: ProjectionTarget;
  target: ProjectionTarget;
  slot: string;
  targetSnapshot: Cam;
  savedAt: number;
}

export interface CameraMemoryDriver {
  save(name: string): void;
  restore(name: string): void;
  /** Optional hard delete; useCamera's flat driver predates this seam. */
  clear?(name?: string): void;
  getTarget(): Cam;
}

export interface CameraMemoryStack {
  pushTransition(target: ProjectionTarget): CameraMemoryFrame;
  popTransition(expectedCaller: ProjectionTarget): CameraMemoryFrame | null;
  restoreProjection(frame: CameraMemoryFrame): void;
  restoreTarget(target: ProjectionTarget): void;
  setCurrent(target: ProjectionTarget): void;
  current(): ProjectionTarget;
  clear(): void;
}

/**
 * App-owned projection transaction seam. `useCamera` remains the shared,
 * flat driver; this adapter gives layer, nook, and dialogue nested caller
 * snapshots without introducing another camera owner.
 */
export function createCameraMemoryStack(
  camera: CameraMemoryDriver,
  initial: ProjectionTarget,
): CameraMemoryStack {
  let currentTarget = { ...initial };
  const frames: CameraMemoryFrame[] = [];
  const knownSlots = new Set<string>([initial.slot]);
  const remember = (target: ProjectionTarget) => { knownSlots.add(target.slot); };
  const clearSlot = (slot: string) => {
    if (camera.clear) {
      camera.clear(slot);
      return;
    }
    // Compatibility with the existing flat useCamera driver: restoring a
    // never-used sentinel yields its default, which is then written over the
    // old slot so a new world cannot inherit the previous world's view.
    camera.restore('__airp_camera_empty__');
    camera.save(slot);
  };

  return {
    pushTransition(target) {
      remember(target);
      const frame: CameraMemoryFrame = {
        caller: { ...currentTarget },
        target: { ...target },
        slot: currentTarget.slot,
        targetSnapshot: camera.getTarget(),
        savedAt: Date.now(),
      };
      remember(frame.caller);
      camera.save(frame.slot);
      frames.push(frame);
      currentTarget = { ...target };
      return frame;
    },
    popTransition(expectedCaller) {
      const frame = frames.at(-1);
      if (!frame) return null;
      if (
        frame.caller.projection !== expectedCaller.projection ||
        frame.caller.identity !== expectedCaller.identity ||
        frame.caller.slot !== expectedCaller.slot
      ) {
        return null;
      }
      frames.pop();
      camera.save(frame.target.slot);
      currentTarget = { ...frame.caller };
      return frame;
    },
    restoreProjection(frame) {
      camera.restore(frame.caller.slot);
      currentTarget = { ...frame.caller };
    },
    restoreTarget(target) {
      remember(target);
      camera.restore(target.slot);
      currentTarget = { ...target };
    },
    setCurrent(target) {
      remember(target);
      currentTarget = { ...target };
    },
    current() {
      return { ...currentTarget };
    },
    clear() {
      for (const slot of knownSlots) clearSlot(slot);
      frames.length = 0;
    },
  };
}
