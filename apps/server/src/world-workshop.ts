import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createOpenAIImageProvider, resolveImageModelId, defaultSheet, themeSkillRules, mergeStateDecls, modeOfTheme, parseFrontmatter, parseTheme, stringifyFrontmatter, themeStateDecls, themeBuildingNote, themeTitle, worldTypeOf, STRUCTURE_FLAGS, WORLD_VIEW_MODES, type ImageProvider, type WorldTheme, type WorldViewMode } from '@airp/shared';
import { compressImage, compressWorldImages } from '@airp/shared/images';
import { gatewayFetch, readAiGateway, textModelEndpoint } from './ai-gateway.js';
import { publishedRoot, resolveWorldPath, userId, worldsRoot } from './engine/user-root.js';

/**
 * The world workshop: a player makes a world of
 * their own from the launcher, paints or uploads its cover, and the writer
 * builds the rest from their prompts.
 *
 * Shape decisions that are NOT derivable from the code, settled on
 * 2026-09-26:
 *
 * - A made world is a SAVE in the player's own root (`worldsRoot`), never a
 *   template. `templates/` is the edition corpus the edition gates compare
 *   against; a player-made world there would redden them and would be shared
 *   with every seat by accident.
 * - Its id is `made-<8 hex>`. No template id starts with `made`, so the shelf's
 *   longest-prefix fallback grouping can never pull a made world under a
 *   curated one; and it carries no `-jp` / `-zh` suffix, so the launcher's
 *   edition folding leaves it alone (a made world exists in ONE language).
 * - Draft / published is one field in `world.json` (`workshop.status`) plus a
 *   copy: publishing copies the world into `publishedRoot`, a directory every
 *   seat of a deployment can read, exactly like a template but writable by the
 *   workshop. Other players START GAMES from that copy; the author keeps
 *   editing the original and republishes to update it.
 */

export class WorkshopError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const MADE_ID = /^made-[a-f0-9]{8}$/;
/**
 * An official edition's id (`templates/<id>`: `wuwu`, `wuwu-jp`, `last-train-ko`).
 *: the official worlds are owned by a person
 * who edits them in the workshop and
 * republishes them through the same remote draft / publish flow as a made
 * world. The id alone grants nothing: the identity service only lets the
 * resource's owner download its draft, upload a revision or publish it.
 */
export const OFFICIAL_ID = /^(?!made-)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const isOfficialId = (id: unknown): id is string => typeof id === 'string' && id.length <= 64 && OFFICIAL_ID.test(id);
/** A world id the remote sync may carry: a made world, or an official edition (owner only, see above). */
export const isSyncWorldId = (id: unknown): id is string => typeof id === 'string' && (MADE_ID.test(id) || isOfficialId(id));
export const WORKSHOP_LOCALES = ['en', 'ja', 'zh-CN', 'ko'] as const;
export type WorkshopLocale = (typeof WORKSHOP_LOCALES)[number];

export interface WorkshopMeta {
  status: 'draft' | 'published';
  /** `userId()` of the seat that made it; `local` for a developer. */
  owner: string;
  createdAt: string;
  publishedAt?: string;
  /** Set when an admin force-unpublished the world back to this draft; cleared on the next publish. */
  takenDown?: TakenDown;
  /**
   * The owner's editable copy of an OFFICIAL edition (id = the edition id,
   * `worlds/<id>`), downloaded from their remote space. It is republished on
   * the remote only — never into this computer's published root — and never
   * withdrawn from the brick: the lobby keeps it public.
   */
  official?: true;
}

/** An admin's force-unpublish, kept on the author's returned draft so they are told why it left the public area. */
export interface TakenDown {
  /** The acting admin's uid. */
  by: string;
  at: string;
  reason?: string;
}

/** Cover input: paint from a prompt, or bring a picture. One of the two is required. */
export type CoverInput =
  | { kind: 'generate'; prompt: string }
  | { kind: 'upload'; mimeType: string; dataB64: string };

export interface CreateWorldInput {
  name: string;
  description: string;
  locale: WorkshopLocale;
  /** The player's display name inside the world; defaults per locale. */
  playerName?: string;
  /** The narrator's first line for a world with nobody to speak yet; defaults per locale. */
  greeting?: string;
  cover: CoverInput;
  /** Rules × structure. Absent = narrative × sandbox, today's behaviour. */
  theme?: WorldTheme;
  /** The view the world opens in (world.json `view.default`, map-first TRPG worlds). Absent = canvas. */
  view?: WorldViewMode;
  /** Where it is kept: `cloud` also uploads it to the account. Absent = local. */
  location?: 'cloud' | 'local';
}

