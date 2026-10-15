// the player's own provider keys on the browser
// version. The promise under test: the key lives only in this browser, goes only
// to the provider the player chose, and never reaches a Worldlines server — not
// in a request (header, URL or body, for chat, images, voices or voice input),
// not in the synced settings, not in a log line, not in a world / VFS file.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const lk = await jiti.import('../src/lib/local-key.ts');
const rt = await jiti.import('../../browser-runtime/src/platform/local-key.ts');
const gw = await jiti.import('../../browser-runtime/src/platform/model-gateway.ts');
const { createAccountData } = await jiti.import('../src/lib/account-data.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const messages = JSON.parse(await src('../src/lib/messages.json'));

const DS_KEY = 'sk-deepseek-SECRET-0123456789';
const OA_KEY = 'sk-openai-SECRET-abcdefghij';
const ACCOUNT = 'account-token-ACCT';
const GATEWAY = 'https://ai.worldlines.gg/v1';

function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
}

function settingsWithBothKeys() {
  let s = lk.defaultLocalKeySettings();
  s = lk.upsertKey({ ...s, source: 'local' }, { preset: 'deepseek', base: 'https://api.deepseek.com', key: DS_KEY });
  s = lk.upsertKey(s, { preset: 'openai', base: 'https://api.openai.com/v1', key: OA_KEY });
  return s;
}

test('storage: this browser only, round-trips, malformed → Worldlines, 清除 removes everything', () => {
  const st = memoryStorage();
  assert.deepEqual(lk.readLocalKey(st), lk.defaultLocalKeySettings());
  const s = settingsWithBothKeys();
  assert.equal(lk.writeLocalKey(st, s), true);
  assert.deepEqual(lk.readLocalKey(st), s);
  assert.deepEqual([...st.map.keys()], [lk.LOCAL_KEY_STORAGE]);
  lk.clearLocalKey(st);
  assert.equal(st.map.size, 0);
  assert.deepEqual(lk.readLocalKey(memoryStorage({ [lk.LOCAL_KEY_STORAGE]: '{not json' })), lk.defaultLocalKeySettings());
  const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(lk.readLocalKey(throwing), lk.defaultLocalKeySettings());
  assert.equal(lk.writeLocalKey(throwing, s), false);
  lk.clearLocalKey(throwing);
});

test('keys: DeepSeek carries chat, OpenAI fills images / voices / voice input; Worldlines mode routes nothing', () => {
  const s = settingsWithBothKeys();
  const [ds, oa] = s.keys;
  assert.equal(s.use.chat.via, ds.id, 'the first key keeps chat');
  assert.equal(s.use.chat.model, 'deepseek-flash');
  for (const cap of ['image', 'tts', 'stt']) assert.equal(s.use[cap].via, oa.id, cap);
  const routes = lk.runtimeRoutes(s);
  assert.deepEqual(Object.keys(routes).sort(), ['chat', 'image', 'stt', 'tts']);
  assert.equal(routes.chat.flavor, 'deepseek');
  assert.equal(routes.image.model, 'gpt-image-1');
  assert.deepEqual(lk.runtimeRoutes({ ...s, source: 'worldlines' }), {});
  const moved = lk.chooseFor(s, 'chat', oa.id);
  assert.equal(lk.runtimeRoutes(moved).chat.model, 'gpt-5-mini');
  assert.equal(lk.runtimeRoutes(lk.chooseFor(s, 'tts', lk.WORLDLINES)).tts, undefined);
  const removed = lk.removeKey(s, oa.id);
  assert.deepEqual(Object.keys(lk.runtimeRoutes(removed)), ['chat']);
  assert.equal(lk.chatKeyLabel(s), 'DeepSeek');
  assert.equal(lk.chatKeyLabel(lk.defaultLocalKeySettings()), null);
  // DeepSeek has no image / voice endpoint: it is never offered for them.
  assert.equal(lk.supports(ds, 'image'), false);
  const custom = lk.upsertKey(lk.defaultLocalKeySettings(), { preset: 'custom', base: 'https://api.example.ai/v1', key: 'k-1' });
  assert.equal(custom.use.chat.via, custom.keys[0].id);
  assert.equal(custom.use.image.via, lk.WORLDLINES, 'a custom service gets chat only by default');
});

