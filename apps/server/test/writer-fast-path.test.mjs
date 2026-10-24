// The writer's fast path on the server, against a fake model:
//   - the switch: AIRP_WRITER_FAST_PATH=off|shadow|on (default on), world.json writer.fastPath,
//     the save's writerFastPath setting;
//   - the pre-route (§5.1) and the run-time fallbacks (§5.2–§5.3);
//   - on: chalk on the existing chalk lane, ops through the action service, the ending runs, the
//     log line; the player's turn is counted once (the WS request), never again by the fast beat;
//   - shadow: nothing written, nothing sent, one comparison line in the log;
//   - the log keeps the request of a beat the fast path answered (the drawer's history), and only of those;
//   - the button preview is the command engine's dry run and agrees with the real press.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as nodeTest } from 'node:test';
import { testsNeeding } from '../../../tools/shipped-worlds.mjs';
import { fileURLToPath } from 'node:url';
import { LocalWorldStore, createActionService, parseFrontmatter, previewChoice, buildFastPathPack, reachedEnding, streamItemsOfFastPathLog } from '@airp/shared';
import { WriterFastPath, AgentBeatRecorder, fastPathModeFromEnv, fastPathAllowed, preRoute, FAST_PATH_LOG } from '../dist/engine/writer-fast-path.js';
import { countServerPlayerTurn } from '../dist/engine/player-turn.js';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const TEMPLATE = fileURLToPath(new URL('../../../templates/seven-days-inn-zh', import.meta.url));
// The fixture is 七日旅店; every test here is skipped where this copy does not carry it.
const test = testsNeeding(nodeTest, 'seven-days-inn-zh');
const SHRINE = 'world/shrine';
const BEAT = (text) => `[Current Layer] ${SHRINE}\n[Player Request] ${text}`;

async function world() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-fast-path-'));
  const root = path.join(base, 'inn-save-1a2b3c4d');
  await fs.cp(TEMPLATE, root, { recursive: true });
  const store = new LocalWorldStore(root);
  const god = () => createActionService(store, { type: 'god' }, { turn: `req:${crypto.randomUUID()}` });
  const read = (rel) => fs.readFile(path.join(root, rel), 'utf8');
  const has = (rel) => fs.access(path.join(root, rel)).then(() => true, () => false);
  const log = async () => (await read(FAST_PATH_LOG).catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { base, root, store, god, read, has, log, done: async () => { store.close(); await fs.rm(base, { recursive: true, force: true }); } };
}

/** Every world file (not .airpworld) → sha256; the history DB's event count. */
async function snapshot(root, store) {
  const out = {};
  const walk = async (dir) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else out[path.relative(root, full)] = crypto.createHash('sha256').update(await fs.readFile(full)).digest('hex');
    }
  };
  await walk(root);
  return { files: out, seq: await store.getMaxSeq() };
}

