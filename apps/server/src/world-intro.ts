import fs from 'node:fs';
import path from 'node:path';
import {
  parseFrontmatter,
  resolveTheme,
  stringifyFrontmatter,
  WORLD_INTRO_FIELDS,
  worldIntroOf,
  type WorldIntro,
  type WorldIntroField,
} from '@airp/shared';
import { WorkshopError, WORKSHOP_LOCALES, themeLine, workshopOf, type WorkshopLocale } from './world-workshop.js';
import { textModelEndpoint } from './ai-gateway.js';

/**
 * The first-entry intro of a workshop world: a
 * popup, shown once per SAVE, that explains the world's logic (its theme)
 * in a few sentences and asks the player three setup questions — who you are,
 * what you want, what you look for first — each with a one-click fill.
 *
 * - The explanation is DETERMINISTIC (`worldIntroOf` in the shared theme
 *   registry): no model is asked to describe the rules.
 * - The answers are world content: they land in `player/README.md` (the
 *   existing "who you are" page, `templates/last-train/player/README.md`),
 *   as frontmatter keys plus a readable body block, so the writer reads them
 *   like any other file and a published copy carries the author's answers as
 *   the next player's defaults.
 * - "Shown" is a marker beside the save (`.airpworld/intro.json`), exactly like
 *   the opening marker (`engine/opening.ts`): it belongs to the save, not the
 *   browser, and a play copy of a published world (which never copies
 *   `.airpworld/` state) gets its own first intro.
 */

const MARKER = '.airpworld/intro.json';
const PLAYER_README = 'player/README.md';
const FIELD_MAX = 300;
const BLOCK_START = '<!-- world-intro -->';
const BLOCK_END = '<!-- /world-intro -->';

export type IntroFields = Record<WorldIntroField, string>;

const EMPTY: IntroFields = { identity: '', goal: '', first: '' };

const HEADINGS: Record<WorkshopLocale, { title: string } & IntroFields> = {
  en: { title: 'You', identity: 'Who you are', goal: 'What you want', first: 'What you look for first' },
  'zh-CN': { title: '你', identity: '你是谁', goal: '你想做成什么', first: '你最先想找什么' },
  ja: { title: 'あなた', identity: 'あなたは誰か', goal: '何を成し遂げたいか', first: 'まず何を探すか' },
  ko: { title: '당신', identity: '당신은 누구인가', goal: '무엇을 이루고 싶은가', first: '가장 먼저 무엇을 찾는가' },
};

const localeOf = (raw: unknown): WorkshopLocale =>
  (WORKSHOP_LOCALES as readonly string[]).includes(raw as string) ? (raw as WorkshopLocale) : 'en';

export function readIntroShown(worldRoot: string): boolean {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(worldRoot, MARKER), 'utf8'));
    return typeof raw === 'object' && raw !== null && (raw as { shown?: unknown }).shown === true;
  } catch {
    return false; // fail-soft: showing the intro again is harmless
  }
}

export function writeIntroShown(worldRoot: string, shown: boolean): void {
  const dir = path.join(worldRoot, '.airpworld');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(worldRoot, MARKER);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(shown ? { shown: true, at: new Date().toISOString() } : { shown: false }, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}

/** What `player/README.md` already says (the author's answers travel with a published copy). */
export function readIntroFields(worldRoot: string): IntroFields {
  try {
    const fm = parseFrontmatter(fs.readFileSync(path.join(worldRoot, PLAYER_README), 'utf8')).frontmatter ?? {};
    const out = { ...EMPTY };
    for (const key of WORLD_INTRO_FIELDS) if (typeof fm[key] === 'string') out[key] = fm[key].trim().slice(0, FIELD_MAX);
    return out;
  } catch {
    return { ...EMPTY };
  }
}

/** Pure: the request body → the three answers (each optional, trimmed, bounded). */
export function parseIntroFields(body: unknown): IntroFields {
  const source = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const out = { ...EMPTY };
  for (const key of WORLD_INTRO_FIELDS) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') throw new WorkshopError(400, 'invalid_argument', `${key} must be a string.`);
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed.length > FIELD_MAX) throw new WorkshopError(400, 'invalid_argument', `${key} must be at most ${FIELD_MAX} characters.`);
    out[key] = trimmed;
  }
  return out;
}

/**
 * Pure: the new `player/README.md` text. Keeps whatever else the page holds
 * (frontmatter keys and body), replacing only the intro keys and the marked
 * intro block, so re-answering never stacks copies.
 */
