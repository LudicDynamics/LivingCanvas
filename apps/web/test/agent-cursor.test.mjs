// Writer pointer pure-function assertions (lib/agent-cursor.ts). Same jiti
// bootstrap as ghost.test.mjs. Run: node --test apps/web/test/agent-cursor.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

let mod = null;
// The pointer tag reuses the activity copy (AgentCursorLayer.tsx:183), so the
// memory assertions read the same label the player sees.
let activityLabel = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/agent-cursor.ts');
  ({ activityLabel } = await jiti.import('../src/lib/agent-activity.ts'));
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping agent-cursor group:', err?.message ?? err);
}

const skip = mod && activityLabel ? false : 'jiti or pi-rp submodule unavailable';
const {
  normalizeToolPath, cursorPathFromArgs, operationForTool, resolveCursorTarget, cursorSubject,
  applyToolStart, applyToolEnd, applyIdle, pruneCursors, CURSOR_IDLE_HIDE_MS, CURSOR_STALE_MS,
  applyDialogue, replayIndexAt, replayDurationMs, CURSOR_REPLAY_STEP_MS,
} = mod ?? {};

const MAP_ITEMS = [
  { path: 'world/opening.md', kind: 'note', frontmatter: null },
  { path: 'world/abandoned-harbor/README.md', kind: 'gate', frontmatter: { type: 'readme' } },
  { path: 'world/lighthouse/README.md', kind: 'gate', frontmatter: { type: 'readme' } },
  { path: 'world/lighthouse/top/README.md', kind: 'gate', frontmatter: { type: 'readme' } },
];

test('AC1 normalizeToolPath trims ./, backslashes, duplicate and trailing slashes', { skip }, () => {
  assert.equal(normalizeToolPath('./world\\harbor//a.md/'), 'world/harbor/a.md');
  assert.equal(normalizeToolPath('.'), undefined);
  assert.equal(normalizeToolPath(''), undefined);
  assert.equal(normalizeToolPath(42), undefined);
});

test('AC2 cursorPathFromArgs prefers path, then move endpoints, then a layer folder', { skip }, () => {
  assert.equal(cursorPathFromArgs({ path: 'world/a.md', to: 'x' }), 'world/a.md');
  assert.equal(cursorPathFromArgs({ from: 'world/a.md', to: 'world/b' }), 'world/a.md');
  assert.equal(cursorPathFromArgs({ layer: 'map' }), 'world');
  assert.equal(cursorPathFromArgs({ layer: 'world/harbor' }), 'world/harbor');
  assert.equal(cursorPathFromArgs({ command: 'ls' }), undefined);
  assert.equal(cursorPathFromArgs(null), undefined);
});

test('AC3 operationForTool maps reads, browses, writes; unknown is other', { skip }, () => {
  assert.equal(operationForTool('read'), 'read');
  assert.equal(operationForTool('ls'), 'look');
  assert.equal(operationForTool('chalk'), 'write');
  assert.equal(operationForTool('edit'), 'edit');
  assert.equal(operationForTool('bash'), 'other');
});

// the design notes — all 12 memory tools collapse to `memory`, and
// the tag never shows a memory object: the `memory` copy has no `{subject}` slot.
test('AC3b all 12 memory tools map to memory; the tag shows no memory object', { skip }, () => {
  const MEMORY_TOOLS = [
    'recall', 'retrieve', 'memorize', 'revise', 'forget', 'relocate',
    'associate', 'trigger', 'consolidate', 'retrace', 'set_time', 'awaken',
  ];
  const REAL_ARGS = {
    recall: { uri: 'core://locations/work/admin_desk' },
    retrieve: { query: 'secret' },
    memorize: { uri: 'core://x', content: 'PRIVATE' },
    revise: { uri: 'core://x', old_text: 'a', new_text: 'b' },
    forget: { target: 'core://locations/work/admin_desk' },
    relocate: { uri: 'core://x', to: 'core://y/z' },
    associate: { target_uri: 'core://a', new_uri: 'core://b' },
    trigger: { uri: 'core://x', add: ['k'] },
    consolidate: { target_uri: 'core://t', source_uris: ['core://a'], content: 'X' },
    retrace: { uri: 'core://x' },
    set_time: {},
    awaken: {},
  };
  const t = (key) => key;
  for (const tool of MEMORY_TOOLS) {
    assert.equal(operationForTool(tool), 'memory', `${tool} → memory`);
    // Path resolution is NOT blocked (forget.target / relocate.to are generic
    // PATH_FIELDS) — what protects the player is the copy's missing {subject}:
    // `with === without`, so a resolved subject is never interpolated.
    const label = activityLabel(
      { operation: operationForTool(tool), state: 'running', subject: cursorSubject(cursorPathFromArgs(REAL_ARGS[tool], tool)) },
      t,
    );
    assert.equal(label, 'Remembering…', `${tool} renders a bare tag`);
  }
  assert.equal(operationForTool('memory'), 'other', 'the raw word is not a tool name');
});