export interface CreateWorldResult {
  id: string;
  /** The client-facing save path (`worlds/<id>`), ready for `/api/worlds/load`. */
  worldPath: string;
  manifest: Record<string, unknown>;
}

/** What paints a cover: the image port, narrowed to what the workshop needs. */
export type CoverPainter = (prompt: string) => Promise<
  | { ok: true; mimeType: string; dataB64: string }
  | { ok: false; reason: string; message: string }
>;

/** Launcher bricks are 5:3; 3:2 is the closest size the Images API offers. */
const COVER_WIDTH = 1536;
const COVER_HEIGHT = 1024;
/** Painting a cover is one request with nothing to retry; the env timeout the writer uses applies. */
const DEFAULT_PAINT_TIMEOUT_MS = 180_000;
export const COVER_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
/** Decoded upload ceiling. A launcher cover never needs more; bigger means someone is probing. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const NAME_MAX = 60;
const DESCRIPTION_MAX = 400;
const PROMPT_MAX = 2000;

/**
 * The server's cover painter, or `null` when no image model the server can
 * drive is configured. Only the OpenAI-compatible path is wired here: it is a
 * plain `fetch` adapter shared with the writer's `generate_image`. The
 * OpenRouter path lives in the agent process (pi-ai's model table) and is not
 * reachable from the server; a deployment on it uploads covers instead.
 */
