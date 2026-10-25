// The local edition's own voice-live, modelled
// on Sense's voice.rs: voice.json parsing, reuse-if-running, spawn args/env, stop-only-own-child,
// status reporting, and the call-entry gate local vs browser. child_process is a fake throughout.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const lvl = await jiti.import('../src/engine/local-voice-live.ts');
const { composeVoiceCallConfig, resolveVoiceProvider } = await jiti.import('../src/engine/voice-provider.ts');
const { voiceLiveSessionUrl, proxiedVoiceLiveLogsMetaOnly } = await jiti.import('../src/engine/voice-live-cast.ts');
const {
  parseVoiceConf, VoiceConfError, voiceConfigFile, voiceLiveLogFile, voiceLiveSpawnSpec, redactConfValues,
  localVoiceLiveInEffect, createLocalVoiceLive, effectiveVoiceLiveUrl,
} = lvl;

const SECRET = 'fish-key-0123456789abcdef';
const CONF = JSON.stringify({
  dir: '/opt/voice-live', uv: '/opt/homebrew/bin/uv', port: 8799,
  env: { VOICE_LIVE_ASR: 'fish', VOICE_LIVE_TTS: 'fish', VOICE_LIVE_FISH_API_KEY: SECRET, VOICE_LIVE_FISH_VOICE: 'ref-voice-id' },
});

// ---------- voice.json ----------

test('voice.json: the Sense shape, with defaults for uv and port', () => {
  const c = parseVoiceConf(CONF);
  assert.deepEqual(c, { dir: '/opt/voice-live', uv: '/opt/homebrew/bin/uv', port: 8799, env: JSON.parse(CONF).env });
  const d = parseVoiceConf('{"dir":"~/w/voice-live"}', '/Users/n');
  assert.equal(d.dir, '/Users/n/w/voice-live');
  assert.equal(d.uv, 'uv');
  assert.equal(d.port, 8777);
  assert.deepEqual(d.env, {});
  assert.equal(parseVoiceConf('{"dir":"/v","env":{"VOICE_LIVE_PORT":"8790"}}').port, 8790);
});

test('voice.json: bad files are refused with the field named, never a value', () => {
  for (const [text, re] of [
    ['not json', /not valid JSON/],
    ['[]', /JSON object/],
    ['{}', /"dir"/],
    ['{"dir":"relative/path"}', /absolute/],
    ['{"dir":"/v","port":70000}', /"port"/],
    ['{"dir":"/v","port":"8777"}', /"port"/],
    ['{"dir":"/v","uv":""}', /"uv"/],
    ['{"dir":"/v","env":[]}', /"env"/],
    [`{"dir":"/v","env":{"FISH_API_KEY":12345678}}`, /FISH_API_KEY must be a string/],
    [`{"dir":"/v","env":{"bad name":"${SECRET}"}}`, /not a variable name/],
  ]) {
    assert.throws(() => parseVoiceConf(text), (e) => e instanceof VoiceConfError && re.test(e.message) && !e.message.includes(SECRET), text);
  }
});

test('voice.json lives beside remote.json (~/.config/airp), AIRP_VOICE_CONFIG overrides; the log sits beside it', () => {
  const saved = process.env.AIRP_REMOTE_CONFIG;
  try {
    process.env.AIRP_REMOTE_CONFIG = '/home/n/.config/airp/remote.json';
    assert.equal(voiceConfigFile({}), '/home/n/.config/airp/voice.json');
    assert.equal(voiceConfigFile({ AIRP_VOICE_CONFIG: '/tmp/x/voice.json' }), '/tmp/x/voice.json');
    assert.equal(voiceLiveLogFile('/home/n/.config/airp/voice.json'), '/home/n/.config/airp/voice-live.log');
  } finally {
    if (saved === undefined) delete process.env.AIRP_REMOTE_CONFIG; else process.env.AIRP_REMOTE_CONFIG = saved;
  }
});

// ---------- spawn spec ----------

