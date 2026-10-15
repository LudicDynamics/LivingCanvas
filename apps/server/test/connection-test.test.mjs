// Connection self-test — server assertions.
// Runs against built dist: `pnpm build` first.
// Upstreams are REPLACED by local stubs through the injected `fetch`; nothing paid is called.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runConnectionTests, probeChat } from '../dist/routes/connection-test.js';

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function withEnv(values, run) {
  const saved = {};
  for (const [k, v] of Object.entries(values)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return Promise.resolve().then(run).finally(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

test('probeChat reports the model and its reply', async () => {
  const seen = [];
  const fetchStub = async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return jsonResponse(200, { choices: [{ message: { content: ' ok ' } }] }); };
  const detail = await probeChat({ baseUrl: 'http://stub/v1/', apiKey: 'k', model: 'm-1', tokenField: 'max_tokens', fetch: fetchStub });
  assert.equal(detail, 'm-1 → "ok"');
  assert.equal(seen[0].url, 'http://stub/v1/chat/completions');
  assert.equal(seen[0].body.max_tokens, 5);
});

test('an upstream error surfaces its status and body, never as a pass', async () => {
  const fetchStub = async () => new Response('{"error":"Model Not Exist"}', { status: 400 });
  await assert.rejects(probeChat({ baseUrl: 'http://stub', apiKey: 'k', model: 'nope', tokenField: 'max_tokens', fetch: fetchStub }), /HTTP 400.*Model Not Exist/);
});

test('every configured service gets a row; missing keys are skipped, not failed', async () => {
  await withEnv({ DEEPSEEK_API_KEY: 'd', OPENAI_API_KEY: undefined, DASHSCOPE_API_KEY: undefined, AIRP_TTS_LOCAL_BASE_URL: undefined }, async () => {
    const fetchStub = async () => jsonResponse(200, { choices: [{ message: { content: 'ok' } }] });
    const checks = await runConnectionTests({
      agentModels: async () => ({ writer: { provider: 'deepseek', id: 'deepseek-v4-flash' }, characters: [{ id: 'nanami', model: { provider: 'vercel-ai-gateway', id: 'x' } }, { id: 'mio', model: { provider: 'zai', id: 'glm' } }] }),
      fetch: fetchStub,
    });
    const byId = Object.fromEntries(checks.map(c => [c.id, c]));
    assert.equal(byId.deepseek.status, 'ok');
    assert.equal(byId.openai.status, 'skipped');
    assert.equal(byId.writer.status, 'ok');
    assert.match(byId.writer.detail, /deepseek-v4-flash/);
    assert.equal(byId['character:nanami'].status, 'skipped');
    // Worldlines no longer offers Vercel: never named to the player
    assert.match(byId['character:nanami'].detail, /no longer offered/);
    assert.ok(!JSON.stringify(checks).toLowerCase().includes('vercel'), 'no vercel in the connection test');
    assert.match(byId['character:mio'].detail, /no direct probe/);
    assert.equal(byId['tts-online'].status, 'skipped');
    assert.equal(byId['tts-local'].status, 'skipped');
    assert.equal(byId.stt.status, 'skipped');
    assert.equal(byId.live.status, 'skipped');
  });
});

test('a hanging upstream is reported as a failure with the timeout named', async () => {
  await withEnv({ DEEPSEEK_API_KEY: 'd', OPENAI_API_KEY: undefined, DASHSCOPE_API_KEY: undefined, AIRP_TTS_LOCAL_BASE_URL: undefined }, async () => {
    // What `AbortSignal.timeout` makes fetch throw once the budget is spent.
    const fetchStub = async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); };
    const checks = await runConnectionTests({ agentModels: async () => null, fetch: fetchStub });
    const deepseek = checks.find(c => c.id === 'deepseek');
    assert.equal(deepseek.status, 'failed');
    assert.match(deepseek.detail, /no reply within 25s/);
    assert.equal(checks.find(c => c.id === 'writer').detail, 'no world is open');
  });
});