export function createCoverPainter(env: NodeJS.ProcessEnv = process.env): CoverPainter | null {
  // the same model the writer's generate_image would pick (an own OpenAI key alone → openai/gpt-image-1)
  let raw = resolveImageModelId(env);
  let request: typeof fetch = fetch;
  // No own OpenAI key, signed in: paint through the account (ai-gateway.ts).
  const gateway = (env.OPENAI_API_KEY ?? '').trim() ? null : readAiGateway(env);
  if (gateway?.account && !(env.AIRP_AI_BASE ?? '').trim()) {
    if (!raw.startsWith('openai/')) raw = `openai/${(env.AIRP_AI_IMAGE_MODEL ?? '').trim() || 'gpt-image-1'}`;
    env = { ...env, AIRP_AI_BASE: gateway.base };
    request = (url, init) => gatewayFetch(gateway, String(url), init);
  }
  const [providerId, ...rest] = raw.split('/');
  const model = rest.join('/');
  if (providerId !== 'openai' || !model) return null;
  const provider: ImageProvider = createOpenAIImageProvider(model, env, request);
  const parsed = Number(env.AIRP_IMAGE_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_PAINT_TIMEOUT_MS;
  return async (prompt) => provider.generate({ prompt, width: COVER_WIDTH, height: COVER_HEIGHT }, { timeoutMs });
}

const text = (value: unknown, field: string, max: number, required: boolean): string => {
  if (value === undefined || value === null) {
    if (required) throw new WorkshopError(400, 'invalid_argument', `${field} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw new WorkshopError(400, 'invalid_argument', `${field} must be a string.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new WorkshopError(400, 'invalid_argument', `${field} is required.`);
  if (trimmed.length > max) throw new WorkshopError(400, 'invalid_argument', `${field} must be at most ${max} characters.`);
  return trimmed;
};

/** Pure: the request body → a validated input, or a 400. */
export function parseCreateWorldInput(body: unknown): CreateWorldInput {
  if (typeof body !== 'object' || body === null) throw new WorkshopError(400, 'invalid_argument', 'Expected a JSON body.');
  const source = body as Record<string, unknown>;
  const name = text(source.name, 'name', NAME_MAX, true);
  const description = text(source.description, 'description', DESCRIPTION_MAX, true);
  const locale = typeof source.locale === 'string' && (WORKSHOP_LOCALES as readonly string[]).includes(source.locale)
    ? (source.locale as WorkshopLocale)
    : 'en';
  const playerName = text(source.playerName, 'playerName', NAME_MAX, false) || undefined;
  const greeting = text(source.greeting, 'greeting', DESCRIPTION_MAX, false) || undefined;
  const cover = source.cover;
  if (typeof cover !== 'object' || cover === null) throw new WorkshopError(400, 'invalid_argument', 'A cover is required: paint one from a prompt or upload a picture.');
  const kind = (cover as { kind?: unknown }).kind;
  let parsedCover: CoverInput;
  if (kind === 'generate') {
    parsedCover = { kind: 'generate', prompt: text((cover as { prompt?: unknown }).prompt, 'cover.prompt', PROMPT_MAX, true) };
  } else if (kind === 'upload') {
    const mimeType = (cover as { mimeType?: unknown }).mimeType;
    const dataB64 = (cover as { dataB64?: unknown }).dataB64;
    if (typeof mimeType !== 'string' || !COVER_MIME[mimeType]) throw new WorkshopError(400, 'invalid_argument', 'The cover must be a PNG, JPEG or WebP picture.');
    if (typeof dataB64 !== 'string' || !dataB64) throw new WorkshopError(400, 'invalid_argument', 'The uploaded cover is empty.');
    // 4 base64 characters per 3 bytes: reject before decoding an oversized body.
    if (dataB64.length > (MAX_UPLOAD_BYTES * 4) / 3 + 4) throw new WorkshopError(413, 'too_large', 'The cover must be 8 MB or smaller.');
    parsedCover = { kind: 'upload', mimeType, dataB64 };
  } else {
    throw new WorkshopError(400, 'invalid_argument', 'cover.kind must be "generate" or "upload".');
  }
  const theme = parseThemeField(source.theme);
  const view = parseViewField(source.view);
  if (source.location !== undefined && source.location !== 'cloud' && source.location !== 'local') throw new WorkshopError(400, 'invalid_argument', 'location must be "cloud" or "local".');
  const location = source.location as 'cloud' | 'local' | undefined;
  return { name, description, locale, playerName, greeting, cover: parsedCover, ...(theme ? { theme } : {}), ...(view ? { view } : {}), ...(location ? { location } : {}) };
}

/** The request's `view`: `'map'` or `'canvas'`; absent is fine, anything else is a 400. */
function parseViewField(raw: unknown): WorldViewMode | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'string' && (WORLD_VIEW_MODES as readonly string[]).includes(raw)) return raw as WorldViewMode;
  throw new WorkshopError(400, 'invalid_argument', `view must be one of: ${WORLD_VIEW_MODES.join(', ')}.`);
}

/** The request's `theme`, validated against the registry; a bad one is a 400, never a silent default. */
function parseThemeField(raw: unknown): WorldTheme | undefined {
  try {
    return parseTheme(raw) ?? undefined;
  } catch (error) {
    throw new WorkshopError(400, 'invalid_argument', error instanceof Error ? error.message : 'Invalid theme.');
  }
}

const DEFAULTS: Record<WorkshopLocale, { player: string; greeting: string; blank: string }> = {
  en: {
    player: 'Traveller',
    greeting: 'This world is still blank. Tell the writer what it should become, and it will take shape around you.',
    blank: 'Nothing here has been written yet. Ask the writer to build the world.',
  },
  ja: {
    player: '旅人',
    greeting: 'この世界はまだ白紙です。作家に「どんな世界にしたいか」を伝えると、あなたの周りに形が生まれていきます。',
    blank: 'ここにはまだ何も書かれていません。作家に世界を作ってもらいましょう。',
  },
  'zh-CN': {
    player: '旅人',
    greeting: '这个世界还是一张白纸。告诉作家你想要一个什么样的世界，它就会在你身边成形。',
    blank: '这里还什么都没有写下。请让作家开始搭建这个世界。',
  },
  ko: {
    player: '여행자',
    greeting: '이 세계는 아직 백지입니다. 어떤 세계가 되었으면 하는지 작가에게 말하면, 당신 주위로 모습을 갖춰 갑니다.',
    blank: '여기에는 아직 아무것도 쓰이지 않았습니다. 작가에게 세계를 만들어 달라고 하세요.',
  },
};

/** YAML-safe double-quoted scalar for a one-line frontmatter value. */
const yamlQuote = (value: string) => JSON.stringify(value.replace(/\s+/g, ' ').trim());

function newMadeId(): string {
  return `made-${randomBytes(4).toString('hex')}`;
}

/**
 * Make a world. The cover is settled FIRST (painting can take a minute and can
 * fail), and only then is the directory written, so a failed paint leaves no
 * half-world behind on the shelf.
 */
export async function createWorkshopWorld(repoRoot: string, input: CreateWorldInput, painter: CoverPainter | null): Promise<CreateWorldResult> {
  let mimeType: string;
  let bytes: Buffer;
  if (input.cover.kind === 'generate') {
    if (!painter) {
      throw new WorkshopError(503, 'no_image_model', 'No image model is configured for painting covers. Upload a picture instead.');
    }
    const painted = await painter(input.cover.prompt);
    if (!painted.ok) {
      const status = painted.reason === 'no_credentials' ? 503 : painted.reason === 'timeout' ? 504 : 502;
      throw new WorkshopError(status, 'cover_failed', `The cover could not be painted: ${painted.message}`);
    }
    mimeType = COVER_MIME[painted.mimeType] ? painted.mimeType : 'image/png';
    bytes = Buffer.from(painted.dataB64, 'base64');
  } else {
    mimeType = input.cover.mimeType;
    bytes = Buffer.from(input.cover.dataB64, 'base64');
    if (bytes.length === 0) throw new WorkshopError(400, 'invalid_argument', 'The uploaded cover is empty.');
    if (bytes.length > MAX_UPLOAD_BYTES) throw new WorkshopError(413, 'too_large', 'The cover must be 8 MB or smaller.');
  }
  // Compressed on the way in. The cover is also the
  // entry scene's backdrop, so it gets the scene cap, not the launcher-cover one.
  const compressed = await compressImage(bytes, { role: 'scene' });
  if (compressed.changed && COVER_MIME[compressed.mimeType]) {
    bytes = Buffer.from(compressed.bytes.buffer, compressed.bytes.byteOffset, compressed.bytes.byteLength);
    mimeType = compressed.mimeType;
  }
  const ext = COVER_MIME[mimeType];
  const coverRel = `assets/scenes/intro.${ext}`;

  const root = worldsRoot(repoRoot);
  await fs.mkdir(root, { recursive: true });
  let id = newMadeId();
  // Eight hex digits collide about never; a loop is still cheaper than a wrong "exists".
  while (await fs.access(path.join(root, id)).then(() => true, () => false)) id = newMadeId();
  const dir = path.join(root, id);
  const now = new Date().toISOString();
  const defaults = DEFAULTS[input.locale];
  const audioTheme = worldTypeOf(input.theme?.type)?.audioTheme;
  const manifest = {
    id,
    name: input.name,
    version: '1.0.0',
    schema: 1,
    description: input.description,
    author: userId(),
    genre: 'Workshop',
    tags: ['workshop'],
    material: 'parchment',
    cover: coverRel,
    locale: input.locale,
    entry: 'map',
    extensions: [],
    characters: [],
    player: { id: 'player', name: input.playerName || defaults.player },
    opening: { greeting: input.greeting || defaults.greeting },
    workshop: { status: 'draft', owner: userId(), createdAt: now } satisfies WorkshopMeta,
    // The theme and the `mode` its structure flags derive.
    // No clock card and no `endings` list are written: a workshop world's endings
    // live in the writer's prose until ending authoring exists.
    ...(input.theme ? { theme: input.theme, mode: modeOfTheme(input.theme) } : {}),
    // Character skills: a TRPG-style rule pack
    // (coc / dnd on a type that rolls) makes the world's skill rules.
    ...(input.theme && themeSkillRules(input.theme) ? { rules: themeSkillRules(input.theme) } : {}),
    // The type's default music (themes.ts `audioTheme`), so a new world is not silent.
    ...(audioTheme ? { audio: { theme: audioTheme } } : {}),
    // Map-first: the play UI opens in this view; players can switch.
    ...(input.view ? { view: { default: input.view } } : {}),
    // 本机 / 云端: this device's choice (stripped from every upload); the sync pass uploads a 云端 world.
    location: input.location ?? 'local',
    createdAt: now,
    updatedAt: now,
  };
  // The entry scene is a written layer from the start (a README, not a stub):
  // the cover is its backdrop and the description its first sight. Leaving it
  // a stub would fire the I1 initialiser with no brief on the very first
  // entry, before the author has said a word about the world.
  const readme = [
    '---',
    'type: readme',
    `name: ${yamlQuote(input.name)}`,
    `title: ${yamlQuote(input.name)}`,
    'material: parchment',
    `bg: ${coverRel}`,
    '---',
    '',
    input.description,
    '',
    defaults.blank,
    '',
  ].join('\n');
  await fs.mkdir(path.join(dir, 'assets', 'scenes'), { recursive: true });
  await fs.mkdir(path.join(dir, 'world'), { recursive: true });
  await fs.mkdir(path.join(dir, 'characters'), { recursive: true });
  await fs.mkdir(path.join(dir, 'player'), { recursive: true });
  await fs.writeFile(path.join(dir, coverRel), bytes);
  await fs.writeFile(path.join(dir, 'world', 'README.md'), readme);
  await fs.writeFile(path.join(dir, 'world.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (input.theme) await writeThemeStates(dir, input.theme, input.locale, manifest.characters);
  const rules = input.theme ? themeSkillRules(input.theme) : null;
  if (rules) await writeDefaultSheets(dir, rules.system, input.locale, manifest.characters);
  return { id, worldPath: `worlds/${id}`, manifest };
}

const PLAYER_TITLE: Record<WorkshopLocale, string> = { en: 'You', 'zh-CN': '你', ja: 'あなた', ko: '당신' };

/**
 * Write a theme's default declared states (the design notes,
 * 触发器.md §7) into README frontmatter `states:`: player/README.md,
 * world/README.md and characters/<id>/README.md for every character listed.
 * Merged by id — an entry the README already declares is never overwritten.
 * A made world has no characters at creation; `create_char` declares the
 * character defaults on each character the writer makes later.
 * A missing player README is created (only when there are player states);
 * a missing world or character README is left alone.
 */
export async function writeThemeStates(dir: string, theme: WorldTheme, locale: WorkshopLocale, characters: readonly unknown[] = []): Promise<void> {
  const decls = themeStateDecls(theme, locale);
  const merge = async (rel: string, list: typeof decls.player, fresh: Record<string, unknown> | null) => {
    if (!list.length) return;
    const file = path.join(dir, rel);
    const existing = await fs.readFile(file, 'utf8').catch(() => null);
    if (existing === null && !fresh) return;
    const parsed = existing === null ? null : parseFrontmatter(existing);
    const frontmatter: Record<string, unknown> = { ...(parsed?.frontmatter ?? fresh ?? {}) };
    const states = mergeStateDecls(frontmatter.states, list);
    if (!states) return;
    frontmatter.states = states;
    await fs.writeFile(file, stringifyFrontmatter(frontmatter, parsed ? parsed.body : '\n'));
  };
  await merge('player/README.md', decls.player, { type: 'readme', title: PLAYER_TITLE[locale] });
  await merge('world/README.md', decls.world, null);
  for (const character of characters) {
    const id = typeof character === 'object' && character !== null ? (character as { id?: unknown }).id : undefined;
    if (typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id)) await merge(`characters/${id}/README.md`, decls.character, null);
  }
}

/**
 * Default character sheets: the protagonist's
 * in player/README.md (created when missing) and one per listed character whose
 * README exists. `replace` swaps an existing sheet (a rule-system change);
 * otherwise a README that already has a sheet keeps it. Returns the files written.
 */
export async function writeDefaultSheets(dir: string, system: 'coc' | 'dnd', locale: WorkshopLocale, characters: readonly unknown[] = [], replace = false): Promise<string[]> {
  const written: string[] = [];
  const put = async (rel: string, role: 'player' | 'character', fresh: Record<string, unknown> | null) => {
    const file = path.join(dir, rel);
    const existing = await fs.readFile(file, 'utf8').catch(() => null);
    if (existing === null && !fresh) return;
    const parsed = existing === null ? null : parseFrontmatter(existing);
    const frontmatter: Record<string, unknown> = { ...(parsed?.frontmatter ?? fresh ?? {}) };
    if (frontmatter.sheet !== undefined && !replace) return;
    frontmatter.sheet = defaultSheet(system, role, locale);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, stringifyFrontmatter(frontmatter, parsed ? parsed.body : '\n'));
    written.push(rel);
  };
  await put('player/README.md', 'player', { type: 'readme', title: PLAYER_TITLE[locale] });
  for (const character of characters) {
    const id = typeof character === 'object' && character !== null ? (character as { id?: unknown }).id : undefined;
    if (typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id)) await put(`characters/${id}/README.md`, 'character', null);
  }
  return written;
}

