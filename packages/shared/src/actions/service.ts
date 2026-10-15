import { randomUUID } from 'node:crypto';
import type { WorldStore } from '../store/world-store.js';
import type { ActionContext, ActionDetails, ActionResult } from './types.js';
import type { Actor, AgentScope } from './actor.js';
import { fail } from './errors.js';
import { assertNotEnded } from './closed-world-state.js';
import type { CreateCharInvocation } from './create-char.js';

/**
 * `createActionService` is the single action entry point shared by the server
 * routes and the agent extension tools (00 §1 / doc-20 §12): both `new` their
 * own `WorldStore`, but both call this function, so the UI and the agent can
 * never run two sets of dice / move / choice semantics.
 *
 * The service binds the frozen twenty-four method names and dispatches each to
 * a handler that the per-tool modules (02–11) register into `ACTION_REGISTRY`.
 * This module therefore carries no business logic — only the binding table —
 * which is exactly the split 01 §2.1 asks for, and it lets the shared skeleton
 * compile before any tool module exists.
 */

/** Inputs are passed through opaquely; each tool module owns its real shape. */
export type ActionInput = Record<string, unknown>;

export type ActionHandler = (ctx: ActionContext, input: ActionInput) => Promise<ActionResult>;

/**
 * The frozen method list (01 §2.6 + §5: 22 tool methods and the 2 extra
 * `createEntity` / `carryFollowers` rows). The names are the contract; the
 * per-tool input and detail types live with their own modules and are applied
 * by the callers that know them.
 */
export interface ActionService {
  readonly ctx: ActionContext;
  readonly actor: Actor;

  // — doc-03 (read-only, no event) —
  lookAt(input: ActionInput): Promise<ActionResult>;
  viewCanvas(input: ActionInput): Promise<ActionResult>;
  // — doc-02 —
  writeChalk(input: ActionInput): Promise<ActionResult>;
  // — doc-04 —
  moveEntity(input: ActionInput): Promise<ActionResult>;
  removeEntity(input: ActionInput): Promise<ActionResult>;
  editEntity(input: ActionInput): Promise<ActionResult>;
  // — doc-05 —
  moveCharacter(input: ActionInput): Promise<ActionResult>;
  setFollowing(input: ActionInput): Promise<ActionResult>;
  carryFollowers(input: ActionInput): Promise<ActionResult>;
  // — doc-06 —
  chooseOption(input: ActionInput): Promise<ActionResult>;
  // — doc-07 —
  rollDice(input: ActionInput): Promise<ActionResult>;
  // — doc-08 —
  useItemOn(input: ActionInput): Promise<ActionResult>;
  // — doc-09 (no event; canvas.db state only) —
  linkCards(input: ActionInput): Promise<ActionResult>;
  arrangeCards(input: ActionInput): Promise<ActionResult>;
  /** Canonical collision-safe canvas arrangement for the functional agent. */
  arrangeCanvas(input: ActionInput): Promise<ActionResult>;
  getComponent(input: ActionInput): Promise<ActionResult>;
  showComponent(input: ActionInput): Promise<ActionResult>;
  // — doc-11 —
  generateImage(input: ActionInput): Promise<ActionResult>;
  // — doc-11 / doc-12 —
  enterLayer(input: ActionInput): Promise<ActionResult>;
  noteCharacterTalked(input: ActionInput): Promise<ActionResult>;
  recordLayerInitialized(input: ActionInput): Promise<ActionResult>;
  /** The ONE action that appends an event while reporting failure (doc-21 §3.6). */
  recordLayerInitFailed(input: ActionInput): Promise<ActionResult>;
  // — doc-12 (god create branch) —
  createEntity(input: ActionInput): Promise<ActionResult>;
  // — search → dice chalk —
  searchPlace(input: ActionInput): Promise<ActionResult>;
  // — one use of a skill = one check —
  skillCheck(input: ActionInput): Promise<ActionResult>;
  // — the four outcome tiers' consequences —
  diceConsequence(input: ActionInput): Promise<ActionResult>;
  settleDiceConsequences(input: ActionInput): Promise<ActionResult>;
  // — Writer/Character configuration maintenance —
  editCharacterConfig(input: ActionInput): Promise<ActionResult>;
  // — Writer-only character assembly —
  createChar(invocation: CreateCharInvocation): Promise<ActionResult>;
  snapshotWorld(input: ActionInput): Promise<ActionResult>;
  rollbackWorld(input: ActionInput): Promise<ActionResult>;
  // — music —
  setMusic(input: ActionInput): Promise<ActionResult>;
}

