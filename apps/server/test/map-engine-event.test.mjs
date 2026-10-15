/**
 * the design notes — `mapEngineEvent` frame-mapping acceptance tests.
 *
 * The function is deliberately pure (no I/O, no WS), so each case builds a
 * `JsonAgentSessionEvent` literal and asserts the frames. `timestamp` is added
 * by `push` and is the only time dependency, so assertions ignore it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import fs from 'node:fs';
import { mapEngineEvent, messageText } from '../dist/engine/event-bridge.js';

/** Strip the broadcast timestamp so a frame compares structurally. */
function frames(
  source,
  event,
  args = new Map(),
  characterId = undefined,
  buf = new Map(),
  turnId = `orphan:${source}`,
  projector = undefined,
  savePath = undefined,
) {
  return mapEngineEvent(source, event, args, characterId, buf, turnId, projector, savePath)
    .map(({ timestamp: _t, ...rest }) => rest);
}

test('chalk_landed reads details.path (the frozen shape) and result.path (legacy)', () => {
  const end = (result, args) => {
    const toolArgs = new Map([['c1', args]]);
    return frames('writer', {
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'chalk',
      result,
      isError: false,
    }, toolArgs);
  };

  // details.path wins when args carry no path (chalk's default naming).
  const fromDetails = end({ content: [], details: { path: 'world/baker-street/01-x.md' } }, {});
  const landedDetails = fromDetails.find((f) => f.type === 'chalk_landed');
  assert.equal(landedDetails.path, 'world/baker-street/01-x.md');

  // Legacy flat result.path is still honoured.
  const fromFlat = end({ path: 'y.md', content: [], details: {} }, {});
  assert.equal(fromFlat.find((f) => f.type === 'chalk_landed').path, 'y.md');

  // Tool args take precedence (what `write` targeted).
  const fromArgs = end({ content: [], details: { path: 'z.md' } }, { path: 'w.md' });
  assert.equal(fromArgs.find((f) => f.type === 'chalk_landed').path, 'w.md');
});

test('canvas_patched carries layer/kind/action/links/cards from details', () => {
  const out = frames('writer', {
    type: 'tool_execution_end',
    toolCallId: 'c2',
    toolName: 'arrange',
    result: {
      content: [],
      details: {
        kind: 'cards',
        action: 'laid-out',
        layer: 'world/inn',
        cards: [{ path: 'world/inn/a.md', x: 1, y: 2, z: 3 }],
      },
    },
    isError: false,
  }, new Map());

  const patched = out.find((f) => f.type === 'canvas_patched');
  assert.equal(patched.layer, 'world/inn');
  assert.equal(patched.kind, 'cards');
  assert.equal(patched.action, 'laid-out');
  assert.deepEqual(patched.cards, [{ path: 'world/inn/a.md', x: 1, y: 2, z: 3 }]);
  assert.equal(patched.links, undefined);
});

test('roll_dice emits the dice_result PRESENTATION frame with the frozen fields', () => {
  const details = {
    path: 'world/inn/lock.md',
    name: 'Rusted Lock',
    dice: '1d100',
    desc: 'Pick the lock',
    expect: '>50',
    result: 62,
    passed: true,
    rolls: [62],
    crit: false,
    fumble: false,
    layer: 'world/inn',
  };
  const out = frames('writer', {
    type: 'tool_execution_end',
    toolCallId: 'c3',
    toolName: 'roll_dice',
    result: { content: [], details },
    isError: false,
  }, new Map());

  const dice = out.find((f) => f.type === 'dice_result');
  assert.deepEqual(dice, { type: 'dice_result', source: 'writer', ...details });
  // The event type it mirrors is NOT a frame name (00 §5.3).
  assert.equal(out.some((f) => f.type === 'roll_resolved'), false);
});