test('presets: General Compute (chat only, its context windows); no Vercel anywhere', () => {
  assert.deepEqual(lk.LOCAL_KEY_PRESETS.map((p) => p.id), ['deepseek', 'openai', 'openrouter', 'generalcompute', 'gemini', 'groq', 'siliconflow', 'together', 'fireworks', 'mistral', 'custom']);
  assert.ok(!JSON.stringify(lk.LOCAL_KEY_PRESETS).toLowerCase().includes('vercel'));
  const gc = lk.presetOf('generalcompute');
  assert.equal(gc.base, 'https://api.generalcompute.com/v1');
  assert.deepEqual(Object.keys(gc.models), ['chat']);
  assert.deepEqual([...gc.models.chat].sort(), ['deepseek-v3.1', 'deepseek-v3.2', 'gemma-4-31B-it', 'gpt-oss-120b', 'minimax-m2.7']);
  const s = lk.upsertKey({ ...lk.defaultLocalKeySettings(), source: 'local' }, { preset: 'generalcompute', base: gc.base, key: 'gc-test' });
  assert.equal(s.use.image.via, lk.WORLDLINES);
  let r = lk.runtimeRoutes(s).chat;
  assert.deepEqual({ model: r.model, flavor: r.flavor, contextWindow: r.contextWindow }, { model: 'gpt-oss-120b', flavor: 'custom', contextWindow: 128000 });
  r = lk.runtimeRoutes(lk.chooseFor(s, 'chat', s.keys[0].id, 'deepseek-v3.2')).chat;
  assert.equal(r.contextWindow, 32000);
  assert.equal(lk.runtimeRoutes(lk.chooseFor(s, 'chat', s.keys[0].id, 'deepseek-v3.1')).chat.contextWindow, undefined, 'unknown → the default');
  assert.equal(rt.parseLocalKeyRoutes({ chat: r }).chat.contextWindow, 32000);
  // custom flavor: DeepSeek-only fields dropped
  const body = JSON.parse(rt.adaptChatBody(JSON.stringify({ model: 'x', thinking: { type: 'enabled' }, reasoning_effort: 'low', max_tokens: 9 }), r));
  assert.deepEqual(body, { model: 'deepseek-v3.2', max_tokens: 9 });
});

test('a key may only go to an https provider, never to a Worldlines host', () => {
  for (const bad of ['https://ai.worldlines.gg/v1', 'https://worldlines.gg', 'https://x.api.worldlines.gg/v1', 'http://api.deepseek.com', 'https://u:p@api.deepseek.com', 'https://api.deepseek.com?x=1', 'nope']) {
    assert.equal(lk.providerBase(bad), null, bad);
    assert.equal(rt.safeProviderBase(bad), null, `runtime: ${bad}`);
  }
  assert.equal(lk.providerBase('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  assert.equal(lk.providerBase('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.ok(lk.keyProblem({ base: 'https://ai.worldlines.gg/v1', key: 'sk-1' }));
  assert.deepEqual(rt.parseLocalKeyRoutes({ chat: { base: 'https://ai.worldlines.gg/v1', key: 'sk-1', model: 'm', flavor: 'openai' } }), {}, 'the Worker refuses it too');
});

test('「从 .env.local 读取」: DeepSeek and OpenAI keys, placeholders ignored', () => {
  const keys = lk.keysFromEnvFile(`# comment\nDEEPSEEK_API_KEY="${DS_KEY}"\nexport OPENAI_API_KEY=${OA_KEY} # mine\nDASHSCOPE_API_KEY=x\n`);
  assert.deepEqual(keys, [
    { preset: 'deepseek', base: 'https://api.deepseek.com', key: DS_KEY },
    { preset: 'openai', base: 'https://api.openai.com/v1', key: OA_KEY },
  ]);
  assert.deepEqual(lk.keysFromEnvFile('OPENAI_API_KEY=sk-x\nOPENAI_BASE_URL=https://proxy.example.com/v1'), [{ preset: 'custom', base: 'https://proxy.example.com/v1', key: 'sk-x' }]);
  assert.deepEqual(lk.keysFromEnvFile('DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY\nOPENAI_API_KEY=your-key-here'), []);
});

test('「测试连接」: one GET of /models (or OpenRouter /key) to the provider — never a completion, never Worldlines', async () => {
  const seen = [];
  const ok = async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ data: [{ id: 'deepseek-flash' }] }), { status: 200 }); };
  const r = await lk.testKey({ preset: 'deepseek', base: 'https://api.deepseek.com', key: DS_KEY }, ok);
  assert.deepEqual(r, { ok: true, models: ['deepseek-flash'] });
  assert.equal(seen[0].url, 'https://api.deepseek.com/models');
  assert.equal(seen[0].init.method, undefined, 'GET');
  assert.equal(seen[0].init.headers.authorization, `Bearer ${DS_KEY}`);
  assert.equal(seen[0].init.credentials, 'omit');
  await lk.testKey({ preset: 'openrouter', base: 'https://openrouter.ai/api/v1', key: 'sk-or' }, ok);
  assert.equal(seen[1].url, 'https://openrouter.ai/api/v1/key');
  assert.deepEqual(await lk.testKey({ preset: 'openai', base: 'https://api.openai.com/v1', key: OA_KEY }, async () => new Response('{}', { status: 401 })), { ok: false, reason: 'unauthorized', status: 401 });
  assert.deepEqual(await lk.testKey({ preset: 'openai', base: 'https://api.openai.com/v1', key: OA_KEY }, async () => { throw new TypeError('Failed to fetch'); }), { ok: false, reason: 'blocked' });
  assert.equal((await lk.testKey({ preset: 'openai', base: 'https://ai.worldlines.gg/v1', key: OA_KEY }, ok)).reason, 'invalid');
  assert.equal(seen.length, 2);
});