/** A fake chat-completions endpoint: streams `reply` as SSE in small pieces; JSON for the repair call. */
function fakeModel(replies, { status = 200 } = {}) {
  const calls = [];
  const request = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (status !== 200) return new Response('nope', { status });
    const next = replies.length > 1 ? replies.shift() : replies[0];
    const text = typeof next === 'string' ? next : JSON.stringify(next);
    if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    const enc = new TextEncoder();
    const pieces = text.match(/[\s\S]{1,7}/g) ?? [];
    const stream = new ReadableStream({
      start(c) {
        for (const p of pieces) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`));
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 9000, completion_tokens: 160, prompt_cache_hit_tokens: 8800 } })}\n\n`));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { request, calls };
}

const ENV = (mode) => ({ AIRP_WRITER_FAST_PATH: mode, DEEPSEEK_API_KEY: 'test-key-not-real' });

function sink() {
  const frames = [];
  const events = [];
  return { frames, events, out: { frame: (m) => frames.push(m), event: (e) => events.push(e) } };
}

const LEAVE = {
  route: 'fast',
  chalk: { append_to: null, title: '一个人走', text: '你迈下第一级石阶，杉树在身后合拢。', options: [] },
  ops: [{ op: 'choose', path: `${SHRINE}/hidden-path.md`, option: 'leave-alone' }],
  why: '玩家明确选择一个人走',
};

test('the switch: on by default; off / shadow by env; a world or a save can turn it off', async () => {
  assert.equal(fastPathModeFromEnv({}), 'on');
  assert.equal(fastPathModeFromEnv({ AIRP_WRITER_FAST_PATH: '' }), 'on');
  assert.equal(fastPathModeFromEnv({ AIRP_WRITER_FAST_PATH: 'ON' }), 'on');
  assert.equal(fastPathModeFromEnv({ AIRP_WRITER_FAST_PATH: 'yes' }), 'on');
  assert.equal(fastPathModeFromEnv({ AIRP_WRITER_FAST_PATH: 'shadow' }), 'shadow');
  for (const v of ['off', 'OFF', ' off ', '0', 'false', 'no']) assert.equal(fastPathModeFromEnv({ AIRP_WRITER_FAST_PATH: v }), 'off', v);
  const w = await world();
  try {
    assert.deepEqual(fastPathAllowed(w.root), { ok: true });
    const manifest = JSON.parse(await w.read('world.json'));
    await fs.writeFile(path.join(w.root, 'world.json'), JSON.stringify({ ...manifest, writer: { fastPath: false } }));
    assert.equal(fastPathAllowed(w.root).ok, false);
    await fs.writeFile(path.join(w.root, 'world.json'), JSON.stringify(manifest));
    await fs.mkdir(path.join(w.root, '.airpworld'), { recursive: true });
    await fs.writeFile(path.join(w.root, '.airpworld/settings.json'), JSON.stringify({ autoWrite: 'scenes-and-choices', writerFastPath: false }));
    assert.equal(fastPathAllowed(w.root).ok, false);
    const fast = new WriterFastPath({ storeFor: () => w.store, env: ENV('on'), request: fakeModel([LEAVE]).request });
    assert.deepEqual(await fast.gate(w.root, BEAT('好')), { ok: false, reason: 'save setting writerFastPath is false' });
    const off = new WriterFastPath({ storeFor: () => w.store, env: { AIRP_WRITER_FAST_PATH: 'off', DEEPSEEK_API_KEY: 'x' }, request: fakeModel([LEAVE]).request });
    assert.deepEqual(await off.gate(w.root, BEAT('好')), { ok: false, reason: 'off' });
  } finally {
    await w.done();
  }
});

test('pre-route: only play beats, on a place with a README, referring to nothing outside it and the bag', async () => {
  const w = await world();
  try {
    assert.deepEqual(await preRoute(w.store, BEAT('离开这里')), { ok: true, layer: SHRINE });
    assert.equal((await preRoute(w.store, `[Current Layer] ${SHRINE}\n[Author Request] 加一个房间`)).ok, false);
    assert.equal((await preRoute(w.store, 'Narrate the away digest.')).ok, false);
    assert.equal((await preRoute(w.store, '[Current Layer] world/nowhere\n[Player Request] 看看')).ok, false);
    assert.equal((await preRoute(w.store, BEAT('看看[账本](world/front-hall/register.md)'))).ok, false);
    assert.equal((await preRoute(w.store, BEAT('用[石碑](world/shrine/hidden-path.md)和[便签](player/note.md)'))).ok, true);
    const event = `[Player Event] {"type":"choice_selected","layer":"${SHRINE}","subject":"${SHRINE}/hidden-path.md"}`;
    assert.deepEqual(await preRoute(w.store, event), { ok: true, layer: SHRINE });
    const noModel = new WriterFastPath({ storeFor: () => w.store, env: { AIRP_WRITER_FAST_PATH: 'on', AIRP_AI_ACCOUNT: '0' } });
    assert.deepEqual(await noModel.gate(w.root, BEAT('好')), { ok: false, reason: 'no model endpoint' });
  } finally {
    await w.done();
  }
});

test('dry run: the preview says what pressing would do, writes nothing, and agrees with the real press', async () => {
  const w = await world();
  try {
    const player = createActionService(w.store, { type: 'player' }, { turn: 'req:preview' });
    const before = await snapshot(w.root, w.store);
    const shut = await previewChoice(player.ctx, { path: `${SHRINE}/hidden-path.md`, choice: 'leave-alone' });
    assert.equal(shut.verdict, 'nothing');
    assert.deepEqual(shut.commands.map((c) => [c.command, c.status, c.skipped ?? c.effects?.length]), [['leave-alone', 'ok', 0], ['lovers-leave', 'skipped', 'when_false']]);
    const search = await previewChoice(player.ctx, { path: `${SHRINE}/README.md`, choice: 'search' });
    assert.equal(search.verdict, 'client');
    assert.deepEqual(search.client, { kind: 'search', spot: 'scene' });
    const pack = await buildFastPathPack(w.store, { layer: SHRINE, request: BEAT('好，我一个人走') });
    assert.match(pack.user, /「一个人从小路下山」 \(id leave-alone\) → command leave-alone: every effect’s when is false → would do NOTHING now/);
    assert.deepEqual(await snapshot(w.root, w.store), before, 'preview and pack wrote nothing');
    assert.equal(await w.store.readCursor('writer'), 0, 'the writer cursor did not move');
    // With the way known, the dry run says the ending would run — and the real press runs it.
    await w.god().createEntity({ path: 'player/shrine-path.md', frontmatter: { type: 'note', title: '神社小路的走法' }, body: '过三棵杉' });
    const open = await previewChoice(player.ctx, { path: `${SHRINE}/hidden-path.md`, choice: 'leave-alone' });
    assert.equal(open.verdict, 'would_run');
    assert.deepEqual(open.commands[0].effects.map((e) => [e.action, e.args?.ending]), [['end', 'alone']]);
    assert.equal(await reachedEnding(w.store), null);
    await player.chooseOption({ path: `${SHRINE}/hidden-path.md`, choice: 'leave-alone' });
    assert.equal((await reachedEnding(w.store))?.id, 'alone');
  } finally {
    await w.done();
  }
});

test('on: one call streams the chalk on the chalk lane, the op runs the ending, the turn is counted once', async () => {
  const w = await world();
  try {
    await w.god().createEntity({ path: 'player/shrine-path.md', frontmatter: { type: 'note', title: '神社小路的走法' }, body: '过三棵杉' });
    const days = async () => parseFrontmatter(await w.read('world/days.md')).frontmatter.status?.data?.turns ?? 0;
    const turnsBefore = await days();
    // What the WS handler does for a writer_prompt: count the request, then submit the beat.
    await countServerPlayerTurn(w.store, 'request');
    const model = fakeModel([LEAVE]);
    const fast = new WriterFastPath({ storeFor: () => w.store, env: ENV('on'), request: model.request });
    const s = sink();
    const result = await fast.run(w.root, BEAT('好，我一个人走'), s.out);
    assert.equal(result.handled, true, result.fallback);
    assert.equal(model.calls.length, 1, 'one call, no repair');
    assert.equal(model.calls[0].thinking.type, 'disabled');
    const types = s.frames.map((f) => f.type);
    assert.equal(types.filter((t) => t === 'chalk_writing').length, 1);
    assert.ok(types.indexOf('chalk_writing') < types.indexOf('writer_delta'));
    assert.equal(s.frames.filter((f) => f.type === 'writer_delta').map((f) => f.delta).join(''), LEAVE.chalk.text);
    const landed = s.frames.find((f) => f.type === 'chalk_landed');
    assert.ok(landed?.path?.startsWith(`${SHRINE}/`));
    assert.ok(s.frames.some((f) => f.type === 'agent_progress' && f.landed === true));
    assert.deepEqual(s.events.map((e) => e.type), ['agent_start', 'agent_settled']);
    assert.match(await w.read(landed.path), /你迈下第一级石阶/);
    assert.equal((await reachedEnding(w.store))?.id, 'alone');
    assert.equal(await days(), turnsBefore + 1, 'the request counted once; the writer\'s choose is not a player turn');
    const [line] = await w.log();
    assert.equal(line.mode, 'on');
    assert.equal(line.route, 'fast');
    assert.deepEqual(line.legal, { ok: 1, total: 1 });
    assert.ok(await w.store.readCursor('writer') > 0, 'the writer read this beat');
    assert.doesNotMatch(JSON.stringify(line), /test-key-not-real/, 'the key never reaches the log');
    // The writer's session never sees this beat: the log keeps the request for the message drawer.
    assert.deepEqual(Object.keys(line.request).sort(), ['at', 'id', 'message']);
    assert.equal(line.request.id, landed.toolCallId);
    assert.equal(line.request.message, BEAT('好，我一个人走'));
    assert.ok(Date.parse(line.request.at) <= Date.parse(line.at), 'stamped when the beat arrived, not when it finished');
    assert.deepEqual(streamItemsOfFastPathLog(await w.read(FAST_PATH_LOG)).map((e) => [e.id, e.kind, e.who, e.text, e.layer, e.at]),
      [[`ask:${landed.toolCallId}`, 'you', 'writer', '好，我一个人走', SHRINE, Date.parse(line.request.at)]]);
  } finally {
    await w.done();
  }
});

test('on: fallbacks — HTTP error, the model asking for the agent, nothing parsable — leave the world untouched', async () => {
  const w = await world();
  try {
    const before = await snapshot(w.root, w.store);
    for (const [label, model] of [
      ['http', fakeModel([LEAVE], { status: 503 })],
      ['agent', fakeModel([{ route: 'agent', chalk: null, ops: [], why: '要搭一个新地点' }])],
      ['garbage', fakeModel(['not json at all'])],
    ]) {
      const fast = new WriterFastPath({ storeFor: () => w.store, env: ENV('on'), request: model.request });
      const s = sink();
      const result = await fast.run(w.root, BEAT('离开这里'), s.out);
      assert.equal(result.handled, false, label);
      assert.ok(result.fallback, label);
      assert.ok(!s.frames.some((f) => f.type === 'chalk_landed'), `${label}: no chalk landed`);
      assert.ok(!s.events.some((e) => e.type === 'agent_settled'), `${label}: the agent continues the same busy beat`);
    }
    const after = await snapshot(w.root, w.store);
    assert.deepEqual(after.files, before.files);
    assert.equal(after.seq, before.seq);
    assert.deepEqual((await w.log()).map((l) => l.route), ['agent', 'agent', 'agent']);
    assert.ok((await w.log()).every((l) => !('request' in l)), 'a beat the agent takes is in its session, not here');
  } finally {
    await w.done();
  }
});

test('on: two beats in one place with every op refused → the next beat there goes to the agent', async () => {
  const w = await world();
  try {
    const bad = { route: 'fast', chalk: { title: '雾', text: '雾没有散。', options: [] }, ops: [{ op: 'search', spot: 'nowhere' }], why: 'x' };
    const model = fakeModel([bad]); // the repair call answers the same object → no usable ops either
    const fast = new WriterFastPath({ storeFor: () => w.store, env: ENV('on'), request: model.request });
    for (let i = 0; i < 2; i++) assert.equal((await fast.run(w.root, BEAT('找路'), sink().out)).handled, true);
    const gate = await fast.gate(w.root, BEAT('找路'));
    assert.deepEqual(gate, { ok: false, reason: 'two beats in a row here had every op refused' });
    assert.equal((await fast.gate(w.root, BEAT('找路'))).ok, true, 'one agent beat, then the fast path again');
    const lines = await w.log();
    assert.deepEqual(lines.map((l) => l.legal), [{ ok: 0, total: 1 }, { ok: 0, total: 1 }]);
    assert.ok(lines[0].repair, 'one repair round was tried');
  } finally {
    await w.done();
  }
});

test('on: a chalk that copies a declared button loses the button; a quiet beat lands no chalk', async () => {
  const w = await world();
  try {
    const copy = { route: 'fast', chalk: { title: '路', text: '小路就在石碑后面。', options: [{ id: 'alone', label: '一个人从小路下山' }, { id: 'back', label: '回旅店门口', enter: 'map' }, { id: 'x', label: '去别处', enter: 'world/nowhere' }] }, ops: [], why: '' };
    const fast = new WriterFastPath({ storeFor: () => w.store, env: ENV('on'), request: fakeModel([copy]).request });
    const s = sink();
    assert.equal((await fast.run(w.root, BEAT('路在哪'), s.out)).handled, true);
    const card = parseFrontmatter(await w.read(s.frames.find((f) => f.type === 'chalk_landed').path)).frontmatter;
    assert.deepEqual(card.choice.options.map((o) => o.id), ['back']);
    assert.deepEqual(card.choice_actions, { back: { kind: 'enter', target: 'map' } });
    const quiet = { route: 'fast', chalk: { title: '静', text: '什么也没发生。', options: [] }, ops: [], why: '' };
    const q = new WriterFastPath({ storeFor: () => w.store, env: ENV('on'), request: fakeModel([quiet]).request });
    const qs = sink();
    assert.equal((await q.run(w.root, `[Current Layer] ${SHRINE}\n[Quiet Beat] No player request this turn.`, qs.out)).handled, true);
    assert.ok(!qs.frames.some((f) => f.type === 'writer_delta' || f.type === 'chalk_landed'));
  } finally {
    await w.done();
  }
});

test('shadow: the fast path runs beside the agent, writes nothing, sends nothing, logs the comparison', async () => {
  const w = await world();
  try {
    const before = await snapshot(w.root, w.store);
    const fast = new WriterFastPath({ storeFor: () => w.store, env: ENV('shadow'), request: fakeModel([LEAVE]).request });
    const run = await fast.shadow(w.root, BEAT('好，我一个人走'));
    assert.ok(run);
    const agent = new AgentBeatRecorder();
    agent.onEvent({ type: 'tool_execution_start', toolName: 'chalk', toolCallId: 'a', args: {} });
    agent.onEvent({ type: 'tool_execution_end', toolName: 'chalk', toolCallId: 'a', isError: false });
    agent.onEvent({ type: 'tool_execution_start', toolName: 'choose', toolCallId: 'b', args: { path: `${SHRINE}/hidden-path.md`, option: 'leave-alone' } });
    agent.onEvent({ type: 'tool_execution_end', toolName: 'choose', toolCallId: 'b', isError: false });
    agent.onEvent({ type: 'agent_settled' });
    await run.finish(agent);
    const after = await snapshot(w.root, w.store);
    assert.deepEqual(after, before, 'shadow wrote nothing');
    const [line] = await w.log();
    assert.equal(line.mode, 'shadow');
    assert.equal(line.request, undefined, 'shadow: the agent answered, its session holds the request');
    assert.deepEqual(line.legal, { ok: 1, total: 1 });
    assert.deepEqual(line.compare.same, [`choose ${SHRINE}/hidden-path.md#leave-alone`]);
    assert.equal(line.agent.steps, 2);
    assert.equal(typeof line.firstChalkMs, 'number');
  } finally {
    await w.done();
  }
});

// ——— lifecycle routing (no pi process: the fast path is a stub) ———
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { AgentLifecycleManager } = await jiti.import('../src/engine/lifecycle.ts');

function stubFast(mode, handled) {
  const calls = { run: 0, shadow: 0, finish: [], abort: 0 };
  return {
    calls,
    mode: () => mode,
    gate: async () => ({ ok: true, store: null, layer: SHRINE, endpoint: null }),
    run: async (_root, _msg, out) => {
      calls.run++;
      if (handled) {
        out.frame({ type: 'chalk_landed', source: 'writer', toolCallId: 'fast:1', path: `${SHRINE}/x.md` });
        out.frame({ type: 'agent_progress', source: 'writer', busy: true, landed: true });
        out.event({ type: 'agent_settled' });
      }
      return { handled, fallback: handled ? undefined : 'stub', record: {} };
    },
    shadow: async () => { calls.shadow++; return { finish: async (agent) => { calls.finish.push(agent); } }; },
    abort: () => { calls.abort++; return true; },
  };
}

test('lifecycle: `on` answers a beat without starting the agent; a fallback goes to the agent; shadow finishes even if the agent cannot start', async () => {
  const frames = [];
  const events = [];
  const make = (fast) => new AgentLifecycleManager({
    repoRoot: '/tmp/nowhere', vendorCliPath: '/tmp/nowhere/cli.js', fastPath: fast,
    frameSink: (m) => frames.push(m), eventSink: (source, event, _c, turnId, savePath) => events.push({ source, type: event.type, turnId, savePath }),
  });
  const on = stubFast('on', true);
  await make(on).submitWriter('/tmp/w-fast', BEAT('好'));
  assert.equal(on.calls.run, 1);
  assert.ok(frames.every((f) => f.savePath === '/tmp/w-fast'));
  assert.deepEqual(events.map((e) => [e.source, e.type]), [['writer', 'agent_settled']]);
  assert.match(events[0].turnId, /^writer:/);

  const fallback = stubFast('on', false);
  await assert.rejects(make(fallback).submitWriter('/tmp/w-fast', BEAT('好')), 'the agent is asked (and cannot start here)');
  assert.equal(fallback.calls.run, 1);

  const shadow = stubFast('shadow', true);
  await assert.rejects(make(shadow).submitWriter('/tmp/w-fast', BEAT('好')));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(shadow.calls.run, 0, 'shadow never answers the beat');
  assert.deepEqual(shadow.calls.finish, [null], 'logged without an agent record');

  const stop = stubFast('on', true);
  await make(stop).abortWriter('/tmp/w-fast');
  assert.equal(stop.calls.abort, 1, 'Stop reaches a fast beat even with no writer process');
});