test('AC4 a card on this canvas wins, including absolute and extension-less paths', { skip }, () => {
  assert.deepEqual(resolveCursorTarget('world/opening.md', MAP_ITEMS, 'map'), { kind: 'card', path: 'world/opening.md' });
  assert.deepEqual(resolveCursorTarget('/Users/x/worlds/w1/world/opening.md', MAP_ITEMS, 'map'), { kind: 'card', path: 'world/opening.md' });
  assert.deepEqual(resolveCursorTarget('world/opening', MAP_ITEMS, 'map'), { kind: 'card', path: 'world/opening.md' });
});

test('AC5 a file or folder under a child scene lands on its gate, deepest gate first', { skip }, () => {
  assert.deepEqual(resolveCursorTarget('world/abandoned-harbor/opening.md', MAP_ITEMS, 'map'), { kind: 'gate', path: 'world/abandoned-harbor/README.md' });
  assert.deepEqual(resolveCursorTarget('world/abandoned-harbor', MAP_ITEMS, 'map'), { kind: 'gate', path: 'world/abandoned-harbor/README.md' });
  assert.deepEqual(resolveCursorTarget('world/lighthouse/top/lamp.md', MAP_ITEMS, 'map'), { kind: 'gate', path: 'world/lighthouse/top/README.md' });
});

test('AC6 this layer folder or a not-yet-landed file is the canvas; other roots are elsewhere', { skip }, () => {
  assert.deepEqual(resolveCursorTarget('world', MAP_ITEMS, 'map'), { kind: 'layer' });
  assert.deepEqual(resolveCursorTarget('world/new-card.md', MAP_ITEMS, 'map'), { kind: 'layer' });
  assert.deepEqual(resolveCursorTarget('characters/old-sailor/README.md', MAP_ITEMS, 'map'), { kind: 'elsewhere' });
  const harbor = [{ path: 'world/abandoned-harbor/opening.md', kind: 'note', frontmatter: null }];
  assert.deepEqual(resolveCursorTarget('world/abandoned-harbor/new.md', harbor, 'world/abandoned-harbor'), { kind: 'layer' });
  assert.deepEqual(resolveCursorTarget('world/other.md', harbor, 'world/abandoned-harbor'), { kind: 'elsewhere' });
});

test('AC7 an authored gate uses its frontmatter target', { skip }, () => {
  const items = [{ path: 'world/door.md', kind: 'gate', frontmatter: { type: 'gate', target: 'world/cellar' } }];
  assert.deepEqual(resolveCursorTarget('world/cellar/barrel.md', items, 'map'), { kind: 'gate', path: 'world/door.md' });
});

test('AC8 cursorSubject shows a file name, a README as its folder', { skip }, () => {
  assert.equal(cursorSubject('world/opening.md'), 'opening');
  assert.equal(cursorSubject('world/abandoned-harbor/README.md'), 'abandoned-harbor');
  assert.equal(cursorSubject('world/abandoned-harbor'), 'abandoned-harbor');
  assert.equal(cursorSubject(undefined), undefined);
});

test('AC9 reducers: unowned frame dropped, start → end → idle → pruned; stale terminal ignored', { skip }, () => {
  let map = new Map();
  map = applyToolStart(map, { source: 'character', toolCallId: 'c1', toolName: 'read', args: { path: 'a.md' } }, 0);
  assert.equal(map.size, 0);

  map = applyToolStart(map, { source: 'writer', toolCallId: 't1', toolName: 'read', args: { path: 'world/opening.md' } }, 0);
  assert.equal(map.get('writer').state, 'running');
  assert.equal(map.get('writer').operation, 'read');

  // A path-less browse keeps pointing where the writer was.
  map = applyToolStart(map, { source: 'writer', toolCallId: 't2', toolName: 'bash', args: { command: 'ls' } }, 10);
  assert.equal(map.get('writer').path, 'world/opening.md');

  const same = applyToolEnd(map, { source: 'writer', toolCallId: 't1', isError: false }, 20);
  assert.equal(same, map, 'late terminal of an older call is ignored');

  map = applyToolEnd(map, { source: 'writer', toolCallId: 't2', isError: true }, 20);
  assert.equal(map.get('writer').state, 'error');

  map = applyIdle(map, 'writer', 30);
  assert.equal(map.get('writer').idle, true);
  assert.equal(pruneCursors(map, 30 + CURSOR_IDLE_HIDE_MS - 1), map);
  assert.equal(pruneCursors(map, 30 + CURSOR_IDLE_HIDE_MS).size, 0);
});

test('AC11 the pointer is unmounted only after the CSS linger + fade has run', { skip }, async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../src/components/canvas/agent-cursor.css', import.meta.url), 'utf8');
  const ms = (name) => Number(new RegExp(`--agent-cursor-${name}:\\s*(\\d+)ms`).exec(css)?.[1]);
  const hold = ms('hold');
  const fade = ms('fade');
  assert.ok(hold > 0 && fade > 0, 'hold and fade are declared in ms');
  assert.ok(CURSOR_IDLE_HIDE_MS >= hold + fade, `${CURSOR_IDLE_HIDE_MS} >= ${hold} + ${fade}`);
  assert.doesNotMatch(css, /agent-cursor-enter[^;]*\bboth\b/, 'enter animation must not pin opacity');
});

