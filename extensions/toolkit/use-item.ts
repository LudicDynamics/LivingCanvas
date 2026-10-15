import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { UseItemOnDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `use_item_on` — apply one thing to another (doc-tools/08 §2.2, §8.2).
 *
 * The action lives in `packages/shared/src/actions/use-item.ts`, shared with the
 * player's `POST /api/use-item`. The item is NOT consumed or moved: that is a
 * separate `move` (doc-tools/08 §2.2). A target responds only when its
 * registered component kind defines a handler — otherwise the attempt is still
 * recorded and the writer narrates the result on the next turn.
 */
export const useItemOnTool = defineTool({
  name: 'use_item_on',
  label: 'Use Item On',
  description:
    'Apply one item to another entity: a key to a lock, evidence to a character, a ' +
    'brush to a canvas. Records the attempt as a world event; the item is NOT consumed or moved ' +
    '(call move for that). The target reacts only if its component kind defines a handler; ' +
    'otherwise the writer narrates the outcome on the next turn.',
  parameters: Type.Object(
    {
      item: Type.String({
        description: 'World-relative path of the item, e.g. "player/copper-key.md"',
      }),
      target: Type.String({
        description:
          'World-relative path of the target entity, e.g. "world/cellar/cellar-door.md"',
      }),
    },
    { additionalProperties: false }
  ),
  promptSnippet:
    'use_item_on(item, target) — apply one entity to another (key to lock, evidence to a character)',
  promptGuidelines: [
    'Use use_item_on when one thing in the world is applied to another; use choose when a single entity offers its own public actions.',
    'use_item_on never consumes or moves the item — call move separately if the story needs the item handed over.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).useItemOn({ item: params.item, target: params.target });
      return ok(result as { text: string; details: UseItemOnDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
