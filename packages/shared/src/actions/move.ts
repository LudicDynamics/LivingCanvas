/**
 * doc 04 `move` — the ONLY entry point for moving a world object file, used for
 * take / drop / place / give (doc-20 §5). It walks the nine steps of 04 §3.1 in
 * order; the store does the physical half (`moveFile`), this file does
 * validation, canvas migration, seating and the `entity_moved` event.
 */
import { entityName, parseFrontmatter } from '../schemas/frontmatter.js';
import type { DanglingRef } from '../schemas/events.js';
import { ActionError } from './errors.js';
import { assertNookMutationAllowed } from './actor.js';
import type { AgentScope } from './actor.js';
import { registerAction } from './service.js';
import { actorLabel } from './actor.js';
import { seatFileOf } from './delete.js';
import { isHtmlPath } from '../rules/html-head.js';
import { commandDetail } from './types.js';
import type { ActionContext, ActionResult } from './types.js';

export interface MoveEntityInput {
  /** World-relative, POSIX, no leading './' (00 §2.1). Must be an existing .md file. */
  from: string;
  /** Destination. A layer directory is accepted and the filename is kept (§3.7). */
  to: string;
  /** Optional. An entity path that MUST sit in the same layer as the final `to`. */
  near?: string;
}

export interface MoveEntityDetails {
  /** The stable new path == `to` after directory expansion. */
  path: string;
  from: string;
  to: string;
  /** Name read BEFORE the move (frontmatter title, else filename minus .md). */
  name: string;
  near?: string;
  /** Files rewritten in place (== rewroteFiles.length). */
  rewrote: number;
  /** References that could not be rewritten (== danglingRefs.length). */
  dangling: number;
  rewroteFiles: string[];
  danglingRefs: DanglingRef[];
  /** `near` was passed but is not meaningful (same-layer rename) — never silent. */
  nearIgnored?: true;
  /** Seating outcome; `exhausted` means no collision-free cell was found. */
  seat?: { exhausted: boolean };
}

/** Path discipline shared by `from` / `to` / `near` (00 §2.1 + 00 §2.4). */
function assertEntityPath(path: string, label: string): void {
  if (path.includes('\\')) {
    throw new ActionError({
      code: 'invalid_path',
      message: `${label} must use POSIX separators, got "${path}"`,
    });
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new ActionError({
      code: 'invalid_path',
      message: `${label} must be world-relative, got "${path}"`,
    });
  }
  if (path.split('/').includes('..')) {
    throw new ActionError({
      code: 'invalid_path',
      message: `${label} must not contain "..", got "${path}"`,
    });
  }
  const first = path.split('/')[0];
  if (first.startsWith('.') || path.split('/').includes('node_modules')) {
    throw new ActionError({
      code: 'invalid_path',
      message: `${label} is inside a reserved prefix: "${path}"`,
    });
  }
}

