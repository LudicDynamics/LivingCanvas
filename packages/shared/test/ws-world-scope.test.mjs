import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWorldScopedCommand, WS_COMMANDS, worldScopedCommandMatchesSave } from '../dist/protocol/ws.js';

test('every world command is classified for save-root enforcement', () => {
  assert.deepEqual(WS_COMMANDS, [
    'writer_prompt', 'airp_init', 'writer_abort', 'abort',
    'character_start', 'character_prompt', 'character_abort', 'character_stop',
    'character_talk_end',
  ]);
  for (const command of WS_COMMANDS) assert.equal(isWorldScopedCommand(command), true);
  assert.equal(isWorldScopedCommand('connected'), false);
  assert.equal(isWorldScopedCommand('world_event'), false);
  assert.equal(isWorldScopedCommand(null), false);
});

test('a command captured in save A has no authorized dispatch while save B is selected', () => {
  let dispatched = 0;
  const dispatchIfCurrent = (frame, activeSavePath) => {
    if (!worldScopedCommandMatchesSave(frame, activeSavePath, () => true)) return;
    dispatched += 1;
  };

  dispatchIfCurrent({ type: 'character_prompt', characterId: 'vera', savePath: '/saves/a' }, '/saves/b');
  dispatchIfCurrent({ type: 'writer_prompt', message: 'act', savePath: '/saves/b' }, '/saves/b');
  assert.equal(dispatched, 1, 'only the B-scoped command may reach the side-effecting dispatcher');
  assert.equal(
    worldScopedCommandMatchesSave({ type: 'writer_prompt', message: 'missing path' }, '/saves/b', () => true),
    false,
    'a missing identity is never filled from the current selection',
  );
  assert.equal(
    worldScopedCommandMatchesSave({ type: 'writer_prompt', savePath: '/saves/b' }, '/saves/b', () => false),
    false,
    'a path that is no longer the lifecycle root is rejected',
  );
});
