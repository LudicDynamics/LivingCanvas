import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  chatSummaryWantsBeat,
  countRealExchanges,
  createActionService,
  normalizeChatSummary,
  parseCharacterSession,
  parseFrontmatter,
  renderTranscript,
  type ChatExchange,
  type ChatSummary,
  type LocalWorldStore,
  type WorldEvent,
} from '@airp/shared';
import { textModelEndpoint } from '../ai-gateway.js';
import { characterSessionFile } from './launch.js';

/**
 * The writer learns what happened in a character's private chat
 *.
 *
 * When a chat ends — the dialogue closes or switches, the nook closes, a voice
 * call hangs up, or the character has been quiet for a while — this reads the
 * NEW turns of that character's own session file, counts the real exchanges,
 * asks a cheap text model for a short structured summary, and records ONE
 * `character_talked` event carrying it. The transcript never enters the
 * writer's context; the writer can read it on demand (`read_conversation`).
 *
 * Why a separate model call over the new turns, not a hidden turn on the
 * character agent: a hidden turn would be written into the character's own
 * session (it would remember being asked to summarise itself), it pays for the
 * character's whole context, and the agent is usually being stopped right now.
 *
 * Isolation is untouched: nothing here is shown to another character.
 */

export type ChatVia = 'dialogue' | 'voice' | 'idle';

export interface ChatSummaryInput {
  name: string;
  transcript: string;
  locale?: string;
}

/** The summary call was refused for billing (402 / 429): no summary, and no beat. */
export class ChatSummaryBillingError extends Error {}

export interface ChatEndDeps {
  /** The character's session file text, or null when it has none. */
  readSession(worldRoot: string, characterId: string): string | null;
  /** One cheap model call; null when no text model is configured. */
  summarize(input: ChatSummaryInput): Promise<ChatSummary | null>;
  /** One quiet writer turn (lifecycle.submitWriter). Rejects when the writer is busy. */
  quietWriterTurn(worldRoot: string, prompt: string): Promise<void>;
  /** The world's `chatBeats` setting. */
  beatsEnabled(worldRoot: string): boolean;
  now?(): number;
  log?(message: string): void;
}

export interface ChatEndResult {
  turns: number;
  event: WorldEvent | null;
  summary: ChatSummary | null;
  /** Why no event was recorded, when none was. */
  skipped?: 'no_session' | 'no_exchange' | 'failed';
  /** 'started' or why no beat followed. */
  beat: 'started' | 'not_asked' | 'nothing_to_show' | 'disabled' | 'billing' | 'rate_limited' | 'not_wanted';
}

/** At most one quiet beat per this window, whatever the number of chats (the team: ≤1 per 2 minutes). */
export const CHAT_BEAT_INTERVAL_MS = 120_000;
/** A chat nobody closed (the companion dock stays open) ends after this much quiet. */
export const CHAT_IDLE_MS = 240_000;
/** Without a watermark and an open time, how many exchanges a first summary looks at. */
const FIRST_SUMMARY_EXCHANGES = 20;

const defaultReadSession = (worldRoot: string, characterId: string): string | null => {
  try {
    return fs.readFileSync(characterSessionFile(worldRoot, characterId), 'utf8');
  } catch {
    return null;
  }
};

/** The writer's quiet turn after a chat (no player message). English, like every writer prompt header. */
export function quietBeatPrompt(layer: string, name: string): string {
  return [
    `[Current Layer] ${layer}`,
    `[Quiet Beat] No player request this turn. The player has just finished a private conversation with ${name}; ` +
      'its summary is under "Recently, in the world". If what they learned or promised should now show on the canvas — ' +
      'a clue card, a thread moved forward, a promise noted where the player will see it — make that ONE small change ' +
      'with your tools and stop. Do not narrate the conversation, do not answer for the player, and do not quote the ' +
      'private chat unless a line naturally belongs on a card. If nothing needs to change, change nothing and reply with one short line.',
  ].join('\n');
}

export class ChatEndCoordinator {
  private readonly deps: Required<Pick<ChatEndDeps, 'readSession'>> & ChatEndDeps;
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly openedAt = new Map<string, number>();
  private readonly idle = new Map<string, ReturnType<typeof setTimeout>>();
  private lastBeatAt = Number.NEGATIVE_INFINITY;

