/**
 * Talking to an NPC card.
 *
 * An NPC is a card, not an agent: each player line becomes ONE writer turn with
 * the brief from `buildNpcBrief` (packages/shared/src/rules/npc.ts) — speak only
 * as this NPC, only from its `knows` cards, hand over only its declared `gives`.
 * The exchange is written onto the card (`dialogue:`), so it is part of the save
 * and survives a reload. A give runs through `runDeclaredChoice` — the same path
 * a player's click on that option takes — never a parallel one.
 */
import {
  ActionError,
  appendNpcDialogue,
  buildNpcBrief,
  declaredRewardCard,
  eventsThisLoop,
  createActionService,
  npcDialogueOf,
  parseFrontmatter,
  parseNpcReply,
  readNpcCard,
  tickNotesForNpc,
  NPC_LINE_MAX,
  type ActionService,
  type LocalWorldStore,
  type NpcDialogueEntry,
  type NpcKnownCard,
} from '@airp/shared';
import { randomUUID } from 'node:crypto';
import { runDeclaredChoice, serialDeclared } from './declared-actions.js';

export interface NpcTalkDeps {
  store: LocalWorldStore;
  /** One writer turn for `prompt`; resolves with the writer's final reply text. */
  askWriter(prompt: string): Promise<string>;
  /** Clock for the recorded lines (tests pin it). */
  now?: () => string;
}

export interface NpcTalkResult {
  path: string;
  name: string;
  reply: string;
  gives: { id: string; text?: string }[];
  dialogue: NpcDialogueEntry[];
}

const NPC_PATH = /^world\/[a-zA-Z0-9_/-]+\.md$/;

function fail(code: 'invalid_argument' | 'not_found' | 'conflict', message: string): never {
  throw new ActionError({ code, message });
}

/** The writer answered nothing usable: not the caller's fault (502 at the route). */
export class NpcNoAnswerError extends Error {}

/** One conversation per card at a time: a second line waits for the first answer. */
const talking = new Set<string>();

function playerService(store: LocalWorldStore): ActionService {
  return createActionService(store, { type: 'player' }, { turn: `npc:${randomUUID()}` });
}

/** Where a declared path lives now: moves are followed, a guess never is. */
async function currentPath(store: LocalWorldStore, declared: string): Promise<string | null> {
  if (await store.statKind(declared) === 'file') return declared;
  let moved = declared;
  for (const event of await eventsThisLoop(store)) {
    if (event.type === 'entity_moved' && event.detail.from === moved) moved = String(event.detail.to);
  }
  return moved !== declared && await store.statKind(moved) === 'file' ? moved : null;
}

/** The declared reward text for a find that does not exist yet (any world/ card may declare it). */
async function declaredReward(store: LocalWorldStore, path: string): Promise<{ title: string; body: string } | null> {
  for (const file of await store.listFiles('world')) {
    if (!file.endsWith('.md')) continue;
    const found = declaredRewardCard(parseFrontmatter(await store.readFile(file)).frontmatter, path);
    if (found) return found;
  }
  return null;
}

/** Read the NPC's `knows` cards. A card that no longer exists is simply not known. */
export async function readKnownCards(store: LocalWorldStore, paths: readonly string[]): Promise<NpcKnownCard[]> {
  const out: NpcKnownCard[] = [];
  for (const declared of paths) {
    const actual = await currentPath(store, declared);
    if (!actual) {
      // Not found yet: a declared search/dice reward is still known by its text.
      const reward = await declaredReward(store, declared);
      if (reward) out.push({ path: declared, ...reward });
      continue;
    }
    const parsed = parseFrontmatter(await store.readFile(actual));
    const title = String(parsed.frontmatter?.title ?? parsed.frontmatter?.name ?? declared.split('/').pop()?.replace(/\.md$/, '') ?? declared);
    out.push({ path: declared, title, body: parsed.body });
  }
  return out;
}

async function readNpc(store: LocalWorldStore, path: string) {
  if (typeof path !== 'string' || !NPC_PATH.test(path) || path.split('/').some((s) => s === '.' || s === '..')) {
    fail('invalid_argument', 'path must be a world/… NPC card');
  }
  if (await store.statKind(path) !== 'file') fail('not_found', `No NPC at ${path}`);
  const parsed = parseFrontmatter(await store.readFile(path));
  const npc = readNpcCard(parsed.frontmatter);
  if (!npc) fail('invalid_argument', `${path} is not a valid NPC card`);
  return { npc, frontmatter: parsed.frontmatter as Record<string, unknown> };
}

