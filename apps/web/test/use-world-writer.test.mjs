import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const useWorld = await readFile(new URL('../src/state/useWorld.ts', import.meta.url), 'utf8');
const settings = await readFile(new URL('../src/components/AgentSettings.tsx', import.meta.url), 'utf8');

test('writer prompts can target the active projection layer without a second seam', () => {
  assert.match(useWorld, /sendToWriter\(text: string, layerOverride\?: string\): WriterPromptAcceptance/);
  assert.match(useWorld, /const targetLayer = [\s\S]*?layerRef\.current/);
  assert.match(useWorld, /type: 'writer_prompt',[\s\S]*?layer: targetLayer/);
});

test('writer progress remains canonical and Agents does not synthesize REST busy frames', () => {
  assert.match(useWorld, /acceptWriterFrame\(msg\)/);
  assert.doesNotMatch(useWorld, /airp:agent-frame/);
  assert.doesNotMatch(settings, /airp:agent-frame/);
  assert.doesNotMatch(settings, /status\.busy/);
});
