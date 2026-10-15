// Character tick v2 — the server's model host (apps/server/src/tick-model.ts, the design notes):
// an own key / the service, the quiet header, prefetch then at most TICK_WAIT_MS more, a late answer dropped,
// a refusal (401 / 402 / 403) stops calls for that save, and the stub.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTickModelHost, resetTickModelHost, stubTickAnswer, TICK_WAIT_MS, QUIET_HEADER } from '../dist/tick-model.js';

const REQ = (key = 'seed:5:intent:ross:a,b') => ({
  key,
  system: 'sys',
  user: 'How you talk: 「哎呀。」 「我去透口气。」\n## Options (pick one id)\n- visit-study [mark → 书房]: x\n- say [speak]: y',
  maxTokens: 200,
});
const ok = (content) => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1600, completion_tokens: 120 } }), { status: 200, headers: { 'content-type': 'application/json' } });
const env = { DEEPSEEK_API_KEY: 'k', AIRP_AI_ACCOUNT: '0' };

test('own key: one quiet JSON call; the answer and its estimated credits come back', async () => {
  resetTickModelHost();
  const seen = [];
  const host = createTickModelHost(env, async (url, init) => { seen.push({ url, init }); return ok('{"move":"say"}'); });
  assert.equal(host.tier(), 'registered');
  const reply = await host.runner('/w1').answer(REQ());
  assert.deepEqual(reply, { content: '{"move":"say"}', credits: 1.2 });
  assert.match(String(seen[0].url), /\/chat\/completions$/);
  const headers = new Headers(seen[0].init.headers);
  assert.equal(headers.get(QUIET_HEADER), '1', 'never opens the sign-in panel');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.response_format.type, 'json_object');
  assert.deepEqual(body.thinking, { type: 'disabled' });
});

test('prefetch: the beat takes the prefetched answer when the key matches (options may differ)', async () => {
  resetTickModelHost();
  let calls = 0;
  const host = createTickModelHost(env, async () => { calls += 1; return ok('{"move":"say"}'); });
  assert.equal(host.prefetch('/w2', REQ('seed:5:intent:ross:a,b')), true);
  const reply = await host.runner('/w2').answer(REQ('seed:5:intent:ross:a'));
  assert.equal(reply.content, '{"move":"say"}');
  assert.equal(calls, 1, 'no second call');
  // Another beat / actor: a fresh call.
  host.prefetch('/w2', REQ('seed:6:chatter:eve:say'));
  await host.runner('/w2').answer(REQ('seed:6:intent:ross:a'));
  assert.equal(calls, 3);
});

test(`a slow answer: at most ${TICK_WAIT_MS} ms after the beat, then the rules (null) and the request is aborted`, async () => {
  resetTickModelHost();
  let aborted = false;
  const host = createTickModelHost(env, (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
    setTimeout(() => resolve(ok('{"move":"say"}')), TICK_WAIT_MS + 1500);
  }));
  const t = Date.now();
  assert.equal(await host.runner('/w3').answer(REQ()), null);
  assert.ok(Date.now() - t < TICK_WAIT_MS + 400);
  assert.equal(aborted, true);
});

test('a refusal (403 guest_world_only, 402 credits, 401) stops tick calls for that save; others go on', async () => {
  for (const status of [401, 402, 403]) {
    resetTickModelHost();
    let calls = 0;
    const host = createTickModelHost(env, async () => { calls += 1; return new Response(JSON.stringify({ error: { code: 'guest_world_only' } }), { status }); });
    assert.equal(await host.runner('/w4').answer(REQ()), null);
    assert.equal(host.runner('/w4'), null, `${status}: blocked`);
    assert.equal(host.prefetch('/w4', REQ()), false);
    assert.ok(host.runner('/other'));
    assert.equal(calls, 1);
  }
  resetTickModelHost();
});

test('no model here: no runner, no tier (the v1 rules)', () => {
  const host = createTickModelHost({ AIRP_AI_ACCOUNT: '0' }, async () => ok('{}'));
  assert.equal(host.runner('/w5'), null);
  assert.equal(host.tier(), null);
});

test('the stub (screenshots only): first option, one of the person\'s own voice lines', async () => {
  const a = JSON.parse(stubTickAnswer(REQ()));
  assert.equal(a.move, 'visit-study');
  assert.ok(['哎呀。', '我去透口气。'].includes(a.say));
  resetTickModelHost();
  const host = createTickModelHost({ AIRP_TICK_MODEL_STUB: '1', AIRP_AI_ACCOUNT: '0' }, async () => { throw new Error('no network'); });
  const reply = await host.runner('/w6').answer(REQ());
  assert.equal(JSON.parse(reply.content).move, 'visit-study');
  resetTickModelHost();
});
