// The voice call's fast brain (voice-fast-brain.ts) and how the relay uses it
// (voice-live-brain.ts): one streamed model call per line, deltas up as they
// arrive (speech-clean), cancellation aborts the HTTP stream, the finished
// exchange goes into the character's history, AIRP_VOICE_BRAIN=agent keeps the
// old path — and the old path's watchdog. A fake streaming provider only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  createFastBrain, voiceBrainModeFromEnv, voiceModelEndpoint, readCharacterSoul, voiceSystemPrompt, sessionBrief,
  recordCallExchange, worldLanguage,
} = await jiti.import('../src/engine/voice-fast-brain.ts');
const { createBrainRelay } = await jiti.import('../src/engine/voice-live-brain.ts');

const SAVE = '/saves/a';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** An OpenAI-compatible SSE body; `gate` holds the stream after `holdAfter` deltas until released. */
function sseProvider(deltas, { holdAfter = Infinity, status = 200 } = {}) {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const request = async (url, init) => {
    const call = { url, body: JSON.parse(init.body), signal: init.signal, aborted: false };
    calls.push(call);
    if (status !== 200) return new Response('{"error":"nope"}', { status });
    const enc = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        init.signal.addEventListener('abort', () => {
          call.aborted = true;
          try { controller.error(new DOMException('aborted', 'AbortError')); } catch { /* closed */ }
        });
        for (let i = 0; i < deltas.length; i++) {
          if (i === holdAfter) await gate;
          if (call.aborted) return;
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: deltas[i] } }] })}\n\n`));
          await tick();
        }
        if (!call.aborted) {
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
        }
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { request, calls, release: () => release() };
}

function brain(provider, extra = {}) {
  const up = [];
  const fanned = [];
  const records = [];
  const b = createFastBrain({
    characterId: 'chizuru',
    worldRoot: SAVE,
    model: () => ({ baseUrl: 'https://model.test/v1', apiKey: 'k', model: 'deepseek-v4-flash', via: 'own', request: provider.request }),
    soul: () => ({ name: '千鹤', text: '旅店的女将。礼数周全。' }),
    language: () => 'zh-CN',
    readSession: () => null,
    record: async (player, reply) => { records.push({ player, reply }); },
    broadcast: (frame) => fanned.push(frame),
    log: () => {},
    ...extra,
  }, (frame) => up.push(frame));
  return { b, up, fanned, records };
}

const until = async (cond, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await tick(2);
  }
};

test('deltas go up as they arrive, speech-clean; the fan-out keeps the full text; the exchange is recorded', async () => {
  const provider = sseProvider(['我是千鹤，', '这间旅店的女将。', '（把茶碗推过去）', '喝口热的。']);
  const { b, up, fanned, records } = brain(provider);
  b.prompt('你是谁？');
  await until(() => up.some((f) => f.type === 'character_idle'));
  const said = up.filter((f) => f.type === 'character_delta').map((f) => f.delta).join('');
  assert.equal(said, '我是千鹤，这间旅店的女将。喝口热的。', 'the stage direction is never spoken');
  assert.ok(up.every((f) => f.characterId === 'chizuru' && f.savePath === SAVE));
  assert.equal(up.at(-1).type, 'character_idle');
  const full = fanned.find((f) => f.type === 'character_message');
  assert.equal(full.text, '我是千鹤，这间旅店的女将。（把茶碗推过去）喝口热的。', 'subtitles / dialogue keep the full line');
  await until(() => records.length === 1);
  assert.deepEqual(records[0], { player: '你是谁？', reply: '我是千鹤，这间旅店的女将。（把茶碗推过去）喝口热的。' });
  // The request: streamed, thinking off, no tools, the character's soul + the voice rule in the system prompt.
  const body = provider.calls[0].body;
  assert.equal(body.stream, true);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.tools, undefined);
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[0].content, /旅店的女将/);
  assert.match(body.messages[0].content, /1–3 sentences/);
  assert.match(body.messages[0].content, /Chinese/);
  assert.deepEqual(body.messages.at(-1), { role: 'user', content: '你是谁？' });
});

test('the first delta goes up before the reply is complete', async () => {
  const provider = sseProvider(['你好，', '欢迎光临。'], { holdAfter: 1 });
  const { b, up } = brain(provider);
  b.prompt('你好');
  await until(() => up.some((f) => f.type === 'character_delta'));
  assert.equal(up[0].delta, '你好，');
  assert.equal(up.some((f) => f.type === 'character_idle'), false);
  provider.release();
  await until(() => up.some((f) => f.type === 'character_idle'));
});

test('abort (barge-in) cuts the HTTP stream at once; nothing more of that turn goes up; nothing is recorded', async () => {
  const provider = sseProvider(['先说一句，', '还没说完的话。'], { holdAfter: 1 });
  const { b, up, records } = brain(provider);
  b.prompt('喂？');
  await until(() => up.length === 1);
  b.abort();
  await tick(5);
  assert.equal(provider.calls[0].aborted, true, 'the HTTP stream is aborted');
  provider.release();
  await tick(20);
  assert.deepEqual(up.map((f) => f.type), ['character_delta'], 'no idle, no error, no late delta');
  assert.equal(records.length, 0);
  assert.equal(b.busy(), false, 'never stuck');
});

test('a new prompt supersedes the running one, and the call remembers what was said', async () => {
  const provider = sseProvider(['第一句，', '被打断了。'], { holdAfter: 1 });
  const { b, up } = brain(provider);
  b.prompt('第一个问题');
  await until(() => up.length === 1);
  b.prompt('第二个问题');
  await tick(5);
  assert.equal(provider.calls[0].aborted, true);
  provider.release();
  await until(() => up.filter((f) => f.type === 'character_idle').length === 1);
  const second = provider.calls[1].body.messages;
  assert.deepEqual(second.slice(1).map((m) => m.role), ['user', 'assistant', 'user'], 'the cut-off turn rides along');
  assert.equal(second.at(-1).content, '第二个问题');
});

test('a provider error fails just that turn with an error frame; no model fails the turn too', async () => {
  const failing = brain(sseProvider([], { status: 429 }));
  failing.b.prompt('你好');
  await until(() => failing.up.length === 1);
  assert.equal(failing.up[0].type, 'error');
  assert.match(failing.up[0].message, /429/);
  assert.equal(failing.b.busy(), false);

  const none = brain(sseProvider([]), { model: () => null });
  none.b.prompt('你好');
  await until(() => none.up.length === 1);
  assert.equal(none.up[0].type, 'error');
});

test('no first token in time: the turn fails (non-fatal) and the stream is aborted', async () => {
  const provider = sseProvider(['迟到的话。'], { holdAfter: 0 });
  const { b, up } = brain(provider, { firstTokenTimeoutMs: 30 });
  b.prompt('你好');
  await until(() => up.length === 1);
  assert.equal(up[0].type, 'error');
  assert.match(up[0].message, /too long/);
  assert.equal(provider.calls[0].aborted, true);
  provider.release();
});

test('AIRP_VOICE_BRAIN=agent keeps the full agent; anything else is the fast brain', () => {
  assert.equal(voiceBrainModeFromEnv({}), 'fast');
  assert.equal(voiceBrainModeFromEnv({ AIRP_VOICE_BRAIN: '' }), 'fast');
  assert.equal(voiceBrainModeFromEnv({ AIRP_VOICE_BRAIN: 'agent' }), 'agent');
  assert.equal(voiceBrainModeFromEnv({ AIRP_VOICE_BRAIN: 'AGENT' }), 'agent');
});

test("the model connection is the character's: own key from models.json, else the account gateway; override by env", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-voice-repo-'));
  const world = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-voice-world-'));
  fs.mkdirSync(path.join(repo, '.pi', 'agent'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.pi', 'agent', 'models.json'), JSON.stringify({
    providers: { deepseek: { baseUrl: 'https://api.deepseek.com', api: 'openai-completions', apiKey: '$DEEPSEEK_API_KEY', models: [{ id: 'deepseek-v4-flash' }] } },
  }));
  const own = voiceModelEndpoint(repo, world, { env: { DEEPSEEK_API_KEY: 'sk-own', AIRP_AI_ACCOUNT: '0' } });
  assert.deepEqual({ baseUrl: own.baseUrl, apiKey: own.apiKey, model: own.model, via: own.via }, { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-own', model: 'deepseek-v4-flash', via: 'own' });
  const viaGateway = voiceModelEndpoint(repo, world, { env: { AIRP_AI_BASE: 'https://ai.example/v1', AIRP_AI_KEY: 'pat' } });
  assert.equal(viaGateway.via, 'gateway');
  assert.equal(viaGateway.baseUrl, 'https://ai.example/v1');
  assert.equal(voiceModelEndpoint(repo, world, { env: { AIRP_AI_ACCOUNT: '0' } }), null, 'no key, not signed in: none');
  const override = voiceModelEndpoint(repo, world, { env: { DEEPSEEK_API_KEY: 'sk', AIRP_VOICE_BRAIN_MODEL: 'deepseek-flash', AIRP_AI_ACCOUNT: '0' } });
  assert.equal(override.model, 'deepseek-flash');
  // The save's own pick wins over the default.
  fs.mkdirSync(path.join(world, '.airpworld'), { recursive: true });
  fs.writeFileSync(path.join(world, '.airpworld', 'model-preferences.json'), JSON.stringify({ character: { provider: 'deepseek', model: 'deepseek-v4-pro', thinking: 'low' } }));
  assert.equal(voiceModelEndpoint(repo, world, { env: { DEEPSEEK_API_KEY: 'sk', AIRP_AI_ACCOUNT: '0' } }).model, 'deepseek-v4-pro');
});

test("the system prompt is the character's own profile (preset file slot), the world's language and a short brief", () => {
  const world = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-voice-soul-'));
  const dir = path.join(world, 'characters', 'chizuru');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(world, 'world.json'), JSON.stringify({ locale: 'zh-CN' }));
  fs.writeFileSync(path.join(dir, 'README.md'), '---\nname: 千鹤\n---\n旅店的女将。');
  fs.writeFileSync(path.join(dir, 'unspoken.md'), '---\ntitle: x\n---\n三十年前的第七夜。');
  fs.writeFileSync(path.join(dir, 'preset.json'), JSON.stringify({ items: [
    { kind: 'block', id: 'world-language', content: '说中文。' },
    { kind: 'slot', id: 'profile', slot: 'file', options: { path: ['README.md', 'unspoken.md', '../../world.json', 'missing.md'], baseDir: 'characters/chizuru' } },
  ] }));
  const soul = readCharacterSoul(world, 'chizuru');
  assert.equal(soul.name, '千鹤');
  assert.match(soul.text, /说中文。/);
  assert.match(soul.text, /旅店的女将。/);
  assert.match(soul.text, /三十年前的第七夜/);
  assert.doesNotMatch(soul.text, /name: 千鹤/, 'frontmatter stripped');
  assert.equal(worldLanguage(world), 'zh-CN');
  const jsonl = [
    JSON.stringify({ type: 'session', id: 'h' }),
    JSON.stringify({ type: 'message', id: 'a', parentId: null, message: { role: 'user', content: [{ type: 'text', text: '你好' }] } }),
    JSON.stringify({ type: 'message', id: 'b', parentId: 'a', message: { role: 'assistant', content: [{ type: 'text', text: '[emo: smile] 欢迎。' }] } }),
  ].join('\n');
  const brief = sessionBrief(jsonl);
  assert.equal(brief.length, 1);
  const system = voiceSystemPrompt({ soul, language: 'zh-CN', brief, scene: '' });
  assert.match(system, /Player: 你好\n千鹤: 欢迎。/);
  assert.match(system, /No stage directions/);
});

test('recording: appendMessage (voice-call custom message) then navigateTree, queued as one of her turns', async () => {
  const calls = [];
  const client = {
    appendMessage: async (args) => { calls.push(['append', args]); return { entryId: 'e1' }; },
    navigateTree: async (id) => { calls.push(['navigate', id]); return { cancelled: false }; },
  };
  let queued = 0;
  const host = {
    ensureCharacter: async () => client,
    submitCharacterTurn: async (_id, run) => { queued++; return run(); },
  };
  await recordCallExchange(host, 'chizuru', SAVE, '你是谁？', '我是千鹤。');
  assert.equal(queued, 1);
  assert.equal(calls[0][0], 'append');
  assert.equal(calls[0][1].customType, 'voice-call');
  assert.deepEqual(calls[0][1].details, { player: '你是谁？', reply: '我是千鹤。' });
  assert.equal(calls[0][1].display, false);
  assert.deepEqual(calls[1], ['navigate', 'e1']);
});

// ── the relay ───────────────────────────────────────────────────────────

class FakeSocket {
  constructor(url) { this.url = url; this.sent = []; this.handlers = new Map(); this.closed = false; }
  on(event, handler) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]); return this; }
  emit(event, ...args) { for (const h of this.handlers.get(event) ?? []) h(...args); }
  send(data) { this.sent.push(JSON.parse(String(data))); }
  close() { this.closed = true; }
  open() { this.emit('open'); }
}
function sockets() {
  const created = [];
  class Socket extends FakeSocket { constructor(url) { super(url); created.push(this); } }
  return { Socket, created };
}
const brainFrame = (frame) => Buffer.from(`{"type": "brain", "frame": ${JSON.stringify(frame)}}`);
const engineFrame = (frame) => Buffer.from(JSON.stringify(frame));

test('relay, fast: prompts and aborts never reach the agent; start / stop do; the agent’s frames never go up', async () => {
  const { Socket, created } = sockets();
  const up = [];
  const seen = [];
  const fake = { start: (c) => seen.push(['start', c]), prompt: (m) => seen.push(['prompt', m]), abort: () => seen.push(['abort']), close: async () => { seen.push(['close']); }, busy: () => false };
  const tap = createBrainRelay('chizuru', SAVE, 'ws://127.0.0.1:3001/ws?v=1', (t) => up.push(JSON.parse(t)), Socket, () => true, { fast: () => fake });
  tap.take(brainFrame({ type: 'character_start', characterId: 'chizuru', recentContext: 'scene' }));
  tap.take(brainFrame({ type: 'character_prompt', characterId: 'chizuru', message: '你好' }));
  tap.take(brainFrame({ type: 'character_abort', characterId: 'chizuru' }));
  created[0].open();
  assert.deepEqual(created[0].sent.map((f) => f.type), ['character_start'], 'only the start reaches the agent');
  assert.deepEqual(seen, [['start', 'scene'], ['prompt', '你好'], ['abort']]);
  created[0].emit('message', engineFrame({ type: 'character_delta', characterId: 'chizuru', savePath: SAVE, delta: 'echo' }), false);
  created[0].emit('close');
  assert.deepEqual(up, [], 'no agent frame, no loopback error goes up in fast mode');
  tap.close();
  await tick(5);
  assert.deepEqual(seen.at(-1), ['close']);
});

test('relay, agent: speech-clean deltas, and a busy agent fails just that turn (watchdog), its late frames dropped', async () => {
  const { Socket, created } = sockets();
  const up = [];
  const tap = createBrainRelay('chizuru', SAVE, 'ws://127.0.0.1:3001/ws?v=1', (t) => up.push(JSON.parse(t).frame), Socket, () => true, { agentTurnTimeoutMs: 30 });
  tap.take(brainFrame({ type: 'character_start', characterId: 'chizuru' }));
  created[0].open();
  tap.take(brainFrame({ type: 'character_prompt', characterId: 'chizuru', message: '你好' }));
  const engine = created[0];
  engine.emit('message', engineFrame({ type: 'character_delta', characterId: 'chizuru', savePath: SAVE, delta: '欢迎。（鞠躬）' }), false);
  engine.emit('message', engineFrame({ type: 'character_delta', characterId: 'chizuru', savePath: SAVE, delta: '请进。' }), false);
  engine.emit('message', engineFrame({ type: 'character_idle', characterId: 'chizuru', savePath: SAVE }), false);
  assert.equal(up.filter((f) => f.type === 'character_delta').map((f) => f.delta).join(''), '欢迎。请进。');
  up.length = 0;

  tap.take(brainFrame({ type: 'character_prompt', characterId: 'chizuru', message: '还在吗？' }));
  await tick(60);
  assert.equal(up.length, 1);
  assert.equal(up[0].type, 'error');
  assert.match(up[0].message, /busy/);
  assert.equal(engine.sent.at(-1).type, 'character_abort', 'the stuck turn is aborted');
  // The wedged turn finally fails with the rpc timeout: dropped, it must not hit the next turn.
  engine.emit('message', engineFrame({ type: 'error', characterId: 'chizuru', savePath: SAVE, message: 'Timeout waiting for response to get_state. Stderr: …' }), false);
  assert.equal(up.length, 1);
  // The next line works as normal; a long rpc error is shortened.
  tap.take(brainFrame({ type: 'character_prompt', characterId: 'chizuru', message: '喂' }));
  engine.emit('message', engineFrame({ type: 'error', characterId: 'chizuru', savePath: SAVE, message: 'Timeout waiting for response to get_state. Stderr: long dump' }), false);
  assert.equal(up.at(-1).message, 'Timeout waiting for response to get_state.');
  tap.close();
});