export async function moveEntity(
  ctx: ActionContext,
  input: MoveEntityInput
): Promise<ActionResult<MoveEntityDetails>> {
  const { store, actor } = ctx;
  const from = input.from;
  let to = input.to;

  // ---- 1. validate from / to ----
  assertEntityPath(from, 'from');
  assertEntityPath(to, 'to');

  const fromKind = await store.statKind(from);
  if (fromKind === 'missing') {
    throw new ActionError({ code: 'not_found', message: `Entity not found: "${from}"` });
  }
  if (fromKind === 'dir') {
    throw new ActionError({
      code: 'not_movable',
      message: `move only accepts a single .md file, got a directory: "${from}"`,
    });
  }
  const agentScope: AgentScope =
    ctx.agentScope ??
    (actor.type === 'character' ? 'character' : actor.type === 'player' ? 'player' : 'writer-top-level');
  const manifest = await store.getManifest();
  assertNookMutationAllowed(
    actor,
    agentScope,
    from,
    'move',
    manifest.characters.map((character) => character.id),
  );
  if (from.endsWith('/README.md') || from === 'README.md') {
    throw new ActionError({
      code: 'not_movable',
      message: `README.md is a layer's identity and cannot be moved: "${from}"`,
    });
  }
  if (!from.endsWith('.md') && !isHtmlPath(from)) {
    throw new ActionError({
      code: 'invalid_argument',
      message: `move only accepts a single .md or .html entity, got "${from}"`,
    });
  }

  // ---- 2. read the name BEFORE the file moves (events must be self-sufficient) ----
  const rawFrom = await store.readFile(from);
  const { frontmatter } = parseFrontmatter(rawFrom);
  const name = entityName(frontmatter, from);

  // ---- 3. resolve the final target; never overwrite ----
  if (!to.endsWith('.md') && !isHtmlPath(to)) {
    const asLayer = await store.resolveLayer(to);
    if (asLayer === null) {
      throw new ActionError({
        code: 'invalid_argument',
        message: `Move destination "${to}" is neither a .md nor a .html path nor a known layer directory`,
      });
    }
    to = `${to.replace(/\/+$/, '')}/${from.split('/').pop()}`;
  }
  assertNookMutationAllowed(
    actor,
    agentScope,
    to,
    'move',
    manifest.characters.map((character) => character.id),
  );
  if (to === from) {
    throw new ActionError({ code: 'invalid_argument', message: `Cannot move a file onto itself: "${to}"` });
  }
  if ((await store.statKind(to)) !== 'missing') {
    throw new ActionError({ code: 'already_exists', message: `Target already exists: "${to}"` });
  }

  // ---- 4. validate `near` (04 §2.3) ----
  let near = input.near;
  if (near !== undefined) {
    assertEntityPath(near, 'near');
    if ((await store.statKind(near)) === 'dir') {
      throw new ActionError({
        code: 'near_out_of_layer',
        message: `near must be an entity path, not a layer directory: "${near}"`,
      });
    }
    if ((await store.statKind(near)) === 'missing') {
      throw new ActionError({ code: 'not_found', message: `Entity not found: "${near}"` });
    }
    const nearLayer = await store.resolveLayer(near);
    const destLayer = await store.resolveLayer(to);
    if (nearLayer !== destLayer) {
      throw new ActionError({
        code: 'near_out_of_layer',
        message: `near "${near}" is not in the destination layer "${destLayer ?? to}"`,
        details: { near, layer: destLayer },
      });
    }
  }

  const fromLayer = await store.resolveLayer(from);
  const destLayer = await store.resolveLayer(to);
  // `near` only means something when the entity actually changes layer (§3.9.4).
  const nearIgnored = near !== undefined && fromLayer === destLayer && destLayer !== null;
  if (nearIgnored) near = undefined;

  // ---- 5–7. physical move + reference rewrite + self-rebase ----
  const { rewrote, dangling } = await store.moveFile(from, to);

  // ---- 8. canvas migration (silent failure is the bug this replaces) ----
  await store.renameCardPosition(from, to);

  // ---- 9. seating (only for a NEW card in a layer) + event ----
  let seat: { exhausted: boolean } | undefined;
  if (destLayer !== null) {
    const existing = store.getLayerCards([to])[0];
    if (!existing) {
      const seatFile = seatFileOf(
        // Re-read: the moved file is the only authority on its own kind.
        parseFrontmatter(await store.readFile(to)).frontmatter,
        to
      );
      if (near !== undefined) {
        const placed = await store.seatNear(destLayer, seatFile, near);
        seat = { exhausted: placed.exhausted };
      } else {
        await store.seatUnplaced(destLayer, [seatFile]);
        seat = { exhausted: false };
      }
    }
  }

  let event;
  try {
    event = await store.appendEvent({
      type: 'entity_moved',
      actor,
      detail: {
        from,
        to,
        name,
        ...(input.near !== undefined ? { near: input.near } : {}),
        rewrote: rewrote.length,
        dangling: dangling.length,
        ...commandDetail(ctx),
      },
      subject: to,
      // Layer keeps the end that is in the world tree (01 §3.9).
      layer: fromLayer ?? destLayer ?? undefined,
      turn: ctx.turn,
    });
  } catch (err) {
    throw new ActionError({
      code: 'event_failed',
      message: `File was moved to "${to}" but the world event could not be recorded: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const notes: string[] = [];
  if (nearIgnored) {
    notes.push(
      `near "${input.near}" was ignored: the entity did not change layer, and an already-seated card is never re-flowed`
    );
  }
  if (seat?.exhausted) {
    notes.push('the card was placed near the anchor but could not avoid overlapping');
  }

  return {
    text:
      `${actorLabel(actor)} moved "${name}" from ${from} to ${to} (rewrote ${rewrote.length}, dangling ${dangling.length}).` +
      (notes.length > 0 ? ` ${notes.join(' ')}` : ''),
    details: {
      path: to,
      from,
      to,
      name,
      ...(input.near !== undefined ? { near: input.near } : {}),
      rewrote: rewrote.length,
      dangling: dangling.length,
      rewroteFiles: [...new Set(rewrote)].sort(),
      danglingRefs: dangling,
      ...(nearIgnored ? { nearIgnored: true as const } : {}),
      ...(seat ? { seat } : {}),
      event,
    },
  };
}

registerAction('moveEntity', (ctx, input) => moveEntity(ctx, input as unknown as MoveEntityInput));