test('AC12 character place args: use_item_on aims at the target, move_to at near / the destination scene', { skip }, () => {
  assert.equal(cursorPathFromArgs({ item: 'player/key.md', target: 'world/door.md' }, 'use_item_on'), 'world/door.md');
  assert.equal(cursorPathFromArgs({ item: 'player/key.md' }, 'use_item_on'), 'player/key.md');
  assert.equal(cursorPathFromArgs({ destination: 'world/harbor', near: 'world/harbor/boat.md' }, 'move_to'), 'world/harbor/boat.md');
  assert.equal(cursorPathFromArgs({ destination: 'map' }, 'move_to'), 'world');
  assert.equal(cursorPathFromArgs({ path: ['world/a.md', 'world/b.md'] }, 'look_at'), 'world/a.md');
});

test('AC13 a character frame needs its id; a path-less act points at the character itself', { skip }, () => {
  let map = applyToolStart(new Map(), { source: 'character', characterId: 'watson', toolCallId: 'c1', toolName: 'set_following', args: { following: true } }, 0);
  const c = map.get('character:watson');
  assert.equal(c.characterId, 'watson');
  assert.equal(c.self, true);
  assert.equal(c.mode, 'live');
  map = applyToolStart(map, { source: 'character', characterId: 'bad:id', toolCallId: 'c2', toolName: 'read', args: {} }, 1);
  assert.equal(map.size, 1, 'an invalid character id drives nothing');
});

test('AC14 in its dialogue a character is recorded, replayed on close, then idles', { skip }, () => {
  const frame = (id, path, tool = 'look_at') => ({ source: 'character', characterId: 'watson', toolCallId: id, toolName: tool, args: { path } });
  let map = applyDialogue(new Map(), 'watson', 0);
  map = applyToolStart(map, frame('c1', 'world/opening.md'), 1, 'watson');
  map = applyToolEnd(map, { source: 'character', characterId: 'watson', toolCallId: 'c1', isError: false }, 2);
  map = applyToolStart(map, frame('c2', 'world/door.md', 'use_item_on'), 3, 'watson');
  map = applyToolEnd(map, { source: 'character', characterId: 'watson', toolCallId: 'c2', isError: true }, 4);
  let c = map.get('character:watson');
  assert.equal(c.mode, 'deferred');
  assert.deepEqual(c.trail.map((s) => [s.toolCallId, s.state]), [['c1', 'ok'], ['c2', 'error']]);

  // Idle and the stale sweep never end a deferred pointer.
  assert.equal(applyIdle(map, 'character:watson', 5), map);
  assert.equal(pruneCursors(map, CURSOR_STALE_MS * 10), map);

  map = applyDialogue(map, null, 100);
  c = map.get('character:watson');
  assert.equal(c.mode, 'replay');
  assert.equal(replayIndexAt(c, 0), -1, 'starts at the avatar');
  assert.equal(replayIndexAt(c, CURSOR_REPLAY_STEP_MS), 0);
  assert.equal(replayIndexAt(c, CURSOR_REPLAY_STEP_MS * 10), c.trail.length, 'ends back home');

  const end = 100 + replayDurationMs(c);
  assert.equal(pruneCursors(map, end - 1), map);
  map = pruneCursors(map, end);
  assert.equal(map.get('character:watson').idle, true);
  assert.equal(pruneCursors(map, end + CURSOR_IDLE_HIDE_MS).size, 0);
});

test('AC15 a dialogue with no recorded act is dropped on close; the writer ignores dialogues', { skip }, () => {
  let map = applyDialogue(new Map(), 'watson', 0);
  map = applyToolStart(map, { source: 'writer', toolCallId: 'w1', toolName: 'read', args: { path: 'world/a.md' } }, 1, 'watson');
  assert.equal(map.get('writer').mode, 'live');
  map = applyToolStart(map, { source: 'character', characterId: 'watson', toolCallId: 'c1', toolName: 'read', args: { path: 'x.md' } }, 2, 'watson');
  map = applyDialogue(map, 'holmes', 3);
  assert.equal(map.get('character:watson').mode, 'replay', 'switching dialogues replays the previous one');
  const empty = applyDialogue(applyDialogue(new Map([['character:holmes', { ...map.get('character:watson'), agentId: 'character:holmes', characterId: 'holmes', mode: 'live', trail: [] }]]), 'holmes', 4), null, 5);
  assert.equal(empty.has('character:holmes'), false);
});

test('AC10 a silent running pointer goes idle after the stale window', { skip }, () => {
  const map = applyToolStart(new Map(), { source: 'writer', toolCallId: 't1', toolName: 'read', args: { path: 'x.md' } }, 0);
  const next = pruneCursors(map, CURSOR_STALE_MS);
  assert.equal(next.get('writer').idle, true);
});
