import { readFileSync } from 'node:fs';
import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  AGENT_ROLE_ENV,
  ActionError,
  type CharacterPresetTemplate,
} from '../../packages/shared/dist/index.js';
import { agentActor } from './actor.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

function loadPlatformCharacterPreset(): CharacterPresetTemplate {
  const source = new URL('../../presets/character.json', import.meta.url);
  return structuredClone(JSON.parse(readFileSync(source, 'utf8')) as CharacterPresetTemplate);
}

function isExplicitWriterProcess(): boolean {
  return process.env[AGENT_ROLE_ENV] === 'writer' &&
    process.env.AIRP_AGENT_SCOPE === 'writer-top-level' &&
    agentActor().type === 'writer';
}

export const createCharTool: ToolDefinition = defineTool({
  name: 'create_char',
  label: 'Create Character',
  description: 'Writer-only: create a character from a prepared avatar and profile files.',
  parameters: Type.Object({
    id: Type.String({ description: 'ASCII lower-kebab-case character id.' }),
    name: Type.String({ description: 'Free-form prose display name.' }),
    desc: Type.String({ description: 'README.md body.' }),
    avatar: Type.String({ description: 'Existing assets/** or .airpworld/assets/** image path.' }),
    identity: Type.Optional(Type.String()),
    personality: Type.Optional(Type.String()),
    memory: Type.Optional(Type.String()),
    voice: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
  promptSnippet: 'create_char({id, name, desc, avatar, identity, personality, memory, voice}) — optional properties may be omitted; prepare avatar first',
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    if (!isExplicitWriterProcess()) {
      return fail(new ActionError({
        code: 'unsupported',
        message: 'create_char requires AIRP_AGENT_ROLE=writer and AIRP_AGENT_SCOPE=writer-top-level.',
      }));
    }
    try {
      return ok(await getActionService(ctx).createChar({
        input: params,
        platformPreset: loadPlatformCharacterPreset(),
      }));
    } catch (err) {
      return fail(err);
    }
  },
});
