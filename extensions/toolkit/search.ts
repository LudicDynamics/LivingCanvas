import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { SearchPlaceDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `search` — the writer's answer to "I search / investigate / take / loot …"
 *. The shell only forwards to the shared
 * `searchPlace` action, which lands ONE dice chalk in the layer. It never rolls
 * and never creates the found item: the player rolls, and the rolled band
 * creates the item.
 */
const Find = Type.Object(
  {
    title: Type.String({ description: 'Title of the minor item this band finds.' }),
    body: Type.String({ description: 'What the item is, in the world language.' }),
  },
  { additionalProperties: false }
);
const Band = Type.Object(
  {
    text: Type.String({ description: 'One or two sentences: what this band of the roll means, in the world language.' }),
    find: Type.Optional(Find),
    harm: Type.Optional(
      Type.Union([Type.Literal('light'), Type.Literal('serious'), Type.Literal('grave')], {
        description:
          'Only when this band means the player gets hurt (a fall, a blade, the cold). The engine lowers hidden health by the severity; ' +
          'you describe the hurt in words, never as a number. Ignored in worlds without hidden health.',
      })
    ),
    cost: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
      description: 'failure / setback only (TRPG worlds): ONE effect the engine applies when this band lands, e.g. {"clock": -1}, {"state": {"target": "player", "id": "hp", "by": -1}}, {"complication": "a door locks"}. setback costs at most 1.',
    })),
    bonus: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
      description: 'great only (TRPG worlds): ONE extra effect, e.g. {"clock": 1} or {"reveal": {"title": "…", "body": "…"}}.',
    })),
  },
  { additionalProperties: false }
);

export const searchTool = defineTool({
  name: 'search',
  label: 'Search',
  description:
    'Answer a player who searches, investigates, takes or loots something by putting a DICE CHALK on the canvas. ' +
    'Nothing is found yet: the player rolls the chalk, and only then does the rolled band create the item. ' +
    'If the place declares searchable spots (the layer README `search:` list), pass `spot` with the matching id — ' +
    'key clues are only ever found this way. If nothing declared fits, pass `improvise` for a MINOR, non-key find ' +
    '(four bands failure / setback / success / great, each with its own text and an optional find; the engine sets the dice ' +
    'from the world theme — 2d10 11+ by default, d100 <=60 in a Cthulhu world, d20+2 vs DC 12 in a D&D world). ' +
    'Never write the found item yourself, never roll the search, and never narrate what was found before the roll resolves.',
  parameters: Type.Object(
    {
      layer: Type.String({ description: 'The place being searched: its layer id (e.g. world/london-map/morgue, or map for the root).' }),
      spot: Type.Optional(Type.String({ description: 'Id of a spot declared in that layer README’s search: list.' })),
      improvise: Type.Optional(
        Type.Object(
          {
            title: Type.String({ description: 'Short title of the search, in the world language.' }),
            body: Type.Optional(Type.String({ description: 'One line shown on the dice card before the roll.' })),
            continue_label: Type.Optional(Type.String({ description: 'Button text that asks you to narrate after the roll, in the world language.' })),
            outcomes: Type.Object(
              { failure: Band, setback: Band, success: Band, great: Band },
              { additionalProperties: false }
            ),
          },
          { additionalProperties: false }
        )
      ),
    },
    { additionalProperties: false }
  ),
  promptSnippet: 'search — turn a player’s search/investigate/loot into a dice chalk; the item appears only after their roll',
  promptGuidelines: [
    'When the player searches, investigates, takes or loots, call search instead of writing the find: a declared spot (spot) for anything the place lists, otherwise improvise a minor, non-key find.',
    'After search, stop: the player rolls the dice chalk. Do not call roll_dice on it, do not create or move the item, and do not narrate the result until the roll_resolved event arrives.',
    'A key clue that the world has not declared as a search find is never improvised; if the player searches where nothing is declared, the find is minor or nothing.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).searchPlace(params as unknown as Record<string, unknown>);
      return ok(result as { text: string; details: SearchPlaceDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
