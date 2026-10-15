import { ActionError } from './errors.js';
import { characterIdOfPath, characterRootConfigOf, isValidCharacterId } from '../rules/characters.js';
import { isPlayerNotePath } from '../rules/player-notes.js';

/**
 * Event originators. `functional` is a deliberately narrow actor for
 * player-authorized maintenance agents; it is not an alias for trusted engine.
 */
export type ActorType = 'player' | 'god' | 'writer' | 'character' | 'engine' | 'functional';
export interface Actor {
  type: ActorType;
  /** character carries its id; functional carries only canvas-arranger. */
  id?: string;
}

/** The ONLY env var that carries agent identity (00 §3). */
export const AGENT_ROLE_ENV = 'AIRP_AGENT_ROLE';
export const CHARACTER_ROLE_PREFIX = 'character:';
export const FUNCTIONAL_ARRANGER_ROLE = 'functional:canvas-arranger' as const;
export const FUNCTIONAL_ARRANGER_SCOPE = 'functional-canvas-arranger' as const;

/**
 * Pure. Maps a raw `AIRP_AGENT_ROLE` value onto an Actor.
 * Never throws — an unknown role must not take down an agent process.
 * The caller logs `warning` ONCE (see extensions/toolkit/actor.ts); this
 * function stays pure so the whole degradation table is unit-testable.
 */
export function resolveAgentActor(raw: string | undefined): {
  actor: Actor;
  /** Human-readable warning the caller logs ONCE; null when nothing is off. */
  warning: string | null;
} {
  if (raw === FUNCTIONAL_ARRANGER_ROLE) {
    return { actor: { type: 'functional', id: 'canvas-arranger' }, warning: null };
  }
  if (raw === undefined || raw === '') {
    return { actor: { type: 'writer' }, warning: 'AIRP_AGENT_ROLE is not set; falling back to writer' };
  }
  if (raw === 'writer' || raw === 'scene-init' || raw === 'nook-init') {
    return { actor: { type: 'writer' }, warning: null };
  }
  if (raw.startsWith(CHARACTER_ROLE_PREFIX)) {
    const id = raw.slice(CHARACTER_ROLE_PREFIX.length);
    if (id === '') {
      return {
        actor: { type: 'writer' },
        warning: `AIRP_AGENT_ROLE='character:' has an empty id; falling back to writer`,
      };
    }
    return { actor: { type: 'character', id }, warning: null };
  }
  return { actor: { type: 'writer' }, warning: `Unknown AIRP_AGENT_ROLE='${raw}'; falling back to writer` };
}

/**
 * Functional arranger identity is a separate fail-closed entry point.  It
 * intentionally does not call the compatibility resolver above.
 */
export function resolveFunctionalArrangerActor(
  rawRole: string | undefined,
  rawScope: string | undefined,
): { actor: { type: 'functional'; id: 'canvas-arranger' }; agentScope: typeof FUNCTIONAL_ARRANGER_SCOPE } {
  if (rawRole !== FUNCTIONAL_ARRANGER_ROLE || rawScope !== FUNCTIONAL_ARRANGER_SCOPE) {
    throw new Error('Invalid functional arranger identity or scope.');
  }
  return {
    actor: { type: 'functional', id: 'canvas-arranger' },
    agentScope: FUNCTIONAL_ARRANGER_SCOPE,
  };
}

/**
 * Stable reader id for read_cursors (doc-21 §5.1/§5.2): 'writer' | 'character:<id>'.
 * Null for actors that never read the event stream (player/god/engine have no
 * cursor; their events are recorded but never merged into an injection).
 */
export function readerOfActor(actor: Actor): string | null {
  if (actor.type === 'writer') return 'writer';
  if (actor.type === 'character') {
    return actor.id ? `${CHARACTER_ROLE_PREFIX}${actor.id}` : null;
  }
  return null;
}

/** 'player' | 'god' | 'writer' | 'watson' — log / history-panel label. */
export function actorLabel(actor: Actor): string {
  if (actor.type === 'functional') return actor.id ?? 'canvas-arranger';
  if (actor.type === 'character') return actor.id ?? 'character';
  return actor.type;
}