  constructor(deps: Partial<ChatEndDeps> & Pick<ChatEndDeps, 'summarize' | 'quietWriterTurn' | 'beatsEnabled'>) {
    this.deps = { readSession: defaultReadSession, ...deps };
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private log(message: string): void {
    (this.deps.log ?? ((m: string) => console.warn(m)))(message);
  }

  private key(store: LocalWorldStore, characterId: string): string {
    return `${store.worldRoot}\u0000${characterId}`;
  }

  /** A dialogue opened: a first summary (no watermark yet) only looks at turns from here on. */
  noteOpened(store: LocalWorldStore, characterId: string): void {
    const key = this.key(store, characterId);
    if (!this.openedAt.has(key)) this.openedAt.set(key, this.now());
  }

  /** The player spoke to the character: (re)start the quiet-chat timer. */
  armIdle(store: LocalWorldStore, characterId: string, ms = CHAT_IDLE_MS): void {
    const key = this.key(store, characterId);
    this.noteOpened(store, characterId);
    const old = this.idle.get(key);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      this.idle.delete(key);
      void this.end(store, characterId, { via: 'idle', beat: false }).catch(() => {});
    }, ms);
    (timer as { unref?: () => void }).unref?.();
    this.idle.set(key, timer);
  }

  /** Forget every timer (world switch, shutdown). */
  clear(): void {
    for (const timer of this.idle.values()) clearTimeout(timer);
    this.idle.clear();
    this.openedAt.clear();
  }

  /**
   * A chat ended. Serialised per character: two quick closes summarise
   * disjoint spans (the second starts after the first one's watermark).
   * Never throws.
   */
  end(store: LocalWorldStore, characterId: string, opts: { via: ChatVia; beat: boolean }): Promise<ChatEndResult> {
    const key = this.key(store, characterId);
    if (opts.via !== 'idle') {
      const timer = this.idle.get(key);
      if (timer) clearTimeout(timer);
      this.idle.delete(key);
    }
    const previous = this.chains.get(key) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(() => this.endNow(store, characterId, opts));
    const tracked = run.finally(() => {
      if (this.chains.get(key) === tracked) this.chains.delete(key);
    });
    this.chains.set(key, tracked);
    return run;
  }

  private async endNow(store: LocalWorldStore, characterId: string, opts: { via: ChatVia; beat: boolean }): Promise<ChatEndResult> {
    const key = this.key(store, characterId);
    const none = (skipped: ChatEndResult['skipped']): ChatEndResult => ({ turns: 0, event: null, summary: null, skipped, beat: 'not_asked' });
    try {
      const jsonl = this.deps.readSession(store.worldRoot, characterId);
      if (jsonl === null) return none('no_session');
      const watermark = await lastWatermark(store, characterId);
      const parsed = parseCharacterSession(jsonl, { after: watermark });
      let span: ChatExchange[] = parsed.exchanges;
      if (!watermark || !parsed.resumed) {
        // No earlier summary to continue from (an old save, or the session was
        // reset): look only at this visit, or the last few exchanges.
        const opened = this.openedAt.get(key);
        span = opened !== undefined
          ? span.filter((e) => !e.at || Date.parse(e.at) >= opened - 5_000)
          : span.slice(-FIRST_SUMMARY_EXCHANGES);
      }
      this.openedAt.delete(key);
      const turns = countRealExchanges(span);
      if (turns === 0) return none('no_exchange');

      const name = await characterName(store, characterId);
      let summary: ChatSummary | null = null;
      let billing = false;
      try {
        const manifest = (await store.getManifest().catch(() => null)) as { locale?: unknown } | null;
        summary = normalizeChatSummary(
          await this.deps.summarize({
            name,
            transcript: renderTranscript(span, name, { lastN: 40, maxChars: 14_000 }).text,
            ...(typeof manifest?.locale === 'string' ? { locale: manifest.locale } : {}),
          })
        );
      } catch (err) {
        billing = err instanceof ChatSummaryBillingError;
        this.log(`[AIRP chat-summary] summary for "${characterId}" skipped: ${err instanceof Error ? err.message : String(err)}`);
      }

      const svc = createActionService(store, { type: 'player' }, { turn: `req:${randomUUID()}` });
      const result = await svc.noteCharacterTalked({
        character: characterId,
        turns,
        summary,
        ...(parsed.lastEntryId ? { through: parsed.lastEntryId } : {}),
        via: opts.via,
      });
      const event = (result.details as { event: WorldEvent }).event;
      return { turns, event, summary, beat: this.maybeBeat(store, name, summary, opts, billing) };
    } catch (err) {
      this.log(`[AIRP chat-summary] chat end for "${characterId}" failed: ${err instanceof Error ? err.message : String(err)}`);
      return none('failed');
    }
  }

  private maybeBeat(
    store: LocalWorldStore,
    name: string,
    summary: ChatSummary | null,
    opts: { via: ChatVia; beat: boolean },
    billing: boolean
  ): ChatEndResult['beat'] {
    if (!opts.beat || opts.via === 'idle') return 'not_wanted';
    if (billing) return 'billing';
    if (!chatSummaryWantsBeat(summary)) return 'nothing_to_show';
    if (!this.deps.beatsEnabled(store.worldRoot)) return 'disabled';
    const now = this.now();
    if (now - this.lastBeatAt < CHAT_BEAT_INTERVAL_MS) return 'rate_limited';
    this.lastBeatAt = now;
    let layer = 'map';
    try {
      layer = store.readViewpoint(now)?.layer || 'map';
    } catch {
      /* the map is a fine default */
    }
    void this.deps.quietWriterTurn(store.worldRoot, quietBeatPrompt(layer, name)).catch((err) => {
      // The writer was busy (its next turn reads the summary anyway) or the
      // turn failed; the writer's own error frames already say why.
      this.log(`[AIRP chat-summary] quiet beat not run: ${err instanceof Error ? err.message : String(err)}`);
    });
    return 'started';
  }
}

