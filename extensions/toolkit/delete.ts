import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { RemoveEntityDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `delete` — the one world-content delete entry point (doc-tools/04 §2.2/§3.2).
 *
 * The engine drops the card and its links, then REPORTS the references that now
 * point at nothing (`details.dangling`) instead of rewriting prose — deciding
 * what that sentence should become is the author's call, not the engine's
 * (doc-tools/04 §3.2). `bash rm` gives neither the card cleanup nor the report.
 */
export const deleteTool = defineTool({
  name: 'delete',
  label: 'Delete',
  description:
    'Delete one world entity file. The engine removes its canvas card (and every line that ' +
    'touched it) and then tells you how many references now dangle \u2014 the ones pointing at it ' +
    'are left as they are, because only you can decide what that passage should say instead. ' +
    'Use delete when something is genuinely gone from the world: a burnt letter, a taken object, ' +
    'a door that collapsed. Never use bash rm: it leaves a card pointing at nothing and tells ' +
    'you nothing about what broke. Manuscripts are not README.md \u2014 a layer\u2019s README is its ' +
    'identity and cannot be deleted this way.',
  parameters: Type.Object(
    {
      path: Type.String({
        description: 'World-relative path of the entity to delete, e.g. "world/inn/key.md".',
      }),
    },
    { additionalProperties: false }
  ),
  promptSnippet: 'delete(path) \u2014 remove one entity through the engine and learn what it broke',
  promptGuidelines: [
    'Use delete to remove an entity; never use bash rm, because the canvas card and the reference report would be lost.',
    'After delete, check the returned dangling count: references to it were left untouched on purpose, and the prose may need rewriting.',
    'You cannot delete a layer\u2019s README.md: that is the layer\u2019s identity, not an object.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).removeEntity({ path: params.path });
      return ok(result as { text: string; details: RemoveEntityDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