test('roll_dice failure emits no dice_result', () => {
  const out = frames('character', {
    type: 'tool_execution_end',
    toolCallId: 'c4',
    toolName: 'roll_dice',
    result: { content: [], details: {} },
    isError: true,
  }, new Map());
  assert.equal(out.some((f) => f.type === 'dice_result'), false);
});

test('show broadcasts details.frame verbatim, and warns (zero frames) when absent', () => {
  const frame = { type: 'show_frame', component: 'sparkle', target: 'world/x.md' };
  const withFrame = frames('writer', {
    type: 'tool_execution_end',
    toolCallId: 'c5',
    toolName: 'show',
    result: { content: [], details: { frame } },
    isError: false,
  }, new Map());
  assert.deepEqual(withFrame.find((f) => f.type === 'show_frame'), frame);

  const originalWarn = console.warn;
  let warned = 0;
  console.warn = () => { warned += 1; };
  try {
    const without = frames('writer', {
      type: 'tool_execution_end',
      toolCallId: 'c6',
      toolName: 'show',
      result: { content: [], details: {} },
      isError: false,
    }, new Map());
    assert.equal(without.some((f) => f.type === 'show_frame'), false);
    assert.equal(warned, 1, 'a missing frame is warned about, never faked');
  } finally {
    console.warn = originalWarn;
  }
});

test('generate_image streams progress and announces the landed asset', () => {
  const progress = frames('writer', {
    type: 'tool_execution_update',
    toolCallId: 'g1',
    toolName: 'generate_image',
    args: {},
    partialResult: { details: { stage: 'painting', elapsedMs: 4200, width: 1024, height: 1024 } },
  }, new Map());
  assert.deepEqual(progress, [
    {
      type: 'image_generation_progress',
      source: 'writer',
      toolCallId: 'g1',
      stage: 'painting',
      elapsedMs: 4200,
      width: 1024,
      height: 1024,
    },
  ]);

  const landed = frames('writer', {
    type: 'tool_execution_end',
    toolCallId: 'g1',
    toolName: 'generate_image',
    result: {
      content: [],
      details: { asset: '.airpworld/assets/gen/x.png', mimeType: 'image/png', width: 1024, height: 1024, reused: false },
    },
    isError: false,
  }, new Map());
  const img = landed.find((f) => f.type === 'image_landed');
  assert.equal(img.asset, '.airpworld/assets/gen/x.png');
  assert.equal(img.mimeType, 'image/png');
  assert.equal(img.reused, false);
});

test('a generate_image refused for billing marks its tool_end with the stop code; other failures do not', () => {
  const end = (text) => frames('character', {
    type: 'tool_execution_end', toolCallId: 'g9', toolName: 'generate_image', isError: true,
    result: { content: [{ type: 'text', text }], details: {} },
  }, new Map()).find((f) => f.type === 'tool_end');
  assert.equal(end('The image could not be paid for (HTTP 402: code=insufficient_credits; reason=claim_required).').billing, 'claim_required');
  assert.equal(end('The image could not be paid for (HTTP 429: code=quota_exceeded).').billing, 'quota_exceeded');
  assert.equal(end('The image model failed: HTTP 500.').billing, undefined);
});

test('a non-streaming tool_execution_update maps to zero frames', () => {
  const out = frames('writer', {
    type: 'tool_execution_update',
    toolCallId: 'm1',
    toolName: 'move',
    args: {},
    partialResult: {},
  }, new Map());
  assert.deepEqual(out, []);
});

test('message_update / message_end keep their existing mapping', () => {
  assert.deepEqual(
    frames('character', {
      type: 'message_update',
      usage: { input: 0, output: 0 },
      assistantMessageEvent: { type: 'text_delta', delta: 'hi' },
    }, new Map()),
    [{ type: 'character_delta', source: 'character', delta: 'hi' }]
  );

  const end = frames('writer', {
    type: 'message_end',
    message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
  }, new Map());
  assert.deepEqual(end, [{ type: 'writer_message', source: 'writer', text: 'done' }]);
  assert.equal(messageText({ content: [{ type: 'thinking', text: 'x' }, { type: 'text', text: 'y' }] }), 'y');
});