async function record(store: LocalWorldStore, path: string, entries: NpcDialogueEntry[], given?: string[]): Promise<NpcDialogueEntry[]> {
  return serialDeclared(store.worldRoot, async () => {
    const fm = parseFrontmatter(await store.readFile(path)).frontmatter;
    const dialogue = appendNpcDialogue(npcDialogueOf(fm), entries);
    const previous = Array.isArray(fm?.given) ? (fm!.given as string[]) : [];
    const nextGiven = given?.length ? [...new Set([...previous, ...given])] : undefined;
    await playerService(store).editEntity({ path, frontmatter: { dialogue, ...(nextGiven ? { given: nextGiven } : {}) } });
    return dialogue;
  });
}

/** One player line → one NPC reply (and at most one declared give). */
export async function talkToNpc(deps: NpcTalkDeps, input: { path: unknown; message: unknown }): Promise<NpcTalkResult> {
  const { store } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const path = String(input.path ?? '');
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (!message || message.length > NPC_LINE_MAX) fail('invalid_argument', `message must be 1–${NPC_LINE_MAX} characters`);
  const { npc } = await readNpc(store, path);
  const key = `${store.worldRoot}:${path}`;
  if (talking.has(key)) fail('conflict', `${npc.name} is still answering.`);
  talking.add(key);
  try {
    const history = npcDialogueOf(parseFrontmatter(await store.readFile(path)).frontmatter);
    // The player's line is kept even if the answer fails: it was said.
    await record(store, path, [{ by: 'player', text: message, at: now() }]);
    const { frontmatter } = await readNpc(store, path);
    const knows = await readKnownCards(store, npc.knows);
    const manifest = await store.getManifest().catch(() => null) as { locale?: unknown } | null;
    const given = Array.isArray(frontmatter.given) ? (frontmatter.given as string[]) : [];
    // Character tick: what this NPC just did on the page.
    const moves = await tickNotesForNpc(store, path).catch(() => []);
    const brief = buildNpcBrief({ path, npc, frontmatter, knows, history, line: message, language: manifest?.locale, given, moves });

    const raw = await deps.askWriter(brief);
    const parsed = parseNpcReply(raw, { name: npc.name, gives: npc.gives.filter((id) => !given.includes(id)) });
    if (!parsed.line) throw new NpcNoAnswerError(`${npc.name} did not answer. Try again.`);

    const gives: NpcTalkResult['gives'] = [];
    for (const id of parsed.gives) {
      // Same path as the player clicking the option on this card.
      try {
        const result = await serialDeclared(store.worldRoot, async () => {
          const svc = playerService(store);
          return (await runDeclaredChoice(svc, path, id)) ?? await svc.chooseOption({ path, choice: id });
        });
        gives.push({ id, text: result.text });
      } catch (error) {
        console.warn(`[AIRP NPC] give "${id}" on ${path} failed:`, error instanceof Error ? error.message : error);
      }
    }
    const dialogue = await record(store, path, [{ by: 'npc', text: parsed.line, at: now() }], gives.map((g) => g.id));
    return { path, name: npc.name, reply: parsed.line, gives, dialogue };
  } finally {
    talking.delete(key);
  }
}

/** Minimal writer surface `writerReplyTurn` needs (AgentLifecycleManager). */
export interface WriterTurns {
  startWriter(worldRoot: string): Promise<{ onEvent(listener: (event: any) => void): () => void }>;
  submitWriter(worldRoot: string, message: string): Promise<void>;
}

function textOf(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: string; text?: string } => !!block && typeof block === 'object' && (block as { type?: unknown }).type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

/**
 * Run one ordinary writer turn and return its LAST assistant text — the NPC's
 * words. The turn goes through `submitWriter`, so it queues and times out like
 * every other writer beat.
 */
export async function writerReplyTurn(lifecycle: WriterTurns, worldRoot: string, prompt: string): Promise<string> {
  const client = await lifecycle.startWriter(worldRoot);
  let last = '';
  const off = client.onEvent((event) => {
    if (event?.type !== 'message_end') return;
    const message = event.message as { role?: string } | undefined;
    if (message?.role !== 'assistant') return;
    const text = textOf(message).trim();
    if (text) last = text;
  });
  try {
    await lifecycle.submitWriter(worldRoot, prompt);
  } finally {
    off();
  }
  return last;
}
