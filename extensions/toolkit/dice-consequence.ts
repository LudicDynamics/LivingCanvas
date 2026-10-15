import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `dice_consequence` — pay a resolved roll's tier.
 * The shell forwards to the shared `diceConsequence` action, which checks the
 * card's tier and bounds the effect (a 大失败 costs up to 3, a 失败 at most 1, a
 * 大成功 gains up to 2) and lands it as the engine. In a 跑团 world, a 大失败
 * or 大成功 left unpaid when your turn ends gets the world's default instead.
 */
const Effect = Type.Object(
  {
    clock: Type.Optional(Type.Integer({ description: 'Move the world clock: -1 / -2 as a cost, +1 as a bonus.' })),
    state: Type.Optional(Type.Object({
      target: Type.String({ description: 'player | world | characters/<id>' }),
      id: Type.String({ description: 'A declared number state, e.g. hp, sanity, trust, suspicion.' }),
      by: Type.Integer({ description: 'Signed change, e.g. -1. For a state where up is worse (suspicion), +1 is the cost.' }),
    }, { additionalProperties: false })),
    harm: Type.Optional(Type.Union([Type.Literal('light'), Type.Literal('serious'), Type.Literal('grave')], { description: 'The protagonist is hurt (hidden hp).' })),
    sanity: Type.Optional(Type.Integer({ description: 'Protagonist sanity change, e.g. -1.' })),
    relationship: Type.Optional(Type.Integer({ description: 'Trust of the character involved (or present), e.g. -1 / +1.' })),
    item: Type.Optional(Type.Object({ path: Type.String(), fate: Type.Union([Type.Literal('lost'), Type.Literal('broken')]) }, { additionalProperties: false, description: 'An item lost (removed) or broken.' })),
    reveal: Type.Optional(Type.Object({ title: Type.String(), body: Type.String() }, { additionalProperties: false, description: 'A 大成功 bonus: a hidden detail lands as a note next to the dice card. Never a declared key clue.' })),
    complication: Type.Optional(Type.String({ description: 'A cost told as a story event: a door locks, someone grows suspicious, an enemy appears. One line, world language.' })),
    boon: Type.Optional(Type.String({ description: 'A 大成功 bonus told as a story event. One line, world language.' })),
  },
  { additionalProperties: false, description: 'Exactly ONE effect.' }
);

export const diceConsequenceTool = defineTool({
  name: 'dice_consequence',
  label: 'Dice Consequence',
  description:
    'Apply a resolved roll’s tier consequence to the world. After a 大失败 (crit_fail) you MUST apply a real cost; after a 失败 (fail) a small cost or complication; after a 大成功 (crit_success) an extra reward. ' +
    'A 成功 (success) owes nothing beyond its intended result. Pass the dice card path and exactly one effect. ' +
    'In a TRPG world, an unpaid 大失败 / 大成功 at the end of your turn gets the world’s default (shown under [Dice owed]).',
  parameters: Type.Object(
    {
      path: Type.String({ description: 'The resolved dice card (the path roll_resolved named).' }),
      effect: Effect,
    },
    { additionalProperties: false }
  ),
  promptSnippet: 'dice_consequence — pay a resolved roll’s tier: cost after a failure, bonus after a critical success',
  promptGuidelines: [
    'After every roll_resolved, read its tier: crit_success → an extra reward; success → the intended result; fail → partial result + a small cost (at most 1); crit_fail → a real cost. Pay it with dice_consequence before ending your turn, then narrate it.',
    'Changes you make with other tools (moving an item away, locking a door with edit, an enemy card) still need one dice_consequence complication line so the cost is recorded.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).diceConsequence(params as unknown as Record<string, unknown>);
      return ok(result as { text: string; details: Record<string, unknown> });
    } catch (err) {
      return fail(err);
    }
  },
});
