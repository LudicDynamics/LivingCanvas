// A character's private chat as the writer may learn it
//: real-exchange counting, the summary shape,
// and the rule that only the WRITER's world state carries a summary.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseCharacterSession,
  countRealExchanges,
  renderTranscript,
  normalizeChatSummary,
  chatSummaryWantsBeat,
  isSceneCue,
  renderEventWindow,
} from '../dist/index.js';

let seq = 0;
const msg = (id, parentId, role, text, extra = []) =>
  JSON.stringify({ type: 'message', id, parentId, timestamp: `2026-10-08T00:00:0${seq++ % 10}Z`, message: { role, content: [...extra, { type: 'text', text }] } });
const session = (...lines) => [JSON.stringify({ type: 'session', id: 'h', cwd: '/w' }), ...lines].join('\n');

const CHAT = session(
  msg('a', null, 'user', '(Scene note, not something the player said: the player has just come back.)'),
  msg('b', 'a', 'assistant', '[emo: happy] You came back.'),
  msg('c', 'b', 'user', 'Where is the key?'),
  JSON.stringify({ type: 'message', id: 'c2', parentId: 'c', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'SECRET THOUGHT' }, { type: 'toolCall', name: 'look_at', arguments: {} }] } }),
  JSON.stringify({ type: 'message', id: 'c3', parentId: 'c2', message: { role: 'toolResult', content: [{ type: 'text', text: 'TOOL OUTPUT' }] } }),
  msg('d', 'c3', 'assistant', '[emo: normal] Under the bell.'),
  msg('e', 'd', 'user', 'Promise you will not tell?'),
  msg('f', 'e', 'assistant', 'I promise.'),
  msg('g', 'f', 'user', 'One more thing'),
);

test('N counts real exchanges only: no scene cue, no unanswered line', () => {
  const t = parseCharacterSession(CHAT);
  assert.equal(countRealExchanges(t.exchanges), 2);
  assert.equal(t.lastEntryId, 'g');
  assert.ok(isSceneCue('（场景提示，不是玩家说的话：…）'));
  assert.ok(isSceneCue('（場面の指示で、…）'));
  assert.ok(!isSceneCue('Scene note please'));
});

test('the transcript is spoken words only — no thinking, no tool traffic, no emotion tags', () => {
  const { text } = renderTranscript(parseCharacterSession(CHAT).exchanges, 'Vera');
  assert.match(text, /Player: Where is the key\?\nVera: Under the bell\./);
  assert.match(text, /scene cue/);
  for (const hidden of ['SECRET THOUGHT', 'TOOL OUTPUT', '[emo:']) assert.ok(!text.includes(hidden), hidden);
  const last = renderTranscript(parseCharacterSession(CHAT).exchanges, 'Vera', { lastN: 1 });
  assert.equal(last.shown, 1);
  assert.match(last.text, /One more thing/);
});

test('a line answered over a voice call by the fast brain counts as an exchange (custom_message voice-call)', () => {
  const t = parseCharacterSession(session(
    msg('a', null, 'user', 'Hello?'),
    msg('b', 'a', 'assistant', 'Evening.'),
    JSON.stringify({ type: 'custom_message', id: 'v1', parentId: 'b', customType: 'voice-call', content: '[Voice call] …', display: false,
      details: { player: '你是谁？', reply: '[emo: smile] 我是千鹤。（把茶碗推过去）' }, timestamp: '2026-10-25T00:00:00Z' }),
    JSON.stringify({ type: 'custom_message', id: 'x', parentId: 'v1', customType: 'something-else', content: 'not a line', details: { player: 'no' } }),
  ));
  assert.equal(countRealExchanges(t.exchanges), 2);
  const voice = t.exchanges.at(-1);
  assert.equal(voice.player, '你是谁？');
  assert.equal(voice.reply, '我是千鹤。（把茶碗推过去）', 'the history keeps the full line; only the emotion tag goes');
  assert.equal(t.lastEntryId, 'x');
});

test('a watermark resumes after it; an unknown one reads the whole branch', () => {
  const after = parseCharacterSession(CHAT, { after: 'd' });
  assert.equal(countRealExchanges(after.exchanges), 1);
  assert.equal(after.exchanges[0].player, 'Promise you will not tell?');
  const lost = parseCharacterSession(CHAT, { after: 'gone' });
  assert.equal(lost.resumed, false);
  assert.equal(countRealExchanges(lost.exchanges), 2);
});

test('only the current branch counts', () => {
  const branched = session(
    msg('a', null, 'user', 'ABANDONED question'),
    msg('b', 'a', 'assistant', 'abandoned answer'),
    msg('c', null, 'user', 'kept question'),
    msg('d', 'c', 'assistant', 'kept answer'),
  );
  const t = parseCharacterSession(branched);
  assert.equal(countRealExchanges(t.exchanges), 1);
  assert.ok(!renderTranscript(t.exchanges, 'V').text.includes('ABANDONED'));
});

test('summaries are bounded and normalised; a beat needs a clue, a promise or the flag', () => {
  const s = normalizeChatSummary({
    text: 'x'.repeat(2000),
    clues_learned: ['a', '', 'none', 'b', 'c', 'd', 'e', 'f'],
    promises_made: 'not a list',
    relationship_change: '(none)',
    notable_quotes: ['one', 'two', 'three'],
  });
  assert.ok(s.text.length <= 600);
  assert.deepEqual(s.clues_learned, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(s.promises_made, []);
  assert.equal(s.relationship_change, '');
  assert.equal(s.notable_quotes.length, 2);
  assert.equal(s.important, false);
  assert.equal(normalizeChatSummary({ text: '' }), null);
  assert.equal(chatSummaryWantsBeat(s), true);
  assert.equal(chatSummaryWantsBeat({ ...s, clues_learned: [] }), false);
  assert.equal(chatSummaryWantsBeat({ ...s, clues_learned: [], important: true }), true);
});

const talked = {
  seq: 7, id: 'evt-7', projectId: 'p', type: 'character_talked', actor: { type: 'player' }, layer: null,
  subject: 'characters/watson/README.md', turn: 'req:1', createdAt: '',
  detail: {
    character: 'watson', name: 'Watson', turns: 6,
    summary: { text: 'They discussed the bell tower', clues_learned: ['the key is under the bell'], promises_made: ['meet at dawn'], relationship_change: 'warmer', player_intent: 'search the tower', notable_quotes: ['I trust you'], important: false },
  },
};
const render = (actor) => renderEventWindow({ events: [talked], coldStart: false }, { caps: 10, actor, layerNames: {} }).lines.join('\n');

test('the writer reads the summary in its dynamics; a character never does', () => {
  const writer = render({ type: 'writer' });
  assert.match(writer, /The player spoke with Watson \(6 exchanges\): They discussed the bell tower\./);
  assert.match(writer, /Clues learned: the key is under the bell\./);
  assert.match(writer, /Promises: meet at dawn\./);
  assert.match(writer, /read_conversation\("watson"\)/);
  const character = render({ type: 'character', id: 'vera' });
  assert.equal(character, 'The player spoke with Watson (6 exchanges).');
  assert.ok(!character.includes('bell'));
});

test('an event without a summary renders exactly as before', () => {
  const plain = { ...talked, detail: { character: 'watson', name: 'Watson', turns: 1 } };
  assert.equal(renderEventWindow({ events: [plain], coldStart: false }, { caps: 10, actor: { type: 'writer' }, layerNames: {} }).lines[0], 'The player spoke with Watson (1 exchange).');
});