/** What the create form holds when the author asks for a fill-in. Every field optional. */
export interface SuggestFormInput {
  locale: WorkshopLocale;
  name?: string;
  description?: string;
  playerName?: string;
  coverPrompt?: string;
  /** The theme picked on the form, so the fill-in fits it (a Cthulhu premise for a Cthulhu world). */
  theme?: WorldTheme;
}

export interface SuggestFormResult {
  name: string;
  description: string;
  playerName: string;
  coverPrompt: string;
}

/** Pure: the request body → the fields the author already typed. */
export function parseSuggestFormInput(body: unknown): SuggestFormInput {
  const source = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const locale = typeof source.locale === 'string' && (WORKSHOP_LOCALES as readonly string[]).includes(source.locale)
    ? (source.locale as WorkshopLocale)
    : 'en';
  const theme = parseThemeField(source.theme);
  return {
    locale,
    name: text(source.name, 'name', NAME_MAX, false) || undefined,
    description: text(source.description, 'description', DESCRIPTION_MAX, false) || undefined,
    playerName: text(source.playerName, 'playerName', NAME_MAX, false) || undefined,
    coverPrompt: text(source.coverPrompt, 'coverPrompt', PROMPT_MAX, false) || undefined,
    ...(theme ? { theme } : {}),
  };
}