test('A1: character frames carry characterId; writer frames do not', () => {
  const delta = {
    type: 'message_update',
    usage: { input: 0, output: 0 },
    assistantMessageEvent: { type: 'text_delta', delta: 'hi' },
  };
  const idle = { type: 'agent_settled' };

  // Character source + id: every produced frame is stamped.
  assert.deepEqual(frames('character', delta, new Map(), 'nanami'), [
    { type: 'character_delta', source: 'character', delta: 'hi', characterId: 'nanami' },
  ]);
  assert.deepEqual(frames('character', idle, new Map(), 'nanami'), [
    { type: 'character_idle', source: 'character', characterId: 'nanami' },
  ]);

  // Writer source + text_delta: NO frame (the design notes — the writer's
  // narration is the chalk tool's `content`, never its text reply).
  assert.deepEqual(frames('writer', { ...delta }, new Map()), []);

  // Character source WITHOUT an id (legacy / empty clientKey): field omitted,
  // not present as '' or null — the frontend's `??` fallback depends on it.
  assert.deepEqual(frames('character', { ...delta }, new Map()), [
    { type: 'character_delta', source: 'character', delta: 'hi' },
  ]);
});

test('mapped activity and character frames retain their originating save path', () => {
  const delta = {
    type: 'message_update',
    usage: { input: 0, output: 0 },
    assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
  };
  assert.deepEqual(
    frames('character', delta, new Map(), 'nanami', new Map(), 'character:t1', undefined, '/saves/A'),
    [{
      type: 'character_delta',
      source: 'character',
      delta: 'hello',
      characterId: 'nanami',
      savePath: '/saves/A',
    }],
  );
  const activity = frames(
    'writer',
    { type: 'tool_execution_start', toolCallId: 'read-A', toolName: 'read', args: {} },
    new Map(),
    undefined,
    new Map(),
    'writer:t1',
    undefined,
    '/saves/A',
  ).find((frame) => frame.type === 'agent_activity');
  assert.equal(activity?.savePath, '/saves/A');
});

test('writer_delta comes from chalk toolcall fragments, not text_delta', () => {
  const buf = new Map();
  const delta = (d, contentIndex = 0) => ({
    type: 'message_update',
    usage: { input: 0, output: 0 },
    assistantMessageEvent: { type: 'toolcall_delta', contentIndex, delta: d },
  });
  const endCall = (name, args, id = 'tc1', contentIndex = 0) => ({
    type: 'message_update',
    usage: { input: 0, output: 0 },
    assistantMessageEvent: { type: 'toolcall_end', contentIndex, toolCall: { id, name, arguments: args } },
  });

  // Fragments accumulate; no frame until toolcall_end confirms the tool name.
  assert.deepEqual(frames('writer', delta('{"content":"The fog '), new Map(), undefined, buf), []);
  assert.deepEqual(frames('writer', delta('parts"}'), new Map(), undefined, buf), []);

  const out = frames('writer', endCall('chalk', { content: 'The fog parts' }), new Map(), undefined, buf);
  const joined = out.filter((f) => f.type === 'writer_delta').map((f) => f.delta).join('');
  assert.equal(joined, 'The fog parts');
  assert.ok(out.every((f) => f.toolCallId === 'tc1'));

  // A non-chalk tool (write also has a `content` arg) yields NO writer_delta.
  const buf2 = new Map();
  frames('writer', delta('{"path":"a.md","content":"hi"}'), new Map(), undefined, buf2);
  assert.deepEqual(frames('writer', endCall('write', { path: 'a.md', content: 'hi' }, 'tc2'), new Map(), undefined, buf2), []);
});

