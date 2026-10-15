// World-event forwarding — BEHAVIOUR, not source text.
//
// `01 §10.3` planned this file and it was never written, so B5's wiring had no
// failing-when-broken guard. The obvious cheap version —
// `assert.match(src, /forwardWorldEvent\(/)` — only proves a CALL exists in the
// text; it stays green when the call sits behind an early `break`, when the
// filter list is wrong, or when dedup swallows the frame. That is exactly the
// "green because nothing ran" failure this repo keeps hitting.
//
// So this drives the REAL `useWorld` message handler: the module is bundled with
// esbuild and `react` is ALIASED to a stub that queues effects instead of running
// a renderer (the repo has no jsdom — character-rail.test.mjs:8-9). `useWorld()`
// is then called directly, the queued socket effect is run, and frames are fed to
// the captured `WebSocket.onmessage`. Assertions are on the `airp:world-event`
// CustomEvents that actually reached `window` — the same channel App listens on
// (`App.tsx:622`).
//
// Run: node --test apps/web/test/world-event-forwarding.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const require = createRequire(pathToFileURL(path.join(webRoot, 'test/x.mjs')));

/** The stub standing in for `react`. Queues effects; every hook is a call-through. */
const REACT_STUB = `
export const useEffectQueue = [];
export function useCallback(fn) { return fn; }
export function useEffect(fn) { useEffectQueue.push(fn); }
export function useRef(init) { return { current: init }; }
export function useState(init) { return [typeof init === 'function' ? init() : init, () => {}]; }
export function useMemo(fn) { return fn(); }
export function useSyncExternalStore(_subscribe, get) { return get(); }
export function useLayoutEffect(fn) { useEffect(fn); }
export const Fragment = Symbol('Fragment');
export function jsx() { return null; }
export function jsxs() { return null; }
export function createElement() { return null; }
export default { useCallback, useEffect, useRef, useState, useMemo, useSyncExternalStore, useLayoutEffect, jsx, jsxs, Fragment, createElement };
`;

/**
 * Build the real `useWorld` and return a driver. The stub is bundled INTO the
 * output, so `useEffectQueue` is re-exported from the wrapper entry — importing
 * a second copy would read a different (always empty) module instance.
 */
