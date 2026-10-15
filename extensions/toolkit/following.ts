import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { SetFollowingDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `set_following` — start or stop a character travelling with the player
 * (doc-tools/05 §2.2).
 *
 * The action lives in `packages/shared/src/actions/following.ts`, shared with
 * the player's `POST /api/following` (doc-20 §12). File name is `following.ts`
 * per doc-tools/12 §2.2 (REVIEW M-2). This file is only the wrapper.
 */
export const setFollowingTool = defineTool({
  name: 'set_following',
  label: 'Set Following',
  description:
    'Turn a character\u2019s "follows you" state on or off. A following character travels with ' +
    'the player: when the player enters another scene, the character\u2019s presence moves to ' +
    'that scene too. Following is a runtime state on the canvas \u2014 it never moves files and ' +
    'never starts a character process. Writers must name `character`.',
  parameters: Type.Object(
    {
      character: Type.Optional(
        Type.String({
          description:
            'Character id, e.g. "watson". Omit to set your own state (character agents only).',
        })
      ),
      following: Type.Boolean({
        description: 'true = start following the player, false = stop.',
      }),
    },
    { additionalProperties: false }
  ),
  promptSnippet:
    'set_following(character?, following) \u2014 start or stop a character travelling with the player',
  promptGuidelines: [
    'Use set_following to record that a character agreed to come along (true) or left the party (false).',
    'Use move_to to place a character in a scene; set_following only flips the follow flag.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).setFollowing({
        character: params.character,
        following: params.following,
      });
      return ok(result as { text: string; details: SetFollowingDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