test('chalk delta backstop uses replacement mode when the extractor lags', () => {
  const buf = new Map();
  // A raw fragment whose decoded prefix cannot reach the authoritative content
  // (simulate a lost escape) → one final replace frame.
  frames('writer', {
    type: 'message_update', usage: { input: 0, output: 0 },
    assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 0, delta: '{"content":"par' },
  }, new Map(), undefined, buf);
  const out = frames('writer', {
    type: 'message_update', usage: { input: 0, output: 0 },
    assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: { id: 'tc9', name: 'chalk', arguments: { content: 'parts' } } },
  }, new Map(), undefined, buf);
  const replace = out.find((f) => f.mode === 'replace');
  assert.ok(replace, 'expected a replacement backstop frame');
  assert.equal(replace.delta, 'parts');
});

test('agent_activity preserves writer/character identity and terminal idempotency', async () => {
  const { ActivityProjector } = await import('../dist/engine/agent-activity.js');
  const projector = new ActivityProjector();
  const args = new Map();
  const start = {
    type: 'tool_execution_start',
    toolCallId: 'activity-1',
    toolName: 'write',
    args: { path: '/private/secret.md', content: 'do not expose' },
  };
  const end = {
    type: 'tool_execution_end',
    toolCallId: 'activity-1',
    toolName: 'write',
    result: { details: { path: '/private/secret.md' } },
    isError: false,
  };
  const started = frames('writer', start, args, undefined, new Map(), 'turn-1', projector)
    .find((frame) => frame.type === 'agent_activity');
  const completed = frames('writer', end, args, undefined, new Map(), 'turn-1', projector)
    .find((frame) => frame.type === 'agent_activity');
  assert.equal(started.source, 'writer');
  assert.equal(started.agentId, 'writer');
  assert.equal(started.phase, 'started');
  assert.equal(started.subject, 'secret');
  assert.equal(completed.activityId, started.activityId);
  assert.equal(completed.phase, 'completed');
  assert.equal(frames('writer', end, args, undefined, new Map(), 'turn-1', projector).some((frame) => frame.type === 'agent_activity'), false);
});

test('the retired custom-message activity relay no longer projects frames (engine-native agent_activity replaced it)', async () => {
  // pi-rp 36330ab: subagent activity arrives as transient `agent_activity`
  // engine events (covered in event-bridge.test.mjs). A leftover
  // `airp_agent_activity` custom message must not resurrect the old path.
  const { ActivityProjector } = await import('../dist/engine/agent-activity.js');
  const projector = new ActivityProjector();
  const message = {
    role: 'custom',
    customType: 'airp_agent_activity',
    content: JSON.stringify({
      type: 'tool_start',
      context: { source: 'functional', agentId: 'scene-init', turnId: 'functional:t1' },
      toolCallId: 'child-1',
      toolName: 'read',
      args: { path: '/private/note.md' },
    }),
  };
  const out = mapEngineEvent('writer', { type: 'message_end', message }, new Map(), undefined, new Map(), 'writer:t1', projector);
  assert.equal(out.filter((frame) => frame.type === 'agent_activity' && frame.source === 'functional').length, 0);
});

test('card_writing fires for a writer `write` and carries kind/title/layer', () => {
  const out = frames('writer', {
    type: 'tool_execution_start',
    toolCallId: 'c9',
    toolName: 'write',
    args: {
      path: 'world/baker-street/lock.md',
      content: '---\ntype: component\ncomponent: lock\ntitle: Brass Lock\n---\n\nbody\n',
    },
  });
  const frame = out.find((f) => f.type === 'card_writing');
  assert.equal(frame.source, 'writer');
  assert.equal(frame.toolCallId, 'c9');
  assert.equal(frame.kind, 'lock');
  assert.equal(frame.title, 'Brass Lock');
  assert.equal(frame.layer, 'world/baker-street');
  // The frame never carries `path` — handover is keyed on chalk_landed.path.
  assert.equal(frame.path, undefined);
});