test('spawn: uv run python -m voice_live in dir, voice.json env on a minimal base (not our whole env)', () => {
  const spec = voiceLiveSpawnSpec(parseVoiceConf(CONF), { PATH: '/usr/bin', HOME: '/Users/n', OPENAI_API_KEY: 'canvas-own', AIRP_REMOTE_CONFIG: '/x' });
  assert.equal(spec.command, '/opt/homebrew/bin/uv');
  assert.deepEqual(spec.args, ['run', 'python', '-m', 'voice_live']);
  assert.equal(spec.cwd, '/opt/voice-live');
  assert.equal(spec.env.PATH, '/usr/bin');
  assert.equal(spec.env.HOME, '/Users/n');
  assert.equal(spec.env.VOICE_LIVE_FISH_API_KEY, SECRET);
  assert.equal(spec.env.VOICE_LIVE_PORT, '8799');
  assert.equal(spec.env.VOICE_LIVE_HOST, '127.0.0.1');
  assert.equal(spec.env.OPENAI_API_KEY, undefined, 'the canvas keys are not handed over');
  assert.equal(spec.env.AIRP_REMOTE_CONFIG, undefined);
});

test('redaction: env values never survive into a reason', () => {
  const conf = parseVoiceConf(CONF);
  assert.equal(redactConfValues(`401 for key ${SECRET}`, conf), '401 for key ***');
});

// ---------- the supervisor (fake child_process) ----------

function fakeChild(pid = 4242) {
  const ch = new EventEmitter();
  ch.pid = pid;
  ch.unref = () => {};
  return ch;
}