/** Everything a request carries, as text: URL, headers and body (a multipart body entry by entry). */
async function carried(url, init = {}) {
  let body = '';
  if (typeof init.body === 'string') body = init.body;
  else if (init.body instanceof FormData) for (const [k, v] of init.body.entries()) body += `${k}=${typeof v === 'string' ? v : await v.text()}\n`;
  return `${url}\n${JSON.stringify(Object.fromEntries(new Headers(init.headers).entries()))}\n${body}`;
}

function runtimeHarness(routes, world = 'whitechapel-zh') {
  const calls = [];
  const direct = async (url, init = {}) => {
    calls.push({ url: String(url), init, text: await carried(String(url), init) });
    if (String(url).endsWith('/audio/speech')) return new Response(new Uint8Array([82, 73, 70, 70]), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const gateway = gw.createGatewayFetch(direct, { base: GATEWAY, product: 'livingcanvas', token: async () => ACCOUNT, onAuthRequired: () => {}, world: () => world });
  let current = rt.parseLocalKeyRoutes(routes);
  const f = rt.createLocalKeyFetch(gateway, direct, { gatewayBase: GATEWAY, current: () => current });
  return { f, calls, set: (r) => { current = rt.parseLocalKeyRoutes(r); } };
}

/** What the server and the agents send to the gateway, one of each. */
async function everyCapability(f) {
  const auth = { authorization: 'Bearer worldlines-account', 'content-type': 'application/json', 'x-stainless-os': 'x' };
  await f(`${GATEWAY}/chat/completions`, { method: 'POST', headers: auth, body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [{ role: 'assistant', content: 'a', reasoning_content: 'r' }], max_tokens: 100, thinking: { type: 'enabled' }, reasoning_effort: 'low', stream: true }) });
  await f(`${GATEWAY}/images/generations`, { method: 'POST', headers: auth, body: JSON.stringify({ model: 'gpt-image-1', prompt: 'a door', n: 1, size: '1024x1024' }) });
  const edit = new FormData();
  edit.append('model', 'gpt-image-1'); edit.append('prompt', 'same door'); edit.append('image', new Blob([new Uint8Array([1, 2])]), 'ref.png');
  await f(`${GATEWAY}/images/edits`, { method: 'POST', headers: { authorization: 'Bearer worldlines-account' }, body: edit });
  await f(`${GATEWAY}/audio/speech`, { method: 'POST', headers: auth, body: JSON.stringify({ model: 'qwen3-tts-flash', input: '你好', voice: 'Cherry', response_format: 'wav', language: 'Chinese', emotion: 'happy' }) });
  await f(`${GATEWAY}/audio/speech`, { method: 'POST', headers: auth, body: JSON.stringify({ model: 'local-tts', input: '你好', voice: 'setsuna', response_format: 'wav' }) });
  const audio = new FormData();
  audio.append('file', new Blob([new Uint8Array([3])]), 'speech.webm'); audio.append('model', 'gpt-4o-transcribe'); audio.append('response_format', 'json');
  await f(`${GATEWAY}/audio/transcriptions`, { method: 'POST', headers: { authorization: 'Bearer worldlines-account' }, body: audio });
  await f(`${GATEWAY}/usage/me`, { headers: { authorization: 'Bearer worldlines-account' } });
  await f('https://storage.worldlines.gg/v1/public/livingcanvas/worlds');
}

