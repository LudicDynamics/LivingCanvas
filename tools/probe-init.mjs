#!/usr/bin/env node
/**
 * Engine-spawn INIT probe — the acceptance test for
 * the I1 batch.
 *
 * The `airp-init` command is loaded by the engine, not by us: a broken handler
 * would only surface at runtime. The only proof is a REAL writer spawn plus a
 * real initialization, observed on the filesystem and in `history.db`.
 *
 * What it does, per case:
 *   1. copy a template world to a tmp dir and delete a stub layer's README so the
 *      layer is a genuine stub (`isLayerEmpty` true) — a fresh layer per case, so
 *      the emptiness short-circuit cannot make a case pass for the wrong reason;
 *   2. spawn the writer with `tools/init-probe-provider.ts` (deterministic — no
 *      network) as an extra extension;
 *   3. send `/airp-init <json>` through the RPC prompt channel;
 *   4. wait for idle, then assert on disk + `history.db`.
 *
 * The provider writes `README.md` + `01-probe.md` into `[Target Path]` when it
 * sees a brief, so a green run means the whole chain worked: command parsed →
 * emptiness checked → brief built and delivered → subagent spawned with `write`
 * → product checked → event recorded.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writerLaunch } from '../apps/server/dist/engine/launch.js';
import { RpcClient } from '../vendor/pi-rp/packages/coding-agent/dist/index.js';
import { LocalWorldStore } from '../packages/shared/dist/index.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VENDOR_CLI = path.join(REPO, 'vendor/pi-rp/packages/coding-agent/dist/cli.js');
const TEST_WORLD = path.join(REPO, 'archive/templates/pre-bilingual-2026-09-14/holmes-world');
const INIT_PROVIDER = path.join(REPO, 'tools/init-probe-provider.ts');

const failures = [];
const ok = (label, detail) => console.log(`  ok  ${label}  ${detail}`);
const fail = (label, detail) => {
  failures.push(`${label}: ${detail}`);
  console.error(`  FAIL ${label}  ${detail}`);
};

function makeTmpWorld() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-init-'));
  fs.cpSync(TEST_WORLD, tmp, { recursive: true });
  fs.rmSync(path.join(tmp, '.airpworld', 'sessions'), { recursive: true, force: true });
  return tmp;
}

/** Turn a written layer into a stub by removing its README. */
function stubLayer(tmp, layerId) {
  const dir = layerId === 'map' ? 'world' : layerId;
  fs.rmSync(path.join(tmp, dir, 'README.md'), { force: true });
  return dir;
}

/** Make a nook empty by deleting every non-json file. */
function emptyNook(tmp, characterId) {
  const dir = path.join(tmp, 'characters', characterId);
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json')) fs.rmSync(path.join(dir, entry), { force: true, recursive: true });
  }
  return `characters/${characterId}`;
}

