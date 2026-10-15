import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ArrangeDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `arrange` — place one card, or re-flow a whole layer (doc-tools/09 §2.6).
 *
 * The action itself lives in `packages/shared/src/actions/canvas.ts`, shared
 * with the player's `POST /api/card/position`. This file is only the wrapper:
 * it folds the flat tool parameters into `ArrangeInput` and lets the action
 * layer own every rule (00 §8).
 *
 * `w` / `h` exist only because the plan froze them in the signature; the action
 * layer rejects them (`CARD_FORMS` is the one size source), so passing them
 * fails loudly rather than being silently ignored.
 */
export const arrangeTool = defineTool({
  name: 'arrange',
  label: 'Arrange Cards',
  description:
    'Move a card on the canvas, or lay out a whole scene. Give `path` plus x/y to ' +
    'place ONE card at an absolute spot; give `layout` to re-flow a layer from ' +
    'scratch (grid / circle / row). Coordinates persist in canvas state, not in ' +
    'the file. Card size and rotation are NOT settable: width comes from the ' +
    'kind\u2019s form table and rotation is derived from the path.',
  parameters: Type.Object(
    {
      path: Type.Optional(
        Type.String({
          description: 'World-relative path of the single card to place (omit when using `layout`).',
        })
      ),
      x: Type.Optional(Type.Number({ description: 'Absolute x for `place`.' })),
      y: Type.Optional(Type.Number({ description: 'Absolute y for `place`.' })),
      z: Type.Optional(
        Type.Number({ description: 'Stacking order for `place`; higher draws on top.' })
      ),
      w: Type.Optional(
        Type.Number({ description: 'Not settable (card size comes from CARD_FORMS); passing it fails.' })
      ),
      h: Type.Optional(
        Type.Number({ description: 'Not settable (card size comes from CARD_FORMS); passing it fails.' })
      ),
      layer: Type.Optional(
        Type.String({ description: 'Layer id for `layout`; inferred from `paths` when omitted.' })
      ),
      layout: Type.Optional(
        Type.Union([Type.Literal('grid'), Type.Literal('circle'), Type.Literal('row')], {
          description: 'Re-flow the layer into a grid, a circle, or a single row.',
        })
      ),
      paths: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'For `layout`: the cards to re-flow. Omit to re-flow every card on the layer. Order is normalized.',
        })
      ),
    },
    { additionalProperties: false }
  ),
  promptSnippet: 'arrange \u2014 move a card, or re-flow a layer (grid / circle / row)',
  promptGuidelines: [
    'Use arrange when a card should sit somewhere specific, or a layer needs a readable layout; coordinates are canvas state, not file content.',
    'Pass either `path` (place one card, with x/y) or `layout` (re-flow cards), never both.',
    'Do not pass w or h: a card\u2019s size is a property of its kind, not of its position.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const input: {
      place?: { path: string; x?: number; y?: number; z?: number };
      layout?: { mode: 'grid' | 'circle' | 'row'; layer?: string; paths?: string[] };
      w?: number;
      h?: number;
    } = {};
    if (params.path !== undefined) {
      input.place = { path: params.path, x: params.x, y: params.y, z: params.z };
    }
    if (params.layout !== undefined) {
      input.layout = { mode: params.layout, layer: params.layer, paths: params.paths };
    }
    if (params.w !== undefined) input.w = params.w;
    if (params.h !== undefined) input.h = params.h;

    try {
      const result = await getActionService(ctx).arrangeCards(input);
      return ok(result as { text: string; details: ArrangeDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
