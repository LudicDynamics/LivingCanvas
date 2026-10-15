/**
 * doc-tools/08 `use_item_on` — apply one item to another entity.
 *
 * The binary relation the engine records: item A acts on entity B. The call
 * itself never consumes or moves the item (doc-08 §3.2, doc-20:289); the only
 * world change `use_item_on` itself makes is the `use_item_on` event row. The
 * target may also change — but only through its own component's deterministic
 * handler, and only by rewriting the target's own frontmatter (doc-08 §3.4).
 *
 * Seven steps, order fixed (doc-08 §3.1):
 *   resolve paths → read item → read target → run handler → append event →
 *   assemble details/text → return.
 */
import { createHash } from 'node:crypto';
import { entityName, parseFrontmatter } from '../schemas/frontmatter.js';
import type { ParsedFrontmatter } from '../schemas/frontmatter.js';
import type { WorldEvent } from '../schemas/events.js';
import { componentDefOf, resolveComponentKind } from '../components/registry.js';
import type { EntityRef, HandlerOutcome } from '../components/types.js';
import { ActionError, fail } from './errors.js';
import { registerAction } from './service.js';
import type { ActionContext, ActionResult } from './types.js';
import { runTriggeredCommands } from '../commands/trigger.js';
import { commandReceiptText, commandReceipts } from '../commands/receipt.js';

export interface UseItemOnInput {
  /** World-relative path of the item being applied (a single .md file). */
  item: string;
  /** World-relative path of the entity it is applied to. */
  target: string;
}

/**
 * The closed reason codes the renderer gives fixed human lines to. A handler
 * may return its own code (open string), which degrades to "no response"
 * (doc-08 §7.2).
 */
export type UseItemOnReason = 'no_handler' | 'wrong_item' | 'already_open' | 'not_ready' | string;

/** What the frontend plays on drop; supplied by the action layer, never guessed (doc-08 §6.1). */
export interface UseItemOnPresentation {
  foley: 'unlock' | 'paper-slide' | 'none';
  burst: 'unlock' | 'present' | 'none';
}

export interface UseItemOnDetails {
  /** Normalized item path (stable id). */
  item: string;
  /** The item's display name at this moment. */
  itemName: string;
  target: string;
  targetName: string;
  /** The target's registry kind, or null when the engine does not know it. */
  targetKind: string | null;
  /** Whether the target's deterministic handler processed the application. */
  handled: boolean;
  /** One-line handler summary (null when handled=false). */
  effect: string | null;
  /** Handler refusal code, `details` only — never written to the event (REVIEW m-13). */
  reason: UseItemOnReason | null;
  /** The `use_item_on` event row. */
  event: WorldEvent;
  presentation: UseItemOnPresentation;
}

/**
 * doc-08 §3.1 step 1 — the path discipline every action re-checks (01 §7.2
 * copy). The store re-checks too; this gives a precise message and fails before
 * any I/O.
 */
export function assertEntityPath(path: unknown, label: string): string {
  if (typeof path !== 'string' || path === '') {
    fail('invalid_argument', `"${label}" must be a world-relative path, got an empty string`);
  }
  // A leading './' is normalized away, not rejected — same tolerance as
  // look_at's assertSafePath (00 §2.1).
  const rel = path.replace(/^\.\//, '');
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
    fail('invalid_path', `Path must be world-relative, got "${path}"`);
  }
  if (rel.includes('\\')) {
    fail('invalid_path', `Path must use POSIX separators, got "${path}"`);
  }
  if (rel.split('/').includes('..')) {
    fail('invalid_path', `Path must not contain "..", got "${path}"`);
  }
  // `.airpworld/assets/**` is the one allowed hidden root (00 §2.5), but it is
  // binary content, never a use_item_on endpoint.
  const segs = rel.split('/').filter((s) => s !== '');
  if (segs.some((s) => s.startsWith('.')) || segs.includes('node_modules')) {
    fail('invalid_path', `Path is inside a reserved directory: "${path}"`);
  }
  return rel;
}

