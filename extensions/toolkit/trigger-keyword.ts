import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { ActionError, fireKeywordTrigger } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `trigger_keyword` — the writer's half of a keyword trigger
 *. The world declares a turning point by MEANING
 * ("the player names Wayne as the killer"); the writer's context lists the
 * active intents each turn, never their consequences. When the player's words
 * or actions this turn actually mean one of them, the writer calls this tool
 * with the id — and the ENGINE validates it (exists, is a keyword trigger, has
 * not fired, the player is in an allowed layer, the speaker fits its scope) and
 * runs the consequence. The writer never announces an ending in prose.
 */
export const triggerKeywordTool = defineTool({
  name: 'trigger_keyword',
  label: 'Turning Point',
  description:
    'Tell the engine the player has just done or said something that MEANS one of the turning points listed under ' +
    '[Turning points] in your context. Pass its id. Judge by meaning: a paraphrase counts; a mere mention, a question ' +
    'about it, a hypothetical or a joke does not. The engine checks and runs the consequence (which may end the story); ' +
    'you never learn it in advance and never narrate an ending yourself — narrate the moment, then stop.',
  parameters: Type.Object(
    {
      id: Type.String({ description: 'The turning point id, exactly as listed in your context.' }),
      by: Type.Optional(
        Type.Union([Type.Literal('player'), Type.Literal('character')], {
          description: 'Who said or did it. Default player. Some turning points count only the player.',
        })
      ),
    },
    { additionalProperties: false }
  ),
  promptSnippet: 'trigger_keyword — the player just meant one of the listed turning points; let the engine decide what follows',
  promptGuidelines: [
    'Call trigger_keyword only when the player\'s words or actions this turn clearly mean a listed turning point; if unsure, ask in the story instead.',
    'Never write an ending, a death or a verdict in prose; the engine reaches endings, and the player sees them on their own page.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const svc = getActionService(ctx);
      if (svc.actor.type !== 'writer') {
        throw new ActionError({ code: 'invalid_argument', message: 'Only the writer judges turning points.' });
      }
      const fired = await fireKeywordTrigger(svc.ctx, { id: params.id, ...(params.by ? { by: params.by } : {}) });
      const text = fired.ending
        ? `Turning point "${fired.id}" fired. The story has reached an ending; the player sees it now. Narrate only the moment itself, briefly.`
        : `Turning point "${fired.id}" fired${fired.settle === 'failed' ? ' (part of its consequence could not land)' : ''}. Narrate what follows from the world's new state.`;
      return ok({ text, details: fired });
    } catch (err) {
      return fail(err);
    }
  },
});
