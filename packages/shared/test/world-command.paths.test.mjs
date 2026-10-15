/**
 * `07 §2.1` N4 / N5: the write-path classifier's 11 frozen samples, and the
 * byte-level equivalence with `01`'s `commandIdOfPath`.
 *
 * Imports the BUILT dist, so `npx tsc -p packages/shared/tsconfig.json` must
 * have run first (`packages/shared/test/*.test.mjs` convention).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyWorldWritePath,
  writeGateReason,
  MAX_REASON_DIAGNOSTICS,
  MAX_REASON_CHARS,
  COMMAND_FILE_SOFT_HINT_CHARS,
} from '../dist/commands/paths.js';
// Also reachable from the barrel once `index.ts` re-exports `paths.js` (07 §8.2).
import { commandIdOfPath } from '../dist/index.js';
import { isHtmlPath } from '../dist/rules/html-head.js';

/** `07 §2.1`'s table, verbatim (input → expected target). */
const SAMPLES = [
  ['world/london-map/01.md', { kind: 'entity' }],
  ['player/brass-key.md', { kind: 'entity' }],
  ['characters/watson/memory.md', { kind: 'entity' }],
  ['command/investigate-clue.yaml', { kind: 'command', id: 'investigate-clue' }],
  ['command/investigate-clue.yml', { kind: 'rejected', code: 'command_must_be_yaml' }],
  ['command/investigate-clue.md', { kind: 'rejected', code: 'command_must_be_yaml' }],
  ['command/sub/x.yaml', { kind: 'rejected', code: 'command_must_be_flat' }],
  ['command/Bad_Id.yaml', { kind: 'rejected', code: 'command_id_invalid' }],
  ['command/', { kind: 'rejected', code: 'command_must_be_yaml' }],
  ['notes/x.md', { kind: 'rejected', code: 'not_a_writable_root' }],
  ['world/london-map/01.txt', { kind: 'rejected', code: 'entity_must_be_md' }],
];

test('N4: all 11 `07 §2.1` samples classify as the table says', () => {
  for (const [input, expected] of SAMPLES) {
    assert.deepEqual(classifyWorldWritePath(input), expected, input);
  }
});

/** Boundary cases beyond the table — both directions of the equivalence. */
const EXTRA = [
  // `command/` only admits a well-formed id: regex start, hyphens, 48-char cap.
  'command/a.yaml',
  'command/0.yaml',
  'command/-lead.yaml',
  'command/Upper.yaml',
  'command/under_score.yaml',
  'command/a-b-c.yaml',
  `command/${'a'.repeat(48)}.yaml`,
  `command/${'a'.repeat(49)}.yaml`,
  // Near-misses on the dir: prefix sharing, casing, nesting, absolute-ish.
  'commands/x.yaml',
  'Command/x.yaml',
  'command/sub/deep/x.yaml',
  'world/command/x.yaml',
  '/command/x.yaml',
  'command/x.yaml/extra',
  'command/.yaml',
  'command/x.YAML',
  'command/x.yaml ',
  // Content roots: exact prefix match only, `.md` only.
  'worldfile/01.md',
  'world/01.md',
  'world/01.MD',
  'world/nested/deep/01.md',
  'player/01.txt',
  'characters/watson/memory.markdown',
  'characters/',
  '',
  'README.md',
  '../command/x.yaml',
  './command/x.yaml',
];

test('N5: `kind === "command"` ⟺ `commandIdOfPath !== null`, and ids match byte for byte', () => {
  for (const file of [...SAMPLES.map(([f]) => f), ...EXTRA]) {
    const target = classifyWorldWritePath(file);
    const id = commandIdOfPath(file);
    const isCommand = target.kind === 'command';
    assert.equal(isCommand, id !== null, `divergence at ${JSON.stringify(file)}`);
    if (isCommand && id !== null) assert.equal(target.id, id, file);
  }
});

