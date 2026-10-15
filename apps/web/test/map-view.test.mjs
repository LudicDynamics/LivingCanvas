// The map view: the same layer projected onto a 45° floor.
//
// The math is tested as the pure functions it is, because a wrong inverse does
// not look wrong — it just drops every click, drag and zoom somewhere slightly
// off, and nobody can say why. The rest are source assertions for the seams:
// every pointer path goes through the projection, and the canvas that shipped
// is byte-for-byte what it was.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const cam = await jiti.import('../src/lib/camera.ts');
const viewMode = await jiti.import('../src/lib/view-mode.ts');

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const canvas = await read('../src/components/canvas/Canvas.tsx');
const useCamera = await read('../src/state/useCamera.ts');
const performance = await read('../src/components/performance/PerformanceLayer.tsx');
const viewpoint = await read('../src/hooks/useViewpointReport.ts');
const grid = await read('../src/components/canvas/CanvasGrid.tsx');
const app = await read('../src/App.tsx');
const launcher = await read('../src/components/WorldLauncher.tsx');
const css = await read('../src/index.css');
const messages = JSON.parse(await read('../src/lib/messages.json'));

const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`);

test('the canvas that shipped is untouched: identity projection, same transform string', () => {
  // Byte-for-byte: anything that snapshot the old string still matches.
  assert.equal(
    cam.worldTransform(1000, 800, { x: 10, y: 20, z: 2 }),
    'translate(500px, 400px) scale(2) translate(-10px, -20px)',
  );
  assert.equal(
    cam.worldTransform(1000, 800, { x: 10, y: 20, z: 2 }, 'canvas'),
    'translate(500px, 400px) scale(2) translate(-10px, -20px)',
  );
  assert.deepEqual(cam.projectOffset(3, 4), { x: 3, y: 4 });
  assert.deepEqual(cam.unprojectOffset(3, 4), { x: 3, y: 4 });
  assert.deepEqual(cam.screenToWorld(600, 500, 1000, 800, { x: 0, y: 0, z: 1 }), { x: 100, y: 100 });
});

test('the floor is a 2:1 diamond: rotate 45°, then squash the vertical to half', () => {
  // A unit step along world x goes down-right; along world y, down-left.
  const alongX = cam.projectOffset(1, 0, 'map');
  const alongY = cam.projectOffset(0, 1, 'map');
  close(alongX.x, Math.SQRT1_2, 'x→screen.x');
  close(alongX.y, Math.SQRT1_2 / 2, 'x→screen.y');
  close(alongY.x, -Math.SQRT1_2, 'y→screen.x');
  close(alongY.y, Math.SQRT1_2 / 2, 'y→screen.y');
  // A grid square becomes a diamond exactly twice as wide as it is tall.
  const corners = [[0, 0], [80, 0], [80, 80], [0, 80]].map(([x, y]) => cam.projectOffset(x, y, 'map'));
  const width = Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x));
  const height = Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y));
  close(width / height, 2, 'diamond aspect');
  // And the CSS matrix is the same map, in CSS argument order.
  const { a, b, c, d } = cam.MAP_FLOOR;
  assert.equal(cam.MAP_FLOOR_MATRIX, `matrix(${a}, ${b}, ${c}, ${d}, 0, 0)`);
  assert.match(cam.worldTransform(1000, 800, { x: 10, y: 20, z: 2 }, 'map'),
    /^translate\(500px, 400px\) scale\(2\) matrix\([^)]+\) translate\(-10px, -20px\)$/);
});

test('unproject is the exact inverse of project, both ways round', () => {
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [123.5, -40], [-900, 3100], [4000, 4000]]) {
    const there = cam.projectOffset(x, y, 'map');
    const back = cam.unprojectOffset(there.x, there.y, 'map');
    close(back.x, x, `x round trip for (${x},${y})`);
    close(back.y, y, `y round trip for (${x},${y})`);
    const other = cam.unprojectOffset(x, y, 'map');
    const again = cam.projectOffset(other.x, other.y, 'map');
    close(again.x, x, `reverse x for (${x},${y})`);
    close(again.y, y, `reverse y for (${x},${y})`);
  }
});

test('a click lands on the floor point that is drawn under it', () => {
  // world → screen → world must be the identity at any camera, on either view.
  const camera = { x: 960, y: 540, z: 0.8 };
  for (const view of ['canvas', 'map']) {
    for (const [wx, wy] of [[960, 540], [1200, 300], [0, 2000], [-500, -500]]) {
      const s = cam.worldToScreen(wx, wy, 1400, 900, camera, view);
      const w = cam.screenToWorld(s.x, s.y, 1400, 900, camera, view);
      close(w.x, wx, `${view} x`);
      close(w.y, wy, `${view} y`);
    }
    // The camera point is always the middle of the screen.
    const middle = cam.worldToScreen(camera.x, camera.y, 1400, 900, camera, view);
    close(middle.x, 700, `${view} centre x`);
    close(middle.y, 450, `${view} centre y`);
  }
});

test('zooming keeps the floor point under the cursor under the cursor', () => {
  const start = { x: 960, y: 540, z: 1 };
  for (const view of ['canvas', 'map']) {
    const before = cam.screenToWorld(1100, 300, 1400, 900, start, view);
    const next = cam.zoomAt(1100, 300, 1400, 900, start, -240, view);
    assert.ok(next.z > start.z, 'a negative delta zooms in');
    const after = cam.screenToWorld(1100, 300, 1400, 900, next, view);
    close(after.x, before.x, `${view} anchor x`);
    close(after.y, before.y, `${view} anchor y`);
  }
});

test('on the map a drag straight across the screen is a diagonal across the floor', () => {
  // Canvas: screen-right is world-right.
  assert.deepEqual(cam.screenDeltaToWorld(100, 0, 2, 'canvas'), { x: 50, y: 0 });
  // Map: screen-right moves +x and −y in equal measure (the diamond's axis).
  const moved = cam.screenDeltaToWorld(100, 0, 1, 'map');
  close(moved.x, -moved.y, 'diagonal');
  assert.ok(moved.x > 0);
  // And it is the exact inverse of the projection of that move.
  const onScreen = cam.projectOffset(moved.x, moved.y, 'map');
  close(onScreen.x, 100, 'returns to 100px right');
  close(onScreen.y, 0, 'with no vertical drift');
});

test('the visible floor is the unprojected screen, which on the map is larger than the screen', () => {
  const camera = { x: 0, y: 0, z: 1 };
  const flat = cam.visibleWorldBounds(1000, 600, camera, 'canvas');
  assert.deepEqual(flat, { left: -500, top: -300, right: 500, bottom: 300 });
  const map = cam.visibleWorldBounds(1000, 600, camera, 'map');
  // Every screen corner must fall inside the reported floor rectangle.
  for (const [sx, sy] of [[0, 0], [1000, 0], [1000, 600], [0, 600]]) {
    const w = cam.screenToWorld(sx, sy, 1000, 600, camera, 'map');
    assert.ok(w.x >= map.left - 1e-9 && w.x <= map.right + 1e-9, `corner ${sx},${sy} x inside`);
    assert.ok(w.y >= map.top - 1e-9 && w.y <= map.bottom + 1e-9, `corner ${sx},${sy} y inside`);
  }
});

test('the chalk canvas is never tilted: map mode replaces it instead', () => {
  // The first version stood cards up on a 45° floor. the team: the 45° is the
  // MAP's drawing, not a projection of the cards — so none of that styling may
  // come back, and the canvas stays flat whatever the view is.
  assert.doesNotMatch(css, /\[data-view='map'\]/);
  assert.match(useCamera, /const sharedProjection: ViewProjection = 'canvas';/);
  assert.doesNotMatch(useCamera, /subscribeViewMode/);
  assert.match(canvas, /const viewMode = camera\.getProjection\(\);/);
});

test('the view is its own axis: canvas by default, persisted, never a layout value', () => {
  assert.equal(viewMode.DEFAULT_VIEW_MODE, 'canvas');
  assert.equal(viewMode.isViewMode('map'), true);
  assert.equal(viewMode.isViewMode('canvas'), true);
  assert.equal(viewMode.isViewMode('companion'), false, 'layout values are not views');
  assert.equal(viewMode.isViewMode('grid'), false, 'arranger layouts are not views');
  assert.equal(viewMode.readViewMode(), 'canvas', 'no storage → the canvas that shipped');
  assert.equal(viewMode.VIEW_STORAGE_KEY, 'airp.view');
});

test('every pointer path in the canvas goes through the projection', () => {
  // Card drag and pan used to hand-roll `dx / z`; on the map that drags the
  // wrong way, so both now go through the camera maths.
  assert.doesNotMatch(canvas, /\bdx \/ z\b/);
  assert.doesNotMatch(canvas, /\bdy \/ z\b/);
  assert.equal((canvas.match(/screenDeltaToWorld\(dx, dy, camera\.getCam\(\)\.z, viewRef\.current\)/g) ?? []).length, 2);
  assert.match(canvas, /zoomAt\(sx, sy, w, h, camera\.getTarget\(\), e\.deltaY, viewRef\.current\)/);
  assert.match(canvas, /screenToWorld\(sx, sy, w, h, cam, viewRef\.current\)/);
  // Handlers are registered once, so they read the projection through a ref.
  assert.match(canvas, /const viewRef = useRef\(viewMode\);\s*\n\s*viewRef\.current = viewMode;/);
  assert.match(canvas, /data-view=\{viewMode\}/);
  // The initial framing fits the PROJECTED footprint, not the world box.
  assert.match(canvas, /projectOffset\(x, y, view\)/);
  assert.match(canvas, /unprojectOffset\(0, \(bottomSpace - topSpace\) \/ \(2 \* z\), view\)/);
});

test('one camera, one projection: every world-space drawer reads the same one', () => {
  // The frame loop writes it, and a switch wakes the loop (it sleeps at rest).
  assert.match(useCamera, /worldTransform\(sharedSize\.w, sharedSize\.h, c, sharedProjection\)/);
  assert.match(useCamera, /projection: sharedProjection,/);
  assert.match(useCamera, /getProjection = useCallback\(\(\) => sharedProjection, \[\]\)/);
  // The performance layer's threads and aim, the grid, and what the agents are
  // told the player sees — all through the same projection.
  assert.match(performance, /\}, view\.projection\);/);
  assert.match(performance, /projectToScreen\(wx, wy, w, h, ctx\.camera\.getCam\(\), ctx\.camera\.getProjection\(\)\)/);
  assert.doesNotMatch(performance, /\(wx - cam\.x\) \* cam\.z/);
  assert.match(grid, /visibleWorldBounds\(view\.vw, view\.vh, view, view\.projection\)/);
  assert.match(viewpoint, /visibleWorldBounds\(vp\.w, vp\.h, cam, camera\.getProjection\(\)\)/);
  assert.doesNotMatch(viewpoint, /vp\.w \/ \(2 \* cam\.z\)/);
});

test('direct-manipulation loops never force layout or re-invalidate style per event', () => {
  // Wheel zoom arrives at device frequency (a trackpad can exceed 120Hz), and
  // the camera's rAF has just written a fresh transform: a bare
  // getBoundingClientRect in onWheel forces a style/layout pass per event that
  // grows with card count (the same seam the drag loop was fixed for). Wheel
  // must read the cached viewport rect, invalidated on resize like every other
  // consumer.
  const wheel = canvas.match(/const onWheel = \(e: WheelEvent\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.ok(wheel, 'wheel handler found');
  // The rect may be read exactly once to FILL the cache; the hot path reads
  // `cached.r`, never the element.
  assert.equal((wheel.match(/el\.getBoundingClientRect\(\)/g) ?? []).length, 1);
  assert.match(wheel, /const rect = cached\.r;/);
  assert.match(wheel, /viewportRectRef\.current = cached;/);
  // The frame loop runs every animated frame; attribute writes invalidate style
  // even when the value is unchanged, so both dataset writes must be guarded.
  const loop = useCamera.match(/const loop = \(\) => \{[\s\S]*?\n    \};/)?.[0] ?? '';
  assert.ok(loop, 'camera loop found');
  assert.doesNotMatch(loop, /^\s*world\.dataset\.view = /m, 'unconditional data-view write');
  assert.match(loop, /world\.dataset\.view !== sharedProjection\) world\.dataset\.view = sharedProjection/);
  // The world layer is written per frame from JS, so it needs an explicit
  // compositor promotion (the launcher wall already carries the same hint).
  assert.match(css, /\.origin-top-left \{\s*\n  will-change: transform;\s*\n\}/);
  // The launcher wall pans from pointer deltas: the transform must stay on
  // whole pixels, because a fractional translate resamples the wall's raster
  // tiles at a sub-pixel offset every frame (drag stutter on slow compositors).
  assert.match(launcher, /translate3d\(\$\{-Math\.round\(at\.x\)\}px, \$\{-Math\.round\(at\.y\)\}px, 0\)/);
});

test('map mode mounts the board in the canvas’s place, and every click reuses a canvas action', () => {
  assert.match(app, /\{viewMode === 'map' \? \(/);
  assert.match(app, /<Board\n/);
  assert.match(app, /onEnterPlace=\{\(target\) => \{ void enterGate\(target, 'board'\); \}\}/);
  assert.match(app, /onMeetCharacter=\{\(id\) => \{ void meetCharacter\(id\); \}\}/);
  assert.match(app, /onTakeItem=\{\(path\) => \{ void handleTakeItem\(path\); \}\}/);
  assert.match(app, /onLeave=\{\(parentId\) => \{ void enterLayer\(parentId\)\.then\(applyFollowFailures\); \}\}/);
  // The same layer data as the canvas, nothing fetched on the side — both draw `stageItems`, the layer's items
  // minus the older chalks that went into the message drawer.
  assert.equal(app.match(/items=\{stageItems\}/g)?.length, 2);
  assert.match(app, /const stageItems = streamOn\s*\? canvasItems\.filter\(/);
  assert.match(app, /view\.state === 'in-scene'/);
});

test('the switch is always in sight at the top right, both choices named', async () => {
  // It used to hide in the canvas tools column (opacity 0 until hovered, and
  // on the edge the option rail owns) — nobody found it.
  const sw = await read('../src/components/chrome/ViewModeSwitch.tsx');
  const swCss = await read('../src/components/chrome/view-mode-switch.css');
  assert.match(app, /\{!nookChar && <ViewModeSwitch mode=\{viewMode\} onChange=\{setViewMode\} \/>\}/);
  assert.doesNotMatch(app, /data-view-toggle/);
  assert.match(sw, /option\('canvas', t\('Canvas'\)\)/);
  assert.match(sw, /option\('map', t\('Map'\)\)/);
  assert.match(sw, /aria-pressed=\{mode === value\}/);
  assert.match(swCss, /\.view-mode-switch \{[\s\S]*top: max\(22px/);
  assert.doesNotMatch(swCss, /opacity: 0;[\s\S]*\.view-mode-switch:hover/);
  for (const key of ['Canvas', 'Map', 'View']) {
    assert.ok(messages[key]?.['zh-CN'] && messages[key]?.ja, `${key} needs zh-CN and ja`);
  }
});
