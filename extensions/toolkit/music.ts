import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { musicCatalogLines, type SetMusicDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `set_music` — the writer changes the music of the player's place or the
 * world theme. The action and its catalog validation
 * live in `packages/shared/src/actions/music.ts`; this file is only the shell.
 * The catalog (ids, tags, one line each) is in the description so the writer
 * can pick by mood without a lookup.
 */
export const setMusicTool = defineTool({
  name: 'set_music',
  label: 'Set Music',
  description:
    'Change what plays, for good: the music (and optionally the ambient sound bed) of the player’s ' +
    'current place, another place, or the world-wide theme. A place with its own track rests the world ' +
    'theme while the player is there. The page crossfades live. Keep it rare: a new world, entering a new ' +
    'kind of place, or a major turn (discovery, danger, grief, an ending) — never every turn.\n' +
    'Catalog (id [mood tags] — what it sounds like):\n' +
    musicCatalogLines().join('\n'),
  parameters: Type.Object(
    {
      layer: Type.Optional(
        Type.String({
          description:
            '"current" (default) = the player’s place; "world" = the world theme; or a layer id ("map", "world/...").',
        })
      ),
      track: Type.String({
        description: 'A music id from the catalog, "silence" (no music here), or "default" (back to the inherited / type default music).',
      }),
      ambient: Type.Optional(
        Type.String({ description: 'An ambient id from the catalog, "none", or "default". Omit to keep the bed. Places only.' })
      ),
      reason: Type.Optional(Type.String({ description: 'A few words: why the music changes now.' })),
    },
    { additionalProperties: false }
  ),
  promptSnippet: 'set_music(layer?, track, ambient?, reason?) — change the music of a place or the world theme (catalog ids only)',
  promptGuidelines: [
    'Use set_music rarely: when a world is made, when the player enters a new kind of place, or at a major turn (discovery, danger, grief, an ending).',
    'Pick set_music tracks by mood tag from the catalog; a made-up id is refused.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).setMusic({
        layer: params.layer,
        track: params.track,
        ambient: params.ambient,
        reason: params.reason,
      });
      return ok(result as { text: string; details: SetMusicDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