async function bootstrap() {
  const esbuild = require(
    path.join(repoRoot, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js')
  );

  // Browser globals the module touches at import / first render. `window` is the
  // observation point: forwarding is defined as "a CustomEvent reached window".
  const dispatched = [];
  globalThis.window = {
    location: { protocol: 'http:', host: 'localhost:3399' },
    dispatchEvent: (event) => { dispatched.push(event); return true; },
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
  };
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.CustomEvent = class {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  };
  const sockets = [];
  globalThis.WebSocket = class {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(data); }
    close() {}
  };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });

  const cacheDir = path.join(webRoot, 'node_modules/.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(cacheDir, 'airp-wwe-'));
  // The scratch bundle is needed only until the dynamic `import` below resolves.
  // `try/finally` (not a call after the happy path) is what keeps an esbuild or
  // import failure from stranding the directory — the hygiene defect this file's
  // own report flagged across the suite: a `mkdtemp` with no exception-safe `rm`
  // leaks one directory per run until the tmpfs fills.
  try {
    const stubFile = path.join(dir, 'react-stub.mjs');
    fs.writeFileSync(stubFile, REACT_STUB, 'utf-8');

    const entry = path.join(dir, 'entry.ts');
    fs.writeFileSync(
      entry,
        `export { agentActivityStore } from ${JSON.stringify(path.join(webRoot, 'src/lib/agent-activity-store.ts'))};\n` +
        `export { useEffectQueue } from 'react';\n` +
        `export * from ${JSON.stringify(path.join(webRoot, 'src/state/useWorld.ts'))};\n`,
      'utf-8'
    );

    const built = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'esm',
      jsx: 'automatic',
      // `alias` (not a resolve plugin) is what actually keeps REAL React out: the
      // JSX runtime is pulled in from the bundled modules too, and a partial stub
      // leaves `react`'s dispatcher null => "Invalid hook call" at call time.
      alias: { react: stubFile, 'react-dom': stubFile, 'react/jsx-runtime': stubFile, 'react-dom/client': stubFile },
      loader: { '.css': 'empty' },
      platform: 'node',
      absWorkingDir: webRoot,
      // `base-path.ts` reads `import.meta.env.BASE_URL` at module scope.
      define: { 'import.meta.env.BASE_URL': '"/"' },
    });
    const file = path.join(dir, 'useWorld.mjs');
    fs.writeFileSync(file, built.outputFiles[0].text, 'utf-8');

    const mod = await import(pathToFileURL(file).href);
    mod.agentActivityStore.selectSave('/test/saves/active');
    mod.useWorld();
    // Effects that need a real DOM throw here; the socket effect does not.
    for (const effect of mod.useEffectQueue) {
      try { effect(); } catch { /* DOM-dependent effect */ }
    }
    const socket = sockets[0];
    const handler = socket && typeof socket.onmessage === 'function' ? socket.onmessage : null;

    return {
      /** Feed one WS frame and report which CustomEvents reached `window`. */
      drive(frame) {
        dispatched.length = 0;
        handler({ data: JSON.stringify(frame) });
        return dispatched.map((event) => ({ type: event.type, detail: event.detail }));
      },
      selectSave(savePath) {
        mod.agentActivityStore.selectSave(savePath);
      },
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const driver = await bootstrap().catch((error) => {
  console.error('forwarding bootstrap unavailable:', error?.message ?? error);
  return null;
});
const skip = driver ? false : 'esbuild/react stub unavailable';

/** A `world_event` frame carrying one event of `type`. */
const ACTIVE_SAVE_PATH = '/test/saves/active';
const worldEvent = (type, id, extra = {}) =>
  ({ type: 'world_event', savePath: ACTIVE_SAVE_PATH, event: { id, type, layer: 'world/a', ...extra } });

/** The names of the CustomEvents a frame produced. */
// `airp:stream-event` is the message drawer's own copy of EVERY deduped event, not the chrome
// refresh this file is about; it has its own case below.
const names = (events) => events.map((event) => event.type).filter((type) => type !== 'airp:stream-event');
const streamCopies = (events) => events.filter((event) => event.type === 'airp:stream-event').map((event) => event.detail?.id);

test('the driver bootstrap is up: a skipped behaviour assertion is no assertion', () => {
  // Same honesty switch as character-rail.test.mjs:175. If the bundle stops
  // building, every case below would "pass" by skipping — so the skip itself is
  // asserted.
  assert.equal(skip, false, `forwarding bootstrap failed: ${skip}`);
});

/* ------------------- the B5 fix: events that MUST reach App ------------------- */

// Non-emptiness core. Before `7fd9122`, `forwardWorldEvent` was defined, sat in a
// dependency array, and was NEVER called — so a follow toggle or a carried
// character never refreshed the rail. Remove the call at `useWorld.ts:744` and
// both cases below go red (measured: 0 events dispatched).
test('B5: `following_changed` reaches window as airp:world-event', { skip }, () => {
  const events = driver.drive(worldEvent('following_changed', 'evt-follow-1', { detail: { character: 'watson', following: true } }));
  assert.deepEqual(names(events), ['airp:world-event'], 'a follow toggle MUST refresh App');
});

test('B5: `character_moved` reaches window as airp:world-event', { skip }, () => {
  const events = driver.drive(worldEvent('character_moved', 'evt-move-1', { detail: { character: 'watson', to: 'world/b' } }));
  assert.deepEqual(names(events), ['airp:world-event'], 'a carried character MUST refresh App');
});

test('the forwarded detail is the WHOLE frame, not a summary', { skip }, () => {
  // App's listener (`App.tsx:622`) refetches chrome data and other consumers read
  // the event; a trimmed payload would silently break them.
  const frame = worldEvent('character_moved', 'evt-move-full', { detail: { character: 'watson', to: 'world/b' } });
  const [forwarded] = driver.drive(frame);
  assert.equal(forwarded.type, 'airp:world-event');
  assert.deepEqual(forwarded.detail, frame, 'the full frame MUST be the event detail');
});

/* -------------------- dedup, and ordering vs. dedup (01 §3.5) -------------------- */

test('a duplicate event id is forwarded ONCE (dedup precedes forwarding)', { skip }, () => {
  // The same row arrives twice: as a `world_event` frame AND inside an HTTP
  // response. `01 §3.5` freezes `noteWorldEvent` BEFORE the
  // forward, or App refetches twice. Reverse the two lines and the second call
  // below dispatches again -> red.
  assert.deepEqual(names(driver.drive(worldEvent('following_changed', 'evt-dup'))), ['airp:world-event']);
  assert.deepEqual(names(driver.drive(worldEvent('following_changed', 'evt-dup'))), [], 'the duplicate MUST NOT re-forward');
});

/* ----------------- events that MUST NOT be forwarded (filter guard) ----------------- */

test('an event outside the forward set is NOT forwarded', { skip }, () => {
  // `layer_entered` refreshes via the ordinary layer refetch; broadcasting it as
  // a chrome-refresh trigger is the "forward everything" regression. Measured
  // green here, red for an implementation that drops the filter list.
  assert.deepEqual(names(driver.drive(worldEvent('layer_entered', 'evt-layer'))), []);
  assert.deepEqual(names(driver.drive(worldEvent('render_event', 'evt-render'))), []);
});

test('world-scoped frames require the active save identity', { skip }, () => {
  driver.selectSave(null);
  assert.deepEqual(names(driver.drive(worldEvent('character_moved', 'evt-no-save'))), []);

  driver.selectSave(ACTIVE_SAVE_PATH);
  const foreignFrame = {
    ...worldEvent('character_moved', 'evt-foreign-save'),
    savePath: '/test/saves/foreign',
  };
  assert.deepEqual(names(driver.drive(foreignFrame)), []);
  assert.deepEqual(names(driver.drive(worldEvent('character_moved', 'evt-active-save'))), ['airp:world-event']);
});

test('every deduped event reaches the message drawer once (airp:stream-event), forwarded or not', { skip }, () => {
  assert.deepEqual(streamCopies(driver.drive(worldEvent('layer_entered', 'evt-stream-1'))), ['evt-stream-1']);
  assert.deepEqual(streamCopies(driver.drive(worldEvent('layer_entered', 'evt-stream-1'))), []);
  assert.deepEqual(streamCopies(driver.drive({ type: 'world_event', event: { type: 'character_moved' } })), []);
});

test('a malformed world_event frame is dropped without forwarding', { skip }, () => {
  // No id => not dedupable; forwarding it would let one malformed frame refetch
  // chrome data repeatedly.
  assert.deepEqual(names(driver.drive({ type: 'world_event', event: { type: 'character_moved' } })), []);
  assert.deepEqual(names(driver.drive({ type: 'world_event' })), []);
  assert.deepEqual(names(driver.drive({ type: 'world_event', event: null })), []);
});

/* ------------------- pre-existing behaviour that must stay intact ------------------- */

test('the pre-existing `file_changed` / `card_position` forwards still work', { skip }, () => {
  // These were already wired at `useWorld.ts:724-727`; B5 must not have replaced
  // them while reviving the dead function.
  assert.deepEqual(names(driver.drive({ type: 'file_changed', savePath: ACTIVE_SAVE_PATH, path: 'world/a/x.md' })), ['airp:world-event']);
  assert.deepEqual(names(driver.drive({ type: 'card_position', savePath: ACTIVE_SAVE_PATH, path: 'world/a/x.md', x: 1, y: 2 })), ['airp:world-event']);
});
