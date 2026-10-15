// The nook's call lane is owner-scoped (the design notes, contract 30
// §2.2 冻结 1 / §4.1 冻结 6 / §5.3 冻结 9). NookView reads the store through
// `live-call.js`, so a static render bundles the component against a local stub
// of that binding whose four hooks read `globalThis` — one snapshot per phase.
//
// Two bootstrap seams are required beyond the dialogue test's (34 §8.2, measured):
//   - `import.meta.env.BASE_URL` must be defined (base-path.ts:7 reads it; without
//     the define every render group here would silently SKIP — the exact trap
//     that left character-rail.test.mjs at 11 skipped);
//   - `.css` must resolve to an empty loader (NookView imports nook CSS).
// Run: node --test apps/web/test/nook-call-lane.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const require = createRequire(pathToFileURL(path.join(webRoot, 'test/x.mjs')));

const componentPath = path.join(webRoot, 'src/components/nook/NookView.tsx');
const source = fs.readFileSync(componentPath, 'utf8');

// ---- bootstrap: bundle the component against a stub of the store binding ----
const STUB = `
export interface StubLiveCallState {
  phase: 'idle' | 'connecting' | 'live' | 'error';
  error?: string;
  characterId: string | null;
  owner: string | null;
  inputText: string;
  outputText: string;
}
const DEFAULT_STATE: StubLiveCallState = {
  phase: 'idle', characterId: null, owner: null, inputText: '', outputText: '',
};
export function useLiveCallState(): StubLiveCallState {
  return (globalThis as any).__liveCallState ?? DEFAULT_STATE;
}
export function useLiveCallLines() {
  return (globalThis as any).__liveCallLines ?? { streaming: '', lines: [] };
}
export function useLiveCallActions() {
  return (globalThis as any).__liveCallActions ?? { start: async () => {}, stop: async () => {} };
}
export function useLiveCallAvailable(): boolean {
  return (globalThis as any).__liveCallAvailable !== false;
}
`;
const ENTRY = `
export { NookView } from ${JSON.stringify(componentPath)};
`;

let NookView = null;
let React = null;
let renderToStaticMarkup = null;
try {
  const esbuild = require(
    path.join(repoRoot, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js')
  );
  React = (await import('react')).default;
  ({ renderToStaticMarkup } = await import('react-dom/server'));

  const cacheDir = path.join(webRoot, 'node_modules/.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(cacheDir, 'airp-nookcall-'));
  const stubPath = path.join(dir, 'live-call-stub.ts');
  fs.writeFileSync(stubPath, STUB, 'utf-8');
  const out = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: webRoot, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    // `react` (and its JSX runtime) stays external so the renderer shares our
    // instance; `.css` is erased below. CJS deps reached through the Canvas
    // subtree still emit `require(...)`, which the banner installs.
    external: ['react', 'react/jsx-runtime', 'react-dom', 'lucide-react'],
    platform: 'node',
    absWorkingDir: webRoot,
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    logLevel: 'error',
    // NookView imports its own CSS. An unresolved `.css` would abort the whole
    // bootstrap and take every render assert with it.
    loader: { '.css': 'empty' },
    // base-path.ts:7 reads `import.meta.env.BASE_URL`; esbuild's default leaves
    // it undefined and the module throws at import time.
    define: { 'import.meta.env.BASE_URL': '"/"' },
    plugins: [
      {
        name: 'live-call-stub',
        setup(build) {
          build.onResolve({ filter: /live-call\.js$/ }, () => ({ path: stubPath }));
        },
      },
    ],
  });
  const bundle = path.join(dir, 'nook-call.mjs');
  fs.writeFileSync(bundle, out.outputFiles[0].text, 'utf-8');
  ({ NookView } = await import(pathToFileURL(bundle).href));
} catch (err) {
  // A failed bootstrap is a FAILURE, never a skip: a silently skipped group is
  // indistinguishable from a green one.
  assert.fail('render bootstrap unavailable: ' + (err?.stack ?? err));
}
assert.ok(NookView && React && renderToStaticMarkup, 'render bootstrap incomplete');

const X = 'nanami';
const OTHER = 'watson';

/** Set the stub snapshot, render one static tree, and hand back the DOM string. */
function render(next) {
  globalThis.__liveCallState = {
    phase: 'idle', characterId: null, owner: null, inputText: '', outputText: '', ...next,
  };
  globalThis.__liveCallLines = { streaming: '', lines: [] };
  globalThis.__liveCallAvailable = true;
  return renderToStaticMarkup(
    React.createElement(NookView, {
      characterId: X,
      worldId: 'world-1',
      character: { id: X },
      effectsEnabled: false,
      locale: 'en',
      onClose() {},
    })
  );
}

