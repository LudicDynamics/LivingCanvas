/**
 * 「再生成一批」: a fresh batch of lines the
 * player might say to ONE character (a registered character, or an NPC card)
 * right now. Written lines come first in the bubble; this is the player's own
 * ask for more, one cheap call (the workshop's text model: an own DeepSeek key,
 * else the signed-in account — a trial guest gets 503, the page shows the chip
 * greyed with a sign-in hint).
 *
 * The model sees only what the player sees: the scene's public text, the cards
 * on the layer by title, the bag by title, the last few lines of this
 * conversation (sent by the page), and the character's public description —
 * never `intent`, NPC briefs' `knows`, commands or hidden states.
 */
import { parseFrontmatter, projectCardForCharacter, type LocalWorldStore } from '@airp/shared';
import { WorkshopError } from './world-workshop.js';
import { textModelEndpoint } from './ai-gateway.js';

export const SUGGEST_LINES = 3;
const LINE_MAX = 60;

export interface ReplySuggestInput {
  /** A registered character id… */
  character?: string;
  /** …or an NPC card path. */
  npc?: string;
  /** The layer on screen (`map` or `world/...`). */
  layer?: string;
  /** The last lines of this conversation, oldest first. */
  recent?: { who: 'player' | 'character'; text: string }[];
}

const LAYER_RE = /^(map|world(\/[A-Za-z0-9_-]+)+)$/;

/** The request body, validated (throws WorkshopError 400). */
export function parseReplySuggestBody(body: unknown): ReplySuggestInput {
  const b = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const out: ReplySuggestInput = {};
  if (typeof b.character === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(b.character)) out.character = b.character;
  if (typeof b.npc === 'string' && /^world\/[A-Za-z0-9_/-]+\.md$/.test(b.npc)) out.npc = b.npc;
  if (!out.character === !out.npc) throw new WorkshopError(400, 'invalid_argument', 'Name exactly one of character or npc.');
  if (typeof b.layer === 'string' && LAYER_RE.test(b.layer)) out.layer = b.layer;
  if (Array.isArray(b.recent)) {
    out.recent = b.recent.slice(-6).flatMap((l) => {
      const line = l && typeof l === 'object' ? l as Record<string, unknown> : {};
      const who = line.who === 'player' ? 'player' : line.who === 'character' ? 'character' : null;
      return who && typeof line.text === 'string' && line.text.trim() ? [{ who, text: line.text.trim().slice(0, 300) }] : [];
    });
  }
  return out;
}

const LANGUAGE: Record<string, string> = { 'zh-CN': 'Simplified Chinese', ja: 'Japanese', ko: 'Korean', en: 'English' };

/** Pure: the prompt. Exported for tests. */
export function replySuggestPrompt(input: {
  locale: string;
  world: string;
  who: string;
  about: string;
  scene: string;
  cards: string[];
  bag: string[];
  recent: { who: 'player' | 'character'; text: string }[];
}): string {
  const lang = LANGUAGE[input.locale] ?? 'English';
  return [
    `You suggest what the PLAYER might say next to ${input.who} in the interactive story "${input.world}".`,
    `Write exactly ${SUGGEST_LINES} short lines, in ${lang}, each something the player SAYS out loud to ${input.who} (a question, an answer, a remark) — never an action, never narration, never a stage direction.`,
    `Each line at most ${LINE_MAX} characters. Make the three different in intent (e.g. ask, press, reassure). Only mention what the player can see below; invent no new facts or names.`,
    'Answer as JSON: {"lines": ["…", "…", "…"]}',
    '',
    `## ${input.who}`,
    input.about || '(no description)',
    '',
    '## The scene',
    input.scene || '(no description)',
    input.cards.length ? `On view: ${input.cards.join(' · ')}` : '',
    input.bag.length ? `The player carries: ${input.bag.join(' · ')}` : '',
    '',
    '## The conversation so far',
    input.recent.length ? input.recent.map((l) => `${l.who === 'player' ? 'Player' : input.who}: ${l.text}`).join('\n') : '(nothing yet)',
  ].filter((l) => l !== null).join('\n');
}

const titleOf = (fm: Record<string, unknown> | null, path: string): string => {
  const t = fm?.title ?? fm?.name;
  return typeof t === 'string' && t.trim() ? t.trim() : path.split('/').pop()!.replace(/\.md$/, '');
};

