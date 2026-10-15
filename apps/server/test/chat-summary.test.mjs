// A chat's end → the writer's summary and, at most, one quiet writer beat
// (engine/chat-summary.ts, the design notes). Fakes only: the
// summary model and the writer are stubs, no paid call is ever made.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LocalWorldStore } from '@airp/shared';
import {
  ChatEndCoordinator,
  ChatSummaryBillingError,
  CHAT_BEAT_INTERVAL_MS,
  summarizeChatWithModel,
  quietBeatPrompt,
} from '../dist/engine/chat-summary.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-chat-summary-'));
  fs.cpSync(path.join(REPO, 'templates/wuwu'), root, { recursive: true });
  fs.rmSync(path.join(root, '.airpworld', 'sessions'), { recursive: true, force: true });
  fs.rmSync(path.join(root, '.airpworld', 'history.db'), { force: true });
  return root;
}

let n = 0;
/** Append `pairs` of [player, reply] to char-<id>.jsonl (a cue when player is null). */
function talk(root, id, pairs) {
  const file = path.join(root, '.airpworld', 'sessions', `char-${id}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let parent = null;
  if (fs.existsSync(file)) parent = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').at(-1)).id;
  else fs.writeFileSync(file, `${JSON.stringify({ type: 'session', id: 'h', cwd: root })}\n`);
  const at = new Date().toISOString();
  for (const [player, reply] of pairs) {
    const u = `u${n++}`;
    const a = `a${n++}`;
    const text = player ?? '(Scene note, not something the player said: speak first.)';
    fs.appendFileSync(file, `${JSON.stringify({ type: 'message', id: u, parentId: parent, timestamp: at, message: { role: 'user', content: [{ type: 'text', text }] } })}\n`);
    fs.appendFileSync(file, `${JSON.stringify({ type: 'message', id: a, parentId: u, timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } })}\n`);
    parent = a;
  }
}

const SUMMARY = { text: 'They talked about the lamp.', clues_learned: ['the lamp oil is in the shed'], promises_made: [], relationship_change: '', player_intent: '', notable_quotes: [], important: false };

function harness(over = {}) {
  const root = world();
  const store = new LocalWorldStore(root);
  const beats = [];
  const seen = [];
  let clock = 1_000_000;
  const ends = new ChatEndCoordinator({
    summarize: async (input) => { seen.push(input); return over.summary === undefined ? SUMMARY : over.summary; },
    quietWriterTurn: async (worldRoot, prompt) => { beats.push(prompt); },
    beatsEnabled: () => over.beats ?? true,
    now: () => clock,
    log: () => {},
    ...(over.summarize ? { summarize: over.summarize } : {}),
  });
  return {
    root, store, ends, beats, seen,
    advance: (ms) => { clock += ms; },
    close: () => { store.close(); fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test('N is the real exchange count; the event carries the summary, the watermark and how it happened', async () => {
  const h = harness();
  try {
    talk(h.root, 'vera', [[null, 'Evening.'], ['Hello', 'Hi.'], ['Where is the oil?', 'In the shed.'], ['Thanks', 'Mind the tide.']]);
    const r = await h.ends.end(h.store, 'vera', { via: 'voice', beat: true });
    assert.equal(r.turns, 3, 'the scene cue is not an exchange');
    assert.equal(r.event.type, 'character_talked');
    assert.equal(r.event.detail.turns, 3);
    assert.equal(r.event.detail.via, 'voice', 'a hung-up voice call produces a summary');
    assert.equal(r.event.detail.summary.text, SUMMARY.text);
    assert.ok(r.event.detail.through);
    assert.match(h.seen[0].transcript, /Player: Where is the oil\?/);
    assert.ok(!h.seen[0].transcript.includes('Scene note'), 'the cue is not passed off as the player');
  } finally {
    h.close();
  }
});

test('a chat with no real exchange records nothing and costs nothing', async () => {
  const h = harness();
  try {
    talk(h.root, 'vera', [[null, 'Evening.']]);
    const r = await h.ends.end(h.store, 'vera', { via: 'dialogue', beat: true });
    assert.equal(r.skipped, 'no_exchange');
    assert.equal(h.seen.length, 0, 'no model call');
    assert.equal((await h.store.getEvents(50)).filter((e) => e.type === 'character_talked').length, 0);
    assert.equal((await h.ends.end(h.store, 'old-mo', { via: 'dialogue', beat: true })).skipped, 'no_session');
  } finally {
    h.close();
  }
});

test('the next chat end summarises only the new turns', async () => {
  const h = harness();
  try {
    talk(h.root, 'vera', [['FIRST question', 'first answer']]);
    await h.ends.end(h.store, 'vera', { via: 'dialogue', beat: false });
    talk(h.root, 'vera', [['SECOND question', 'second answer'], ['third', 'answer']]);
    const r = await h.ends.end(h.store, 'vera', { via: 'dialogue', beat: false });
    assert.equal(r.turns, 2);
    assert.ok(!h.seen[1].transcript.includes('FIRST'));
    assert.match(h.seen[1].transcript, /SECOND/);
    assert.equal((await h.ends.end(h.store, 'vera', { via: 'dialogue', beat: false })).skipped, 'no_exchange', 'nothing new');
  } finally {
    h.close();
  }
});

test('quiet beat: only for clues/promises/important, ≤1 per chat end, ≤1 per 2 minutes, skippable', async () => {
  const h = harness();
  try {
    talk(h.root, 'vera', [['q', 'a']]);
    assert.equal((await h.ends.end(h.store, 'vera', { via: 'dialogue', beat: true })).beat, 'started');
    assert.equal(h.beats.length, 1);
    assert.match(h.beats[0], /^\[Current Layer\] .+\n\[Quiet Beat\]/);
    talk(h.root, 'vera', [['q2', 'a2']]);
    assert.equal((await h.ends.end(h.store, 'vera', { via: 'dialogue', beat: true })).beat, 'rate_limited');
    h.advance(CHAT_BEAT_INTERVAL_MS);
    talk(h.root, 'vera', [['q3', 'a3']]);
    assert.equal((await h.ends.end(h.store, 'vera', { via: 'dialogue', beat: false })).beat, 'not_wanted', 'the tutorial asked for none');
    talk(h.root, 'vera', [['q4', 'a4']]);
    assert.equal((await h.ends.end(h.store, 'vera', { via: 'idle', beat: true })).beat, 'not_wanted', 'an idle end never starts one');
    talk(h.root, 'vera', [['q5', 'a5']]);
    assert.equal((await h.ends.end(h.store, 'vera', { via: 'dialogue', beat: true })).beat, 'started');
    assert.equal(h.beats.length, 2);
  } finally {
    h.close();
  }
  const off = harness({ beats: false });
  try {
    talk(off.root, 'vera', [['q', 'a']]);
    assert.equal((await off.ends.end(off.store, 'vera', { via: 'dialogue', beat: true })).beat, 'disabled');
  } finally {
    off.close();
  }
  const small = harness({ summary: { ...SUMMARY, clues_learned: [] } });
  try {
    talk(small.root, 'vera', [['hi', 'hello']]);
    assert.equal((await small.ends.end(small.store, 'vera', { via: 'dialogue', beat: true })).beat, 'nothing_to_show');
    assert.equal(small.beats.length, 0);
  } finally {
    small.close();
  }
});

test('out of credits: the event still lands (count only), and no beat follows', async () => {
  const h = harness({ summarize: async () => { throw new ChatSummaryBillingError('402'); } });
  try {
    talk(h.root, 'vera', [['q', 'a']]);
    const r = await h.ends.end(h.store, 'vera', { via: 'dialogue', beat: true });
    assert.equal(r.turns, 1);
    assert.equal(r.event.detail.summary, undefined);
    assert.equal(r.beat, 'billing');
    assert.equal(h.beats.length, 0);
  } finally {
    h.close();
  }
});

test('the model call: billed endpoint, JSON parsed and bounded, 402 is a billing stop, none configured is null', async () => {
  const env = { DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: 'http://model.invalid' };
  const calls = [];
  const ok = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...SUMMARY, notable_quotes: ['a', 'b', 'c'] }) } }] }), { status: 200 });
  };
  const s = await summarizeChatWithModel({ name: 'Vera', transcript: 'Player: hi\nVera: hello' }, env, ok);
  assert.equal(s.text, SUMMARY.text);
  assert.equal(s.notable_quotes.length, 2);
  assert.equal(calls[0].url, 'http://model.invalid/chat/completions');
  assert.equal(calls[0].body.response_format.type, 'json_object');
  await assert.rejects(
    summarizeChatWithModel({ name: 'Vera', transcript: 'x' }, env, async () => new Response('{}', { status: 402 })),
    ChatSummaryBillingError
  );
  assert.equal(await summarizeChatWithModel({ name: 'Vera', transcript: 'x' }, { AIRP_AI_ACCOUNT: '0' }, async () => { throw new Error('no call'); }), null);
  assert.match(quietBeatPrompt('map', 'Vera'), /do not quote the private chat/);
});