/** One line naming a theme for a text model: type, rule pack, structure and the flags that are on. */
export function themeLine(theme: WorldTheme): string {
  const on = STRUCTURE_FLAGS.filter((flag) => theme.structure[flag.id]).map((flag) => flag.label.en.toLowerCase());
  const type = worldTypeOf(theme.type);
  return `${themeTitle(theme)} (${on.length ? on.join(', ') : 'no ending, free exploration'})${type ? ` — ${type.blurb.en}` : ''}`;
}

const LOCALE_NAME: Record<WorkshopLocale, string> = { en: 'English', ja: 'Japanese', 'zh-CN': 'Simplified Chinese', ko: 'Korean' };

/**
 * The fill-in prompt: the create form's four fields, written the way the
 * `world-workshop` skill will later expect them — one specific premise with a
 * conflict, and a cover prompt that already obeys the skill's picture rules
 * (style line first, eye-level scene, light and weather, one or two landmarks,
 * no text, no people). Kept beside the skill's rules on purpose: when §4 of
 * the skill changes, this is the other place that must follow.
 */
export function suggestFormPrompt(input: SuggestFormInput): string {
  const given = Object.entries({ name: input.name, description: input.description, playerName: input.playerName, coverPrompt: input.coverPrompt })
    .filter(([, value]) => value)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');
  return [
    'You complete the form that creates a new interactive story world for a canvas RPG. The writer agent will later build the whole world (places three to four layers deep, people, choices) from these lines, so they must be specific, playable and free of clichés: one concrete place, one concrete tension, something the player can do on their first step.',
    `Write \`name\`, \`description\` and \`playerName\` in ${LOCALE_NAME[input.locale]}. Write \`coverPrompt\` in English.`,
    'Rules:',
    '- name: 2–6 words, a title, no quotes.',
    '- description: one or two sentences, at most 160 characters: what kind of place, and what is at stake there.',
    '- playerName: who the player is in this world (a role or a short name), 1–4 words.',
    '- coverPrompt: one image prompt for the entry scene, 40–90 words. Start with a style line of five to twelve words (period, palette, light, brushwork), then the space seen at eye level from where the player stands, the light and weather, and one or two landmarks. End with: "no text, no people".',
    ...(input.theme ? [`The world's theme is ${themeLine(input.theme)}: the premise, the stakes and the cover must fit it.`] : []),
    given ? `The author already wrote these; keep them exactly and make the rest fit them:\n${given}` : 'The author wrote nothing yet: invent a fresh world.',
    'Answer with a JSON object with exactly the keys name, description, playerName, coverPrompt.',
  ].join('\n');
}