/** doc-08 §3.1 step 2/3 — a parsed `.md` entity with its name at this moment. */
export function toEntityRef(
  path: string,
  parsed: { frontmatter: Record<string, any> | null; body: string }
): EntityRef {
  return {
    path,
    name: entityName(parsed.frontmatter, path),
    frontmatter: parsed.frontmatter ?? {},
    body: parsed.body,
  };
}

/**
 * doc-08 §6.1 — `handled` × target class → what the frontend plays.
 * A target is "character-like" when it is a canvas sprite or a character
 * presence under `characters/<id>/` (the L2 "show evidence" move, doc-19:172).
 */
export function pickPresentation(
  handled: boolean,
  resolvedKind: string,
  targetPath: string
): UseItemOnPresentation {
  if (handled) return { foley: 'unlock', burst: 'unlock' };
  const characterLike = resolvedKind === 'sprite' || targetPath.startsWith('characters/');
  if (characterLike) return { foley: 'paper-slide', burst: 'present' };
  return { foley: 'none', burst: 'none' };
}

/** doc-08 §12 #3: `effect` is one line, at most 120 chars; sliced, never an error. */
const EFFECT_MAX = 120;

function effectOf(outcome: HandlerOutcome): string | null {
  if (!outcome.handled) return null;
  const summary = outcome.summary;
  if (typeof summary !== 'string' || summary === '') return null;
  return summary.length > EFFECT_MAX ? summary.slice(0, EFFECT_MAX) : summary;
}

/**
 * doc-08 §2.3 — the exact English templates. Every branch carries both names
 * and both paths so the writer and the UI can point at either card.
 */
export function renderText(
  item: EntityRef,
  target: EntityRef,
  outcome: HandlerOutcome,
  targetKind: string | null
): string {
  const head = `Used "${item.name}" (${item.path}) on "${target.name}" (${target.path}).`;
  if (outcome.handled) {
    const effect = effectOf(outcome);
    return effect ? `${head} ${effect}` : head;
  }
  if (!('reason' in outcome) || outcome.reason === undefined || outcome.reason === 'no_handler') {
    return `${head} ${target.name} has not reacted yet — nothing in the world changed.`;
  }
  return `${head} The ${targetKind ?? 'target'} did not respond to it.`;
}

/** A missing / unreadable file becomes `not_found`, never a raw store error. */
async function readEntity(
  ctx: ActionContext,
  path: string,
  label: 'Item' | 'Target'
): Promise<ParsedFrontmatter> {
  try {
    return parseFrontmatter(await ctx.store.readFile(path));
  } catch (err) {
    if (err instanceof ActionError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR') {
      fail('not_found', `${label} not found: "${path}"`);
    }
    fail('internal', `Could not read "${path}": ${(err as Error).message}`);
  }
}

/**
 * Record that an item was applied to a target (doc-tools/08).
 */