/** The call-lane button, isolated from the rest of the nook chrome. */
const lane = (html) => html.match(/<button[^>]*class="flex items-center gap-1\.5[\s\S]*?<\/button>/)?.[0] ?? '';
const labelOf = (html) => lane(html).match(/<span>([^<]*)<\/span>/)?.[1];

// ---------------------------------------------------------------------------
// T3c — defect 1: a foreign call is neither depicted nor hangable here.
// ---------------------------------------------------------------------------

test('T3c-1 a foreign call is neither depicted nor hangable in this nook (defect 1)', () => {
  const html = render({ phase: 'live', characterId: OTHER });
  assert.equal(labelOf(html), 'Speak aloud', 'the button MUST NOT read "Hang up"');
  assert.doesNotMatch(html, /data-nook-zone="transcript"/, 'no foreign subtitles');
  assert.doesNotMatch(html, /role="alert"/, 'no foreign error alert');
});

test("T3c-2 this nook's own call still reads \"Hang up\" and shows subtitles", () => {
  const html = render({ phase: 'live', characterId: X });
  assert.equal(labelOf(html), 'Hang up');
  assert.match(html, /data-nook-zone="transcript"/);
});

test('T3c-3 an error on OUR call keeps the alert and a hang-up, not the lane (V-1)', () => {
  const html = render({ phase: 'error', characterId: X, error: 'Mic denied.' });
  assert.equal(labelOf(html), 'Hang up', 'the error phase MUST keep a visible hang-up (V-1)');
  assert.match(html, /role="alert"[\s\S]*Mic denied\./);
  // The transcript lane holds no hang-up, so the error phase has nothing for it
  // to add — and mounting it would print "Listening…" beside the alert
  // (31 §4.2 Step N-2, restored after 34 §3.3 over-extended it).
  assert.doesNotMatch(html, /data-nook-zone="transcript"/, 'the lane MUST NOT claim to listen while errored');
  assert.doesNotMatch(html, /Listening…/, 'nothing on screen may contradict the alert');
});

test('T3c-4 the click is owner-scoped (the other half of 冻结 6)', () => {
  assert.match(source, /stopCall\(`nook:\$\{characterId\}`\)/);
  assert.doesNotMatch(source, /else void stopCall\(\);/);
});

// ---------------------------------------------------------------------------
// Non-emptiness: each pair above is inverted by the raw global phase. Reverting
// the judge to `callInProgress` MUST flip T3c-1 red (34 §3.5 baseline matrix).
// ---------------------------------------------------------------------------

test('T3c-5 the lane gate is ownership-scoped, not the raw global flag', () => {
  // The raw flag survives for the L2 dialogue guard (10 §4.3) only. Reading it in
  // a RENDER decision is defect 1's S-3; the transcript lane is such a decision.
  const renderStart = source.indexOf('\n  return (');
  assert.ok(renderStart > -1, 'component return not found');
  assert.doesNotMatch(source.slice(renderStart), /\{callInProgress &&/);
  // ...and the narrowed derivations it replaced are really there.
  assert.match(source, /const callMine = call\.characterId === characterId;/);
  assert.match(source, /const callVisible = callMine && \(callInProgress \|\| call\.phase === 'error'\);/);
  assert.match(source, /const callTranscript = callMine && callInProgress;/);
});

// ---------------------------------------------------------------------------
// Migration evidence (31 §6.3 A8/A10): the subtitles really moved into the
// shared component, and the host box that the visibility contract anchors on
// was NOT swapped out with it.
// ---------------------------------------------------------------------------

test('T3c-6 the nook subtitles are rendered by the shared component (A8)', () => {
  assert.match(source, /<LiveCallTranscript/);
  // The lane's own hand-written subtitle markup is gone — only `copy` keys the
  // call lane still needs may survive (31 §4.2 Step N-3).
  assert.doesNotMatch(source, /copy\.liveCallThem/);
  assert.doesNotMatch(source, /copy\.liveCallYou/);
  // `copy.liveCallConnecting` MUST survive: the call LANE button still labels the
  // connecting phase with it, so asserting its absence would be a false red.
  assert.match(source, /copy\.liveCallConnecting/);
});

test('T3c-7 the nook transcript box survives the migration (A10)', () => {
  const html = render({ phase: 'live', characterId: X });
  // The host box is what the visibility contract and the nook zone census anchor
  // on; the component itself emits no `data-nook-zone`.
  assert.match(html, /data-nook-zone="transcript"/);
  const at = html.indexOf('data-nook-zone="transcript"');
  const box = html.slice(at, html.indexOf('</div>', at));
  assert.match(box, /data-live-call-transcript/, 'the component mounts INSIDE that box');
  assert.doesNotMatch(html, /class="font-mono text-\[10px\] text-ink\/40"/, 'the old hand-written placeholder is gone');
});

// ---------------------------------------------------------------------------
// The lane gate itself: ownership-scoped, and deliberately WITHOUT the error
// phase — `callMine && callInProgress`, never `callVisible`.
// ---------------------------------------------------------------------------

test('T3c-8 the transcript lane mounts on our transport and never on error', () => {
  // Positive: a live call on this nook mounts the lane.
  assert.match(render({ phase: 'live', characterId: X }), /data-nook-zone="transcript"/);
  // Discriminating half #1: a FOREIGN live call must not leak its subtitles here
  // (34 §3.1 S-3). Reverting the gate to the bare global `callInProgress` flips
  // this red.
  assert.doesNotMatch(
    render({ phase: 'live', characterId: OTHER }),
    /data-nook-zone="transcript"/,
    'a foreign call MUST NOT mount this nook\'s lane',
  );
  // Discriminating half #2: extending the gate to `callVisible` flips THIS red,
  // and that is exactly the regression 34 §3.3 shipped once (the lane printed
  // "Listening…" beside its own error alert). The component cannot catch it —
  // it is phase-agnostic by design (31 §4.2 Step N-2).
  assert.doesNotMatch(
    render({ phase: 'error', characterId: X, error: 'x' }),
    /data-nook-zone="transcript"/,
    'the error phase MUST NOT mount the lane',
  );
  // Source-level pairing: the lane gate is neither of the other two.
  assert.match(source, /\{callTranscript && \(/);
});
