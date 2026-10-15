/**
 * doc 12 §2.4.1 `createEntity` — the C-entry (god mode) entity creation action.
 *
 * God mode's radial menu builds gate / sprite / note / chalk cards from
 * structured data, and the frontend used to spell the frontmatter itself
 * (`App.tsx:233-256`) — which is exactly where doc-07's "frontmatter format is
 * wrong" risk lived. Here the assembly is done by `stringifyFrontmatter`, so the
 * caller hands DATA and the engine owns the syntax.
 *
 * `writeChalk` deliberately does NOT cover this: it invents its own `type: chalk`
 * skeleton and names the file `NN-slug.md` (02 §2). God mode must be free to
 * create the other three kinds with a caller-supplied frontmatter.
 */
import type { WorldEvent } from '../schemas/events.js';
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { validateAppearanceInput } from '../schemas/appearance.js';
import { ActionError } from './errors.js';
import { assertImageAsset } from '../rules/media.js';
import { resolveComponentKind } from '../components/registry.js';
import { eventKindOf } from './delete.js';
import { registerAction } from './service.js';
import { actorLabel, assertPlayerNoteMutationAllowed } from './actor.js';
import { commandDetail } from './types.js';
import type { ActionContext, ActionResult } from './types.js';

export interface CreateEntityInput {
  /** World-root-relative path (00 §2.1). MUST be `*.md`, MUST NOT be `README.md`. */
  path: string;
  /** Body WITHOUT frontmatter delimiters. Ignored when `content` is given. */
  body?: string;
  /** Shallow-merged into the frontmatter; assembled by `stringifyFrontmatter`. */
  frontmatter?: Record<string, unknown>;
  /**
   * Escape hatch: a whole-file replacement. When present, `body`/`frontmatter`
   * are ignored and the text is written verbatim — the caller owns correctness.
   * Used by god mode's "replace this file entirely" gesture.
   */
  content?: string;
}

export interface CreateEntityDetails {
  path: string;
  name: string;
  kind: 'chalk' | 'component' | 'note' | 'letter' | 'other';
  event: WorldEvent;
}

/** Filename slug used when there is no `title` to derive a name from. */
function nameOf(frontmatter: Record<string, unknown>, path: string): string {
  const title = frontmatter.title;
  if (typeof title === 'string' && title.trim() !== '') return title;
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '');
}

function validateCreatePath(path: string): ActionError | null {
  if (!path || path.trim() === '') {
    return new ActionError({ code: 'invalid_argument', message: 'A path is required.' });
  }
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) {
    return new ActionError({
      code: 'invalid_path',
      message: `Paths are world-root relative, not absolute: "${path}"`,
    });
  }
  if (!path.endsWith('.md')) {
    return new ActionError({
      code: 'invalid_path',
      message: `Only markdown entities can be created here (got "${path}")`,
    });
  }
  if (path === 'README.md' || path.endsWith('/README.md')) {
    return new ActionError({
      code: 'invalid_path',
      message: `README.md is a layer's identity, not an entity: "${path}"`,
    });
  }
  const inWorld = path.startsWith('world/') || path.startsWith('player/') || path.startsWith('characters/');
  if (!inWorld) {
    return new ActionError({
      code: 'invalid_path',
      message: `Entities live under world/, player/ or characters/ (got "${path}")`,
    });
  }
  return null;
}

export async function createEntity(
  ctx: ActionContext,
  input: CreateEntityInput
): Promise<ActionResult<CreateEntityDetails>> {
  const path = input.path;

  // 1. Path validation.
  const badPath = validateCreatePath(path);
  if (badPath) throw badPath;
  // Player notes are made by the player's own route only (actions/player-notes.ts).
  assertPlayerNoteMutationAllowed(ctx.actor, path, 'create');

  // 2. Refuse to silently overwrite — 00 §2.3's explicit-path discipline.
  const existing = await ctx.store.statKind(path);
  if (existing !== 'missing') {
    throw new ActionError({
      code: 'already_exists',
      message: `"${path}" already exists; edit it instead of creating over it.`,
    });
  }
  // 3. Assemble and derive identity before any write. For the whole-file escape
  // hatch, parse the supplied content so an embedded appearance declaration is
  // held to the same strict gate as structured frontmatter.
  const frontmatter =
    input.content !== undefined ? parseFrontmatter(input.content).frontmatter ?? {} : input.frontmatter ?? {};
  const filename = path.split('/').pop() ?? path;
  const semanticKind = resolveComponentKind(frontmatter, filename);
  if (frontmatter.component === 'photo' && Object.prototype.hasOwnProperty.call(frontmatter, 'image')) {
    await assertImageAsset(ctx.store.worldRoot, frontmatter.image as string);
  }
  if (Object.prototype.hasOwnProperty.call(frontmatter, 'appearance')) {
    const appearance = validateAppearanceInput(frontmatter.appearance, semanticKind);
    if (!appearance.ok) {
      const issue = appearance.issues[0];
      throw new ActionError({
        code: 'invalid_argument',
        message: issue?.message ?? `Invalid appearance for component kind "${semanticKind}".`,
        details: { issues: appearance.issues },
      });
    }
  }
  const content =
    input.content !== undefined
      ? input.content
      : stringifyFrontmatter(frontmatter, input.body ?? '');
  await ctx.store.writeFile(path, content);

  // 4. Derive event identity from the data that will be visible in the file.
  const name = nameOf(frontmatter, path);
  const kind = eventKindOf(frontmatter, filename);
  const layer = await ctx.store.resolveLayer(path);

  // 5. Exactly one event (doc-21 §4.1).
  const event = await ctx.store.appendEvent({
    type: 'entity_created',
    actor: ctx.actor,
    detail: { path, name, kind, ...commandDetail(ctx) },
    subject: path,
    layer: layer ?? undefined,
    turn: ctx.turn,
  });

  return {
    text: `${actorLabel(ctx.actor)} created "${name}" (${path}).`,
    details: { path, name, kind, event },
  };
}

registerAction('createEntity', (ctx, input) =>
  createEntity(ctx, input as unknown as CreateEntityInput)
);
