import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { MoveCharacterDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `move_to` — walk a character into a scene (doc-tools/05 §2.2).
 *
 * The action lives in `packages/shared/src/actions/move-to.ts`, so the player's
 * UI and both agent processes run ONE presence implementation (doc-20 §12).
 * This file is only the pi-rp wrapper: it has no business rule of its own
 * (00 §8).
 */
export const moveToTool = defineTool({
  name: 'move_to',
  label: 'Move To',
  description:
    'Move a character presence to a scene. destination may be a scene directory ' +
    '(world/baker-street), an entity path in the current scene, or an entity path in ' +
    'another scene (the engine derives its layer). Use `near` to make them walk up to a ' +
    'specific object. Writers must name `character`; a character defaults to moving itself. ' +
    'This only moves their presence on the canvas \u2014 it never moves files and never starts ' +
    'a character process.',
  parameters: Type.Object(
    {
      character: Type.Optional(
        Type.String({
          description: 'Character id, e.g. "watson". Omit to move yourself (character agents only).',
        })
      ),
      destination: Type.String({
        description:
          'A scene directory ("world/baker-street") or an entity path ("world/baker-street/fireplace.md").',
      }),
      near: Type.Optional(
        Type.String({
          description:
            'An entity path in the destination scene to stand next to, e.g. "world/baker-street/fireplace.md".',
        })
      ),
    },
    { additionalProperties: false }
  ),
  promptSnippet:
    'move_to(character?, destination, near?) \u2014 walk a character into a scene, next to an object or into a free spot',
  promptGuidelines: [
    'Use move_to when a character enters a scene or crosses to another one; never move a character with move (move is for object files).',
    'Use move_to with `near` to stage a character beside the object they are talking about.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).moveCharacter({
        character: params.character,
        destination: params.destination,
        near: params.near,
      });
      return ok(result as { text: string; details: MoveCharacterDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
