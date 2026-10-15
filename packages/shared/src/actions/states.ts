/**
 * Declared states, write + read side over the world's files
 *. The pure rules are `rules/states.ts`.
 *
 * A state's declaration is `states:` in the frontmatter of the README it
 * describes; its current value is that same file's `status.data[id]`. The ONLY
 * write paths are the `set_state` / `add_state` command effects and a roll's
 * declared harm — the writer cannot edit a declared state (`assertStateWriteAllowed`).
 */
import { entityName, parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import type { WorldEvent } from '../schemas/events.js';
import type { WorldStore } from '../store/world-store.js';
import {
  clampState,
  currentStateValue,
  normalizeStateWrite,
  parseStateDecls,
  type StateDecl,
  type StateValue,
} from '../rules/states.js';
import { ActionError } from './errors.js';
import type { ActionContext } from './types.js';
import { editEntity, eventKindOf } from './delete.js';
import { commandDetail } from './types.js';

const CHARACTER_TARGET = /^(?:characters\/)?([a-z0-9][a-z0-9-]*)\/?(?:README\.md)?$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `player` / `world` / `characters/<id>` (or a bare `<id>`) → the README that
 * declares the state. Throws `invalid_argument` on anything else.
 */
export function stateFileOf(target: string): string {
  const t = String(target ?? '').trim().replace(/\/+$/, '');
  if (t === 'player' || t === 'player/README.md') return 'player/README.md';
  if (t === 'world' || t === 'world/README.md') return 'world/README.md';
  const m = CHARACTER_TARGET.exec(t);
  if (m && m[1] !== 'player' && m[1] !== 'world') return `characters/${m[1]}/README.md`;
  throw new ActionError({
    code: 'invalid_argument',
    message: `state target "${target}" must be player, world or characters/<id>`,
  });
}

/** Paths whose frontmatter may declare states. */
export function isStateFile(path: string): boolean {
  return path === 'player/README.md' || path === 'world/README.md' || /^characters\/[a-z0-9][a-z0-9-]*\/README\.md$/.test(path);
}

export interface StateFile {
  path: string;
  states: StateDecl[];
  data: Record<string, unknown>;
  frontmatter: Record<string, unknown>;
}

/** Read one state file; `null` when it does not exist. */
export async function readStateFile(store: WorldStore, path: string): Promise<StateFile | null> {
  if ((await store.statKind(path)) !== 'file') return null;
  const fm = parseFrontmatter(await store.readFile(path)).frontmatter ?? {};
  const status = isPlainObject(fm.status) ? fm.status : {};
  const data = isPlainObject(status.data) ? status.data : {};
  return { path, states: parseStateDecls(fm).states, data, frontmatter: fm };
}

export interface StateWrite {
  target: string;
  state: string;
  /** Absolute value (`set_state`). */
  value?: unknown;
  /** Relative change (`add_state`); numbers only. */
  by?: unknown;
}

export interface StateWriteResult {
  path: string;
  state: string;
  previous: StateValue;
  value: StateValue;
  event?: WorldEvent;
  /** True when the value did not change (no write, no event). */
  unchanged: boolean;
}

/**
 * Set or move one declared state, clamped to its range. The change lands
 * through `editEntity` (one `entity_edited`, whose detail carries no value —
 * a hidden number never reaches the event log in plain sight).
 */
export async function writeState(ctx: ActionContext, input: StateWrite): Promise<StateWriteResult> {
  const path = stateFileOf(input.target);
  const file = await readStateFile(ctx.store, path);
  if (!file) throw new ActionError({ code: 'not_found', message: `Entity not found: "${path}"` });
  const decl = file.states.find((s) => s.id === input.state);
  if (!decl) {
    throw new ActionError({
      code: 'invalid_argument',
      message: `"${path}" declares no state "${input.state}" (declared: ${file.states.map((s) => s.id).join(', ') || 'none'})`,
    });
  }
  const previous = currentStateValue(decl, file.data);
  let next: StateValue;
  try {
    if (input.by !== undefined) {
      const by = typeof input.by === 'number' ? input.by : Number(input.by);
      if (decl.type !== 'number') throw new Error(`add_state needs a number state; "${decl.id}" is ${decl.type}`);
      if (!Number.isFinite(by)) throw new Error(`add_state "by" must be a number, got ${JSON.stringify(input.by)}`);
      next = clampState(decl, (previous as number) + by);
    } else {
      next = normalizeStateWrite(decl, input.value);
    }
  } catch (err) {
    throw new ActionError({ code: 'invalid_argument', message: (err as Error).message });
  }
  if (next === previous && file.data[decl.id] === next) {
    return { path, state: decl.id, previous, value: next, unchanged: true };
  }
  const status = isPlainObject(file.frontmatter.status) ? file.frontmatter.status : {};
  const nextStatus = { ...status, data: { ...file.data, [decl.id]: next } };
  if (path.startsWith('characters/')) {
    // A character README is a configuration file: every generic edit refuses
    // it (`edit_character_config` only, actions/actor.ts). A declared state's
    // value is the one field the state engine itself writes there — the same
    // single-key write and the same `entity_edited` editEntity would land.
    const event = await writeCharacterStateValue(ctx, path, nextStatus);
    return { path, state: decl.id, previous, value: next, event, unchanged: false };
  }
  const result = await editEntity(ctx, {
    path,
    frontmatter: { status: nextStatus },
  });
  return { path, state: decl.id, previous, value: next, event: result.details.event, unchanged: false };
}

async function writeCharacterStateValue(ctx: ActionContext, path: string, status: Record<string, unknown>): Promise<WorldEvent> {
  const parsed = parseFrontmatter(await ctx.store.readFile(path));
  const before = parsed.frontmatter ?? {};
  const merged = { ...before, status };
  await ctx.store.writeFileAtomic(path, stringifyFrontmatter(merged, parsed.body));
  try {
    return await ctx.store.appendEvent({
      type: 'entity_edited',
      actor: ctx.actor,
      detail: { path, name: entityName(merged, path), kind: eventKindOf(before, path), ...commandDetail(ctx) },
      subject: path,
      layer: (await ctx.store.resolveLayer(path)) ?? undefined,
      turn: ctx.turn,
    });
  } catch (err) {
    throw new ActionError({
      code: 'event_failed',
      message: `"${path}" was updated but the world event could not be recorded: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/**
 * Only world commands and dice change a declared state (the design notes
 * §5): an `editEntity` from an agent may not write a declared state's value,
 * nor rewrite the declarations or the trigger record. `god` (the author's own
 * hand) is exempt. Throws `invalid_argument`.
 */
export async function assertStateWriteAllowed(ctx: ActionContext, input: Record<string, unknown>): Promise<void> {
  if (ctx.actor.type === 'god' || ctx.actor.type === 'engine') return;
  const path = typeof input.path === 'string' ? input.path.replace(/^\/+/, '') : '';
  if (!isStateFile(path)) return;
  const fm = isPlainObject(input.frontmatter) ? input.frontmatter : null;
  if (!fm) return;
  if ('states' in fm || 'sheet' in fm || 'trigger_log' in fm || 'cg_log' in fm || 'living' in fm || 'run' in fm || 'tick' in fm) {
    throw new ActionError({
      code: 'invalid_argument',
      message: `"${path}": states, sheet, trigger_log, cg_log, living, run and tick belong to the world's author and engine; they cannot be edited in play.`,
    });
  }
  const status = isPlainObject(fm.status) ? fm.status : null;
  const data = status && isPlainObject(status.data) ? status.data : null;
  if (!data) return;
  const file = await readStateFile(ctx.store, path);
  if (!file) return;
  for (const decl of file.states) {
    if (!(decl.id in data)) continue;
    if (data[decl.id] === file.data[decl.id]) continue;
    throw new ActionError({
      code: 'invalid_argument',
      message:
        `"${path}": "${decl.label}" is a declared state; it changes only through dice and world commands. ` +
        'Describe what happened in words instead.',
    });
  }
}
