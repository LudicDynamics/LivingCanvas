// Nook sub-scene navigation.
//
// No jsdom here (character-rail.test.mjs:8-9): the interactive assertions
// degrade to source contracts plus browser smoke, the convention this repo
// already uses (active-projection.test.mjs:1-9).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const nook = await readFile(new URL('../src/components/nook/NookView.tsx', import.meta.url), 'utf8');
const cardRenderer = await readFile(new URL('../src/components/canvas/CardRenderer.tsx', import.meta.url), 'utf8');

test('nook-scene §N2-A26: NookView wires the door target to the scene state', () => {
  // Contract §4.6 froze both prop names.
  assert.match(nook, /scene:\s*string\s*\|\s*null/, 'NookViewProps MUST take a relative scene');
  assert.match(nook, /onEnterScene/, 'NookViewProps MUST expose onEnterScene');
  // Before the fix BOTH <Canvas> had no onEnterGate => doors were dead clicks.
  //
  // MUST anchor at line starts: the greedy `/<Canvas\b[\s\S]*?\/>/g` swallows
  // from the literal `<Canvas>` inside the JSDoc prose (NookView.tsx:32) all the
  // way to a `/>` far below, eating both real elements — it fails even on a
  // correct implementation (06 §10.1 RB1, measured: 3 matches, first 18964 chars).
  const canvases = (nook.match(/^\s*<Canvas\b[\s\S]*?^\s*\/>/gm) ?? []).filter((c) => c.includes('<Canvas'));
  assert.equal(canvases.length, 2, `expected exactly the 2 real <Canvas> elements, got ${canvases.length}`);
  for (const c of canvases) {
    assert.match(c, /onEnterGate=/, 'every NookView Canvas MUST forward onEnterGate (else doors are dead clicks)');
  }
  assert.match(nook, /fetch\(`\/api\/nook\?character=/, 'the fetch still hits the nook endpoint');
  assert.match(nook, /scene=/, 'the fetch MUST carry the scene query');
});

test('nook-scene §N2-A26b: the empty-state init prompt is gated to the ROOT scene', () => {
  // isEmpty itself is unchanged (contract §5.4: a scene with a door is not empty).
  assert.match(nook, /const isEmpty = [^\n]*items\.length === 0[^\n]*scene === null/);
  // The prompt only exists in the root scene — a sub-scene prompt would run
  // `airp_init` against the CHARACTER ROOT and furnish the wrong room.
  assert.match(nook, /isRootScene/, 'a root-scene gate MUST exist for the init prompt');
  assert.match(nook, /showInitPrompt \?/, 'the submittable prompt MUST be gated by it');
  // The empty COPY stays: a blank sub-scene must still read as blank.
  assert.match(nook, /copy\.nookEmptyTitle/, 'the empty-state copy MUST remain visible in sub-scenes');
});

test('nook-scene §N2-A30: the sub-scene README body is actually rendered (B-B4)', () => {
  // Before the fix `state.scene` had three consumers (unpack / frontmatter /
  // isEmpty) and `body` had none => walking into a written room showed a blank
  // canvas (measured 4/4 in templates/fpal/characters/elias).
  assert.match(nook, /data-nook-zone="scene-intro"/, 'a scene-intro band MUST exist');
  assert.match(nook, /MarkdownText/, 'MUST reuse the existing markdown primitive (lib/md.ts:87)');
  assert.doesNotMatch(nook, /dangerouslySetInnerHTML/, 'MUST NOT introduce raw HTML');
  // The band is not a card. Cut the tag's attribute slice first; never use any
  // "proximity" regex: `X[\s\S]{0,N}Y` reaches across `/>` and newlines into the
  // real `.object[data-path]` observer (false positive), and `X[^>]*Y` misses
  // when the attributes come in the other order (false negative).
  const band = (nook.match(/<[^>]*data-nook-zone="scene-intro"[^>]*>/) ?? [])[0] ?? '';
  assert.ok(band, 'a scene-intro band MUST exist');
  assert.doesNotMatch(band, /\bdata-path\b/, 'the band MUST NOT be a card (no data-path)');
});

test('nook-scene §N2-A31: the UNWRITTEN door copy no longer promises init (B-B3)', () => {
  // Before the fix the stub copy promised "walk in, and it will be written" — an
  // event this batch structurally cannot deliver (init targets the root only).
  assert.doesNotMatch(cardRenderer, /walk in, and it will be written/, 'no unkeepable promise');
  assert.doesNotMatch(cardRenderer, /一歩先から物語が生まれる/, 'no unkeepable promise (ja)');
});

test('nook-scene §N2-A32: App owns nookScene and resets it on exit', () => {
  assert.match(app, /useState<string \| null>\(null\)/, 'App MUST own the scene state');
  assert.match(app, /setNookScene\(null\)/, 'leaving the nook MUST reset the scene (contract §4.6)');
  assert.match(app, /scene=\{nookScene\}/, 'NookView MUST receive the relative scene');
  // Switching character never passes through null, so the explicit reset at the
  // one non-null writer is required (contract §4.6 C5).
  assert.match(app, /setNookChar\(characterId\);\s*\n\s*setNookScene\(null\)/, 'the character switch MUST reset explicitly');
});

test('nook-scene §N2-A33: the frontend uses the shared path converter, not its own split', () => {
  // Contract §5.1, the two-arg form ('' = root, null = out of tree).
  assert.match(nook, /nookScenePathOf\(\s*[^)]*,\s*[^)]*\)/, 'the two-arg form MUST be used');
  assert.doesNotMatch(nook, /nookScenePathOf\(\s*[A-Za-z_$][\w.$]*\s*\)/, 'no simple-identifier single-arg form');
  assert.doesNotMatch(nook, /scene\.split\('\/'\)\.slice|path\.slice\(.*README/, 'MUST NOT hand-roll segment splitting');
});

test('nook-scene §N2-A34: the scene reset is keyed on the character identity, not on null alone', () => {
  // The effect covers the three `setNookChar(null)` sites; the explicit call in
  // `openPrivateSpace` covers the fourth (a swap that skips null).
  assert.match(app, /useEffect\(\(\) => \{ if \(nookChar === null\) setNookScene\(null\); \}, \[nookChar\]\)/);
});

test('nook-scene §N2-A35: the shared converter is three-valued, and both falsy values are distinguished', () => {
  // `''` (this character's root) and `null` (out of this character's subtree) are
  // both falsy and mean opposite things — a truthiness check would swallow the
  // walk back to the root. The implementation MUST compare explicitly.
  assert.match(nook, /path === null/, 'the out-of-tree case MUST compare against null');
  assert.match(nook, /path === ''/, 'the legal-root case MUST compare against the empty string');
  assert.match(nook, /scene === null/, 'the relative parent walk MUST compare against null');
});

test('nook-scene §N2-A36: the i18n keys for the scene trail exist in all three tracks', async () => {
  const copy = await readFile(new URL('../src/lib/legacy-ui-copy.ts', import.meta.url), 'utf8');
  const messages = JSON.parse(await readFile(new URL('../src/lib/messages.json', import.meta.url), 'utf8'));
  for (const key of ['nookSceneTrail', 'nookSceneUp', 'nookSceneMissing']) {
    assert.match(copy, new RegExp(`^\\s+${key}: `, 'm'), `UI_COPY.en MUST carry ${key}`);
  }
  for (const value of ['Scene path inside ikigai', 'Up one scene', 'This scene is no longer there.']) {
    const entry = messages[value];
    assert.ok(entry, `messages.json MUST carry "${value}"`);
    assert.equal(typeof entry['zh-CN'], 'string', `"${value}" MUST have a zh-CN entry`);
    assert.equal(typeof entry.ja, 'string', `"${value}" MUST have a ja entry`);
  }
});