/**
 * Ask the text model to fill the form. Uses the same DeepSeek endpoint the
 * agents run on (`DEEPSEEK_API_KEY`), never the image key: filling a form is
 * a text job.
 */
export async function suggestWorldForm(input: SuggestFormInput, env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch): Promise<SuggestFormResult> {
  // An own DeepSeek key, else the signed-in account through ai.worldlines.gg (ai-gateway.ts).
  const endpoint = textModelEndpoint(env, request);
  if (!endpoint) throw new WorkshopError(503, 'no_text_model', 'No text model is configured for filling the form (DEEPSEEK_API_KEY, or sign in to your Worldlines account).');
  const { baseUrl, apiKey } = endpoint;
  const model = env.AIRP_WORKSHOP_SUGGEST_MODEL?.trim() || 'deepseek-v4-flash';
  let response: Response;
  try {
    response = await endpoint.request(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        // DeepSeek V4 reasons by default and would spend the budget thinking.
        thinking: { type: 'disabled' },
        temperature: 1.0,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: suggestFormPrompt(input) }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new WorkshopError(502, 'suggest_failed', `The text model could not be reached (${error instanceof Error ? error.name : 'network error'}).`);
  }
  if (!response.ok) throw new WorkshopError(502, 'suggest_failed', `The text model answered HTTP ${response.status}.`);
  const data = await response.json().catch(() => null) as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = data?.choices?.[0]?.message?.content;
  let parsed: Record<string, unknown> | null = null;
  if (typeof content === 'string') {
    try { parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as Record<string, unknown>; } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== 'object') throw new WorkshopError(502, 'suggest_failed', 'The text model did not answer with a form.');
  const pick = (key: keyof SuggestFormResult, max: number, given?: string) => {
    if (given) return given;
    const value = parsed?.[key];
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  };
  const result: SuggestFormResult = {
    name: pick('name', NAME_MAX, input.name),
    description: pick('description', DESCRIPTION_MAX, input.description),
    playerName: pick('playerName', NAME_MAX, input.playerName),
    coverPrompt: pick('coverPrompt', PROMPT_MAX, input.coverPrompt),
  };
  if (!result.name || !result.description || !result.coverPrompt) throw new WorkshopError(502, 'suggest_failed', 'The text model left the form incomplete.');
  return result;
}

