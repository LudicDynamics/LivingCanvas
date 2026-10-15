import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { SkillCheckDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `skill_check` — one use of a skill is one check.
 * The shell only forwards to the shared `skillCheck` action: for the
 * protagonist it lands a check card the PLAYER rolls; for a character with a
 * sheet (`actor: "self"` in a character process, a character id from the
 * writer) the engine rolls at once. The dice always come from the sheet.
 */
const Band = Type.Object(
  {
    text: Type.String({ description: 'One or two sentences: what this grade of the roll means, in the world language.' }),
    find: Type.Optional(
      Type.Object(
        {
          title: Type.String({ description: 'Title of a MINOR item this grade turns up.' }),
          body: Type.String({ description: 'What the item is, in the world language.' }),
        },
        { additionalProperties: false }
      )
    ),
    harm: Type.Optional(
      Type.Union([Type.Literal('light'), Type.Literal('serious'), Type.Literal('grave')], {
        description: 'Only when this grade hurts the protagonist; the engine lowers hidden health. Describe the hurt in words, never as a number.',
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

export const skillCheckTool = defineTool({
  name: 'skill_check',
  label: 'Skill Check',
  description:
    'Frame a skill check in a world with character skills (world.json rules). Pick the skill id from the sheet in [Character Sheets] and a difficulty you can justify: ' +
    'CoC-like worlds take difficulty regular / hard / extreme (target = the skill %, half, a fifth); D&D-like worlds take a DC (10 easy, 12 moderate, 15 hard, 20 very hard) and optional advantage / disadvantage. ' +
    'For the protagonist (actor "player", the default) this puts a CHECK CARD on the canvas and the PLAYER rolls it — stop and wait; narrate only after the roll resolves, from its tier. ' +
    'For a character with a sheet (actor "self" from a character, or a character id from the writer) the engine rolls at once. ' +
    'Optional outcomes give each grade (failure = fumble, setback = missed, success, great) its own text, a minor find or harm. ' +
    'A CoC sanity check is skill "sanity" with sanity { pass, fail } losses. Never write the result yourself.',
  parameters: Type.Object(
    {
      skill: Type.String({ description: 'Skill id from the sheet, e.g. spot_hidden, library_use, arcana, perception; or sanity.' }),
      actor: Type.Optional(Type.String({ description: '"player" (default), "self" (a character checking its own action), or a character id (writer only).' })),
      difficulty: Type.Optional(
        Type.Union([Type.String(), Type.Number()], { description: 'CoC-like: regular | hard | extreme. D&D-like: a DC number or easy | moderate | hard | very_hard.' })
      ),
      advantage: Type.Optional(Type.Union([Type.Literal('advantage'), Type.Literal('disadvantage')], { description: 'D&D-like only.' })),
      title: Type.String({ description: 'What is being attempted, in the world language (short).' }),
      body: Type.Optional(Type.String({ description: 'One or two lines shown on the card before the roll: why it is uncertain, what is at stake.' })),
      layer: Type.Optional(Type.String({ description: 'Where the card lands (layer id); default the player’s current place.' })),
      outcomes: Type.Optional(Type.Object({ failure: Band, setback: Band, success: Band, great: Band }, { additionalProperties: false })),
      sanity: Type.Optional(
        Type.Object({ pass: Type.Number(), fail: Type.Number() }, { additionalProperties: false, description: 'Sanity check only: sanity lost on a pass / on a fail.' })
      ),
      continue_label: Type.Optional(Type.String({ description: 'Button text that asks you to narrate after the roll, in the world language.' })),
      spot: Type.Optional(Type.String({
        description: 'A search spot the place README declares (search: id). Give it when this attempt is at what that spot covers: the card becomes that spot\'s search and the ROLL creates the spot\'s own declared finds for its grade (your outcomes are not used). The engine also binds by itself when the skill is the spot\'s skill / alt_skills.',
      })),
    },
    { additionalProperties: false }
  ),
  promptSnippet: 'skill_check — one use of a skill = one check; the protagonist’s card is rolled by the player',
  promptGuidelines: [
    'In a world with character skills, when the protagonist attempts something uncertain, call skill_check (the skill that fits, a justified difficulty) instead of deciding the outcome in prose.',
    'After a protagonist skill_check, stop: the player rolls the card. Do not call roll_dice on it and do not narrate the result until roll_resolved arrives; then narrate from its tier.',
    'Feelings, consent and a character’s heart are never skill checks.',
    'An attempt at something the place README declares under search: is that spot’s check — pass spot (or use search). Its finds come from the roll, never from you: after it resolves, the items already exist; narrate them, do not write or move them.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).skillCheck(params as unknown as Record<string, unknown>);
      return ok(result as { text: string; details: SkillCheckDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