async function listCards(store: LocalWorldStore, dir: string): Promise<{ path: string; fm: Record<string, unknown> | null }[]> {
  try {
    const out: { path: string; fm: Record<string, unknown> | null }[] = [];
    for (const p of await store.listFiles(dir)) {
      const rest = p.slice(dir.length + 1);
      if (!p.startsWith(`${dir}/`) || rest.includes('/') || !rest.endsWith('.md') || rest === 'README.md') continue;
      out.push({ path: p, fm: parseFrontmatter(await store.readFile(p)).frontmatter as Record<string, unknown> | null });
    }
    return out;
  } catch {
    return [];
  }
}

/** Gather what the player sees and ask the text model for a batch. */
export async function suggestReplies(
  store: LocalWorldStore,
  input: ReplySuggestInput,
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): Promise<string[]> {
  const endpoint = textModelEndpoint(env, request);
  if (!endpoint) throw new WorkshopError(503, 'no_text_model', 'No text model is available for new lines (DEEPSEEK_API_KEY, or sign in to your Worldlines account).');
  const manifest = await store.getManifest();
  let who = '';
  let about = '';
  if (input.character) {
    const c = manifest.characters.find((x) => x.id === input.character);
    if (!c) throw new WorkshopError(404, 'not_found', `No character "${input.character}".`);
    who = c.name ?? c.id;
    about = c.description ?? '';
  } else if (input.npc) {
    if ((await store.statKind(input.npc)) !== 'file') throw new WorkshopError(404, 'not_found', 'That person is not here.');
    const parsed = parseFrontmatter(await store.readFile(input.npc));
    const fm = (parsed.frontmatter ?? {}) as Record<string, unknown>;
    if (fm.type !== 'npc') throw new WorkshopError(404, 'not_found', 'That person is not here.');
    who = titleOf(fm, input.npc);
    // The persona is how they come across; `knows` / `intent` stay the writer's.
    about = [typeof fm.persona === 'string' ? fm.persona : '', parsed.body.trim()].filter(Boolean).join('\n');
  }
  const layer = input.layer ?? 'map';
  const dir = layer === 'map' ? 'world' : layer;
  const readme = (await store.statKind(`${dir}/README.md`)) === 'file'
    ? parseFrontmatter(projectCardForCharacter(await store.readFile(`${dir}/README.md`))).body.trim()
    : '';
  const cards = (await listCards(store, dir)).filter((c) => c.fm?.type !== 'chalk').map((c) => titleOf(c.fm, c.path)).slice(0, 12);
  const bag = (await listCards(store, 'player')).map((c) => titleOf(c.fm, c.path)).slice(0, 12);
  const prompt = replySuggestPrompt({
    locale: typeof manifest.locale === 'string' ? manifest.locale : 'en',
    world: manifest.name ?? manifest.id ?? '',
    who,
    about: about.slice(0, 800),
    scene: readme.slice(0, 1200),
    cards,
    bag,
    recent: input.recent ?? [],
  });
  const model = env.AIRP_REPLY_SUGGEST_MODEL?.trim() || env.AIRP_WORKSHOP_SUGGEST_MODEL?.trim() || 'deepseek-v4-flash';
  let response: Response;
  try {
    response = await endpoint.request(`${endpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.apiKey}` },
      body: JSON.stringify({
        model,
        thinking: { type: 'disabled' },
        temperature: 1.0,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new WorkshopError(502, 'suggest_failed', `The text model could not be reached (${error instanceof Error ? error.name : 'network error'}).`);
  }
  if (!response.ok) throw new WorkshopError(response.status === 401 || response.status === 403 ? 403 : 502, 'suggest_failed', `The text model answered HTTP ${response.status}.`);
  const data = await response.json().catch(() => null) as { choices?: { message?: { content?: unknown } }[] } | null;
  return parseSuggestedLines(data?.choices?.[0]?.message?.content);
}

/** Pure: the model's answer → at most three clean, distinct lines (throws when none). */
export function parseSuggestedLines(content: unknown): string[] {
  let parsed: unknown = null;
  if (typeof content === 'string') {
    try { parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { parsed = null; }
  }
  const raw = parsed && typeof parsed === 'object' && Array.isArray((parsed as { lines?: unknown }).lines) ? (parsed as { lines: unknown[] }).lines : [];
  const lines = [...new Set(raw
    .filter((l): l is string => typeof l === 'string')
    .map((l) => l.replace(/^[\s"'“「『]+|[\s"'”」』]+$/g, '').trim())
    .filter((l) => l.length > 0 && l.length <= LINE_MAX * 2))].slice(0, SUGGEST_LINES);
  if (!lines.length) throw new WorkshopError(502, 'suggest_failed', 'The text model did not answer.');
  return lines;
}