test('card_writing survives missing frontmatter (no throw, no half frame)', () => {
  // Unparseable / absent content → kind falls back to 'note', NOT 'default'.
  const out = frames('writer', {
    type: 'tool_execution_start',
    toolCallId: 'c10',
    toolName: 'write',
    args: { path: 'world/map/note.md', content: '' },
  });
  const frame = out.find((f) => f.type === 'card_writing');
  assert.equal(frame.kind, 'note');
  assert.equal(frame.layer, 'world/map');
  // A title is never empty: entityName falls back to the basename minus `.md`.
  assert.equal(frame.title, 'note');
});

test('card_writing omits `layer` when the path has no directory (F-2)', () => {
  const out = frames('writer', {
    type: 'tool_execution_start',
    toolCallId: 'c11',
    toolName: 'write',
    args: { path: 'stray.md', content: '---\ntype: note\n---\n' },
  });
  const frame = out.find((f) => f.type === 'card_writing');
  assert.equal('layer' in frame, false);
});

test('card_writing fires only for the writer lane, never character/chalk', () => {
  const start = (source, toolName, args) => frames(source, {
    type: 'tool_execution_start',
    toolCallId: 'c12',
    toolName,
    args,
  });
  const args = { path: 'world/map/x.md', content: '---\ntype: note\n---\n' };
  assert.equal(start('writer', 'write', args).some((f) => f.type === 'card_writing'), true);
  assert.equal(start('character', 'write', args).some((f) => f.type === 'card_writing'), false);
  assert.equal(start('writer', 'chalk', args).some((f) => f.type === 'card_writing'), false);
});

test('card_writing resolves a nook path (characters/<id>/** is its own layer)', () => {
  const out = frames('writer', {
    type: 'tool_execution_start',
    toolCallId: 'c13',
    toolName: 'write',
    args: { path: 'characters/bob/photo.md', content: '---\ntype: component\ncomponent: photo\n---\n' },
  });
  const frame = out.find((f) => f.type === 'card_writing');
  assert.equal(frame.layer, 'characters/bob');
  assert.equal(frame.kind, 'photo');
});

// ── the design notes: never seat a skeleton that no layer can reclaim ──
//
// The frame carries `layer` only when the path is in SOME layer's `items`.
// `reconcileLanded` (front end, `useWorld.ts`) reclaims keyed on those paths, so a
// path that never enters `items` leaves the phantom sitting on a seat forever —
// the leak F-8/F-10 exist to prevent. Each case below is a path the writer CAN
// legally `write` but which belongs to no layer.
test('card_writing omits `layer` for player/** (bag space is not a layer)', () => {
  const out = frames('writer', {
    type: 'tool_execution_start',
    toolCallId: 'c20',
    toolName: 'write',
    args: { path: 'player/brass-key.md', content: '---\ntype: note\n---\n' },
  });
  const frame = out.find((f) => f.type === 'card_writing');
  assert.equal(frame.kind, 'note');
  assert.equal('layer' in frame, false);
});

test('card_writing omits `layer` for a character root config file', () => {
  // identity/personality/memory/README are nook CONFIGURATION, explicitly
  // excluded from the page's items by `nookCardPaths`/`characterRootConfigOf`.
  for (const name of ['identity.md', 'personality.md', 'memory.md']) {
    const out = frames('writer', {
      type: 'tool_execution_start',
      toolCallId: `c21-${name}`,
      toolName: 'write',
      args: { path: `characters/bob/${name}`, content: '---\ntype: note\n---\n' },
    });
    const frame = out.find((f) => f.type === 'card_writing');
    assert.equal('layer' in frame, false, `${name} must not seat a skeleton`);
  }
});