export async function useItemOn(
  ctx: ActionContext,
  input: UseItemOnInput
): Promise<ActionResult<UseItemOnDetails>> {
  const itemPath = assertEntityPath(input.item, 'item');
  const targetPath = assertEntityPath(input.target, 'target');

  // Step 2/3 — existence and shape. A directory is a path error, not "missing":
  // the world does contain something there, it just is not a single .md entity.
  const itemStat = await ctx.store.statKind(itemPath);
  if (itemStat === 'dir') {
    fail('invalid_path', `use_item_on takes a single .md file as "item", got a directory: "${itemPath}"`);
  }
  if (itemStat === 'missing') {
    fail('not_found', `Item not found: "${itemPath}"`);
  }
  if (!itemPath.endsWith('.md')) {
    fail('invalid_path', `use_item_on takes a single .md file as "item", got "${itemPath}"`);
  }
  if (itemPath === 'README.md' || itemPath.endsWith('/README.md')) {
    fail('invalid_path', `A layer's README is its identity, not an item: "${itemPath}"`);
  }

  const targetStat = await ctx.store.statKind(targetPath);
  if (targetStat === 'dir') {
    fail('invalid_path', `use_item_on takes a single .md file as "target", got a directory: "${targetPath}"`);
  }
  const itemParsed = await readEntity(ctx, itemPath, 'Item');
  const targetParsed = await readEntity(ctx, targetPath, 'Target');
  const itemRef = toEntityRef(itemPath, itemParsed);
  const targetRef = toEntityRef(targetPath, targetParsed);

  // Step 4 — handler lookup keyed on the TARGET's kind, never the item's
  const resolvedKind = resolveComponentKind(targetRef.frontmatter, targetPath.split('/').pop() ?? '');
  const def = componentDefOf(resolvedKind);
  const targetKind = def ? resolvedKind : null;
  const handler = def?.handler ?? null;

  let outcome: HandlerOutcome = { handled: false, reason: 'no_handler' };
  if (handler) {
    try {
      outcome = await handler({
        item: itemRef,
        target: targetRef,
        actor: ctx.actor,
        store: ctx.store,
        turn: ctx.turn,
      });
    } catch (err) {
      // A handler failure lands nothing (doc-08 §7.1). A store write failure is
      // already an ActionError and keeps its own code (write_failed).
      if (err instanceof ActionError) throw err;
      fail(
        'internal',
        `The target's handler for "${targetPath}" failed: ${(err as Error).message}`
      );
    }
  }

  const effect = effectOf(outcome);
  const layer = await ctx.store.resolveLayer(targetPath);

  // Step 5 — the event lands unconditionally on the success path, `handled:false`
  // included (doc-08 §3.1; doc-21:250 "不论是否破例，事件照落").
  let event: WorldEvent;
  try {
    event = await ctx.store.appendEvent({
      type: 'use_item_on',
      actor: ctx.actor,
      subject: targetPath,
      turn: ctx.turn,
      layer: layer ?? undefined,
      detail: {
        item: itemPath,
        itemName: itemRef.name,
        target: targetPath,
        targetName: targetRef.name,
        targetKind,
        handled: outcome.handled,
        effect,
      },
    });
  } catch (err) {
    // doc-08 §4.2: if the handler already rewrote the target, the file stands —
    // no rollback, no compensating event (01 §3.6).
    fail(
      'event_failed',
      outcome.handled
        ? 'File was written but the world event could not be recorded'
        : `The world event could not be recorded: ${(err as Error).message}`
    );
  }

  let reason: UseItemOnReason | null = null;
  if (!outcome.handled) reason = outcome.reason ?? 'no_handler';

  // Steps 11b/12 — world commands bound to `on.use_item_on` (the design notes
  // §3). The trigger entity is the TARGET, not the item: the handler lookup
  // above is already keyed on the target's kind, and binding follows the same
  // discipline so one action cannot have two entities each claiming the
  // consequences. A handler may have rewritten the target's `status.data`, but
  // never its `on` — so `targetRef.frontmatter` is still the right snapshot.
  const commands = await runTriggeredCommands(ctx, {
    source: targetPath,
    hook: 'use_item_on',
    mode: 'fresh',
    parsed: targetParsed,
    facts: {
      'item.path': itemPath,
      // `02:517`: the fact component is the item path plus its content hash —
      // the item is the varying half, the target is the binding's home.
      'item.sha256': createHash('sha256')
        .update(`${JSON.stringify(itemRef.frontmatter)}|${itemRef.body}`, 'utf8')
        .digest('hex'),
      'item.name': itemRef.name,
      'target.path': targetPath,
      'target.name': targetRef.name,
      'target.kind': targetKind,
      handled: outcome.handled,
      effect,
      reason,
      'trigger.path': targetPath,
      'trigger.name': targetRef.name,
      'trigger.id': null,
      actor: ctx.actor.type,
      actor_id: ctx.actor.id ?? null,
      layer,
    },
  });

  // Original action sentence FIRST, receipt after (the design notes /
  // §8.2 item 3). `''` when no command matched keeps the text unchanged.
  return {
    text: renderText(itemRef, targetRef, outcome, targetKind) + commandReceiptText(commandReceipts(commands)),
    details: {
      item: itemPath,
      itemName: itemRef.name,
      target: targetPath,
      targetName: targetRef.name,
      targetKind,
      handled: outcome.handled,
      effect,
      reason,
      presentation: pickPresentation(outcome.handled, resolvedKind, targetPath),
      event,
      ...(commands ? { commands } : {}),
    },
  };
}

registerAction('useItemOn', (ctx, input) => useItemOn(ctx, input as unknown as UseItemOnInput));
