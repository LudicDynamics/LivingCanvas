import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { LinkDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `link` — draw / restyle / remove a line between two cards (doc-tools/09 §2.1).
 *
 * The action itself lives in `packages/shared/src/actions/canvas.ts`, so the
 * agent tool and any future god-mode gesture run ONE line implementation
 * (00 §8). This file is only the pi-rp wrapper.
 *
 * Lines live ONLY in `canvas.db` — there is no markdown body for a line and no
 * event row. Nothing here touches a file.
 */
export const linkTool = defineTool({
  name: 'link',
  label: 'Link Cards',
  description:
    'Draw, restyle or remove a LINE between two cards on a layer page. A line is ' +
    'canvas state, not a file: use it for a road on the map, a relationship ' +
    'between two characters\u2019 doors, or the trail from a clue to where it ' +
    'led. Both endpoints must be cards shown on the SAME layer (their paths are ' +
    'the ids, e.g. world/baker-street/README.md). Creating the same line twice ' +
    'is idempotent \u2014 to keep two different lines between the same pair, pass ' +
    'distinct ids.',
  parameters: Type.Object(
    {
      op: Type.Union([Type.Literal('create'), Type.Literal('update'), Type.Literal('delete')], {
        description:
          'create = draw a line (same endpoints + layer = same line, so repeating it just restyles); ' +
          'update = restyle an existing line (needs id, or from+to when only one line connects them); ' +
          'delete = remove a line (same targeting rules as update).',
      }),
      from: Type.Optional(
        Type.String({ description: 'World-relative path of the card the line starts at.' })
      ),
      to: Type.Optional(
        Type.String({ description: 'World-relative path of the card the line ends at.' })
      ),
      id: Type.Optional(
        Type.String({
          description:
            'Line id (lnk-xxxxxxxx). Required to target one specific line when several connect the same pair.',
        })
      ),
      style: Type.Optional(
        Type.Union(
          [
            Type.Literal('solid'),
            Type.Literal('dashed'),
            Type.Literal('arrow'),
            Type.Literal('bold'),
            Type.Literal('red'),
            Type.Literal('hand'),
            Type.Literal('thread'),
            Type.Literal('road'),
          ],
          {
            description:
              'Stroke preset: solid (default), dashed (a "to be continued" / annotation line), ' +
              'arrow (directed), bold (heavy), red (emphasis), hand (drawn), thread (pinned string), ' +
              'road (layer-to-layer on the big map).',
          }
        )
      ),
      color: Type.Optional(
        Type.Union(
          [Type.Literal('ink'), Type.Literal('rust'), Type.Literal('blue'), Type.Literal('sage')],
          { description: 'Overrides the preset colour, e.g. thread + rust for a red string.' }
        )
      ),
      directed: Type.Optional(
        Type.Boolean({ description: 'Draw an arrowhead at the `to` end.' })
      ),
      label: Type.Optional(
        Type.String({ description: 'Short label on the line (max 40 characters), e.g. "10 min walk".' })
      ),
    },
    { additionalProperties: false }
  ),
  promptSnippet: 'link \u2014 draw, restyle or remove a line between two cards on a layer',
  promptGuidelines: [
    'Use link to make a relationship visible (a road, a lead, a connection); it does not write or move any file.',
    'Both endpoints must be cards on the SAME layer page, given as world-relative paths; cross-layer lines are never rendered.',
    'Pass an "id" to update or delete one line when several connect the same pair; link refuses to guess.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).linkCards(params);
      return ok(result as { text: string; details: LinkDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
