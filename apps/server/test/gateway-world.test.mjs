// X-Worldlines-World (apps/server/src/gateway-world.ts anti-abuse):
// every call to the Worldlines AI service while a world is open names it, so
// billing counts play from calls it served; a call on an own provider key never
// carries it. Runs against built dist: `pnpm build` first. Fake fetch only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gatewayFetch, textModelEndpoint } from '../dist/ai-gateway.js';
import { WORLD_HEADER, gatewayWorld, setGatewayWorldSource } from '../dist/gateway-world.js';
import { shelfGroupIdOf, worldKeyOfRoot } from '../dist/world-shelf.js';
import { voiceLiveUpstreamHeaders } from '../dist/engine/voice-provider.js';
import { requestVoiceTicket } from '../dist/engine/voice-live-ticket.js';

globalThis.__airpAccountToken = async () => 'acct';
const AI = 'https://ai.example.test/v1';

function recorder(status = 200, body = { ok: true }) {
  const calls = [];
  const request = async (url, init = {}) => {
    calls.push({ url: String(url), headers: new Headers(init.headers) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, request };
}

function withWorld(t, id) {
  setGatewayWorldSource(() => id);
  t.after(() => setGatewayWorldSource(() => null));
}

test('the open world rides every gateway call, account token or personal token', async (t) => {
  withWorld(t, 'whitechapel-zh');
  const r = recorder();
  await gatewayFetch({ base: AI, apiKey: 'worldlines-account', account: true }, `${AI}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, r.request);
  await gatewayFetch({ base: AI, apiKey: 'wl_pat_x', account: false }, `${AI}/audio/speech`, { method: 'POST', headers: { authorization: 'Bearer wl_pat_x' }, body: '{}' }, r.request);
  assert.deepEqual(r.calls.map((c) => c.headers.get(WORLD_HEADER)), ['whitechapel-zh', 'whitechapel-zh']);
  assert.equal(r.calls[0].headers.get('authorization'), 'Bearer acct');
  assert.equal(r.calls[1].headers.get('authorization'), 'Bearer wl_pat_x');
});

test('no world open, or an id that does not fit: no header (a caller-set one is dropped too)', async (t) => {
  const r = recorder();
  const gw = { base: AI, apiKey: 'worldlines-account', account: true };
  await gatewayFetch(gw, `${AI}/chat/completions`, { method: 'POST', headers: { [WORLD_HEADER]: 'spoofed' }, body: '{}' }, r.request);
  for (const bad of ['', '-lead', 'has space', 'a/b', 'x'.repeat(129)]) {
    setGatewayWorldSource(() => bad);
    assert.equal(gatewayWorld(), null, bad);
    await gatewayFetch(gw, `${AI}/chat/completions`, { method: 'POST', body: '{}' }, r.request);
  }
  setGatewayWorldSource(() => { throw new Error('store closed'); });
  assert.equal(gatewayWorld(), null);
  t.after(() => setGatewayWorldSource(() => null));
  assert.ok(r.calls.every((c) => !c.headers.has(WORLD_HEADER)));
});

test('an own DeepSeek key goes straight to the provider without the world', async (t) => {
  withWorld(t, 'whitechapel-zh');
  const r = recorder();
  const endpoint = textModelEndpoint({ DEEPSEEK_API_KEY: 'sk-own', AIRP_AI_BASE: AI }, r.request);
  assert.equal(endpoint.baseUrl, 'https://api.deepseek.com');
  await endpoint.request(`${endpoint.baseUrl}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer sk-own' }, body: '{}' });
  assert.equal(r.calls[0].headers.has(WORLD_HEADER), false);
  // …while the same job on the service carries it.
  const service = textModelEndpoint({ AIRP_AI_BASE: AI }, r.request);
  await service.request(`${service.baseUrl}/chat/completions`, { method: 'POST', body: '{}' });
  assert.equal(r.calls[1].headers.get(WORLD_HEADER), 'whitechapel-zh');
});

test('voice: the ticket request and the proxied upstream name the world; a direct voice-live run does not', async () => {
  const r = recorder(201, { ticket: 'tkt_0123456789abcdefABCDEF', url: 'wss://ai.example.test/v1/voice/live' });
  await requestVoiceTicket({ ticketsUrl: `${AI}/voice/tickets`, accessToken: 'jwt', cast: {}, world: 'nightcity', request: r.request });
  await requestVoiceTicket({ ticketsUrl: `${AI}/voice/tickets`, accessToken: 'jwt', cast: {}, world: null, request: r.request });
  assert.deepEqual(r.calls.map((c) => c.headers.get(WORLD_HEADER)), ['nightcity', null]);
  assert.equal(voiceLiveUpstreamHeaders({ VOICE_LIVE_TOKEN: 'wl_pat_x' }, 'nightcity')[WORLD_HEADER], 'nightcity');
  assert.equal(voiceLiveUpstreamHeaders({ VOICE_LIVE_TOKEN: 'wl_pat_x' }, null)[WORLD_HEADER], undefined);
  assert.equal(voiceLiveUpstreamHeaders({ VOICE_LIVE_ACCESS_TOKEN: 'shared' }, 'nightcity')[WORLD_HEADER], undefined);
});

test('the world key is the shelf group id (chronicle world_ref livingcanvas/world/<id>)', async (t) => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-gateway-world-'));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  const write = async (rel, manifest) => {
    await fs.mkdir(path.join(repo, rel), { recursive: true });
    await fs.writeFile(path.join(repo, rel, 'world.json'), JSON.stringify(manifest));
  };
  await write('templates/whitechapel-zh', { id: 'whitechapel-zh' });
  await write('worlds/whitechapel-zh-1a2b', { id: 'whitechapel-zh' });
  await write('worlds/whitechapel-zh-old', { id: 'renamed-long-ago' });
  await write('worlds/my-world', { id: 'my-world', workshop: { status: 'draft', owner: 'u1' } });
  assert.equal(worldKeyOfRoot(repo, path.join(repo, 'worlds/whitechapel-zh-1a2b')), 'whitechapel-zh');
  assert.equal(worldKeyOfRoot(repo, path.join(repo, 'worlds/whitechapel-zh-old')), 'whitechapel-zh');
  assert.equal(worldKeyOfRoot(repo, path.join(repo, 'worlds/my-world')), 'my-world');
  assert.equal(worldKeyOfRoot(repo, path.join(repo, 'worlds/missing')), null);
  assert.equal(shelfGroupIdOf('x-1', { id: 'x', workshop: {} }, [{ id: 'x-longer', manifest: { id: 'y' } }]), 'x');
});