test('runtime: in local-key mode no request to a Worldlines host carries a key, and no provider request carries the account token', async () => {
  const s = settingsWithBothKeys();
  const h = runtimeHarness(lk.runtimeRoutes(s));
  await everyCapability(h.f);
  const worldlines = h.calls.filter((c) => /^https:\/\/([a-z0-9-]+\.)*worldlines\.gg\//.test(c.url));
  const providers = h.calls.filter((c) => !worldlines.includes(c));
  assert.ok(worldlines.length >= 3, 'the studio voice, usage and the catalog still go to Worldlines');
  for (const c of worldlines) {
    assert.ok(!c.text.includes(DS_KEY) && !c.text.includes(OA_KEY), `no key to ${c.url}`);
    assert.ok(!c.text.includes('SECRET'), c.url);
  }
  for (const c of providers) {
    assert.ok(!c.text.includes(ACCOUNT), `no account token to ${c.url}`);
    assert.ok(!/x-worldlines-product|x-worldlines-world|whitechapel-zh|x-stainless/i.test(c.text), `no Worldlines / SDK headers (nor the open world) to ${c.url}`);
    assert.equal(c.init.credentials, 'omit');
    assert.equal(c.init.redirect, 'error', 'the key cannot follow a redirect');
  }
  assert.deepEqual(providers.map((c) => c.url), [
    'https://api.deepseek.com/chat/completions',
    'https://api.openai.com/v1/images/generations',
    'https://api.openai.com/v1/images/edits',
    'https://api.openai.com/v1/audio/speech',
    'https://api.openai.com/v1/audio/transcriptions',
  ]);
  assert.equal(new Headers(providers[0].init.headers).get('authorization'), `Bearer ${DS_KEY}`);
  for (const c of providers.slice(1)) assert.equal(new Headers(c.init.headers).get('authorization'), `Bearer ${OA_KEY}`);
  // the studio voice stayed on Worldlines with the account token
  const studio = worldlines.find((c) => c.url === `${GATEWAY}/audio/speech`);
  assert.match(studio.text, /local-tts/);
  assert.equal(new Headers(studio.init.headers).get('authorization'), `Bearer ${ACCOUNT}`);
});

test('runtime: bodies are adapted per provider; Worldlines mode leaves everything on the gateway', async () => {
  const base = settingsWithBothKeys();
  const openaiChat = lk.runtimeRoutes(lk.chooseFor(base, 'chat', base.keys[1].id, 'gpt-4.1-mini'));
  const h = runtimeHarness(openaiChat);
  await everyCapability(h.f);
  const chat = JSON.parse(h.calls[0].init.body);
  assert.equal(h.calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(chat.model, 'gpt-4.1-mini');
  assert.equal(chat.max_completion_tokens, 100);
  assert.equal(chat.max_tokens, undefined);
  assert.equal(chat.thinking, undefined);
  assert.equal(chat.reasoning_effort, undefined, 'gpt-4.1 is not a reasoning model');
  assert.equal(chat.messages[0].reasoning_content, undefined);
  const speech = JSON.parse(h.calls.find((c) => c.url.endsWith('/v1/audio/speech')).init.body);
  assert.equal(speech.model, 'gpt-4o-mini-tts');
  assert.equal(speech.voice, 'marin', 'Cherry (warm-cheerful) is cast as for a Live call');
  assert.equal(speech.language, undefined);
  assert.equal(speech.emotion, undefined);
  const transcription = h.calls.find((c) => c.url.endsWith('/audio/transcriptions'));
  assert.equal(transcription.init.body.get('model'), 'gpt-4o-transcribe');
  assert.equal(transcription.init.body.getAll('model').length, 1);
  // DeepSeek keeps its own fields
  const dsBody = JSON.parse(rt.adaptChatBody(JSON.stringify({ model: 'x', thinking: { type: 'enabled' }, max_tokens: 5 }), { base: 'https://api.deepseek.com', key: 'k', model: 'deepseek-flash', flavor: 'deepseek' }));
  assert.deepEqual(dsBody, { model: 'deepseek-flash', thinking: { type: 'enabled' }, max_tokens: 5 });
  // Worldlines mode: every request goes to the gateway with the account token, nothing else
  const off = runtimeHarness({});
  await everyCapability(off.f);
  assert.ok(off.calls.every((c) => c.url.startsWith('https://') && c.url.includes('worldlines.gg')));
  // the switch is live: the next request follows the new routes
  off.set(lk.runtimeRoutes(base));
  await off.f(`${GATEWAY}/chat/completions`, { method: 'POST', body: '{}' });
  assert.equal(off.calls.at(-1).url, 'https://api.deepseek.com/chat/completions');
});

test('runtime: gateway calls name the open world (X-Worldlines-World); none open or not an id → no header', async () => {
  const on = runtimeHarness({});
  await everyCapability(on.f);
  const gatewayCalls = on.calls.filter((c) => c.url.startsWith(`${GATEWAY}/`));
  assert.equal(gatewayCalls.length, 7);
  for (const c of gatewayCalls) assert.equal(new Headers(c.init.headers).get('x-worldlines-world'), 'whitechapel-zh', c.url);
  const catalog = on.calls.find((c) => c.url.startsWith('https://storage.'));
  assert.ok(!/x-worldlines-world/i.test(catalog.text), 'only the model gateway gets it');
  for (const world of [null, '', '../etc', 'a b', 'x'.repeat(129)]) {
    const off = runtimeHarness({}, world);
    // a caller-set header is never forwarded either
    await off.f(`${GATEWAY}/chat/completions`, { method: 'POST', headers: { 'x-worldlines-world': 'spoofed' }, body: '{}' });
    assert.equal(new Headers(off.calls[0].init.headers).has('x-worldlines-world'), false, String(world));
  }
});

test('runtime: a refused key says so (and is not retried as transient); the sign-in panel is not asked for', async () => {
  let asked = 0;
  const direct = async () => new Response(JSON.stringify({ error: { message: 'Authentication Fails, Your api key: ****0789 is invalid' } }), { status: 401 });
  const gateway = gw.createGatewayFetch(direct, { base: GATEWAY, product: 'livingcanvas', token: async () => ACCOUNT, onAuthRequired: () => { asked++; } });
  const base = settingsWithBothKeys();
  const f = rt.createLocalKeyFetch(gateway, direct, { gatewayBase: GATEWAY, current: () => rt.parseLocalKeyRoutes(lk.runtimeRoutes(base)) });
  const res = await f(`${GATEWAY}/chat/completions`, { method: 'POST', body: '{}' });
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.error.code, 'local_key_refused');
  assert.match(body.error.message, /billing/, 'pi treats "billing" as a hard stop, not a retry');
  assert.ok(!body.error.message.includes(DS_KEY));
  assert.equal(asked, 0);
  const { friendlyModelError } = await jiti.import('../src/lib/model-errors.ts');
  const key = friendlyModelError(`401: ${JSON.stringify(body)}`);
  assert.ok(messages[key]?.['zh-CN'] && messages[key]?.ja, key);
});

test('synced settings never carry the key: the account-data payloads with a key in this browser', async () => {
  const s = settingsWithBothKeys();
  const storage = memoryStorage({ [lk.LOCAL_KEY_STORAGE]: JSON.stringify(s) });
  const sent = [];
  const fetch = async (url, init = {}) => {
    sent.push(await carried(url, init));
    const body = url.endsWith('/api/account-data') ? { ok: true, available: true, settings: null, favorites: [], likes: [], reviews: {}, saves: [], nickname: null } : { ok: true, available: true };
    return { ok: true, status: 200, json: async () => body };
  };
  const data = createAccountData({ fetch, storage, now: () => 1_000_000, readPrefs: () => ({ locale: 'zh-CN', performance: {}, voice: { ttsEnabled: true }, dismissed: [] }), applyPrefs: () => {} });
  await data.refresh();
  data.prefsChanged();
  await data.flushAll?.();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(sent.length > 0);
  for (const text of sent) assert.ok(!text.includes('SECRET') && !text.includes(lk.LOCAL_KEY_STORAGE), text.slice(0, 200));
  // and the real readSyncedPrefs is a whitelist that never reads this storage key
  const app = await src('../src/lib/account-data-app.ts');
  assert.ok(!/local-key|localModelKey|LOCAL_KEY/.test(app), 'account-data-app.ts does not touch the local key');
  assert.ok(!/local-key|localModelKey/.test(await src('../src/lib/account-data.ts')));
  assert.ok(!/local-key|localModelKey/.test(await src('../../server/src/sync/account-data.ts')));
});

test('source contract: the key stays in memory in the Worker — not in models.json, the VFS, a log or a reply', async () => {
  const worker = await src('../../browser-runtime/src/worker.ts');
  assert.match(worker, /writeModelConfig\(\(\) => base, 'worldlines-account', contextWindow\)/, 'models.json keeps the placeholder (only a context window may change)');
  for (const line of worker.split('\n').filter((l) => /localKey/.test(l))) {
    assert.ok(!/writeFileSync|writeTree|console\.|post\(\{ type: 'log'/.test(line), line);
  }
  assert.match(worker, /post\(\{ type: 'local-key-set', id: msg\.id, active: Object\.keys\(localKey\) \}\)/, 'the reply names capabilities, never a key');
  const runtime = await src('../../browser-runtime/src/platform/local-key.ts');
  assert.ok(!/console\.|fs\.|localStorage/.test(runtime.replace(/\/\/.*$/gm, '')), 'the router never logs or persists');
  const page = await src('../src/lib/local-key.ts');
  assert.ok(!/console\./.test(page.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'the page module never logs');
  assert.match(await src('../src/lib/browser-mode.ts'), /localKey: runtimeRoutes\(localKeySettings\(\)\)/);
});

test('UI: the promise is shown next to the switch and in the key form, translated; plan line names the mode', async () => {
  const ui = await src('../src/components/chrome/LocalKeySettings.tsx');
  assert.match(ui, /data-testid="local-key-promise"|testId="local-key-promise"/);
  assert.match(ui, /testId="local-key-notice"/);
  const promise = 'Your key is saved only in this browser on this device. Worldlines never uploads, stores or forwards your key; with a local key, requests go from your browser straight to the provider you choose, never through Worldlines servers.';
  assert.ok(ui.includes(promise));
  assert.equal(messages[promise]['zh-CN'], '你的密钥只保存在这台设备的浏览器里。Worldlines 不会上传、保存或转发你的密钥；使用本机密钥时，请求由你的浏览器直接发给你选择的服务商，不经过 Worldlines 的服务器。');
  assert.ok(messages[promise].ja);
  for (const k of ['Use Worldlines credits', 'Use local keys', 'Remove all local keys', 'Test connection', 'Chat: local key ({provider})', 'Chat: Worldlines credits', 'With a local key your provider bills that use directly: it does not spend Worldlines credits, and the credit numbers here do not move.']) {
    assert.ok(messages[k]?.['zh-CN'] && messages[k]?.ja, k);
  }
  assert.match(await src('../src/components/chrome/PlansPreview.tsx'), /plan-chat-source/);
  // 账号弹窗: the key switch lives in the 设置 tab, the same body as 语音与连接.
  assert.match(await src('../src/components/account/AccountDialog.tsx'), /<VoiceSettingsBody onOpenAccount=\{signIn\} \/>/);
  assert.match(await src('../src/components/TtsSettings.tsx'), /<LocalKeySettings \/>/);
});

// ── several providers, one per job ──

const GROQ_KEY = 'gsk-groq-SECRET-zyxwvut';
const CUSTOM_KEY = 'ck-custom-SECRET-112233';

/** chat → DeepSeek, tts + image → OpenAI, stt → Groq, in that order of adding. */
function settingsWithThreeProviders() {
  const before = settingsWithBothKeys();
  const s = lk.upsertKey(before, { preset: 'groq', base: 'https://api.groq.com/openai/v1', key: GROQ_KEY });
  const groq = s.keys[2];
  // Groq can do chat and STT, but both already are on a working key: nothing is stolen.
  assert.deepEqual(lk.keyPlan(before, { preset: 'groq' }), { takes: [], elsewhere: [{ cap: 'chat', via: before.keys[0].id }, { cap: 'stt', via: before.keys[1].id }] });
  assert.equal(s.use.chat.via, before.keys[0].id);
  assert.equal(s.use.stt.via, before.keys[1].id);
  // the player moves STT to Groq (the panel's offer)
  return lk.chooseFor(s, 'stt', groq.id);
}

test('several providers: adding takes only the jobs still on Worldlines; plan, presets per job, removing hands jobs back', () => {
  const empty = { ...lk.defaultLocalKeySettings(), source: 'local' };
  assert.deepEqual(lk.keyPlan(empty, { preset: 'openai' }).takes, ['chat', 'image', 'tts', 'stt']);
  assert.deepEqual(lk.presetsFor('stt').map((p) => p.id), ['openai', 'groq']);
  assert.deepEqual(lk.presetsFor('image').map((p) => p.id), ['openai'], 'Gemini compat images not verified: not offered');
  assert.deepEqual(lk.presetsFor('tts').map((p) => p.id), ['openai']);
  assert.deepEqual(lk.capabilitiesOf({ preset: 'gemini' }), ['chat']);
  assert.deepEqual(lk.capabilitiesOf({ preset: 'groq' }), ['chat', 'stt']);
  // OpenAI first, then DeepSeek: chat stays on OpenAI (not stolen), DeepSeek waits for the player to move it.
  let s = lk.upsertKey(empty, { preset: 'openai', base: 'https://api.openai.com/v1', key: OA_KEY });
  s = lk.upsertKey(s, { preset: 'deepseek', base: 'https://api.deepseek.com', key: DS_KEY });
  const [oa, ds] = s.keys;
  assert.equal(s.use.chat.via, oa.id);
  s = lk.chooseFor(s, 'chat', ds.id);
  assert.equal(s.use.chat.model, 'deepseek-flash');
  // chooseFor refuses a key that cannot do the job
  assert.equal(lk.chooseFor(s, 'image', ds.id).use.image.via, lk.WORLDLINES);
  // removing OpenAI: image / tts / stt back to Worldlines, chat stays on DeepSeek
  const removed = lk.removeKey(s, oa.id);
  for (const cap of ['image', 'tts', 'stt']) assert.equal(removed.use[cap].via, lk.WORLDLINES, cap);
  assert.equal(removed.use.chat.via, ds.id);
  assert.deepEqual(Object.keys(lk.runtimeRoutes(removed)), ['chat']);
  // a later key picks the freed jobs up again
  const back = lk.upsertKey(removed, { preset: 'openai', base: 'https://api.openai.com/v1', key: OA_KEY });
  assert.deepEqual(['image', 'tts', 'stt'].map((c) => back.use[c].via), Array(3).fill(back.keys[1].id));
  assert.equal(back.use.chat.via, ds.id);
});

test('custom service: the jobs the player ticks, with typed models; unticking hands the job back; stored and read', () => {
  const st = memoryStorage();
  let s = lk.upsertKey({ ...lk.defaultLocalKeySettings(), source: 'local' }, { preset: 'custom', base: 'https://media.example.ai/v1', key: CUSTOM_KEY, caps: ['chat', 'tts', 'stt', 'bogus'] }, { tts: 'my-tts', stt: 'my-asr', chat: 'my-chat' });
  const c = s.keys[0];
  assert.deepEqual(c.caps, ['chat', 'tts', 'stt']);
  assert.deepEqual(lk.capabilitiesOf(c), ['chat', 'tts', 'stt']);
  assert.equal(lk.supports(c, 'image'), false);
  const routes = lk.runtimeRoutes(s);
  assert.deepEqual(Object.keys(routes).sort(), ['chat', 'stt', 'tts']);
  assert.deepEqual([routes.tts.model, routes.stt.model, routes.tts.flavor], ['my-tts', 'my-asr', 'custom']);
  lk.writeLocalKey(st, s);
  assert.deepEqual(lk.readLocalKey(st).keys[0].caps, ['chat', 'tts', 'stt']);
  s = lk.setKeyCaps(s, c.id, ['chat', 'image']);
  assert.equal(s.use.tts.via, lk.WORLDLINES);
  assert.equal(s.use.stt.via, lk.WORLDLINES);
  assert.equal(s.use.image.via, c.id, 'a newly ticked job on Worldlines moves to it');
  assert.equal(s.use.image.model, '', 'no model yet: not routed until the player types one');
  assert.equal(lk.runtimeRoutes(s).image, undefined);
  assert.equal(lk.runtimeRoutes(lk.chooseFor(s, 'image', c.id, 'my-image')).image.model, 'my-image');
  // no ticks said (an old entry): chat only, as before
  assert.deepEqual(lk.capabilitiesOf({ preset: 'custom' }), ['chat']);
  // a custom speech endpoint gets OpenAI's shape and the player's voice
  const speech = JSON.parse(rt.adaptSpeechBody(JSON.stringify({ model: 'qwen3-tts-flash', input: 'x', voice: 'Cherry', language: 'Chinese', emotion: 'happy' }), { ...routes.tts, voice: 'nova' }));
  assert.deepEqual(speech, { model: 'my-tts', input: 'x', voice: 'nova' });
});

test('per-job 「测试」: GET /models only, checks the chosen model is listed — never a generation, never Worldlines', async () => {
  const seen = [];
  const list = (ids) => async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 }); };
  const groq = { preset: 'groq', base: 'https://api.groq.com/openai/v1', key: GROQ_KEY };
  assert.deepEqual(await lk.testJob(groq, 'stt', 'whisper-large-v3-turbo', list(['whisper-large-v3-turbo', 'llama-3.3-70b-versatile'])), { ok: true, listed: true, models: ['whisper-large-v3-turbo', 'llama-3.3-70b-versatile'] });
  assert.equal((await lk.testJob(groq, 'stt', 'whisper-9', list(['whisper-large-v3-turbo']))).listed, false);
  assert.equal((await lk.testJob(groq, 'stt', 'x', list([]))).listed, null, 'nothing listed: cannot tell');
  // Gemini lists `models/…`
  assert.equal((await lk.testJob({ preset: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'g' }, 'chat', 'gemini-2.5-flash', list(['models/gemini-2.5-flash']))).listed, true);
  // OpenRouter: /key (authenticated) then /models
  await lk.testJob({ preset: 'openrouter', base: 'https://openrouter.ai/api/v1', key: 'sk-or' }, 'chat', 'deepseek/deepseek-chat', list(['deepseek/deepseek-chat']));
  assert.deepEqual(seen.slice(-2).map((c) => c.url), ['https://openrouter.ai/api/v1/key', 'https://openrouter.ai/api/v1/models']);
  for (const c of seen) {
    assert.equal(c.init.method, undefined, 'GET');
    assert.equal(c.init.body, undefined);
    assert.ok(c.url.endsWith('/models') || c.url.endsWith('/key'), c.url);
    assert.ok(!c.url.includes('worldlines.gg'));
  }
  const n = seen.length;
  assert.deepEqual(await lk.testJob(groq, 'image', 'x', list([])), { ok: false, reason: 'unsupported' });
  assert.deepEqual(await lk.testJob(groq, 'chat', '  ', list([])), { ok: false, reason: 'no-model' });
  assert.equal((await lk.testJob({ ...groq, base: 'https://ai.worldlines.gg/v1' }, 'chat', 'm', list([]))).reason, 'invalid');
  assert.equal(seen.length, n, 'no request for an unsupported job, a missing model or a Worldlines address');
  assert.deepEqual(await lk.testJob(groq, 'chat', 'm', async () => new Response('{}', { status: 401 })), { ok: false, reason: 'unauthorized', status: 401 });
});

test('runtime: chat → DeepSeek, tts + image → OpenAI, stt → Groq in one session; no key ever goes to *.worldlines.gg', async () => {
  const s = settingsWithThreeProviders();
  const h = runtimeHarness(lk.runtimeRoutes(s));
  await everyCapability(h.f);
  const worldlines = h.calls.filter((c) => /^https:\/\/([a-z0-9-]+\.)*worldlines\.gg\//.test(c.url));
  const providers = h.calls.filter((c) => !worldlines.includes(c));
  for (const c of worldlines) assert.ok(!c.text.includes('SECRET'), `no key to ${c.url}`);
  const byUrl = Object.fromEntries(providers.map((c) => [c.url, new Headers(c.init.headers).get('authorization')]));
  assert.deepEqual(byUrl, {
    'https://api.deepseek.com/chat/completions': `Bearer ${DS_KEY}`,
    'https://api.openai.com/v1/images/generations': `Bearer ${OA_KEY}`,
    'https://api.openai.com/v1/images/edits': `Bearer ${OA_KEY}`,
    'https://api.openai.com/v1/audio/speech': `Bearer ${OA_KEY}`,
    'https://api.groq.com/openai/v1/audio/transcriptions': `Bearer ${GROQ_KEY}`,
  });
  const stt = providers.find((c) => c.url.includes('groq'));
  assert.equal(stt.init.body.get('model'), 'whisper-large-v3-turbo');
  for (const c of providers) {
    assert.ok(!c.text.includes(ACCOUNT));
    const own = new Headers(c.init.headers).get('authorization').slice(7);
    for (const k of [DS_KEY, OA_KEY, GROQ_KEY].filter((x) => x !== own)) assert.ok(!c.text.includes(k), `only its own key to ${c.url}`);
  }
  // a custom service ticked for images, in the same session: images move there, others stay
  let withCustom = lk.upsertKey(lk.chooseFor(s, 'image', lk.WORLDLINES), { preset: 'custom', base: 'https://img.example.ai/v1', key: CUSTOM_KEY, caps: ['image'] }, { image: 'flux-x' });
  const h2 = runtimeHarness(lk.runtimeRoutes(withCustom));
  await everyCapability(h2.f);
  assert.ok(h2.calls.some((c) => c.url === 'https://img.example.ai/v1/images/generations' && JSON.parse(c.init.body).model === 'flux-x'));
  for (const c of h2.calls.filter((x) => x.url.includes('worldlines.gg'))) assert.ok(!c.text.includes('SECRET'), c.url);
  // removing Groq mid-session: STT goes back to Worldlines with the account token, no key
  withCustom = lk.removeKey(withCustom, withCustom.keys.find((k) => k.preset === 'groq').id);
  h2.set(lk.runtimeRoutes(withCustom));
  const audio = new FormData();
  audio.append('file', new Blob([new Uint8Array([3])]), 'speech.webm'); audio.append('model', 'gpt-4o-transcribe');
  await h2.f(`${GATEWAY}/audio/transcriptions`, { method: 'POST', body: audio });
  const last = h2.calls.at(-1);
  assert.equal(last.url, `${GATEWAY}/audio/transcriptions`);
  assert.equal(new Headers(last.init.headers).get('authorization'), `Bearer ${ACCOUNT}`);
  assert.ok(!last.text.includes('SECRET'));
});

test('UI: four jobs as a table before any key, 「再添加一个服务商」, custom ticks, per-job test; ko translated', async () => {
  const ui = await src('../src/components/chrome/LocalKeySettings.tsx');
  assert.match(ui, /data-testid="local-key-jobs"/);
  assert.ok(!/saved\.keys\.length > 0 && \(\s*<table/.test(ui), 'the table is not hidden behind having a key');
  assert.match(ui, /aria-disabled=\{options\.length \? undefined : true\}/);
  assert.match(ui, /data-testid=\{`local-key-test-\$\{cap\}`\}/);
  assert.match(ui, /setKeyCaps\(/);
  const keys = ['Add another provider (for example voices on OpenAI, chat on DeepSeek)', 'Chat', 'Image generation', 'Speech synthesis (TTS)', 'Speech recognition (STT)', 'Which jobs does this service support?', 'Add a provider that can do this first: {list}', 'Test', "Test only reads the provider's model list and checks the model name: nothing is generated and nothing is spent."];
  for (const k of keys) {
    assert.ok(ui.includes(k), k);
    for (const loc of ['zh-CN', 'ja', 'ko']) assert.ok(messages[k]?.[loc], `${k} ${loc}`);
  }
  assert.equal(messages['Add another provider (for example voices on OpenAI, chat on DeepSeek)']['zh-CN'], '再添加一个服务商（例如语音用 OpenAI、对话用 DeepSeek）');
  assert.ok(lk.BROWSER_BLOCKED_PROVIDERS.some((p) => /Anthropic/.test(p)));
  assert.ok(!lk.LOCAL_KEY_PRESETS.some((p) => /anthropic/i.test(p.base)));
});