function harness({ conf = CONF, healthy = [false], listening = false, exitOnTerm = true } = {}) {
  const calls = { spawn: [], kill: [], logs: [] };
  const children = [];
  let healthIdx = 0;
  const sup = createLocalVoiceLive({
    env: {},
    configFile: '/cfg/voice.json',
    readFile: () => conf,
    healthy: async () => healthy[Math.min(healthIdx++, healthy.length - 1)],
    listening: async () => listening,
    spawn: (command, args, options) => {
      calls.spawn.push({ command, args, options });
      const ch = fakeChild(4242 + children.length);
      children.push(ch);
      return ch;
    },
    openLog: () => 'ignore',
    readLogTail: () => `Traceback\nRuntimeError: VOICE_LIVE_ASR=fish needs FISH_API_KEY ${SECRET}\n`,
    kill: (pid, sig) => {
      calls.kill.push([pid, sig]);
      const ch = children.find((c) => c.pid === -pid);
      if (ch && (sig === 'SIGKILL' || exitOnTerm)) setImmediate(() => ch.emit('exit', null, sig));
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
    pollMs: 1,
    startTimeoutMs: 200,
    stopGraceMs: 20,
    log: (l) => calls.logs.push(l),
  });
  return { sup, calls, children };
}

test('no voice.json: off, nothing spawned, no URL', async () => {
  const { sup, calls } = harness({ conf: null });
  sup.boot();
  assert.deepEqual(await sup.ensure(), { state: 'off', configured: false, owned: false });
  assert.equal(calls.spawn.length, 0);
  assert.equal(sup.url(), null);
});

test('reuse: something healthy already on the port is used and never ours to stop', async () => {
  const { sup, calls } = harness({ healthy: [true] });
  const st = await sup.ensure();
  assert.equal(st.state, 'ready');
  assert.equal(st.owned, false);
  assert.equal(calls.spawn.length, 0);
  await sup.stop();
  assert.deepEqual(calls.kill, [], 'stop never touches a process it did not start');
  assert.equal(sup.url(), 'http://127.0.0.1:8799');
});

test('spawn: nothing on the port → detached group, log fds, voice.json env; ready once /healthz answers', async () => {
  const { sup, calls } = harness({ healthy: [false, false, true] });
  const st = await sup.ensure();
  assert.equal(st.state, 'ready');
  assert.equal(st.owned, true);
  assert.equal(calls.spawn.length, 1);
  const [{ command, args, options }] = calls.spawn;
  assert.equal(command, '/opt/homebrew/bin/uv');
  assert.deepEqual(args, ['run', 'python', '-m', 'voice_live']);
  assert.equal(options.cwd, '/opt/voice-live');
  assert.equal(options.detached, true);
  assert.equal(options.stdio[0], 'ignore');
  assert.equal(options.env.VOICE_LIVE_FISH_API_KEY, SECRET);
  assert.ok(calls.logs.every((l) => !l.includes(SECRET)), 'no env value in the server log');
});

test('single flight: two callers while starting spawn once', async () => {
  const { sup, calls } = harness({ healthy: [false, false, false, true] });
  const [a, b] = await Promise.all([sup.ensure(), sup.ensure()]);
  assert.equal(a.state, 'ready');
  assert.equal(b.state, 'ready');
  assert.equal(calls.spawn.length, 1);
});

test('stop: SIGTERM to OUR group; SIGKILL only after the grace period', async () => {
  const graceful = harness({ healthy: [false, true] });
  await graceful.sup.ensure();
  await graceful.sup.stop();
  assert.deepEqual(graceful.calls.kill, [[-4242, 'SIGTERM']]);
  assert.equal(graceful.sup.status().state, 'off');
  assert.equal(graceful.sup.status().owned, false);

  const stubborn = harness({ healthy: [false, true], exitOnTerm: false });
  await stubborn.sup.ensure();
  await stubborn.sup.stop();
  assert.deepEqual(stubborn.calls.kill, [[-4242, 'SIGTERM'], [-4242, 'SIGKILL']]);
});

test('failed: an early exit reports the log tail, redacted', async () => {
  const { sup, children } = harness({ healthy: [false] });
  const p = sup.ensure();
  await new Promise((r) => setImmediate(r));
  children[0].emit('exit', 1, null);
  const st = await p;
  assert.equal(st.state, 'failed');
  assert.match(st.reason, /voice-live exited \(code 1\)/);
  assert.match(st.reason, /needs FISH_API_KEY \*\*\*/);
  assert.ok(!st.reason.includes(SECRET));
  assert.ok(!st.reason.includes('/opt/voice-live'), 'no path in the page-facing reason');
});

test('failed: uv missing (ENOENT) says which voice.json field to fix', async () => {
  const { sup, children } = harness({ healthy: [false] });
  const p = sup.ensure();
  await new Promise((r) => setImmediate(r));
  children[0].emit('error', Object.assign(new Error('spawn uv ENOENT'), { code: 'ENOENT' }));
  const st = await p;
  assert.equal(st.state, 'failed');
  assert.match(st.reason, /uv not found/);
});

test('failed: port taken by a process we did not start, and it is not healthy → not touched', async () => {
  const { sup, calls } = harness({ healthy: [false], listening: true });
  const st = await sup.ensure();
  assert.equal(st.state, 'failed');
  assert.match(st.reason, /did not start/);
  assert.equal(calls.spawn.length, 0);
  assert.deepEqual(calls.kill, []);
});

test('failed: a broken voice.json is reported (field named), nothing spawned', async () => {
  const { sup, calls } = harness({ conf: '{"dir":"rel"}' });
  sup.boot();
  assert.equal(sup.status().state, 'failed');
  assert.match(sup.status().reason, /absolute/);
  assert.equal(calls.spawn.length, 0);
});

test('timeout: never healthy → failed after the start timeout', async () => {
  const { sup } = harness({ healthy: [false] });
  const st = await sup.ensure();
  assert.equal(st.state, 'failed');
  assert.match(st.reason, /did not answer/);
});

test('refresh: a voice-live started by hand (no voice.json) counts as ready; gone again → off', async () => {
  let up = true;
  const sup = createLocalVoiceLive({ env: {}, configFile: '/cfg/voice.json', readFile: () => null, healthy: async () => up, log: () => {} });
  assert.equal((await sup.refresh()).state, 'ready');
  up = false;
  assert.equal((await sup.refresh()).state, 'off');
});

test('AIRP_LOCAL_VOICE_LIVE=0 (the browser build tab): never configured, never spawns', async () => {
  let spawned = 0;
  const sup = createLocalVoiceLive({ env: { AIRP_LOCAL_VOICE_LIVE: '0' }, configFile: '/cfg/voice.json', readFile: () => CONF, healthy: async () => true, spawn: () => { spawned += 1; return fakeChild(); }, log: () => {} });
  sup.boot();
  assert.equal((await sup.refresh()).state, 'off');
  assert.equal((await sup.ensure()).configured, false);
  assert.equal(spawned, 0);
});

// ---------- which URL, which query ----------

test('in effect only for the local default: not with VOICE_LIVE_URL, tickets, or in a tab', () => {
  assert.equal(localVoiceLiveInEffect({}), true);
  assert.equal(localVoiceLiveInEffect({ VOICE_LIVE_URL: 'http://192.0.2.1:8777' }), false);
  assert.equal(localVoiceLiveInEffect({ VOICE_LIVE_TICKETS_URL: 'https://ai.example/v1/voice/live/ticket' }), false);
  assert.equal(localVoiceLiveInEffect({ AIRP_LOCAL_VOICE_LIVE: '0' }), false);
  const sup = { url: () => 'http://127.0.0.1:8799' };
  assert.equal(effectiveVoiceLiveUrl(sup, {}), 'http://127.0.0.1:8799');
  assert.equal(effectiveVoiceLiveUrl(sup, { VOICE_LIVE_URL: 'http://192.0.2.1:8777' }), 'http://192.0.2.1:8777');
  assert.equal(effectiveVoiceLiveUrl({ url: () => null }, {}), 'http://127.0.0.1:8777');
});

test('calls: relay brain + log=meta by default; VOICE_LIVE_LOG=full brings the transcript log back', () => {
  assert.equal(proxiedVoiceLiveLogsMetaOnly({}), true);
  assert.equal(proxiedVoiceLiveLogsMetaOnly({ VOICE_LIVE_LOG: 'full' }), false);
  const url = new URL(voiceLiveSessionUrl('ws://127.0.0.1:8799/ws', { character: 'vera', voice: 'ref', language: 'Japanese' }, { relayBrain: true, logMeta: true }));
  assert.equal(url.searchParams.get('brain'), 'relay');
  assert.equal(url.searchParams.get('log'), 'meta');
  assert.equal(url.searchParams.get('character'), 'vera');
  const plain = new URL(voiceLiveSessionUrl('ws://127.0.0.1:8799/ws', { character: 'vera' }, { relayBrain: true }));
  assert.equal(plain.searchParams.get('log'), null, 'the ticket path is unchanged');
});

test('index.ts proxies to the supervised URL with logMeta, ensures it first, and stops only its own child', async () => {
  const src = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(src, /voiceLiveSocketUrl\(effectiveVoiceLiveUrl\(localVoiceLive\)\)/);
  assert.match(src, /logMeta: proxiedVoiceLiveLogsMetaOnly\(\)/);
  assert.match(src, /localVoiceLive\.ensure\(\)/);
  assert.match(src, /if \(localVoiceLiveInEffect\(\)\) localVoiceLive\.boot\(\);/);
  assert.match(src, /localVoiceLive\.stop\(\)\]\)/);
});

