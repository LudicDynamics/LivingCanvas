import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { WriteChalkDetails } from '../../packages/shared/dist/index.js';
import { currentLayer, getActionService } from './deps.js';
import { fail, ok } from './result.js';

/**
 * `chalk` — the one "write prose" tool (doc-tools/02 §2.1, §8.2).
 *
 * The action lives in `packages/shared/src/actions/chalk.ts`; this file is only
 * the wrapper. Two things the ACTION deliberately does not do, because they are
 * transport-edge normalization (doc-tools/02 §2.5, §12 item 1):
 *  - `title`: the action requires it (01 §5); the shell derives it from the
 *    body's first non-empty line, so the tool face stays at four parameters.
 *  - `layer`: the action is transport-free and cannot know where the caller is;
 *    the shell injects the current layer from the canvas viewpoint (B1's
 *    `viewpoint` table belongs to B2, so this is null in every B1 world — an
 *    omitted `path` then fails loudly instead of guessing a layer).
 *
 * Shape follows doc-tools/12 §2.1: `export const <name>Tool: ToolDefinition`,
 * registered once by `extensions/tools.ts`; deps resolve lazily in `deps.ts`.
 */
function deriveTitle(body: string): string {
  const firstLine = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && !line.startsWith('---'));
  return (firstLine ?? 'Chalk').slice(0, 60);
}

export const chalkTool = defineTool({
  name: 'chalk',
  label: 'Chalk',
  description:
    'Write a piece of narration onto the canvas as a real markdown file. ' +
    'Use it for what the player reads: scene description, dialogue beats, the result of an action. ' +
    'The tool names the file, writes the `type: chalk` frontmatter, and records the world event. ' +
    'Pass `append_to` to continue an existing chalk instead of starting a new one; ' +
    'pass `link_to` to draw a relation line from this chalk to something on the same canvas. ' +
    'Do NOT use bash or write to create chalk — they skip the event log and the naming contract.',
  parameters: Type.Object(
    {
      content: Type.String({ description: 'The narration body in markdown (no frontmatter).' }),
      path: Type.Optional(
        Type.String({
          description:
            "Explicit world-relative target, e.g. 'world/baker-street/03-lamplight.md'. Omit to let the tool name it.",
        })
      ),
      link_to: Type.Optional(
        Type.String({
          description: 'World-relative path of a card on the same canvas to link this chalk to.',
        })
      ),
      append_to: Type.Optional(
        Type.String({
          description: 'Existing chalk path to append to instead of creating a new file.',
        })
      ),
    },
    { additionalProperties: false }
  ),
  promptSnippet:
    'chalk — land narration as a real chalk file on the canvas (in-chat text never reaches the canvas).',
  promptGuidelines: [
    'Use chalk whenever the player should read a new passage of narration.',
    'Use append_to when you are continuing the same beat, rather than starting a new chalk file.',
    'Never write chalk files with write or bash: they bypass the filename convention and the world event log.',
  ],
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    try {
      // Honour engine cancellation before any world lookup or write. The action
      // layer is intentionally transport-free, so the tool shell owns this
      // cancellation boundary.
      signal?.throwIfAborted();
      const result = await getActionService(ctx).writeChalk({
        body: params.content,
        title: deriveTitle(params.content),
        layer: currentLayer(ctx) === 'map' ? 'world' : currentLayer(ctx) ?? undefined,
        path: params.path,
        appendTo: params.append_to,
        linkTo: params.link_to,
        // No `frontmatter`: interactive fields arrive in Phase ② via `edit` (02 §2.7).
      });
      // Abort can race the final event/write. Do not report a successful tool
      // result after cancellation; the engine will record an aborted tool turn.
      signal?.throwIfAborted();
      return ok(result as { text: string; details: WriteChalkDetails });
    } catch (err) {
      return fail(err);
    }
  },
});