test('card_writing omits `layer` for a character sub-scene config at the nook root', () => {
  // Same rule, one level down: a root config of a NESTED scene is not config,
  // it is an ordinary lived trace and DOES belong to that scene's items.
  const nested = frames('writer', {
    type: 'tool_execution_start',
    toolCallId: 'c22-nested',
    toolName: 'write',
    args: { path: 'characters/bob/office/memory.md', content: '---\ntype: note\n---\n' },
  }).find((f) => f.type === 'card_writing');
  assert.equal(nested.layer, 'characters/bob/office');
});

test('card_writing keeps `layer` for the two lanes that DO have items', () => {
  // Positive control: the guard must not over-reject — both lanes below are
  // reclaimed by `reconcileLanded` today.
  const world = frames('writer', {
    type: 'tool_execution_start',
    toolCallId: 'c23-world',
    toolName: 'write',
    args: { path: 'world/baker-street/lock.md', content: '---\ntype: component\n---\n' },
  }).find((f) => f.type === 'card_writing');
  assert.equal(world.layer, 'world/baker-street');

  const nook = frames('writer', {
    type: 'tool_execution_start',
    toolCallId: 'c23-nook',
    toolName: 'write',
    args: { path: 'characters/bob/desk.md', content: '---\ntype: component\n---\n' },
  }).find((f) => f.type === 'card_writing');
  assert.equal(nook.layer, 'characters/bob');
});


// ── the design notes (M10): the `card_writing` skeleton frame for `.html` ──
//
// M10 ships ZERO source changes. `cardWritingFrame` has no `.html` branch and
// MUST NOT grow one (contract §6.6 ruling C): the kind is derived by `cardKindOf`
// → the component registry resolver (M1), which receives the FILENAME and so
// does not care that a raw `.html` has no frontmatter. These four cases are the
// mechanical evidence for that — and case 2 turns red the moment somebody
// "fixes" it with an `isHtmlPath(basename) ? 'html' : derived` guess.

test('card_writing resolves a bare .html to kind=html (via M1, not via this file)', () => {
  const out = frames('writer', {
    type: 'tool_execution_start',
    toolCallId: 'c30',
    toolName: 'write',
    args: {
      path: 'world/baker-street/custom-puzzle.html',
      content: '<!DOCTYPE html><html><head><title>Custom Puzzle</title></head></html>',
    },
  });
  const frame = out.find((f) => f.type === 'card_writing');
  assert.equal(frame.kind, 'html');
  assert.equal(frame.layer, 'world/baker-street');
  // Contract §6.6/§3.2(c): the title KEEPS the extension, matching the event's
  // `detail.name`. NOT the document's <title> (a pure frame cannot read it).
  assert.equal(frame.title, 'custom-puzzle.html');
  // No new keys, no `path` (the frame shape is a cross-end contract).
  assert.equal(frame.path, undefined);
  assert.deepEqual(Object.keys(frame).sort(), ['kind', 'layer', 'source', 'title', 'toolCallId', 'type']);
});

test('card_writing keeps a content-declared kind on a .html path (chalk stays chalk)', () => {
  // The extension is the LAST resort: `resolveComponentKind` checks chalk /
  // gate / sprite BEFORE `.html` (contract §4.2). A frame that disagreed with
  // `/api/layer` would sketch one shape and land another. (The three bare/cover
  // tiers are exactly the ones `cardWritingGuard` refuses to seat, so a frame
  // that got them wrong would be invisible anyway — but the guard must not be
  // the only thing standing between a guess and a wrong kind.)
  const declared = { chalk: 'chalk', gate: 'gate', sprite: 'sprite' };
  for (const [declaredKind, expected] of Object.entries(declared)) {
    const frame = frames('writer', {
      type: 'tool_execution_start',
      toolCallId: `c31-${declaredKind}`,
      toolName: 'write',
      args: { path: 'world/map/notes.html', content: `---\ntype: ${declaredKind}\n---\n\nline\n` },
    }).find((f) => f.type === 'card_writing');
    assert.equal(frame.kind, expected, `${declaredKind} must survive on a .html path`);
  }
  // Counter-check: a `type: note` .html — the kind the registry branch sits
  // AHEAD of — resolves to `html`, the same value `/api/layer` synthesises.
  const note = frames('writer', {
    type: 'tool_execution_start',
    toolCallId: 'c31-note',
    toolName: 'write',
    args: { path: 'world/map/notes.html', content: '---\ntype: note\n---\n' },
  }).find((f) => f.type === 'card_writing');
  assert.equal(note.kind, 'html');
});

