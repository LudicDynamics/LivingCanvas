/**
 * doc 04 `delete` — `removeEntity` (the only world-content deletion entry) and
 * `editEntity` (no tool of its own; serves the B2 hook and the C god entry).
 *
 * Deletion never rewrites the files that referenced the entity (04 §3.2): a
 * move's intent is unchanged, but a delete has no single correct sentence to
 * put in a narrator's prose. The engine's job is to REPORT the breakage
 * (`dangling` + `details.danglingRefs`), not to rewrite other people's story.
 */
import type { WorldEvent } from '../schemas/events.js';
import { entityName, parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { validateAppearanceInput } from '../schemas/appearance.js';
import { resolveComponentKind } from '../components/registry.js';
import { cardFormOf } from '../schemas/forms.js';
import { ActionError } from './errors.js';
import { assertImageAsset } from '../rules/media.js';
import { isHtmlPath } from '../rules/html-head.js';
import { assertNookMutationAllowed } from './actor.js';
import type { AgentScope } from './actor.js';
import { scanRefs } from './refs.js';
import { registerAction } from './service.js';
import { actorLabel } from './actor.js';
// The ONE body-join rule (04 §3.5). `chalk.js` is the owner; importing it here
// rather than re-implementing the trim-and-blank-line join keeps a single rule
// for `append_body` (契约 §8 反模式 3). No cycle: `chalk` does not reach back
// into `delete`.
import { renderAppend } from './chalk.js';
import { commandDetail } from './types.js';
import type { ActionContext, ActionResult } from './types.js';

export interface RemoveEntityInput {
  path: string;
}
export interface RemoveEntityDetails {
  path: string;
  /** The name read BEFORE deletion (the file is gone afterwards). */
  name: string;
  /** How many references now point at nothing (== danglingRefs.length). */
  dangling: number;
  danglingRefs: import('../schemas/events.js').DanglingRef[];
}

export interface EditEntityInput {
  path: string;
  /** Shallow merge; a `null` value deletes that key. */
  frontmatter?: Record<string, unknown>;
  /** Whole-body replacement; omitted = leave the body untouched. */
  body?: string;
  /**
   * Appended to the existing body; omitted = leave it untouched. NEW (04 §3.5,
   * `[C-6]`).
   *
   * Mutually exclusive with `body` rather than merged: "replace" and "append"
   * are different intents, and silently letting one win would make the caller's
   * other argument a lie. Joining goes through `renderAppend` so there is ONE
   * join rule in the repo (契约 §8 反模式 3).
   */
  append_body?: string;
}
export interface EditEntityDetails {
  path: string;
  name: string;
  kind: string;
}

/**
 * The closed five-value mapping for `entity_created.detail.kind` (00 §5.2,
 * adjudicated in the review m-5/m-23). Deliberately NOT `cardKindOf`: that one
 * answers "what do I paint" and has six values (`chalk/gate/letter/note/
 * sprite/default`); an EVENT answers "what is this thing" and has five.
 *
 * `gate` / `sprite` / `type: component` → `component`; `default` → `other`.
 */
export function eventKindOf(
  fm: Record<string, unknown> | null | undefined,
  filename: string
): 'chalk' | 'component' | 'note' | 'letter' | 'other' {
  if (filename === 'README.md' || filename.endsWith('/README.md')) return 'component';
  const type = fm?.type;
  if (type === 'chalk') return 'chalk';
  if (type === 'note') return 'note';
  if (type === 'letter' || fm?.component === 'letter') return 'letter';
  // `gate` / `sprite` are scene furniture, and any registered `component` kind
  // is a prop — all three read as "component" to a history panel.
  if (type === 'gate' || type === 'sprite' || type === 'component' || fm?.component) {
    return 'component';
  }
  return 'other';
}

/** The three kinds of path this module accepts (00 §2.4). */
function movablePathError(path: string): ActionError | null {
  if (path.endsWith('/README.md') || path === 'README.md') {
    return new ActionError({
      code: 'not_movable',
      message: `README.md is a layer's identity and cannot be deleted: "${path}"`,
    });
  }
  return null;
}

export async function removeEntity(
  ctx: ActionContext,
  input: RemoveEntityInput
): Promise<ActionResult<RemoveEntityDetails>> {
  const { store, actor } = ctx;
  const path = input.path;

  const kind = await store.statKind(path);
  if (kind === 'missing') {
    throw new ActionError({ code: 'not_found', message: `Entity not found: "${path}"` });
  }
  if (kind === 'dir') {
    throw new ActionError({
      code: 'not_movable',
      message: `delete only accepts a single .md or .html file, got a directory: "${path}"`,
    });
  }
  const agentScope: AgentScope =
    ctx.agentScope ??
    (actor.type === 'character' ? 'character' : actor.type === 'player' ? 'player' : 'writer-top-level');
  const manifest = await store.getManifest();
  assertNookMutationAllowed(
    actor,
    agentScope,
    path,
    'delete',
    manifest.characters.map((character) => character.id),
  );
  const guard = movablePathError(path);
  if (guard) throw guard;
  if (!path.endsWith('.md') && !isHtmlPath(path)) {
    throw new ActionError({
      code: 'invalid_argument',
      message: `delete only accepts a single .md or .html file, got "${path}"`,
    });
  }

  const raw = await store.readFile(path);
  const { frontmatter } = parseFrontmatter(raw);
  const name = entityName(frontmatter, path);

  // Scan only — deletion never rewrites (04 §3.2 step 3).
  const sites = await scanRefs(store, path, path);
  const danglingRefs = sites.map((s) => ({
    file: s.file,
    target: s.target,
    reason: 'ambiguous' as const,
  }));

  // Step 4: the card and every line touching it go with the file.
  store.dropCard(path);

  await store.deleteFile(path);

  let event: WorldEvent;
  try {
    event = await store.appendEvent({
      type: 'entity_deleted',
      actor,
      detail: { path, name, ...commandDetail(ctx) },
      subject: path,
      layer: (await store.resolveLayer(path)) ?? undefined,
      turn: ctx.turn,
    });
  } catch (err) {
    throw new ActionError({
      code: 'event_failed',
      message: `Entity "${path}" was deleted but the world event could not be recorded: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return {
    text: `${actorLabel(actor)} deleted "${name}" (${path}).${danglingRefs.length > 0 ? ` ${danglingRefs.length} reference(s) now point at nothing.` : ''}`,
    details: { path, name, dangling: danglingRefs.length, danglingRefs, event },
  };
}

/**
 * Frontmatter/body edit that lands `entity_edited` (04 §3.3). No reference scan
 * — the reference graph did not change, only the file's own content.
 */
export async function editEntity(
  ctx: ActionContext,
  input: EditEntityInput
): Promise<ActionResult<EditEntityDetails>> {
  const { store, actor } = ctx;
  const path = input.path;

  const kind = await store.statKind(path);
  if (kind !== 'file') {
    throw new ActionError({ code: 'not_found', message: `Entity not found: "${path}"` });
  }
  const agentScope: AgentScope =
    ctx.agentScope ??
    (actor.type === 'character' ? 'character' : actor.type === 'player' ? 'player' : 'writer-top-level');
  const manifest = await store.getManifest();
  assertNookMutationAllowed(
    actor,
    agentScope,
    path,
    'edit',
    manifest.characters.map((character) => character.id),
  );

  const raw = await store.readFile(path);
  const parsed = parseFrontmatter(raw);
  // `eventKindOf` is computed BEFORE the merge so an edit can never reclassify
  // the entity it edits (04 §3.3 step 1).
  const eventKind = eventKindOf(parsed.frontmatter, path);

  let merged = parsed.frontmatter ? { ...parsed.frontmatter } : {};
  if (input.frontmatter) {
    for (const [key, value] of Object.entries(input.frontmatter)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
  }
  // The appearance gate uses the semantic kind of the merged entity; eventKind
  // above intentionally remains anchored to the pre-edit entity for history.
  const semanticKind = resolveComponentKind(merged, path.split('/').pop() ?? path);
  if (merged.component === 'photo' && Object.prototype.hasOwnProperty.call(merged, 'image')) {
    await assertImageAsset(store.worldRoot, merged.image as string);
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'appearance')) {
    const appearance = validateAppearanceInput(merged.appearance, semanticKind);
    if (!appearance.ok) {
      const issue = appearance.issues[0];
      throw new ActionError({
        code: 'invalid_argument',
        message: issue?.message ?? `Invalid appearance for component kind "${semanticKind}".`,
        details: { issues: appearance.issues },
      });
    }
  }
  // `body` replaces, `append_body` appends, and passing both is refused rather
  // than resolved: whichever won, the caller's other argument would have been
  // silently ignored. Joining uses `renderAppend` — the SAME rule the chalk tool
  // applies (04 §3.5: one join rule in the repo, 契约 §8 反模式 3).
  if (input.body !== undefined && input.append_body !== undefined) {
    throw new ActionError({
      code: 'invalid_argument',
      message: `"${path}" was given both "body" (replace) and "append_body" (append); pass exactly one.`,
    });
  }
  const body =
    input.append_body === undefined
      ? (input.body ?? parsed.body)
      : renderAppend(parsed.body ?? '', input.append_body);
  const next = stringifyFrontmatter(Object.keys(merged).length > 0 ? merged : null, body);
  await store.writeFileAtomic(path, next);

  const name = entityName(merged, path);

  let event: WorldEvent;
  try {
    event = await store.appendEvent({
      type: 'entity_edited',
      actor,
      detail: { path, name, kind: eventKind, ...commandDetail(ctx) },
      subject: path,
      layer: (await store.resolveLayer(path)) ?? undefined,
      turn: ctx.turn,
    });
  } catch (err) {
    throw new ActionError({
      code: 'event_failed',
      message: `File "${path}" was edited but the world event could not be recorded: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return {
    text: `${actorLabel(actor)} edited "${name}" (${path}).`,
    details: { path, name, kind: eventKind, event },
  };
}

/** Card footprint for a file, from the ONE size table (04 §3.9.2). */
export function seatFileOf(
  frontmatter: Record<string, unknown> | null,
  path: string
): { path: string; w: number; h: number } {
  const form = cardFormOf(frontmatter ?? undefined, path);
  return { path, w: form.w, h: form.h };
}

registerAction('removeEntity', (ctx, input) =>
  removeEntity(ctx, input as unknown as RemoveEntityInput)
);
registerAction('editEntity', (ctx, input) => editEntity(ctx, input as unknown as EditEntityInput));