async function readManifest(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(dir, 'world.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The workshop block of a manifest, or `null` for a curated world. */
export function workshopOf(manifest: Record<string, unknown> | null | undefined): WorkshopMeta | null {
  const raw = manifest?.workshop;
  if (typeof raw !== 'object' || raw === null) return null;
  const meta = raw as Partial<WorkshopMeta>;
  return {
    status: meta.status === 'published' ? 'published' : 'draft',
    owner: typeof meta.owner === 'string' ? meta.owner : 'local',
    createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : '',
    ...(typeof meta.publishedAt === 'string' ? { publishedAt: meta.publishedAt } : {}),
    ...(takenDownOf(meta.takenDown) ?? {}),
    ...(meta.official === true ? { official: true as const } : {}),
  };
}

function takenDownOf(raw: unknown): { takenDown: TakenDown } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const note = raw as Partial<TakenDown>;
  if (typeof note.by !== 'string' || typeof note.at !== 'string') return null;
  return { takenDown: { by: note.by, at: note.at, ...(typeof note.reason === 'string' && note.reason ? { reason: note.reason.slice(0, 500) } : {}) } };
}

/**
 * "Is the active world an authoring session?" — the ORIGINAL of a workshop
 * world, in its author's root, not a play copy. Play copies are named
 * `<id>-<8 hex>` by the load route, so the directory name tells them apart.
 */
export function isAuthoringWorld(worldRoot: string, manifest: Record<string, unknown> | null | undefined): boolean {
  const meta = workshopOf(manifest);
  if (!meta) return false;
  return path.basename(worldRoot) === manifest?.id && meta.owner === userId();
}

/**
 * The building brief the server prepends to every writer prompt of an
 * authoring session (`index.ts`, `writer_prompt`). The writer's own prompt is
 * about narrating a scene for a player; here the player is the author and the
 * request is a change to the world itself. The craft — the tree three to four
 * deep, the README fields that carry the play, the two pictures per layer,
 * the characters — lives in the `world-workshop` skill (skills/world-workshop),
 * per the design notes: the brief only says WHICH job this turn is and
 * points there. The long form goes out while the world has no characters yet,
 * the reminder afterwards.
 */
export function worldBuildingBrief(manifest: Record<string, unknown>): string {
  const note = themeBuildingNote(manifest.theme);
  const brief = worldBuildingBriefBase(manifest);
  return note ? `${brief}\n${note}` : brief;
}

function worldBuildingBriefBase(manifest: Record<string, unknown>): string {
  const locale = typeof manifest.locale === 'string' ? manifest.locale : 'en';
  const characters = Array.isArray(manifest.characters) ? manifest.characters.length : 0;
  if (characters > 0) {
    return `[Workshop] This save is a workshop world and the player is its AUTHOR. Treat the request as a revision to the world itself (a place, a person, a door, a rewritten scene, a lock), not as a player action: read what exists, change the files that need changing, keep ids and paths stable, keep displayed text in the world's language (${locale}), and report in three lines what changed. The README, picture and map rules are in the world-workshop skill.`;
  }
  return [
    '[Workshop] This save is a workshop world and the player is its AUTHOR. Apart from the entry scene README and its cover the world is blank. Build the whole world they describe in this turn, end to end — do not narrate a scene and do not stop at a sketch:',
    '- Read the world-workshop skill first (skills/world-workshop/SKILL.md) and follow it: the layer tree three to four deep (eight to twelve places), every layer with a README whose frontmatter carries its play (intent, choice + choice_actions, map pins), an opening chalk and one to three objects.',
    '- Two pictures per layer with generate_image: the scene picture (bg) and the map picture (map.plan.picture), one shared style line written to assets/maps/PROMPTS.md first. The root keeps its cover; paint only its map.',
    '- Two to four characters with create_char (avatar painted first), placed with move_to; one greeter with a `greeting:` line and `opening.greeter` set in world.json.',
    '- Music: keep the type theme unless the premise wants another (set_music layer "world"); give at most two or three places their own track or ambient with set_music (catalog ids only).',
    '- No door locks (`requires`) unless the premise itself is a lock: the author adds gates later with God Hand.',
    `Write every displayed text in the world's language (${locale}); ids and paths stay ASCII kebab-case. Build the skeleton first, then openings and objects, then people, then pictures. Report in three lines plus the tree when done. Later requests from the author are revisions to this world, not player actions.`,
  ].join('\n');
}

/**
 * Copy a world's content, never its runtime state (`.pi`, `.airpworld/*`) —
 * EXCEPT `.airpworld/assets`: that is where `generate_image` lands every
 * picture a made world's READMEs point at (`bg:`, `map.plan.picture`, avatars),
 * so a snapshot without it would be a world with its pictures torn out.
 */
export function worldCopyFilter(source: string): (file: string) => boolean {
  return (file) => {
    const rel = path.relative(source, file);
    if (rel === '') return true;
    const [top, second] = rel.split(path.sep);
    if (top === '.pi') return false;
    if (top === '.airpworld') return second === undefined || second === 'assets';
    return true;
  };
}

async function copyWorld(source: string, destination: string): Promise<void> {
  await fs.cp(source, destination, { recursive: true, filter: worldCopyFilter(source) });
}

/** The author's original save behind `worlds/<id>`, or the matching 4xx. */
async function ownedOriginal(repoRoot: string, worldPath: unknown): Promise<{ dir: string; id: string; manifest: Record<string, unknown>; meta: WorkshopMeta }> {
  if (typeof worldPath !== 'string' || !/^worlds\/made-[a-f0-9]{8}$/.test(worldPath)) {
    throw new WorkshopError(400, 'invalid_argument', 'Expected the save path of a world made in the workshop.');
  }
  const dir = resolveWorldPath(repoRoot, worldPath);
  const root = await fs.realpath(worldsRoot(repoRoot)).catch(() => null);
  const real = await fs.realpath(dir).catch(() => null);
  if (!root || !real || !real.startsWith(root + path.sep)) throw new WorkshopError(404, 'not_found', 'Save not found.');
  const manifest = await readManifest(real);
  const meta = workshopOf(manifest);
  if (!manifest || !meta) throw new WorkshopError(404, 'not_found', 'Save not found.');
  const id = path.basename(real);
  if (manifest.id !== id) throw new WorkshopError(409, 'not_original', 'Only the original of a made world can be published, not a play copy.');
  if (meta.owner !== userId()) throw new WorkshopError(403, 'not_owner', 'Only the author can publish this world.');
  return { dir: real, id, manifest, meta };
}

async function writeManifest(dir: string, manifest: Record<string, unknown>): Promise<void> {
  const file = path.join(dir, 'world.json');
  await fs.writeFile(`${file}.tmp`, JSON.stringify(manifest, null, 2) + '\n');
  await fs.rename(`${file}.tmp`, file);
}

/** Move a published copy aside instead of deleting it — same rule as `trashWorldSave`. */
async function trashPublished(root: string, id: string): Promise<void> {
  const target = path.join(root, id);
  if (!(await fs.stat(target).then((s) => s.isDirectory(), () => false))) return;
  const trash = path.join(root, '.trash');
  await fs.mkdir(trash, { recursive: true });
  await fs.rename(target, path.join(trash, `${id}-${randomUUID()}`));
}

/**
 * Publish: snapshot the original into the shared published root. Republishing
 * replaces the snapshot (the old one goes to `.trash`). Games other players
 * already started from the previous snapshot are their own saves and are not
 * touched.
 */
export async function publishWorkshopWorld(repoRoot: string, worldPath: unknown): Promise<{ ok: true; publishedPath: string; status: 'published'; publishedAt: string }> {
  const { dir, id, manifest } = await ownedOriginal(repoRoot, worldPath);
  const root = publishedRoot(repoRoot);
  await fs.mkdir(root, { recursive: true });
  const publishedAt = new Date().toISOString();
  const meta: WorkshopMeta = { ...workshopOf(manifest)!, status: 'published', publishedAt };
  // Copy to a dot-named staging dir (the shelf skips dotfiles), then swap.
  const staging = path.join(root, `.staging-${id}-${randomUUID()}`);
  try {
    await copyWorld(dir, staging);
    await writeManifest(staging, { ...manifest, workshop: meta, updatedAt: publishedAt });
    // The public copy is compressed; the author's draft keeps its originals.
    await compressWorldImages(staging);
    await trashPublished(root, id);
    await fs.rename(staging, path.join(root, id));
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
  await writeManifest(dir, { ...manifest, workshop: meta, updatedAt: publishedAt });
  return { ok: true, publishedPath: `published/${id}`, status: 'published', publishedAt };
}

/** Unpublish: retire the snapshot; the original becomes a draft again. */
export async function unpublishWorkshopWorld(repoRoot: string, worldPath: unknown): Promise<{ ok: true; status: 'draft' }> {
  const { dir, id, manifest } = await ownedOriginal(repoRoot, worldPath);
  await trashPublished(publishedRoot(repoRoot), id);
  const { publishedAt: _dropped, ...rest } = workshopOf(manifest)!;
  await writeManifest(dir, { ...manifest, workshop: { ...rest, status: 'draft' }, updatedAt: new Date().toISOString() });
  return { ok: true, status: 'draft' };
}
