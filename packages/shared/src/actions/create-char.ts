import type { WorldEvent } from '../schemas/events.js';
import type { CharacterConfig, WorldManifest } from '../schemas/world.js';
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { CreateCharInputSchema, type CreateCharInput } from '../schemas/create-char.js';
import { isValidCharacterId } from '../rules/characters.js';
import { hostedVoiceOf, resolveVoice } from '../rules/voices.js';
import { assertImageAsset } from '../rules/media.js';
import { themeStateDecls } from '../rules/themes.js';
import { defaultSheet, worldRulesOf } from '../rules/skills.js';
import { ActionError } from './errors.js';
import { registerAction } from './service.js';
import type { ActionContext, ActionResult } from './types.js';

export interface CharacterPresetTemplate {
  schemaVersion?: number;
  id?: string;
  name?: string;
  description?: string;
  items: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface CreateCharInvocation {
  input: CreateCharInput;
  platformPreset: CharacterPresetTemplate;
}

export interface CreateCharDetails {
  id: string;
  nook: string;
  readme: string;
  files: string[];
  avatar: string;
  voice?: string;
  manifestCharacter: CharacterConfig;
  event: WorldEvent;
}

export function characterDisplayNameOf(id: string): string {
  return id.split('-').map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(' ');
}

export function profileSlotFor(id: string): Record<string, unknown> {
  return {
    kind: 'slot',
    id: 'profile',
    slot: 'file',
    options: {
      path: ['README.md', 'identity.md', 'personality.md', 'memory.md'],
      baseDir: `characters/${id}`,
      onMissing: 'skip',
      stripFrontmatter: true,
    },
  };
}
function malformedPreset(preset: CharacterPresetTemplate): ActionError | null {
  if (!preset || typeof preset !== 'object' || preset.id !== 'character' || !Array.isArray(preset.items) || preset.items.length === 0) {
    return new ActionError({ code: 'malformed_entity', message: 'Platform character preset must have id "character" and a non-empty items array' });
  }
  return null;
}

function persistedManifest(manifest: WorldManifest, input: CreateCharInput): CharacterConfig {
  const home = manifest.entry && Object.prototype.hasOwnProperty.call(manifest.layers, manifest.entry) ? manifest.entry : 'map';
  return { id: input.id, name: input.name, home, role: 'npc', avatar: input.avatar, description: input.desc };
}

async function assertVoiceAvailable(ctx: ActionContext, voice: string | undefined): Promise<void> {
  const requested = voice === undefined ? null : resolveVoice(voice);
  if (voice !== undefined && requested === null) {
    throw new ActionError({ code: 'invalid_field_value', message: `Unknown voice "${voice}"` });
  }
  const files = await ctx.store.listFiles('characters');
  for (const file of files) {
    if (!/^characters\/[^/]+\/README\.md$/.test(file)) continue;
    let frontmatter: Record<string, unknown> | null;
    try {
      frontmatter = parseFrontmatter(await ctx.store.readFile(file)).frontmatter;
    } catch {
      throw new ActionError({ code: 'invalid_field_value', message: `Existing character README is malformed: "${file}"` });
    }
    const declared = typeof frontmatter?.voice === 'string' ? frontmatter.voice.trim() : undefined;
    // An older save may declare a studio voice id (setsuna): read it as its hosted stand-in, never an error.
    const existing = declared === undefined ? null : hostedVoiceOf(declared);
    if (declared !== undefined && existing === null) {
      throw new ActionError({ code: 'invalid_field_value', message: `Existing character has an unknown voice in "${file}"` });
    }
    if ((requested === null && existing === null) || (requested !== null && existing === requested)) {
      throw new ActionError({
        code: 'invalid_field_value',
        message: `Voice collides with existing character configuration in "${file}"`,
        details: { conflictFile: file },
      });
    }
  }
}

/**
 * A themed world (world.json `theme`, set by the workshop) declares its
 * character default states on every new character.
 * Worlds without a theme get nothing, exactly as before.
 */
function characterStatesOf(manifest: WorldManifest): { states?: unknown[]; sheet?: Record<string, unknown> } {
  // Character skills: in a world with skill
  // rules every new character gets a default sheet the author can edit.
  const rules = worldRulesOf(manifest);
  const sheet = rules ? { sheet: defaultSheet(rules.system, 'character', (manifest as { locale?: unknown }).locale) } : {};
  if (!manifest.theme) return sheet;
  const states = themeStateDecls(manifest.theme, (manifest as { locale?: unknown }).locale).character;
  return { ...(states.length ? { states } : {}), ...sheet };
}

export async function createChar(
  ctx: ActionContext,
  invocation: CreateCharInvocation,
): Promise<ActionResult<CreateCharDetails>> {
  if (ctx.actor.type !== 'writer' || ctx.agentScope !== 'writer-top-level') {
    throw new ActionError({ code: 'unsupported', message: 'create_char requires the top-level Writer scope' });
  }
  const parsed = CreateCharInputSchema.safeParse(invocation.input);
  if (!parsed.success) {
    throw new ActionError({ code: 'invalid_argument', message: parsed.error.message });
  }
  const input = parsed.data;
  if (!isValidCharacterId(input.id)) {
    throw new ActionError({ code: 'invalid_argument', message: 'id must be lower-kebab-case' });
  }
  const presetError = malformedPreset(invocation.platformPreset);
  if (presetError) throw presetError;
  await assertImageAsset(ctx.store.worldRoot, input.avatar);

  return ctx.store.withCharacterCreationWriteLock(input.id, async (tx) => {
    const manifest = await ctx.store.getManifest();
    if (manifest.characters.some((character) => character.id === input.id)) {
      throw new ActionError({ code: 'already_exists', message: `Character "${input.id}" is already registered` });
    }
    if ((await ctx.store.statKind(`characters/${input.id}`)) !== 'missing') {
      throw new ActionError({ code: 'already_exists', message: `Character directory "characters/${input.id}" already exists` });
    }
    await assertVoiceAvailable(ctx, input.voice);

    const nextCharacter = persistedManifest(manifest, input);
    const files = new Map<string, string>();
    const readme = 'characters/' + input.id + '/README.md';
    files.set(readme, stringifyFrontmatter({
      type: 'readme',
      name: input.name,
      avatar: input.avatar,
      ...(input.voice === undefined ? {} : { voice: input.voice }),
      ...characterStatesOf(manifest),
    }, input.desc));
    for (const name of ['identity', 'personality', 'memory'] as const) {
      const value = input[name];
      if (value !== undefined) files.set(`characters/${input.id}/${name}.md`, value);
    }
    const preset = structuredClone(invocation.platformPreset) as CharacterPresetTemplate;
    preset.id = input.id;
    preset.name = input.name;
    preset.description = input.desc;
    preset.items = [...preset.items.slice(0, -1), profileSlotFor(input.id), preset.items[preset.items.length - 1]];
    files.set(`characters/${input.id}/preset.json`, JSON.stringify(preset, null, 2));

    await tx.stageBundle(files);
    await tx.commitBundleAndManifest({ characters: [...manifest.characters, nextCharacter] });
    const event = await tx.appendSuccessEventOnce({
      type: 'entity_created',
      actor: ctx.actor,
      subject: readme,
      turn: ctx.turn,
      detail: { path: readme, name: input.name, kind: 'other', summary: `character ${input.id} registered` },
    }, `create-char:${input.id}:${ctx.turn}`);
    const details: CreateCharDetails = {
      id: input.id,
      nook: `characters/${input.id}`,
      readme,
      files: [...files.keys()],
      avatar: input.avatar,
      ...(input.voice === undefined ? {} : { voice: input.voice }),
      manifestCharacter: nextCharacter,
      event,
    };
    return {
      text: `writer created character "${input.name}" (${input.id}); avatar ${input.avatar}; registered and ready for on-demand start.`,
      details,
    };
  });
}

registerAction('createChar', (ctx, input) => createChar(ctx, input as unknown as CreateCharInvocation));