async function runInit(tmp, outFile, json, settle) {
  const spec = writerLaunch(REPO, tmp, VENDOR_CLI);
  const client = new RpcClient({
    cliPath: spec.cliPath,
    cwd: spec.cwd,
    args: [...spec.args, '--extension', INIT_PROVIDER],
    env: { ...spec.env, PI_OFFLINE: '1', AIRP_INIT_PROBE_OUT: outFile },
    provider: 'airp-init-probe',
    model: 'deterministic',
  });
  await client.start();
  try {
    // The extension command runs immediately and manages its own LLM interaction,
    // so NO `agent_settled` fires (verified: rpc-client waitForIdle hangs). Poll
    // the observable instead — `settle(tmp)` returns true once the outcome landed.
    await client.prompt(`/airp-init ${JSON.stringify(json)}`);
    for (let i = 0; i < 90; i++) {
      if (await settle(tmp)) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  } finally {
    await client.stop().catch(() => {});
  }
}

function readRequests(outFile) {
  if (!fs.existsSync(outFile)) return [];
  return fs
    .readFileSync(outFile, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/** Settle predicate: did a layer event for `layer` land? */
function settled(layer) {
  return async (tmp) =>
    (await eventsOf(tmp)).some(
      (e) => (e.type === 'layer_initialized' || e.type === 'layer_init_failed') && e.layer === layer
    );
}

async function eventsOf(tmp) {
  const store = new LocalWorldStore(tmp);
  try {
    return await store.getEvents(200);
  } finally {
    store.close();
  }
}

/** Assert a scene init landed: files on disk + exactly one layer_initialized. */
async function assertSceneInit(tmp, dir, label) {
  const readme = path.join(tmp, dir, 'README.md');
  const content = path.join(tmp, dir, '01-probe.md');
  if (fs.existsSync(readme) && fs.existsSync(content)) {
    ok(label, `product landed: ${dir}/README.md + 01-probe.md`);
  } else {
    fail(label, `missing product in ${dir}: readme=${fs.existsSync(readme)} content=${fs.existsSync(content)}`);
  }
  const events = (await eventsOf(tmp)).filter((e) => e.type === 'layer_initialized' && e.layer === dir);
  if (events.length === 1) {
    const e = events[0];
    ok(`${label} · event`, `layer_initialized layer=${e.layer} by=${e.detail?.by} files=${e.detail?.files?.length}`);
    if (e.detail?.by !== 'player') fail(`${label} · by`, `expected by=player, got ${e.detail?.by}`);
    if (e.actor?.type !== 'engine') fail(`${label} · actor`, `expected actor=engine, got ${e.actor?.type}`);
  } else {
    fail(`${label} · event`, `expected exactly 1 layer_initialized for ${dir}, got ${events.length}`);
  }
}

// ——————————————————————————————————————————————————————————————

async function caseSceneInit() {
  const tmp = makeTmpWorld();
  const layer = 'world/crime-scene';
  const dir = stubLayer(tmp, layer);
  const out = path.join(tmp, 'requests.jsonl');
  try {
    const landed = await runInit(
      tmp,
      out,
      { kind: 'scene', target: layer, request: 'a rain-soaked alley', by: 'player' },
      settled(dir)
    );
    if (!landed) fail('scene init', 'no layer event within 90s');
    await assertSceneInit(tmp, dir, 'scene init');

    // The brief must have reached the model, and carried the player's request.
    const reqs = readRequests(out);
    const brief = reqs.map((r) => r.texts.join('\n')).find((t) => t.includes('[Task] Instantiate a scene layer'));
    if (!brief) {
      fail('scene brief delivered', 'no provider request carried the scene brief');
    } else {
      ok('scene brief delivered', `[Target Path] and [Player Request] present`);
      if (!brief.includes(`[Target Path] ${dir}`)) fail('scene brief · target path', `expected [Target Path] ${dir}`);
      if (!brief.includes('[Player Request] a rain-soaked alley')) fail('scene brief · request', 'player request missing');
      if (brief.includes('[Parent Path]') && !brief.includes('[Parent Layer]')) {
        fail('scene brief · parent', '[Parent Path] without [Parent Layer]');
      }
    }

    // Idempotency: a second init on the same (now written) layer must not act.
    const before = (await eventsOf(tmp)).length;
    await runInit(tmp, path.join(tmp, 'requests2.jsonl'), { kind: 'scene', target: layer, by: 'player' }, settled(dir));
    const after = (await eventsOf(tmp)).length;
    if (after === before) {
      ok('scene idempotent', `second init recorded no new events (${before} → ${after})`);
    } else {
      fail('scene idempotent', `second init added ${after - before} events`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function caseNookInit() {
  const tmp = makeTmpWorld();
  const characterId = 'watson';
  const dir = emptyNook(tmp, characterId);
  try {
    const landed = await runInit(
      tmp,
      path.join(tmp, 'requests.jsonl'),
      { kind: 'nook', target: characterId, by: 'player' },
      settled(dir)
    );
    if (!landed) fail('nook init', 'no layer event within 90s');
    const readme = path.join(tmp, dir, 'README.md');
    const content = path.join(tmp, dir, '01-probe.md');
    if (fs.existsSync(readme) && fs.existsSync(content)) {
      ok('nook init', `product landed: ${dir}/README.md + 01-probe.md`);
    } else {
      fail('nook init', `missing product: readme=${fs.existsSync(readme)} content=${fs.existsSync(content)}`);
    }
    const events = (await eventsOf(tmp)).filter((e) => e.type === 'layer_initialized' && e.layer === dir);
    if (events.length === 1) {
      ok('nook init · event', `layer_initialized layer=${events[0].layer}`);
    } else {
      fail('nook init · event', `expected 1 layer_initialized, got ${events.length}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function caseTemplateNoAi() {
  const tmp = makeTmpWorld();
  const layer = 'world/abandoned-orchard';
  const dir = stubLayer(tmp, layer);
  try {
    // template:true → zero-AI path: wait, then assert NO subagent ran (no provider
    // request carrying a brief) but the W2 files landed and an event was recorded.
    const out = path.join(tmp, 'requests.jsonl');
    const landed = await runInit(tmp, out, { kind: 'scene', target: layer, by: 'engine', template: true }, settled(dir));
    if (!landed) fail('template path', 'no layer event within 90s');
    const readme = fs.readFileSync(path.join(tmp, dir, 'README.md'), 'utf-8');
    if (readme.includes('material: stub')) {
      ok('template path', 'W2 stub README written without spawning the model');
    } else {
      fail('template path', `README did not carry the W2 stub marker: ${readme.slice(0, 60)}`);
    }
    const briefs = readRequests(out).filter((r) => r.texts.join('\n').includes('[Task] Instantiate'));
    if (briefs.length === 0) {
      ok('template path · no AI', 'no init brief was ever sent to the model');
    } else {
      fail('template path · no AI', `${briefs.length} init brief(s) sent — the zero-AI path spawned`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ——————————————————————————————————————————————————————————————

console.log('=== AIRP Init Probe (I1) ===');
for (const [name, fn] of [
  ['scene init', caseSceneInit],
  ['nook init', caseNookInit],
  ['template (zero-AI)', caseTemplateNoAi],
]) {
  console.log(`\n[${name}]`);
  try {
    await fn();
  } catch (err) {
    fail(name, err instanceof Error ? err.stack ?? err.message : String(err));
  }
}

if (failures.length > 0) {
  console.error(`\n=== [AIRP Init Probe] ${failures.length} FAILURE(S) ===`);
  process.exit(1);
}
console.log('\n=== [AIRP Init Probe] ALL ASSERTIONS PASSED ===');