export function playerReadmeWithIntro(existing: string | null, fields: IntroFields, locale: WorkshopLocale): string {
  const parsed = existing ? parseFrontmatter(existing) : null;
  const heading = HEADINGS[locale];
  const frontmatter: Record<string, unknown> = { type: 'readme', title: heading.title, ...(parsed?.frontmatter ?? {}) };
  for (const key of WORLD_INTRO_FIELDS) {
    if (fields[key]) frontmatter[key] = fields[key];
    else delete frontmatter[key];
  }
  const block = WORLD_INTRO_FIELDS.filter((key) => fields[key]).map((key) => `**${heading[key]}**: ${fields[key]}`);
  let body = parsed ? parsed.body : '';
  const start = body.indexOf(BLOCK_START);
  const end = body.indexOf(BLOCK_END);
  if (start !== -1 && end > start) body = `${body.slice(0, start).trimEnd()}\n${body.slice(end + BLOCK_END.length)}`;
  body = body.trim();
  const intro = block.length ? `${BLOCK_START}\n${block.join('\n\n')}\n${BLOCK_END}` : '';
  return stringifyFrontmatter(frontmatter, `\n${[body, intro].filter(Boolean).join('\n\n')}\n`);
}

export function writePlayerIntro(worldRoot: string, fields: IntroFields, locale: unknown): void {
  const file = path.join(worldRoot, PLAYER_README);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, playerReadmeWithIntro(existing, fields, localeOf(locale)));
  fs.renameSync(`${file}.tmp`, file);
}

export interface IntroState {
  /** Only a workshop-made world has an intro; everything else answers `workshop: false`. */
  workshop: boolean;
  shown: boolean;
  intro: WorldIntro;
  fields: IntroFields;
}

export function introStateOf(worldRoot: string, manifest: Record<string, unknown>): IntroState {
  const workshop = workshopOf(manifest) !== null;
  return {
    workshop,
    shown: workshop ? readIntroShown(worldRoot) : true,
    intro: worldIntroOf({
      name: typeof manifest.name === 'string' ? manifest.name : '',
      description: typeof manifest.description === 'string' ? manifest.description : '',
      locale: manifest.locale,
      theme: manifest.theme,
    }),
    fields: readIntroFields(worldRoot),
  };
}

// ---------------------------------------------------------------------------
// 一键填写: the same text-model path as the create form's fill-in
// ---------------------------------------------------------------------------

const LOCALE_NAME: Record<WorkshopLocale, string> = { en: 'English', ja: 'Japanese', 'zh-CN': 'Simplified Chinese', ko: 'Korean' };

/** Pure: the prompt that fills the intro's blanks for this world. */
export function suggestIntroPrompt(manifest: Record<string, unknown>, fields: IntroFields): string {
  const locale = localeOf(manifest.locale);
  const given = WORLD_INTRO_FIELDS.filter((key) => fields[key]).map((key) => `- ${key}: ${fields[key]}`).join('\n');
  return [
    'You help a player set up their character before the first step into an interactive story world.',
    `World: ${String(manifest.name ?? '')} — ${String(manifest.description ?? '')}`,
    `Theme: ${themeLine(resolveTheme(manifest.theme))}.`,
    `Write every value in ${LOCALE_NAME[locale]}, one short sentence each (at most 80 characters), concrete and playable:`,
    '- identity: who the player is in this world (a role with one telling detail).',
    '- goal: what they want here; with endings, something the story can resolve; in a sandbox, a personal aim.',
    '- first: the first concrete thing or place they look for.',
    given ? `The player already wrote these; keep them exactly and make the rest fit:\n${given}` : 'The player wrote nothing yet.',
    'Answer with a JSON object with exactly the keys identity, goal, first.',
  ].join('\n');
}

export async function suggestIntroFields(
  manifest: Record<string, unknown>,
  fields: IntroFields,
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): Promise<IntroFields> {
  // An own DeepSeek key, else the signed-in account through ai.worldlines.gg (ai-gateway.ts).
  const endpoint = textModelEndpoint(env, request);
  if (!endpoint) throw new WorkshopError(503, 'no_text_model', 'No text model is configured for filling this in (DEEPSEEK_API_KEY, or sign in to your Worldlines account).');
  const { baseUrl, apiKey } = endpoint;
  const model = env.AIRP_WORKSHOP_SUGGEST_MODEL?.trim() || 'deepseek-v4-flash';
  let response: Response;
  try {
    response = await endpoint.request(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        thinking: { type: 'disabled' },
        temperature: 1.0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: suggestIntroPrompt(manifest, fields) }],
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
  if (!parsed || typeof parsed !== 'object') throw new WorkshopError(502, 'suggest_failed', 'The text model did not answer.');
  const out = { ...EMPTY };
  for (const key of WORLD_INTRO_FIELDS) {
    const value = parsed[key];
    out[key] = fields[key] || (typeof value === 'string' ? value.trim().slice(0, FIELD_MAX) : '');
  }
  if (WORLD_INTRO_FIELDS.some((key) => !out[key])) throw new WorkshopError(502, 'suggest_failed', 'The text model left a field empty.');
  return out;
}