test('writeGateReason: every code yields a non-empty reason with no unfilled placeholder', () => {
  const codes = [
    'not_a_writable_root',
    'entity_must_be_md',
    'command_must_be_yaml',
    'command_must_be_flat',
    'command_id_invalid',
  ];
  for (const code of codes) {
    for (const file of ['', 'world/x.txt', 'command/sub/x.yaml']) {
      const reason = writeGateReason(code, file);
      assert.ok(reason.length > 0, code);
      assert.ok(!reason.includes('undefined'), `${code}: ${reason}`);
      assert.ok(!reason.includes('  '), `${code} has a double space: ${JSON.stringify(reason)}`);
      // R1: the first line MUST say nothing was written (07 §2.3).
      assert.match(reason.split('\n')[0], /NOT written|Nothing was written/, code);
    }
  }
});

test('the three §2.4 constants are the frozen values', () => {
  assert.equal(MAX_REASON_DIAGNOSTICS, 8);
  assert.equal(MAX_REASON_CHARS, 2400);
  assert.equal(COMMAND_FILE_SOFT_HINT_CHARS, 4000);
});

/**
 * the design notes V4 — a BIDIRECTIONAL equality, never a union.
 *
 * The corpus carries both failure directions: paths where `isHtmlPath` is true
 * but the root is not writable (`command/x.html`, `html/x.html`), and paths
 * under a content root that are not `.html` (`world/x.htm`). A union assertion
 * would absorb all of them.
 */
test('V4: `kind === "html"` ⟺ `isHtmlPath(f)` AND `f` is under a content root', () => {
  const CORPUS = [
    'world/a/x.html', 'world/a/b/c/x.HTML', 'world/A/x.Html',
    'player/x.html', 'characters/e/x.html', 'characters/e/deep/x.html',
    'world/x.html.md', 'world/x.md.html', 'world/README.html',
    'command/x.html', 'html/x.html', 'assets/x.html', '.airpworld/assets/x.html',
    'world/x.htm', 'world/x.txt', 'world/x.html/', 'world/', '', 'README.md',
    'world/a/x.md', 'command/x.yaml',
  ];
  for (const f of CORPUS) {
    const isHtml = classifyWorldWritePath(f).kind === 'html';
    const expected =
      isHtmlPath(f) && ['world/', 'player/', 'characters/'].some((p) => f.startsWith(p));
    assert.equal(isHtml, expected, f);
  }
});

/** the design notes — three paths OPEN, the rest HOLD byte-for-byte. */
test('§6.7: `.html` opens under the three content roots; nothing else moves', () => {
  assert.deepEqual(classifyWorldWritePath('world/a/x.html'), { kind: 'html' });
  assert.deepEqual(classifyWorldWritePath('characters/e/x.html'), { kind: 'html' });
  assert.deepEqual(classifyWorldWritePath('player/x.html'), { kind: 'html' });
  // MUST NOT relax:
  assert.deepEqual(classifyWorldWritePath('world/a/x.png'), { kind: 'rejected', code: 'entity_must_be_md' });
  assert.deepEqual(classifyWorldWritePath('world/a/x.htm'), { kind: 'rejected', code: 'entity_must_be_md' });
  assert.deepEqual(classifyWorldWritePath('.airpworld/assets/x.html'), { kind: 'rejected', code: 'not_a_writable_root' });
  assert.deepEqual(classifyWorldWritePath('html/x.html'), { kind: 'rejected', code: 'not_a_writable_root' });
  // MUST NOT move:
  assert.deepEqual(classifyWorldWritePath('world/a/x.md'), { kind: 'entity' });
  assert.deepEqual(classifyWorldWritePath('world/a/x.html.md'), { kind: 'entity' });
  assert.deepEqual(classifyWorldWritePath('command/x.yaml'), { kind: 'command', id: 'x' });
  assert.deepEqual(classifyWorldWritePath('X.MD'), { kind: 'rejected', code: 'not_a_writable_root' });
});

/** The `.md` gate's copy now names the page card too. */
test('entity_must_be_md copy names both writable forms', () => {
  const reason = writeGateReason('entity_must_be_md', 'world/a/x.png');
  assert.match(reason, /\.md entity or a self-contained \.html page/);
  assert.doesNotMatch(reason, /must be Markdown/);
});
