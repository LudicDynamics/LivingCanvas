// Dialogue call UI. The store (11) is not this ticket's
// file, so the component is bundled against a local stub of `live-call.js` whose
// four hooks read `globalThis` — that is what lets a single static render stand
// in for each phase. Render assertions use `renderToStaticMarkup`; the source-text
// assertions cover what a static render cannot reach (effects never run, so
// `prefetchVoice` and the frame consumer never fire).
// Run: node --test apps/web/test/character-modal-call-ui.test.mjs
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

const componentPath = path.join(webRoot, 'src/components/overlay/CharacterModal.tsx');
const source = fs.readFileSync(componentPath, 'utf8');
const messagesRaw = fs.readFileSync(path.join(webRoot, 'src/lib/messages.json'), 'utf8');
const messages = JSON.parse(messagesRaw);

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
export { CharacterModal } from ${JSON.stringify(componentPath)};
export { agentActivityStore } from ${JSON.stringify(path.join(webRoot, 'src/lib/agent-activity-store.js'))};
`;

let CharacterModal = null;
let agentActivityStore = null;
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
  const dir = fs.mkdtempSync(path.join(cacheDir, 'airp-callui-'));
  const stubPath = path.join(dir, 'live-call-stub.ts');
  fs.writeFileSync(stubPath, STUB, 'utf-8');
  const out = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: webRoot, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    // `react` stays external so the renderer shares this React instance; the
    // CJS-only deps also stay out so no dynamic `require` survives.
    external: ['react', 'react/jsx-runtime', 'react-dom', 'lucide-react'],
    platform: 'node',
    absWorkingDir: webRoot,
    logLevel: 'error',
    // The shared subtitle component imports its own stylesheet; without an
    // empty `.css` loader esbuild aborts the whole bundle (31 §3.1).
    loader: { '.css': 'empty' },
    plugins: [
      {
        name: 'live-call-stub',
        setup(build) {
          build.onResolve({ filter: /live-call\.js$/ }, () => ({ path: stubPath }));
        },
      },
    ],
  });
  const bundle = path.join(dir, 'call-ui.mjs');
  fs.writeFileSync(bundle, out.outputFiles[0].text, 'utf-8');
  ({ CharacterModal, agentActivityStore } = await import(pathToFileURL(bundle).href));
} catch (err) {
  // A failed bootstrap is a FAILURE, never a skip: a silently skipped group is
  // indistinguishable from a green one.
  assert.fail('render bootstrap unavailable: ' + (err?.stack ?? err));
}
assert.ok(CharacterModal && React && renderToStaticMarkup, 'render bootstrap incomplete');

const X = 'nanami';
const OTHER = 'someone-else';

/** Set the stub snapshot, render one static tree, and hand back the DOM string. */
function render(next, lines) {
  globalThis.__liveCallState = {
    phase: 'idle', characterId: null, owner: null, inputText: '', outputText: '', ...next,
  };
  globalThis.__liveCallLines = lines ?? { streaming: '', lines: [] };
  globalThis.__liveCallAvailable = next?.available !== false;
  return renderToStaticMarkup(React.createElement(CharacterModal, { characterId: X, onClose() {} }));
}

/** One `character:<id>` chip so `ActivityRail` stops returning null. */
function seedRail(agentId = `character:${X}`) {
  const savePath = '/tests/character-modal-call-ui';
  agentActivityStore.selectSave(savePath);
  const now = Date.now();
  agentActivityStore.ingest({
    type: 'agent_activity',
    source: 'character',
    phase: 'started',
    activityId: `act-${agentId}`,
    agentId,
    turnId: 'turn-1',
    operation: 'read',
    timestamp: now,
  }, now, savePath);
}

const statusOf = (html) => html.match(/<span class="call-status" role="status">([^<]*)<\/span>/)?.[1];
const hangupOf = (html) => html.match(/class="call-hangup"[^>]*>([^<]*)</)?.[1];

// ---------------------------------------------------------------------------
// A1 / A1' / A1'' — the TTS gate, its riding assignment, and its placement.
// ---------------------------------------------------------------------------

test('A1: all five prefetchVoice call sites carry the negated call gate', () => {
  const callSites = [...source.matchAll(/^.*void prefetchVoice\(.*$/gm)]
    .map((m) => m[0])
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
  assert.equal(callSites.length, 5, 'expected exactly five prefetchVoice call sites');
  const lines = new Set();
  for (const line of callSites) {
    // The `!` is part of the assertion: the bare token would go green with the
    // polarity inverted, silencing text mode and speaking during calls.
    assert.match(line, /!callActiveRef\.current/, `gate missing/inverted: ${line.trim()}`);
    lines.add(line.trim());
  }
  assert.equal(lines.size, 5, 'call sites must be distinct');
  // The gate never rewrites the request itself (tools/check-request-bodies.mjs):
  // one call, with the route on the `fetch` line. That request moved to
  // `lib/tts-request.ts` on 2026-09-21 so the companion dock speaks through the
  // SAME call — the modal keeps the gate, the module keeps the fetch, and the
  // modal must not have grown a second one back.
  const requestSource = fs.readFileSync(path.join(webRoot, 'src/lib/tts-request.ts'), 'utf8');
  const fetches = requestSource.split('\n').filter((l) => !l.trim().startsWith('*') && l.includes("fetch('/api/tts'"));
  assert.equal(fetches.length, 1, 'the TTS request must stay a single unguarded call');
  assert.match(fetches[0], /fetch\('\/api\/tts',\s*\{/);
  assert.ok(!source.includes("fetch('/api/tts'"), 'the modal must call the shared request, not its own');
  assert.match(source, /await fetchVoiceUrl\(/);
  // The call gate still decides whether a prefetch happens at all, which is
  // what keeps text mode silent during a live call.
  assert.doesNotMatch(requestSource, /callActive/);
});


/** Index just past the element whose opening tag starts at `start`. */
function subtreeEnd(html, start) {
  const tag = html.slice(start + 1).match(/^[a-zA-Z][\w-]*/)?.[0] ?? 'div';
  let depth = 0;
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  re.lastIndex = start;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return m.index + m[0].length;
    } else if (!html.slice(m.index + m[0].length).trimStart().startsWith('/>')) {
      depth += 1;
    }
  }
  return html.length;
}

test("A1': callActiveRef.current = callActive runs during render, not inside a hook body", () => {
  const bodyStart = source.indexOf('export const CharacterModal: React.FC<CharacterModalProps> = ({');
  assert.ok(bodyStart > -1, 'component body not found');
  const returnAt = source.indexOf('\n  return (\n', bodyStart);
  assert.ok(returnAt > bodyStart, 'component return not found');
  const body = source.slice(bodyStart, returnAt);
  // Peel every `useEffect(...)` / `useCallback(...)` / `useMemo(...)` argument
  // block; a render-phase statement must survive that, a moved one must not.
  let stripped = body;
  for (const name of ['useEffect(', 'useCallback(', 'useMemo(']) {
    let idx = stripped.indexOf(name);
    while (idx !== -1) {
      let depth = 0;
      let i = idx + name.length - 1;
      for (; i < stripped.length; i++) {
        if (stripped[i] === '(') depth += 1;
        else if (stripped[i] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      stripped = stripped.slice(0, idx) + stripped.slice(i + 1);
      idx = stripped.indexOf(name, idx);
    }
  }
  assert.match(stripped, /callActiveRef\.current = callActive;/, 'must be a top-level render statement');
  // Mirrors `callActive`, never `callVisible` — the error phase must let the
  // prefetch and the text path resume.
  assert.doesNotMatch(stripped, /callActiveRef\.current = callVisible/);
});

test('A1": the gate lives at the call sites, never inside prefetchVoice', () => {
  assert.equal((source.match(/void prefetchVoice\(/g) ?? []).length, 5);
  const from = source.indexOf('const prefetchVoice = useCallback(');
  const to = source.indexOf('const syncPages = useCallback(');
  assert.ok(from > -1 && to > from, 'prefetchVoice body not delimited');
  const body = source.slice(from, to);
  assert.match(body, /if \(page\.voiceState !== 'idle'\) return;/);
  assert.doesNotMatch(body, /callActiveRef/);
});

// ---------------------------------------------------------------------------
// A2 – A8, A3' — what the paper shows, per store snapshot.
// ---------------------------------------------------------------------------

test('A2: an unavailable server renders no mode switch at all', () => {
  assert.doesNotMatch(render({ available: false }), /data-dialogue-mode-switch/);
  assert.match(render({ available: true }), /data-dialogue-mode-switch/);
});

test('A3: a live call replaces the whole text input row', () => {
  const live = render({ phase: 'live', characterId: X });
  assert.doesNotMatch(live, /speech-input-row/);
  assert.match(live, /class="call-hangup"/);
  const idle = render({ phase: 'idle' });
  assert.match(idle, /speech-input-row/);
  assert.doesNotMatch(idle, /call-hangup/);
});

test("A3': the error phase keeps the call panel and its alert", () => {
  const html = render({ phase: 'error', characterId: X, error: 'Mic denied.' });
  assert.match(html, /role="alert"/);
  assert.match(html, /Mic denied\./);
  assert.doesNotMatch(html, /speech-input-row/);
});

test('A4: another character\'s call leaves this dialogue in text mode', () => {
  const html = render({ phase: 'live', characterId: OTHER });
  assert.match(html, /speech-input-row/);
  assert.doesNotMatch(html, /call-hangup/);
});

test('A5: the call panel owns an alert slot for the store error', () => {
  const html = render({ phase: 'error', characterId: X, error: 'Could not reach the voice server.' });
  assert.match(html, /class="dialogue-call-alert" role="alert"/);
  assert.match(html, /Could not reach the voice server\./);
});

test('A6: status and button labels follow the phase', () => {
  assert.equal(statusOf(render({ phase: 'connecting', characterId: X })), 'Connecting…');
  const live = render({ phase: 'live', characterId: X });
  assert.equal(statusOf(live), 'On a call');
  assert.equal(hangupOf(live), 'Hang up');
  const err = render({ phase: 'error', characterId: X, error: 'x' });
  assert.equal(statusOf(err), 'Could not connect');
  assert.equal(hangupOf(err), 'Close');
});

test('A7: transcript order, and outputText only once streaming is empty', () => {
  const streaming = render(
    { phase: 'live', characterId: X, outputText: 'Charlie', inputText: 'Delta' },
    { streaming: 'Bravo', lines: ['Alpha'] }
  );
  // Contract §2.3: with a committed line streaming, the voice front-end's own
  // outputText is suppressed — otherwise the same sentence prints twice.
  assert.ok(!streaming.includes('Charlie'));
  const streamed = ['Alpha', 'Bravo', 'Delta'].map((s) => streaming.indexOf(s));
  assert.ok(streamed.every((i) => i > -1), `missing line: ${streamed}`);
  assert.deepEqual(streamed, [...streamed].sort((a, b) => a - b));

  const settled = render(
    { phase: 'live', characterId: X, outputText: 'Charlie', inputText: 'Delta' },
    { streaming: '', lines: ['Alpha'] }
  );
  const at = ['Alpha', 'Charlie', 'Delta'].map((s) => settled.indexOf(s));
  assert.ok(at.every((i) => i > -1), `missing line: ${at}`);
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
});

test('A8: the character-modal rail is inside the call stage subtree', () => {
  seedRail();
  const html = render({ phase: 'live', characterId: X });
  const stageAt = html.indexOf('<div class="call-stage">');
  assert.ok(stageAt > -1, 'call stage not rendered');
  // Scoped on purpose: the identity-side rail at CharacterModal.tsx:880 is
  // always mounted, so an unscoped `data-surface` check would pass with the new
  // rail missing entirely.
  const stage = html.slice(stageAt, subtreeEnd(html, stageAt));
  assert.match(stage, /data-surface="character-modal"/);
  // ...and the pre-existing identity rail still exists (an addition, not a swap).
  assert.match(html.slice(0, stageAt), /data-surface="character-modal"/);
});

// ---------------------------------------------------------------------------
// A9 – A13 — source-level invariants a static render cannot observe.
// ---------------------------------------------------------------------------

test('A9: handleClose stops the owned call before onClose()', () => {
  const from = source.indexOf('const handleClose = useCallback(');
  const to = source.indexOf('const requestClose = useCallback(');
  assert.ok(from > -1 && to > from, 'handleClose body not delimited');
  const body = source.slice(from, to);
  const stopAt = body.indexOf('void stopOwnedCall();');
  const closeAt = body.indexOf('onClose();');
  assert.ok(stopAt > -1, 'stopOwnedCall missing from handleClose');
  assert.ok(closeAt > -1, 'onClose() missing from handleClose');
  assert.ok(stopAt < closeAt, 'stop(owner) must precede character_stop');
});


test('A11: the nine new keys are localised and Close stays a single key', () => {
  const added = [
    'Start a call', 'Text', 'Dialogue mode', 'On a call', 'Listening…',
    'Hang up', 'They say', 'You', 'Could not connect',
  ];
  for (const key of added) {
    assert.ok(key in messages, `missing key: ${key}`);
    assert.ok(messages[key]['zh-CN'], `missing zh-CN for ${key}`);
    assert.ok(messages[key].ja, `missing ja for ${key}`);
  }
  // json.load silently drops a duplicate, so count the raw key text: this is the
  // only way to prove `Close call` / a second `Close` was not added (F6).
  assert.equal((messagesRaw.match(/"Close":/g) ?? []).length, 1);
  assert.ok('Connecting…' in messages && 'Close' in messages);
});


test('A13: callVisible is derived from callActive together with the error phase', () => {
  const line = source.split('\n').find((l) => /const callVisible =/.test(l));
  assert.ok(line, 'callVisible definition not found');
  assert.match(line, /callActive/);
  assert.match(line, /'error'/);
});

// ---------------------------------------------------------------------------
// T4-1 – T4-4 / T4b — defect 2: the disabled predicate is per character
// (contract 30 §4.2 冻结 7/7b).
// ---------------------------------------------------------------------------

/** `.dialogue-modes` has two buttons: index 0 = "Text", index 1 = the call mode. */
const modeTags = (html) => [...html.matchAll(/<button[^>]*class="dialogue-mode"[^>]*>([^<]*)</g)];
const modeDisabled = (html) => /disabled/.test(modeTags(html)[1]?.[0] ?? '');
const modeLabel = (html) => modeTags(html)[1]?.[1];

test("T4-1 another character's call leaves the button ENABLED (defect 2, 10 §4.1)", () => {
  const html = render({ phase: 'live', characterId: OTHER });
  assert.equal(modeDisabled(html), false, "a foreign call MUST NOT disable this paper's button");
  assert.match(html, /Start a call/, 'and the label MUST say the paper is free');
  // Non-emptiness: the same paper with its OWN call is disabled, so the assert
  // above is not passing just because the mode switch failed to render.
  assert.equal(modeDisabled(render({ phase: 'live', characterId: X })), true);
});

test('T4-2 the error phase stays retryable (12 §3.2 / 冻结 7)', () => {
  for (const other of [X, OTHER]) {
    const html = render({ phase: 'error', characterId: other, error: 'x' });
    assert.equal(modeDisabled(html), false, 'error MUST be clickable to retry');
  }
});

test('T4-3 our own transport disables the button (no double start)', () => {
  assert.equal(modeDisabled(render({ phase: 'live', characterId: X })), true);
  assert.equal(modeDisabled(render({ phase: 'connecting', characterId: X })), true);
});

test('T4-4 the frozen predicate is spelled verbatim (35 §2.5 rule 6)', () => {
  assert.match(source, /disabled=\{callActive && call\.characterId === characterId\}/);
  assert.doesNotMatch(source, /disabled=\{callActive\}/);
});

test('T4b a foreign call MUST NOT leave the label or the text-mode gates on (S-7/S-8)', () => {
  const html = render({ phase: 'live', characterId: OTHER });
  assert.equal(modeLabel(html), 'Start a call', 'the label MUST NOT say "On a call" for a foreign call');
  // The render-phase mirror is what the eight text-mode gates read; assert the
  // DEFINITION is narrowed, not just the use site (冻结 7b).
  assert.match(source, /const callActive = callTransporting && call\.characterId === characterId;/);
});

test('T4c the paper subtitles are rendered by the shared component (A9)', () => {
  assert.match(source, /<LiveCallTranscript/);
  // `.call-stage__transcript` now travels as the component's `className` — it is
  // still in the source, so the judge is "inside the component tag", never
  // "absent from the file" (31 §6.3 A9).
  const tag = source.match(/<LiveCallTranscript[\s\S]*?\/>/)?.[0] ?? '';
  assert.match(tag, /className="call-stage__transcript"/, 'the host layout class MUST ride the component');
  // The status bar and its hang-up stay in the host (31 §3.4).
  assert.match(source, /className="call-bar"/);
  assert.match(source, /className="call-hangup"/);
});