/** The newest `character_talked.detail.through` for this character, or null. */
async function lastWatermark(store: LocalWorldStore, characterId: string): Promise<string | null> {
  const events = await store.getEvents(2000);
  for (const e of events) {
    if (e.type !== 'character_talked' || e.detail?.character !== characterId) continue;
    if (typeof e.detail?.through === 'string' && e.detail.through) return e.detail.through;
  }
  return null;
}

async function characterName(store: LocalWorldStore, characterId: string): Promise<string> {
  try {
    const { frontmatter } = parseFrontmatter(await store.readFile(`characters/${characterId}/README.md`));
    if (typeof frontmatter?.name === 'string' && frontmatter.name.trim()) return frontmatter.name.trim();
  } catch {
    /* fall back to the id */
  }
  return characterId;
}

// ------------------------------------------------------------- the model call

/** Pure: the summarisation prompt. */
export function chatSummaryPrompt(input: ChatSummaryInput): string {
  return [
    `You summarise a private conversation between the player and ${input.name}, a character in an interactive story, for the story's narrator.`,
    'The narrator did not hear it. Report only what is in the transcript; never invent.',
    'Answer with a JSON object with exactly these keys:',
    '- text: 2 to 4 sentences in English — what was talked about and what came of it.',
    '- clues_learned: array of short English phrases — facts, leads or secrets the player learned (empty if none).',
    '- promises_made: array of short English phrases — anything the player or the character promised or agreed to do (empty if none).',
    '- relationship_change: one short English phrase on how the character now stands with the player, or "" if unchanged.',
    '- player_intent: one short English phrase — what the player seems to want to do next, or "".',
    '- notable_quotes: at most 2 very short lines worth keeping word for word, in their original language (empty if none).',
    '- important: true only if the chat changes the story beyond clues and promises (a confession, a betrayal, a decision); else false.',
    'Small talk yields empty arrays and important: false.',
    '',
    '<transcript>',
    input.transcript,
    '</transcript>',
  ].join('\n');
}

/**
 * The default summariser: the same text-model path as the workshop fill-ins
 * (an own DeepSeek key, else the signed-in Worldlines account through
 * ai.worldlines.gg — billed like every other call). Null when neither exists.
 */
export async function summarizeChatWithModel(
  input: ChatSummaryInput,
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch
): Promise<ChatSummary | null> {
  const endpoint = textModelEndpoint(env, request);
  if (!endpoint) return null;
  const model = env.AIRP_CHAT_SUMMARY_MODEL?.trim() || 'deepseek-v4-flash';
  const response = await endpoint.request(`${endpoint.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.apiKey}` },
    body: JSON.stringify({
      model,
      thinking: { type: 'disabled' },
      temperature: 0.3,
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: chatSummaryPrompt(input) }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 402 || response.status === 429) {
    await response.body?.cancel().catch(() => {});
    throw new ChatSummaryBillingError(`the text model refused the call for billing (HTTP ${response.status})`);
  }
  if (!response.ok) throw new Error(`the text model answered HTTP ${response.status}`);
  const data = (await response.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('the text model did not answer');
  try {
    return normalizeChatSummary(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')));
  } catch {
    throw new Error('the text model answered something other than JSON');
  }
}

