import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { RollDiceDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `roll_dice` — the writer / character shell (doc-tools/07 §2.3).
 *
 * The action itself lives in `packages/shared/src/actions/roll-dice.ts`, so the
 * player's `POST /api/dice` and both agent processes run ONE dice implementation
 * (doc-20 §2.2 / §12). This file is only the pi-rp wrapper.
 *
 * Shape follows doc-tools/12 §2.1: `toolkit/*.ts` export a `ToolDefinition`
 * constant; `extensions/tools.ts` is the single `registerTool` entry point.
 */
export const rollDiceTool = defineTool({
  name: 'roll_dice',
  label: 'Roll Dice',
  description:
    'Resolve a dice check an entity declares in its frontmatter `roll_dice`. ' +
    'The engine reads `type / desc / expect` from the file, rolls true random, ' +
    'judges against `expect`, writes `result / passed` back into the file and ' +
    'records the world event. Use it when an action is genuinely uncertain and the ' +
    'outcome should be left to chance — picking a lock, holding your nerve, reading ' +
    'someone. Do NOT use it when the story should simply decide the outcome: write ' +
    'that in the prose instead. The caller can never supply the result; the roll is ' +
    'always the engine\u2019s. Refuses to re-roll an entity that already has a result.',
  parameters: Type.Object(
    {
      path: Type.String({
        description:
          'World-relative path of the entity that declares roll_dice, e.g. world/manor/cellar-door.md',
      }),
    },
    // doc-20 §7 / doc-tools/07 §2.3: the caller may NOT submit result / type /
    // expect. Without additionalProperties:false TypeBox ACCEPTS and silently
    // DROPS them, so the model's mistake would vanish instead of failing loudly.
    { additionalProperties: false }
  ),
  promptSnippet: 'roll_dice — let the engine resolve an entity\u2019s declared dice check',
  promptGuidelines: [
    'Use roll_dice when an entity already declares a roll_dice check and the outcome should be left to chance; never invent the result yourself.',
    'Do not pass result, type or expect to roll_dice: the engine reads them from the file, so a re-stated value would only drift from the truth.',
    'If an entity already has a result, roll_dice refuses; to re-open the check, edit the old result out of the file first.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).rollDice({ path: params.path });
      return ok(result as { text: string; details: RollDiceDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
