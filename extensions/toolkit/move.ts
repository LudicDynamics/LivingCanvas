import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { MoveEntityDetails } from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `move` — the one world-object move entry point (doc-tools/04 §2.2).
 *
 * Take / drop / place / give are the same act: one `.md` file changes directory.
 * The action lives in `packages/shared/src/actions/move.ts`, shared with the
 * player's `POST /api/move`; this file is only the wrapper. The engine moves the
 * file, rewrites every reference that pointed at it, migrates the card and seats
 * it — `bash mv` would silently break all of that (doc-tools/04 §1).
 */
export const moveTool = defineTool({
  name: 'move',
  label: 'Move',
  description:
    'Move one world entity file to a new path. Use it for every take / drop / place / give: ' +
    'picking a key up (world/inn/key.md -> player/key.md), handing a letter over ' +
    '(characters/watson/letter.md -> player/letter.md), or putting something back ' +
    '(player/key.md -> world/inn/key.md, near world/inn/counter.md). ' +
    'The engine moves the file, rewrites every reference that pointed at it, migrates its ' +
    'canvas card, seats it by `near` or in a free cell, and records the change. ' +
    'Never use bash mv or write to move an entity: that breaks references silently. ' +
    'Move a character with move_to; move only handles object files.',
  parameters: Type.Object(
    {
      from: Type.String({
        description: 'World-relative path of the entity to move, e.g. "world/inn/key.md".',
      }),
      to: Type.String({
        description:
          'World-relative destination, e.g. "player/key.md". A layer directory is accepted and the filename is kept.',
      }),
      near: Type.Optional(
        Type.String({
          description:
            'An entity path in the destination layer to seat the moved card next to, e.g. "world/inn/counter.md".',
        })
      ),
    },
    { additionalProperties: false }
  ),
  promptSnippet: 'move(from, to, near?) \u2014 take / drop / place / give one entity file through the engine',
  promptGuidelines: [
    'Use move to take, drop, place or give an entity; never use bash mv or write for that.',
    'Use move with `near` to put an object back next to a specific card in the destination scene.',
    'Use move_to to move a character; move only moves object files.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const result = await getActionService(ctx).moveEntity({
        from: params.from,
        to: params.to,
        near: params.near,
      });
      return ok(result as { text: string; details: MoveEntityDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
