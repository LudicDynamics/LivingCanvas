import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActivityProjector,
  normalizeActivityOperation,
  safeActivityError,
  sanitizeActivitySubject,
} from '../dist/engine/agent-activity.js';

test('activity operation allowlist maps unknown tools to other', () => {
  assert.equal(normalizeActivityOperation('look_at'), 'look');
  assert.equal(normalizeActivityOperation('write'), 'write');
  assert.equal(normalizeActivityOperation('generate_image'), 'create');
  assert.equal(normalizeActivityOperation('some_new_tool'), 'other');
});

test('activity operation maps every memory tool to memory', () => {
  // Engine-authoritative list: vendor/pi-rp/packages/memory/src/module.ts:158-170.
  const names = [
    'recall', 'retrieve', 'memorize', 'revise', 'forget', 'relocate',
    'associate', 'trigger', 'consolidate', 'retrace', 'set_time', 'awaken',
  ];
  for (const name of names) {
    assert.equal(normalizeActivityOperation(name), 'memory', `${name} must map to memory`);
  }
  // Regression: unknown tools still fall back, and the fallback is 'other'.
  assert.equal(normalizeActivityOperation('recall_memory_v2'), 'other');
});

test('memory tool subjects never reach the wire', () => {
  // SUBJECT_FIELDS has no memory row by design: recall.uri / retrieve.keywords /
  // memorize.content would otherwise be broadcast as a chip subject.
  assert.equal(sanitizeActivitySubject({
    toolName: 'recall',
    args: { uri: 'core://locations/work/admin_desk' },
  }), undefined);
  assert.equal(sanitizeActivitySubject({
    toolName: 'memorize',
    args: { content: 'the safe is behind the painting' },
  }), undefined);
});

test('activity subject only exposes a clipped safe object name', () => {
  const subject = sanitizeActivitySubject({
    toolName: 'write',
    args: { path: '/home/user/.ssh/id_rsa', content: 'secret' },
    cwd: '/world',
  });
  assert.equal(subject, 'id_rsa');
  assert.equal(JSON.stringify(subject).includes('/home/user'), false);
  assert.equal(sanitizeActivitySubject({ toolName: 'choose', args: { name: { raw: 'secret' } } }), undefined);
});

test('activity projector emits writer and character terminal frames idempotently', () => {
  const projector = new ActivityProjector();
  const writer = { source: 'writer', agentId: 'writer', turnId: 'writer:t1' };
  const start = { type: 'tool_start', context: writer, toolCallId: 'call-1', toolName: 'write', args: { path: '/world/letter.md' } };
  const started = projector.acceptToolStart(writer, start);
  assert.equal(started.length, 1);
  assert.deepEqual(projector.acceptToolStart(writer, start), []);

  const end = { ...start, type: 'tool_end', details: { path: '/world/letter.md' }, isError: false };
  const completed = projector.acceptToolEnd(writer, end);
  assert.equal(completed[0].phase, 'completed');
  assert.deepEqual(projector.acceptToolEnd(writer, end), []);

  const character = { source: 'character', agentId: 'character:nanami', turnId: 'character:t1' };
  const open = { type: 'tool_start', context: character, toolCallId: 'c', toolName: 'read', args: { path: '/world/note.md' } };
  projector.acceptToolStart(character, open);
  const failed = projector.failTurn(character, 'timeout');
  assert.equal(failed[0].source, 'character');
  assert.equal(failed[0].agentId, 'character:nanami');
  assert.equal(failed[0].phase, 'failed');
  assert.equal(failed[0].error, 'timeout');
  assert.deepEqual(projector.failTurn(character, 'timeout'), []);
});

test('activity errors are safe enum summaries', () => {
  assert.equal(safeActivityError('Error: ENOENT /home/user/.ssh/id_rsa'), 'unknown');
  assert.equal(safeActivityError('tool_error'), 'tool_error');
  assert.equal(safeActivityError('cancelled'), 'cancelled');
});