/** The registered method names, in the order 01 §5 lists them. */
export const ACTION_METHODS = [
  'lookAt',
  'viewCanvas',
  'writeChalk',
  'moveEntity',
  'removeEntity',
  'editEntity',
  'editCharacterConfig',
  'moveCharacter',
  'setFollowing',
  'carryFollowers',
  'chooseOption',
  'rollDice',
  'useItemOn',
  'linkCards',
  'arrangeCards',
  'arrangeCanvas',
  'getComponent',
  'showComponent',
  'generateImage',
  'enterLayer',
  'noteCharacterTalked',
  'recordLayerInitialized',
  'createChar',
  'recordLayerInitFailed',
  'createEntity',
  'searchPlace',
  'skillCheck',
  'diceConsequence',
  'settleDiceConsequences',
  'snapshotWorld',
  'rollbackWorld',
  'setMusic',
] as const;

export type ActionMethodName = (typeof ACTION_METHODS)[number];

const ACTION_REGISTRY = new Map<ActionMethodName, ActionHandler>();

/**
 * Called by the per-tool modules (02–11) at import time. A handler receives the
 * service's `ActionContext` plus the caller's input and returns the frozen
 * `{ text, details }`, or throws an `ActionError`.
 */
export function registerAction(name: ActionMethodName, handler: ActionHandler): void {
  ACTION_REGISTRY.set(name, handler);
}

/** Test seam: the probe / unit tests drop registrations between worlds. */
export function clearActionRegistry(): void {
  ACTION_REGISTRY.clear();
}

/**
 * Cross-cutting hooks around every action: the
 * trigger layer registers one at load time, the same way action modules
 * register handlers, so this module never imports the engine (an import here
 * would be a load cycle through the action modules).
 *
 *   - `before` may refuse the action by throwing an `ActionError`;
 *   - `after` sees the committed result and may return an augmented one. It
 *     MUST NOT throw; if it does anyway, the action's own result is kept.
 */
export interface ActionHook {
  before?(name: ActionMethodName, ctx: ActionContext, input: ActionInput): Promise<void>;
  after?(name: ActionMethodName, ctx: ActionContext, input: ActionInput, result: ActionResult): Promise<ActionResult>;
}

const ACTION_HOOKS: ActionHook[] = [];

export function registerActionHook(hook: ActionHook): void {
  if (!ACTION_HOOKS.includes(hook)) ACTION_HOOKS.push(hook);
}

async function invoke(name: ActionMethodName, ctx: ActionContext, input: ActionInput): Promise<ActionResult> {
  const handler = ACTION_REGISTRY.get(name);
  if (!handler) {
    fail('unsupported', `Action '${name}' is not implemented yet (no handler registered)`);
  }
  // A closed world that has ended accepts only reading and talking — for every
  // caller, player, writer and character agent alike.
  await assertNotEnded(ctx.store, name, ctx.turn);
  for (const hook of ACTION_HOOKS) await hook.before?.(name, ctx, input);
  let result = await handler(ctx, input);
  for (const hook of ACTION_HOOKS) {
    if (!hook.after) continue;
    try {
      result = await hook.after(name, ctx, input, result);
    } catch {
      // The action already committed; a hook failure never turns it into an error.
    }
  }
  return result;
}

export function createActionService(
  store: WorldStore,
  actor: Actor,
  opts?: { turn?: string; now?: () => string; rng?: () => number; agentScope?: AgentScope }
): ActionService {
  const ctx: ActionContext = {
    store,
    actor,
    agentScope: opts?.agentScope ?? (process.env.AIRP_AGENT_SCOPE as AgentScope | undefined),
    // One service instance = one batch anchor (01 §2.6): the C entry passes a
    // `req:<uuid>`; the A entry passes the agent's `turn:<session>:<n>`.
    turn: opts?.turn ?? `svc:${randomUUID()}`,
    now: opts?.now,
    rng: opts?.rng,
  };
  const bind = (name: ActionMethodName) => (input: ActionInput) => invoke(name, ctx, input);

  const service = { ctx, actor } as ActionService;
  for (const name of ACTION_METHODS) {
    (service as unknown as Record<string, unknown>)[name] = bind(name);
  }
  return service;
}
