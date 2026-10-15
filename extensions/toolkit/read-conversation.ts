import fs from 'node:fs';
import path from 'node:path';
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import {
  ActionError,
  countRealExchanges,
  isValidCharacterId,
  parseCharacterSession,
  parseFrontmatter,
  renderTranscript,
} from '../../packages/shared/dist/index.js';
import { agentActor } from './actor.js';
import { fail, ok } from './result.js';

/**
 * `read_conversation` — the WRITER reads a character's private chat with the
 * player.
 *
 * The writer's context only carries a short summary per chat
 * (`character_talked`); this is the way to dig in when the summary is not
 * enough. It reads the character's own session file
 * (`.airpworld/sessions/char-<id>.jsonl`), current branch only, spoken words
 * only (no thinking, no tool calls).
 *
 * Writer-only, twice over: the character preset denies the tool, and the
 * shell refuses any caller that is not the writer — a character must never
 * read another character's chat.
 */
export const DEFAULT_LAST_N = 12;
export const MAX_LAST_N = 40;

export function readConversationText(worldRoot: string, characterId: string, lastN = DEFAULT_LAST_N): { text: string; details: Record<string, unknown> } {
  if (!isValidCharacterId(characterId)) {
    throw new ActionError({ code: 'invalid_argument', message: `"${characterId}" is not a character id (ASCII lowercase kebab-case, as in characters/<id>/).` });
  }
  if (!fs.existsSync(path.join(worldRoot, 'characters', characterId, 'README.md'))) {
    throw new ActionError({ code: 'not_found', message: `No character "${characterId}" (looked for characters/${characterId}/README.md).` });
  }
  let name = characterId;
  try {
    const fm = parseFrontmatter(fs.readFileSync(path.join(worldRoot, 'characters', characterId, 'README.md'), 'utf8')).frontmatter;
    if (typeof fm?.name === 'string' && fm.name.trim()) name = fm.name.trim();
  } catch {
    /* the id will do */
  }
  const n = Math.min(MAX_LAST_N, Math.max(1, Math.floor(Number.isFinite(lastN) ? lastN : DEFAULT_LAST_N)));
  let jsonl = '';
  try {
    jsonl = fs.readFileSync(path.join(worldRoot, '.airpworld', 'sessions', `char-${characterId}.jsonl`), 'utf8');
  } catch {
    return { text: `The player has not talked with ${name} yet.`, details: { character: characterId, name, exchanges: 0, shown: 0 } };
  }
  const { exchanges } = parseCharacterSession(jsonl);
  const rendered = renderTranscript(exchanges, name, { lastN: n, maxChars: 12_000 });
  if (!rendered.text) {
    return { text: `The player has not talked with ${name} yet.`, details: { character: characterId, name, exchanges: 0, shown: 0 } };
  }
  const head =
    `Private conversation between the player and ${name} (characters/${characterId}), oldest first — ` +
    `the last ${rendered.shown} exchange${rendered.shown === 1 ? '' : 's'}` +
    (rendered.omitted > 0 ? `; ${rendered.omitted} earlier omitted` : '') +
    '. Only you can read this: use what matters; do not quote it back unless it would be natural for the story to know it.';
  return {
    text: `${head}\n\n${rendered.text}`,
    details: { character: characterId, name, exchanges: countRealExchanges(exchanges), shown: rendered.shown },
  };
}

export const readConversationTool = defineTool({
  name: 'read_conversation',
  label: 'Read Conversation',
  description:
    "Read a character's private conversation with the player, word for word (newest exchanges, oldest first). " +
    'Your world state only carries a short summary of each chat; read the transcript when you need exact words, a detail ' +
    'the summary left out, or to check what was promised. Writer only.',
  parameters: Type.Object(
    {
      char_id: Type.String({ description: 'The character id, as in characters/<id>/ (e.g. "watson").' }),
      last_n: Type.Optional(
        Type.Number({ description: `How many recent exchanges to read; default ${DEFAULT_LAST_N}, at most ${MAX_LAST_N}.` })
      ),
    },
    { additionalProperties: false }
  ),
  promptSnippet: "read_conversation — read a character's private chat with the player when its summary is not enough",
  promptGuidelines: [
    'Reach for read_conversation only when a chat summary leaves out something you need; the summary is usually enough.',
    'What a character was told in private is not common knowledge: do not repeat it verbatim on the canvas unless it would naturally be known.',
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      if (agentActor().type !== 'writer') {
        throw new ActionError({ code: 'invalid_argument', message: 'Only the writer may read a private conversation.' });
      }
      return ok(readConversationText(ctx.cwd, String(params.char_id ?? ''), params.last_n ?? DEFAULT_LAST_N));
    } catch (err) {
      return fail(err);
    }
  },
});