// ---------- availability gate ----------

const GPT_DOWN = { available: false, reason: 'OPENAI_API_KEY is not set on the server', model: 'gpt-live-1', voices: [] };

test('local edition: the call entry follows the local voice-live, whatever the plan', () => {
  const at = (state, reason) => composeVoiceCallConfig({ provider: 'voice-live', gptLive: GPT_DOWN, localVoiceLive: { state, configured: state !== 'off', owned: false, ...(reason ? { reason } : {}) } });
  assert.equal(at('ready').available, true);
  assert.equal(at('starting').available, true, 'a call waits for it to finish starting');
  assert.equal(at('off').available, false);
  assert.match(at('off').reason, /voice\.json/);
  assert.equal(at('failed', 'voice-live exited (code 1)').available, false);
  assert.equal(at('failed', 'voice-live exited (code 1)').reason, 'voice-live exited (code 1)');
  assert.deepEqual(at('ready').localVoiceLive, { state: 'ready', configured: true, owned: false });
  // Status rides the payload without any address.
  assert.doesNotMatch(JSON.stringify(at('ready')), /127\.0\.0\.1|8777|8799/);
  // voice.json present → voice-live even in a production-mode build.
  assert.equal(resolveVoiceProvider({ NODE_ENV: 'production' }, { localVoiceLiveConfigured: true }), 'voice-live');
  assert.equal(resolveVoiceProvider({ NODE_ENV: 'production', AIRP_VOICE_PROVIDER: 'gpt-live' }, { localVoiceLiveConfigured: true }), 'gpt-live');
});

test('browser build: the tab says AIRP_LOCAL_VOICE_LIVE=0 and stays on GPT Live (hidden) until VOICE_LIVE_AVAILABLE', async () => {
  const mode = await readFile(new URL('../../web/src/lib/browser-mode.ts', import.meta.url), 'utf8');
  assert.match(mode, /AIRP_LOCAL_VOICE_LIVE: '0'/);
  assert.match(mode, /env\.AIRP_VOICE_PROVIDER = 'gpt-live';/);
  const gptOnly = composeVoiceCallConfig({ provider: 'gpt-live', gptLive: GPT_DOWN });
  assert.equal(gptOnly.available, false);
  assert.equal(gptOnly.localVoiceLive, undefined);
  const route = await readFile(new URL('../src/routes/live.ts', import.meta.url), 'utf8');
  assert.match(route, /options\.localVoiceLive && localVoiceLiveInEffect\(\)/);
});