test('card_writing seats a skeleton for characters/<id>/**/*.html (nook lane)', () => {
  const frame = frames('writer', {
    type: 'tool_execution_start',
    toolCallId: 'c32',
    toolName: 'write',
    args: { path: 'characters/elias/rough_cloud.html', content: '<html></html>' },
  }).find((f) => f.type === 'card_writing');
  assert.equal(frame.kind, 'html');
  assert.equal(frame.title, 'rough_cloud.html');
  // `characterRootConfigOf` returns null for a non-config direct child, so
  // `seatable` is true and the nook lane keeps the skeleton (contract §6.1).
  assert.equal(frame.layer, 'characters/elias');
});

test('card_writing never throws on a malformed html write (the map loop must survive)', () => {
  // `mapEngineEvent` is a synchronous map loop: one throw drops EVERY later
  // frame, not just this one (event-bridge.ts:164-166). So "no throw" is the
  // assertion — the VALUES below are the measured ones, not ideals.
  const cases = [
    [{ path: 'world/a/x.html', content: '---\n[\n---\n' }, 'html', 'x.html'],
    [{ path: 'world/.html', content: '' }, 'html', '.html'],
    [{ path: 'world/a/X.HTML', content: '<html></html>' }, 'html', 'X.HTML'],
    // No path / non-string path: `relPath` is '' → `basename` is '' → NOT an
    // html path → the md lane, whose `entityName` already returns '' here.
    // Pre-existing behaviour (verified on the UNPATCHED build): this change
    // neither introduces nor fixes the empty title.
    [{ content: '<html></html>' }, 'note', ''],
    [{ path: 42, content: { nested: true } }, 'note', ''],
  ];
  for (const [args, kind, title] of cases) {
    const frame = frames('writer', {
      type: 'tool_execution_start',
      toolCallId: 'c33',
      toolName: 'write',
      args,
    }).find((f) => f.type === 'card_writing');
    assert.ok(frame, `no frame for ${JSON.stringify(args)}`);
    assert.equal(frame.kind, kind, `kind for ${JSON.stringify(args)}`);
    assert.equal(frame.title, title, `title for ${JSON.stringify(args)}`);
  }
});

test('cardWritingFrame has NO .html branch of its own (ruling C, mechanical)', () => {
  // The behavioural cases above would go red if somebody inserted an
  // `isHtmlPath(basename) ? 'html' : derived` guess; this pins the SHAPE of the
  // fix so the intent is legible: the kind must come from `cardKindOf` (→ the
  // M1 registry branch), never from an extension guess made HERE — a guess in
  // this function cannot see `resolveComponentKind`'s chalk → gate → sprite
  // ordering, so it would silently outrank them.
  const src = fs.readFileSync(new URL('../src/engine/event-bridge.ts', import.meta.url), 'utf8');
  const start = src.indexOf('function cardWritingFrame(');
  const end = src.indexOf('function ', start + 1);
  assert.ok(start !== -1 && end !== -1 && start < end, 'cardWritingFrame moved — fix the slice bounds');
  const body = src.slice(start, end);
  assert.ok(body.includes('cardKindOf(fm, path.basename(relPath))'), 'the kind must flow from cardKindOf');
  assert.ok(!body.includes('isHtmlPath'), 'no extension guess inside cardWritingFrame (contract §6.6 ruling C)');
  assert.ok(!/\.html/i.test(body), 'no .html literal inside cardWritingFrame');
});