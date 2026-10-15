import { entityName, parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { nookIdOf, isValidCharacterId } from '../rules/characters.js';
import { ActionError } from './errors.js';
import { actorLabel, type AgentScope } from './actor.js';
import { registerAction } from './service.js';
import type { ActionContext, ActionResult } from './types.js';

export type CharacterConfigFile = 'README.md' | 'identity.md' | 'personality.md' | 'memory.md';

export interface EditCharacterConfigInput {
  characterId: string;
  file: CharacterConfigFile;
  content: string;
  mode: 'replace' | 'append';
}

export interface EditCharacterConfigDetails {
  path: string;
  characterId: string;
  file: CharacterConfigFile;
  mode: 'replace' | 'append';
}


export async function editCharacterConfig(
  ctx: ActionContext,
  input: EditCharacterConfigInput,
): Promise<ActionResult<EditCharacterConfigDetails>> {
  const { store, actor } = ctx;
  if (!input || typeof input !== 'object') {
    throw new ActionError({ code: 'invalid_argument', message: 'edit_character_config input is required' });
  }
  if (!isValidCharacterId(input.characterId)) {
    throw new ActionError({ code: 'invalid_argument', message: 'characterId must be a lower-kebab-case id' });
  }
  if (!['README.md', 'identity.md', 'personality.md', 'memory.md'].includes(input.file)) {
    throw new ActionError({ code: 'invalid_argument', message: 'file must be a character root configuration file' });
  }
  if (typeof input.content !== 'string') {
    throw new ActionError({ code: 'invalid_argument', message: 'content must be a string' });
  }
  if (input.mode !== 'replace' && input.mode !== 'append') {
    throw new ActionError({ code: 'invalid_argument', message: "mode must be 'replace' or 'append'" });
  }

  const manifest = await store.getManifest();
  const registered = manifest.characters.some((character) => character.id === input.characterId);
  const agentScope: AgentScope =
    ctx.agentScope ??
    (actor.type === 'character' ? 'character' : actor.type === 'player' ? 'player' : 'writer-top-level');
  // The initialization subagent is trusted to CREATE a missing root configuration
  // file (the nook cover) but never to rewrite one that already exists. That is
  // what keeps the "no second copy of the profile" rule intact while the brief
  // still lets the model author the README.
  const isInitializer = actor.type === 'writer' && agentScope === 'initializer';
  if (!registered) {
    throw new ActionError({
      code: 'unsupported',
      message: `Character '${input.characterId}' is not registered in the world manifest`,
    });
  }
  if (actor.type === 'character') {
    if (agentScope !== 'character' || actor.id !== input.characterId || input.file !== 'memory.md') {
      throw new ActionError({ code: 'unsupported', message: 'A character may edit only its own memory.md' });
    }
  } else if (actor.type !== 'writer' || (agentScope !== 'writer-top-level' && !isInitializer)) {
    throw new ActionError({ code: 'unsupported', message: 'Only a top-level Writer may edit registered character configuration' });
  }

  const nook = nookIdOf(input.characterId)!;
  const path = `${nook}/${input.file}`;
  if ((await store.statKind(nook)) !== 'dir') {
    throw new ActionError({ code: 'not_found', message: `Character nook not found: "${nook}"` });
  }
  const existing = (await store.statKind(path)) === 'file' ? parseFrontmatter(await store.readFile(path)) : null;
  if (isInitializer && existing !== null) {
    throw new ActionError({
      code: 'unsupported',
      message: `The initializer may only create a missing configuration file; "${path}" already exists`,
    });
  }
  const body = input.mode === 'append'
    ? existing
      ? `${existing.body}${existing.body.endsWith('\n') || existing.body === '' ? '' : '\n'}${input.content}`
      : input.content
    : input.content;
  const next = stringifyFrontmatter(existing?.frontmatter ?? null, body);
  await store.writeFileAtomic(path, next);

  const name = entityName(existing?.frontmatter ?? null, path);
  let event;
  try {
    event = await store.appendEvent({
      type: 'entity_edited',
      actor,
      detail: { path, name, kind: 'other', configuration: true },
      subject: path,
      layer: undefined,
      turn: ctx.turn,
    });
  } catch (err) {
    throw new ActionError({
      code: 'event_failed',
      message: `File "${path}" was edited but the world event could not be recorded: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  return {
    text: `${actorLabel(actor)} edited character configuration "${path}".`,
    details: { path, characterId: input.characterId, file: input.file, mode: input.mode, event },
  };
}

registerAction('editCharacterConfig', (ctx, input) =>
  editCharacterConfig(ctx, input as unknown as EditCharacterConfigInput),
);
