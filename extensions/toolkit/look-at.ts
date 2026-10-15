import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { LookAtDetails, ViewCanvasDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `look_at` / `view_canvas` — the two perception tools (doc-tools/03 §2.3).
 *
 * Both are read-only: no file, no canvas row, no event (doc-tools/03 §3.1 step 6).
 * The actions live in `packages/shared/src/actions/look-at.ts`; this file only
 * wraps them. `look_at`'s `text` IS the content — not a status line (doc-tools/01
 * §2.2), so the shell must not summarize it.
 */
export const lookAtTool = defineTool({
  name: 'look_at',
  label: 'Look At',
  description:
    'Read the player-visible text view of one or more world entities, or of a whole scene page. ' +
    'Hides raw YAML and pure-render fields; keeps the title, the body and the interactive blocks ' +
    '(status / choice / roll dice). Accepts a single .md path, a directory (a layer), or an array. ' +
    'Use look_at to understand what is on the canvas and what actions it offers. ' +
    'Use read when you need the raw frontmatter to edit it.',
  parameters: Type.Object(
    {
      // Array branch MUST come first — Vertex/Gemini function-declaration validation
      // rejects `anyOf: [string, array]` with "For schema with items, schema type
      // should be ARRAY" (its schema merger conflates the scalar branch with the
      // array branch's `items`). Order is semantically irrelevant to JSON Schema;
      // array-first passes everywhere. Same rule, same wording as pi-rp's own
      // `core/tools/read.ts:22-25`.
      path: Type.Optional(
        Type.Union(
          [
            Type.Array(Type.String(), {
              description: 'World-relative paths of .md entities or directories (layers).',
            }),
            Type.String({
              description:
                'World-relative path of a .md entity or a directory (layer). Omit for the current layer.',
            }),
          ],
          {
            description:
              'One path (entity or layer directory), or an array of paths. Omit for the current layer.',
          }
        )
      ),
    },
    { additionalProperties: false }
  ),
  promptSnippet: 'look_at(path?) — read a world entity or a whole scene page as player-visible text',
  promptGuidelines: [
    'Use look_at before choose: the [Choices] block numbers are the indexes choose accepts.',
    'Use look_at on a layer directory to see the files AND the doors out of it, without loading every child scene.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).lookAt({ path: params.path });
      return ok(result as { text: string; details: LookAtDetails });
    } catch (err) {
      return fail(err);
    }
  },
});

/**
 * `view_canvas` — the composition summary of one layer (doc-tools/03 §2.2).
 *
 * `mode: 'image'` is declared legal but not implemented in B1: the action layer
 * raises `unsupported` rather than downgrading to a summary (doc-tools/00 §8
 * anti-pattern 4). Keeping the value on the tool face is deliberate honesty —
 * deleting it would erase "we need sight" from the contract (doc-tools/03 §2.2).
 */
export const viewCanvasTool = defineTool({
  name: 'view_canvas',
  label: 'View Canvas',
  description:
    'Look at one layer\u2019s page as a structured composition summary: what cards sit on it, ' +
    'where they are, which boxes overlap, which cards have no seat yet, and which characters ' +
    'are present. Use it when you need the layout rather than the text \u2014 to find a free spot, ' +
    'to see what the player is looking at, or to check the scene is readable. ' +
    'It does not read any file for you: use look_at for text. ' +
    'A real screenshot is declared but NOT implemented in this phase and fails loudly.',
  parameters: Type.Object(
    {
      layer: Type.Optional(
        Type.String({ description: 'Layer to look at. Omit for the same default chain as look_at.' })
      ),
      mode: Type.Optional(
        Type.Union([Type.Literal('auto'), Type.Literal('image')], {
          description:
            "'auto' (default) returns the structured summary. 'image' asks for a real screenshot; it is declared legal but not implemented in this phase.",
        })
      ),
      viewport: Type.Optional(
        Type.Object(
          { width: Type.Number(), height: Type.Number() },
          { description: "'image' only: viewport in CSS px, clamped to [320,2560]x[240,1600]." }
        )
      ),
    },
    { additionalProperties: false }
  ),
  promptSnippet: 'view_canvas(layer?, mode?) \u2014 read one layer\u2019s layout (cards, overlaps, free spots, presence)',
  promptGuidelines: [
    'Use view_canvas when the layout matters (finding a free spot, checking overlaps); use look_at when you need the text.',
    'Do not ask view_canvas for mode "image": it is not implemented yet and will fail; the structured summary is what B1 provides.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).viewCanvas({
        layer: params.layer,
        mode: params.mode,
        viewport: params.viewport,
      });
      return ok(result as { text: string; details: ViewCanvasDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
