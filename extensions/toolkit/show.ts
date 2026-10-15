import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { SHOW_IDS, type ShowDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `show` — one-off performances (doc-tools/10 §2.2, §8.4).
 *
 * A performance is a transient frame: no file, no canvas row, no event. The
 * server relays `details.frame` verbatim as a `show_frame` broadcast (doc-tools
 * 12 §3.4). `component` is the closed `SHOW_IDS` set, so an unknown id is
 * rejected by schema validation rather than silently ignored.
 *
 * Export name follows doc-tools/12 §2.2 (`showTool`); doc-tools/10 §8.4 calls
 * the same constant `showComponentTool` — doc 12 is the registration contract,
 * so `showTool` wins. The ACTION method stays `showComponent` (`service.ts`).
 */
const showKindSchema = Type.Union(
  SHOW_IDS.map((id) => Type.Literal(id)),
  { description: `Performance id: ${SHOW_IDS.join(', ')}.` }
);

export const showTool = defineTool({
  name: 'show',
  label: 'Show',
  description:
    'Play a one-off performance on the canvas: push the camera in, dim the room to near-black, ' +
    'burst fireworks over a spot, throw evidence threads from several cards to one, stamp an ink ' +
    'mark, or run a dice ceremony. It is pure staging \u2014 nothing is written, no card is created, ' +
    'no world event is recorded, and the performance is gone when it ends. Use show for a beat ' +
    'that should land right now; use chalk or write to put something on the canvas permanently.',
  parameters: Type.Object(
    {
      component: showKindSchema,
      target: Type.Optional(
        Type.String({
          description:
            'World-relative path this performance focuses on, e.g. "world/baker-street/rusty-key.md". Required by spotlight, camera_focus, ink_burst and evidence_burst.',
        })
      ),
      links: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'evidence_burst only: the cards that throw temporary threads toward `target`.',
        })
      ),
      params: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description:
            "The performance's own parameters (e.g. { dim: 0.1 } for spotlight), validated by that performance's schema.",
        })
      ),
      duration_ms: Type.Optional(
        Type.Number({ description: 'Override the default duration in ms; clamped to 300-12000.' })
      ),
      caption: Type.Optional(
        Type.String({ description: 'One-line English caption that fades in with the performance.' })
      ),
    },
    { additionalProperties: false }
  ),
  promptSnippet: 'show \u2014 play a one-off performance (spotlight, lights_out, fireworks, evidence_burst\u2026)',
  promptGuidelines: [
    'Use show for a transient dramatic beat; use chalk or write when something must stay on the canvas.',
    'Pass `target` for spotlight, camera_focus, ink_burst and evidence_burst: without it the performance fails.',
    'Do not use show to place a letter or a lock: show writes nothing, so the card would never exist.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).showComponent({
        component: params.component,
        target: params.target,
        links: params.links,
        params: params.params,
        duration_ms: params.duration_ms,
        caption: params.caption,
      });
      return ok(result as { text: string; details: ShowDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