/** 'player' | 'character:watson' — the compact form for detail fields that need it. */
export function actorRef(actor: Actor): string {
  if (actor.type === 'functional') return `functional:${actor.id ?? 'canvas-arranger'}`;
  if (actor.type === 'character') {
    return actor.id ? `${CHARACTER_ROLE_PREFIX}${actor.id}` : CHARACTER_ROLE_PREFIX;
  }
  return actor.type;
}

/**
 * Scope is injected by the server/agent launcher and is not model-controlled.
 * `engine` is reserved for trusted internal callers; it is included here so a
 * native tool hook can distinguish initialization from ordinary writer turns.
 */
export type AgentScope = 'writer-top-level' | 'character' | 'initializer' | 'player' | 'engine' | typeof FUNCTIONAL_ARRANGER_SCOPE;
export type NookMutationOperation = 'write' | 'edit' | 'move' | 'delete';

function isLifeTraceMutation(
  actor: Actor,
  agentScope: AgentScope,
  characterId: string,
  operation: NookMutationOperation,
  registeredCharacterIds?: readonly string[],
): boolean {
  if (!isValidCharacterId(characterId)) return false;
  if (registeredCharacterIds && !registeredCharacterIds.includes(characterId)) return false;
  if (operation === 'move' || operation === 'delete') {
    if (agentScope === 'initializer') return false;
    if (actor.type === 'character') return actor.id === characterId;
    if (actor.type === 'writer') return agentScope === 'writer-top-level' || agentScope === 'engine';
    return actor.type === 'god' && agentScope !== 'player';
  }
  if (actor.type === 'character') return agentScope === 'character' && actor.id === characterId;
  if (actor.type === 'writer') {
    return agentScope === 'writer-top-level' || agentScope === 'initializer' || agentScope === 'engine';
  }
  return actor.type === 'god' && agentScope !== 'player';
}

/**
 * Pure permission check for character-nook content. Configuration files are
 * intentionally handled separately below: generic write/edit never reaches
 * them, and move/delete are permanently forbidden for all actors.
 */
export function canMutateCharacterNook(
  actor: Actor,
  agentScope: AgentScope,
  characterId: string,
  operation: NookMutationOperation,
  registeredCharacterIds?: readonly string[],
): boolean {
  return isLifeTraceMutation(actor, agentScope, characterId, operation, registeredCharacterIds);
}

/**
 * Enforce the shared four-action nook boundary before any file mutation.
 * The optional manifest list is supplied by action callers so Writer access is
 * limited to characters actually registered in `world.json`.
 */
export function assertNookMutationAllowed(
  actor: Actor,
  agentScope: AgentScope,
  path: string,
  operation: NookMutationOperation,
  registeredCharacterIds?: readonly string[],
): void {
  assertPlayerNoteMutationAllowed(actor, path, operation);
  const characterId = characterIdOfPath(path);
  if (characterId === null) return;
  const config = characterRootConfigOf(path);
  if (config !== null) {
    if (operation === 'move' || operation === 'delete') {
      throw new ActionError({
        code: 'not_movable',
        message: `${config} is a character configuration file and cannot be moved or deleted: "${path}"`,
      });
    }
    throw new ActionError({
      code: 'unsupported',
      message: `${config} can only be changed through edit_character_config: "${path}"`,
    });
  }
  if (!isLifeTraceMutation(actor, agentScope, characterId, operation, registeredCharacterIds)) {
    throw new ActionError({
      code: 'unsupported',
      message: `${actorLabel(actor)} is not allowed to ${operation} character nook content at "${path}"`,
    });
  }
}

/**
 * Player notes belong to the player. Every
 * generic mutation path (write_chalk, native write/edit, edit, move, delete,
 * create) refuses a `world/**\/player-note-<n>.md` path for anyone but the
 * player; the player's own note route (`actions/player-notes.ts`) never comes
 * through here. Moving one is refused for everybody: a note stays where it is
 * pinned (dragging it is a canvas position, not a move).
 */
export function assertPlayerNoteMutationAllowed(actor: Actor, path: string, operation: NookMutationOperation | 'create'): void {
  if (!isPlayerNotePath(path)) return;
  if (operation !== 'move' && (actor.type === 'player' || actor.type === 'god')) return;
  throw new ActionError({
    code: 'player_owned',
    message: `"${path}" is the player's own note. Read it, react to it in the story, but never ${operation} it.`,
  });
}
