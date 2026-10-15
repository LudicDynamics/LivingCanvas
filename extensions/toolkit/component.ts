import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `get_component` — the read-only facade of the component registry
 * (doc-tools/10 §2.1, §8.4).
 *
 * It answers "which component kinds exist, what frontmatter they take, and
 * (for kinds with a registered appearance profile) which schema, presets, and
 * axis IDs are legal", so the model never has to carry every contract in its
 * context. The action lives in `packages/shared/src/actions/component.ts` and
 * touches nothing: no file, no canvas row, no event.
 */
export const getComponentTool = defineTool({
  name: 'get_component',
  label: 'Get Component',
  description:
    'Look up a canvas component kind: its purpose, its frontmatter fields, its appearance schema/options, and a minimal example. ' +
    'Omitting component lists every registered kind in one line each. Read-only; it writes nothing.',
  parameters: Type.Object(
    {
      // Array branch MUST come first — Vertex/Gemini function-declaration validation
      // rejects `anyOf: [string, array]` with "For schema with items, schema type
      // should be ARRAY". See pi-rp `core/tools/read.ts:22-25` and look-at.ts.
      component: Type.Optional(
        Type.Union(
          [
            Type.Array(Type.String(), {
              description: 'Component kind ids, e.g. ["letter","board"].',
            }),
            Type.String({
              description: 'Component kind id, e.g. "lock".',
            }),
          ],
          {
            description:
              'One component kind id, or an array of ids. Omit to list the whole registry as a one-line-per-kind index.',
          }
        )
      ),
    },
    { additionalProperties: false }
  ),
  promptSnippet:
    "get_component(component?) — look up a component kind's frontmatter and appearance contract before writing one",
  promptGuidelines: [
    'Use get_component before writing or editing any file with frontmatter "type: component" — it returns the exact fields and, when registered, appearance options for that kind.',
    'Write appearance only with IDs returned in the appearance details (preset or explicit axes); recommendations from a world skill are not authorization. Omit appearance to preserve legacy defaults; use appearance: {} only when opting into context defaults.',
    'Keep appearance in frontmatter, separate from body, title, preview, choice, status, and roll_dice. Never write CSS, classes, URLs, HTML, or theme prose as appearance values.',
    'Use show for one-off performances (spotlight, lights_out, fireworks). show writes nothing; to place a letter or a lock on the canvas, use chalk or write instead.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).getComponent({ component: params.component });
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  },
});
