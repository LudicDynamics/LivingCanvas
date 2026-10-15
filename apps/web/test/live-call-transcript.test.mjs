// The shared call-subtitle projection.
//
// Render assertions are props-driven and need NO store stub — that is the payoff
// of the component never reading the store (contract 30 §3.2 freeze 4). Source-text
// assertions cover what a static render cannot reach: the three MUST-NOTs are
// properties of "what the file does not contain", so only the text proves them
// (same shape as `character-rail.test.mjs`).
//
// Every load-bearing assertion ships with a reverse control: for the source rules,
// a synthetic violating snippet that the SAME regex must reject, so the rule cannot
// pass vacuously.
//
// Run: node --test apps/web/test/live-call-transcript.test.mjs
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

const componentPath = path.join(webRoot, 'src/components/live/LiveCallTranscript.tsx');
const src = fs.readFileSync(componentPath, 'utf8');

// ---- bootstrap: the component is props-driven, so no store stub is needed ----
const esbuild = require(
  path.join(repoRoot, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js')
);
const React = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

const out = await esbuild.build({
  entryPoints: [componentPath],
  bundle: true,
  write: false,
  format: 'esm',
  jsx: 'automatic',
  // `react` (and its JSX runtime) stays external so the renderer shares our
  // instance; `.css` is erased so no stylesheet output is required.
  external: ['react', 'react/jsx-runtime'],
  loader: { '.css': 'empty' },
  platform: 'node',
  absWorkingDir: webRoot,
});
const cacheDir = path.join(webRoot, 'node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const dir = fs.mkdtempSync(path.join(cacheDir, 'airp-transcript-'));
const file = path.join(dir, 'LiveCallTranscript.mjs');
const js = out.outputFiles.find(f => f.path.endsWith('.js') || f.path.endsWith('.mjs')) ?? out.outputFiles[0];
fs.writeFileSync(file, js.text, 'utf-8');
const { LiveCallTranscript } = await import(pathToFileURL(file).href);
fs.rmSync(dir, { recursive: true, force: true });

const EMPTY_LINES = { streaming: '', lines: [] };
const render = (lines, call, className) => renderToStaticMarkup(
  React.createElement(LiveCallTranscript, { lines, call, className }),
);
const chan = (streaming = '', lines = [], outputText = '', inputText = '', phase = 'live') => [
  { streaming, lines },
  { outputText, inputText, phase },
];

/* ------------------------- 1. render assertions --------------------------- */

test('A1: a line already committed as streaming is not printed twice (31 §3.5 step 6)', () => {
  const markup = render(...chan('Bravo', ['Alpha'], 'Charlie', 'Delta'));
  assert.ok(!markup.includes('Charlie'), 'the voice-ASR copy must be suppressed while streaming exists');
  // Reverse control: drop the `streaming === ''` guard and `Charlie` WOULD appear —
  // so the assertion above has discriminating power.
  const markupNoStreaming = render(...chan('', ['Alpha'], 'Charlie', 'Delta'));
  assert.ok(markupNoStreaming.includes('Charlie'), 'control: without streaming the same text must render');
});

test('A2: the four sources render in the frozen order lines -> streaming -> output -> input', () => {
  const markup = render(...chan('Bravo', ['Alpha'], 'Charlie', 'Delta'));
  const at = ['Alpha', 'Bravo', 'Delta'].map(s => markup.indexOf(s));
  assert.ok(at.every(i => i >= 0), `all four sources render (${at.join(',')})`);
  assert.ok(at[0] < at[1] && at[1] < at[2], 'Alpha before Bravo before Delta');
});

test('A3: with no streaming line the voice-ASR text renders after the committed lines (31 §3.5 step 6)', () => {
  const markup = render(...chan('', ['Alpha'], 'Charlie', 'Delta'));
  const at = ['Alpha', 'Charlie', 'Delta'].map(s => markup.indexOf(s));
  assert.ok(at.every(i => i >= 0), `all sources render (${at.join(',')})`);
  assert.ok(at[0] < at[1] && at[1] < at[2], 'Alpha before Charlie before Delta');
});

test('A4: the empty state branches on phase — connecting vs everything else (D2 / 31 §3.5 step 3)', () => {
  const connecting = render(...chan('', [], '', '', 'connecting'));
  assert.ok(connecting.includes('Connecting\u2026'), 'connecting phase shows the connecting label');
  assert.ok(!connecting.includes('Listening\u2026'), 'connecting phase is not also listening');

  for (const phase of ['live', 'idle', 'error']) {
    // Reverse control: the old nook behaviour was a constant `Connecting…`, which
    // would fail here in every non-connecting phase.
    const markup = render(...chan('', [], '', '', phase));
    assert.ok(markup.includes('Listening\u2026'), `${phase} shows the listening label`);
    assert.ok(!markup.includes('Connecting\u2026'), `${phase} must not claim it is still connecting`);
  }

  // The placeholder is mutually exclusive with real content.
  const talking = render(...chan('', ['Alpha'], '', '', 'live'));
  assert.ok(!talking.includes('Listening\u2026'), 'no placeholder once a line exists');
});

test('A5: every character line carries the shared speaker label, the player line says You (31 §3.5 steps 4/5/7)', () => {
  const markup = render(...chan('Bravo', ['Alpha'], 'Charlie', 'Delta'));
  const lines = [...markup.matchAll(/<p class="live-call-transcript__line[^"]*">([\s\S]*?)<\/p>/g)]
    .map(m => m[1]);
  assert.equal(lines.length, 3, `Alpha, Bravo and Delta each render one line (got ${lines.length})`);
  for (const inner of lines) {
    assert.match(inner, /class="live-call-transcript__speaker"/, 'each line has a speaker label');
  }
  assert.match(lines[0], /They say/);
  assert.match(lines[1], /They say/);
  assert.match(lines[2], /You/);
  assert.ok(!lines[2].includes('They say'), 'the player line is not labelled as the character');
});

test('A6: a host className is appended, never replacing the component class (31 §3.5 step 9)', () => {
  const markup = render(...chan('', ['Alpha'], '', '', 'live'), 'host-x');
  const root = markup.match(/^<div [^>]*>/)?.[0] ?? '';
  assert.match(root, /class="live-call-transcript host-x"/);
  // Reverse control: no className still yields the base class alone.
  const bare = render(...chan('', ['Alpha'], '', '', 'live')).match(/^<div [^>]*>/)?.[0] ?? '';
  assert.match(bare, /class="live-call-transcript"/);
});

test('A7: the root carries the frozen data hook and no surface/role semantics (31 §3.5 root, §3.6)', () => {
  const markup = render(...chan('', ['Alpha'], '', '', 'live'));
  const root = markup.match(/^<div [^>]*>/)?.[0] ?? '';
  assert.match(root, /data-live-call-transcript=""/);
  assert.ok(!root.includes('data-nook-zone'), 'the nook lane hook belongs to the host, not here');
  assert.ok(!/\brole=/.test(root), 'no role is added — that would change the accessibility tree');
});

/* --------------------- 2. source assertions (freeze 4) -------------------- */

// The three rules below are "what the file must NOT contain". Bundling can only
// prove what a given prop set draws, so only the text proves the absence of other
// inputs and side effects.
const RULE_STORE_HOOK = /useLiveCall(State|Lines|Actions|Available)\s*\(/;
const RULE_STORE_IMPORT = /^import (?!type\b)[^\n]*from '[^']*live-call(-store)?\.js';?$/m;
const RULE_ACTIONS = /useLiveCallActions/;
const RULE_START_STOP = /\b(start|stop)\s*\(/;
const RULE_FETCH = /fetch\s*\(/;
const RULE_OWNER = /\bowner\b/;
const RULE_CHARACTER_ID = /characterId/;

test('S1: the component never subscribes to the call store', () => {
  assert.doesNotMatch(src, RULE_STORE_HOOK);
  // A runtime import of the store binding would make the component reactive to it;
  // `import type` is erased and allowed.
  assert.doesNotMatch(src, RULE_STORE_IMPORT);
});

test('S2: the component never starts or stops a call', () => {
  assert.doesNotMatch(src, RULE_ACTIONS);
  assert.doesNotMatch(src, RULE_START_STOP); // no call to start()/stop()
  assert.doesNotMatch(src, RULE_FETCH);      // no request of its own
});

test('S3: the component never assumes an owner', () => {
  assert.doesNotMatch(src, RULE_OWNER);
  assert.doesNotMatch(src, RULE_CHARACTER_ID);
});

test('S1-S3 controls: the same rules reject a violating source (the rules have teeth)', () => {
  // Reverse controls: each rule, run against a snippet that breaks it, MUST match.
  // Without these the rules above would still pass on an empty or mangled file.
  assert.match("import { useLiveCallState } from './live-call-store.js';\nuseLiveCallState();", RULE_STORE_HOOK);
  assert.match("import { liveCallStore } from '../lib/live-call.js';", RULE_STORE_IMPORT);
  assert.match("const { start, stop } = useLiveCallActions();", RULE_ACTIONS);
  assert.match('await stop("rail:X");', RULE_START_STOP);
  assert.match("await fetch('/api/live/close');", RULE_FETCH);
  assert.match('function stop(owner) {}', RULE_OWNER);
  assert.match('characterId: string | null;', RULE_CHARACTER_ID);

  // And the allowed shape must NOT match: this is what keeps the component legal.
  assert.doesNotMatch("import type { LiveCallLines } from '../../lib/live-call-store.js';", RULE_STORE_IMPORT);
  assert.doesNotMatch('const startIndex = 0;', RULE_START_STOP);
});

test('S1 companion: the type import is `import type`, so the store is erased at runtime', () => {
  assert.match(src, /^import type \{[^}]*\} from '\.\.\/\.\.\/lib\/live-call-store\.js';$/m);
});

/* ------------------------------- 3. i18n ---------------------------------- */

test('I1: the component copies from messages.json only, using the four pre-existing keys', () => {
  const keys = [...src.matchAll(/\bt\('([^']+)'\)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(keys)].sort(), ['Connecting…', 'Listening…', 'They say', 'You'].sort());
  const messages = JSON.parse(fs.readFileSync(path.join(webRoot, 'src/lib/messages.json'), 'utf8'));
  for (const key of keys) {
    const entry = messages[key];
    assert.ok(entry, `"${key}" exists in messages.json — this ticket adds no keys`);
    for (const locale of ['zh-CN', 'ja']) {
      assert.ok(entry[locale], `"${key}" has a ${locale} translation`);
    }
  }
  // No third copy track: the legacy `UI_COPY` table must not be reachable from here.
  assert.doesNotMatch(src, /legacy-ui-copy|UI_COPY/);
});
