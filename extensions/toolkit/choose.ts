import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ChooseOptionDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `choose` — the writer / character shell (doc-tools/06 §2.4).
 *
 * The action lives in `packages/shared/src/actions/choose.ts`, so the player's
 * `POST /api/choice` and both agent processes run ONE choice implementation
 * (doc-20 §6: UI click, writer and character share the same action function).
 * This file is only the pi-rp wrapper.
 *
 * Shape follows doc-tools/12 §2.1: `toolkit/*.ts` export a `ToolDefinition`
 * constant and `extensions/tools.ts` is the single `registerTool` entry point;
 * dependencies (store / actor / turn) are resolved lazily by `toolkit/deps.ts`.
 */
export const chooseTool = defineTool({
  name: 'choose',
  label: 'Choose',
  description:
    'Pick one of the public options an entity declares in its frontmatter `choice`. ' +
    'Use it when the player (or your character) takes one of the listed actions \u2014 ' +
    'opening the piano lid, forcing the cellar door, telling Watson your theory. ' +
    '`path` is the entity, `choice` is either the 1-based number or the exact text ' +
    'printed by look_at. This does NOT change the file, remove the option, or decide ' +
    'what happens next: it records that the choice was made, and the world reacts later.',
  parameters: Type.Object(
    {
      path: Type.String({
        description: 'World-relative path of the entity, e.g. world/manor/music-room/piano.md',
      }),
      choice: Type.Union([Type.String(), Type.Number()], {
        description: '1-based option number, or the option text exactly as look_at printed it',
      }),
    },
    { additionalProperties: false }
  ),
  promptSnippet: "choose \u2014 take one of an entity\u2019s declared options",
  promptGuidelines: [
    'Use choose when the player picks one of the options an entity printed in look_at; never invent an option that is not listed.',
    'Use choose (not write/edit) to record a selection: the writer reacts to the choice_selected event, the file itself stays untouched.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).chooseOption({
        path: params.path,
        choice: params.choice,
      });
      return ok(result as { text: string; details: ChooseOptionDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
