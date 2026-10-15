import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { EditCharacterConfigDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

export const editCharacterConfigTool = defineTool({
  name: 'edit_character_config',
  label: 'Edit character configuration',
  description:
    'Maintain one registered character root configuration file through the guarded configuration action. ' +
    'Characters may edit only their own memory.md; the top-level Writer may edit any registered character. ' +
    'An initialization subagent may only CREATE a missing configuration file, never rewrite an existing one. ' +
    'This is not a general file-writing tool and cannot move or delete configuration files.',
  parameters: Type.Object(
    {
      characterId: Type.String({ description: 'Stable lowercase kebab-case character id.' }),
      file: Type.Union([
        Type.Literal('README.md'),
        Type.Literal('identity.md'),
        Type.Literal('personality.md'),
        Type.Literal('memory.md'),
      ]),
      content: Type.String({ description: 'Replacement or appended configuration Markdown body.' }),
      mode: Type.Union([Type.Literal('replace'), Type.Literal('append')]),
    },
    { additionalProperties: false },
  ),
  promptSnippet: 'edit_character_config(characterId, file, content, mode) — guarded profile maintenance',
  promptGuidelines: [
    'Use only for explicit configuration maintenance; lived traces belong in ordinary character nook files.',
    'A Character may edit only its own memory.md. A Writer may edit any manifest-registered character configuration.',
    'During nook initialization use this tool to create the missing README.md; native write/edit cannot touch configuration files.',
    'Never use this tool to overwrite an existing configuration file, and never use move or delete on the four root files.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).editCharacterConfig(params);
      return ok(result as { text: string; details: EditCharacterConfigDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
