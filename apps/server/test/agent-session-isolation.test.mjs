// Every agent has its own conversation
// the design notes
//
//  1. Session keying (launch.ts): a character resumes only `char-<id>.jsonl`;
//     the writer resumes only a non-character file of THIS world, never via
//     pi-rp `--continue` (which picked the newest `.jsonl` — usually a
//     character's — and made the writer live inside that character's thread).
//  2. The real thing: pi-rp processes with a scripted provider (no paid
//     calls). Two characters and the writer, each restarted, and the wire
//     messages each model request carried are checked for the others' words.
//  3. Browser mode: the pi program's pre-bundled extension table is per spawn
//     (apps/browser-runtime jiti.ts). It used to sit on globalThis, so an agent
//     that loaded its extensions after a later spawn ran with that other
//     agent's extension instances — its identity and tool face.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const VENDOR_CLI = path.join(REPO, 'vendor/pi-rp/packages/coding-agent/dist/cli.js');
const PROVIDER = path.join(REPO, 'tools/inject-probe-provider.ts');
const { writerLaunch, characterLaunch, writerSessionFile, characterSessionFile, hasExistingSession } = await import(
  path.join(REPO, 'apps/server/dist/engine/launch.js')
);

function tmpWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-session-iso-'));
  fs.cpSync(path.join(REPO, 'templates/wuwu'), root, { recursive: true });
  fs.rmSync(path.join(root, '.airpworld', 'sessions'), { recursive: true, force: true });
  return root;
}

function writeSession(file, cwd, mtimeSec) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ type: 'session', version: 3, id: path.basename(file), timestamp: new Date().toISOString(), cwd })}\n`);
  if (mtimeSec) fs.utimesSync(file, mtimeSec, mtimeSec);
}

const sessionArgs = (args) => args.flatMap((a, i) => (a === '--continue' ? [a] : a === '--session' ? [a, args[i + 1]] : []));

/* ------------------------------ 1. keying ------------------------------ */

test('the writer never resumes a character thread, and never with --continue', () => {
  const world = tmpWorld();
  try {
    const sessions = path.join(world, '.airpworld', 'sessions');
    const real = fs.realpathSync(world);
    // Only character threads: the writer starts fresh (this is where it used to move in).
    writeSession(path.join(sessions, 'char-vera.jsonl'), real, 2_000_000_000);
    writeSession(path.join(sessions, 'char-old-mo.jsonl'), real, 2_000_000_100);
    assert.equal(writerSessionFile(world), null);
    assert.equal(hasExistingSession(world), false, 'character files are not the writer\'s session');
    assert.deepEqual(sessionArgs(writerLaunch(REPO, world, VENDOR_CLI).args), []);

    // Its own legacy timestamped file is resumed by path, even though a character file is newer.
    const own = path.join(sessions, '2026-09-27T15-07-32-971Z_01a0e368.jsonl');
    writeSession(own, real, 1_900_000_000);
    // A file from another world (copied save, stale cwd) is not this writer's.
    writeSession(path.join(sessions, '2026-09-28T00-00-00-000Z_other.jsonl'), '/nowhere/else', 2_100_000_000);
    assert.equal(writerSessionFile(world), own);
    assert.equal(hasExistingSession(world), true);
    const args = writerLaunch(REPO, world, VENDOR_CLI).args;
    assert.deepEqual(sessionArgs(args), ['--session', own]);
    assert.ok(!args.includes('--continue'));
  } finally {
    fs.rmSync(world, { recursive: true, force: true });
  }
});

test('each character resumes exactly its own file', () => {
  const world = tmpWorld();
  try {
    const vera = sessionArgs(characterLaunch(REPO, world, VENDOR_CLI, 'vera').args);
    const mo = sessionArgs(characterLaunch(REPO, world, VENDOR_CLI, 'old-mo').args);
    assert.deepEqual(vera, ['--session', characterSessionFile(world, 'vera')]);
    assert.deepEqual(mo, ['--session', characterSessionFile(world, 'old-mo')]);
    assert.notEqual(vera[1], mo[1]);
    assert.equal(path.basename(vera[1]), 'char-vera.jsonl');
  } finally {
    fs.rmSync(world, { recursive: true, force: true });
  }
});

test('source: no agent launch resumes "the most recent session"', () => {
  const src = fs.readFileSync(path.join(REPO, 'apps/server/src/engine/launch.ts'), 'utf8');
  assert.doesNotMatch(src, /args\.push\('--continue'\)|'--continue'/);
  assert.match(src, /name\.startsWith\(CHARACTER_SESSION_PREFIX\)\) continue/);
});

/* --------------------- 2. real agents, scripted model --------------------- */

test('two characters and the writer: no model request carries another agent\'s turns', { timeout: 180_000, skip: !fs.existsSync(VENDOR_CLI) && 'pi-rp dist missing' }, async () => {
  const { RpcClient } = await import(path.join(REPO, 'vendor/pi-rp/packages/coding-agent/dist/index.js'));
  const world = tmpWorld();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-session-iso-out-'));
  let n = 0;
  async function turn(spec, message) {
    const out = path.join(outDir, `${n++}.jsonl`);
    const client = new RpcClient({
      cliPath: spec.cliPath, cwd: spec.cwd, args: ['--extension', PROVIDER, ...spec.args],
      provider: 'airp-inject-probe', model: 'deterministic',
      env: { ...spec.env, PI_OFFLINE: '1', AIRP_INJECT_PROBE_OUT: out },
    });
    await client.start();
    try {
      await client.prompt(message);
      await client.waitForIdle(60_000);
    } finally {
      await client.stop();
    }
    assert.ok(fs.existsSync(out), `no model request for "${message}"`);
    return fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l).texts.join('\n')).join('\n');
  }
  const vera = () => characterLaunch(REPO, world, VENDOR_CLI, 'vera');
  const mo = () => characterLaunch(REPO, world, VENDOR_CLI, 'old-mo');
  const writer = () => writerLaunch(REPO, world, VENDOR_CLI);
  const none = (wire, words, who) => { for (const w of words) assert.ok(!wire.includes(w), `${who} saw ${w}`); };
  try {
    await turn(vera(), 'VERA_FIRST hello');
    none(await turn(mo(), 'MO_FIRST hello'), ['VERA_FIRST'], 'old-mo');
    none(await turn(writer(), 'WRITER_FIRST describe'), ['VERA_FIRST', 'MO_FIRST'], 'writer');
    let wire = await turn(vera(), 'VERA_SECOND');
    none(wire, ['MO_FIRST', 'WRITER_FIRST'], 'vera');
    assert.ok(wire.includes('VERA_FIRST'), 'vera keeps her own thread across a restart');
    wire = await turn(mo(), 'MO_SECOND');
    none(wire, ['VERA_FIRST', 'VERA_SECOND', 'WRITER_FIRST'], 'old-mo');
    assert.ok(wire.includes('MO_FIRST'), 'old-mo keeps his own thread across a restart');
    wire = await turn(writer(), 'WRITER_SECOND');
    none(wire, ['VERA_FIRST', 'VERA_SECOND', 'MO_FIRST', 'MO_SECOND'], 'writer');
    assert.ok(wire.includes('WRITER_FIRST'), 'the writer keeps its own thread across a restart');
    // On disk: a character's file holds only that character's preset.
    const sessions = path.join(world, '.airpworld', 'sessions');
    for (const [file, preset] of [['char-vera.jsonl', 'wuwu-vera'], ['char-old-mo.jsonl', 'wuwu-old-mo']]) {
      const presets = new Set([...fs.readFileSync(path.join(sessions, file), 'utf8').matchAll(/"presetId":"([^"]+)"/g)].map((m) => m[1]));
      assert.deepEqual([...presets], [preset], `${file} was opened by another agent`);
    }
  } finally {
    fs.rmSync(world, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

/* ------------- 2b. the writer reads the chats; characters still cannot ------------- */
//: a chat's end puts a summary
// in the WRITER's world state, and the writer alone can read the transcript.

test('the writer gets the chat summary and read_conversation; another character gets neither', { timeout: 180_000, skip: !fs.existsSync(VENDOR_CLI) && 'pi-rp dist missing' }, async () => {
  const { RpcClient } = await import(path.join(REPO, 'vendor/pi-rp/packages/coding-agent/dist/index.js'));
  const { LocalWorldStore } = await import('@airp/shared');
  const { ChatEndCoordinator } = await import(path.join(REPO, 'apps/server/dist/engine/chat-summary.js'));
  const world = tmpWorld();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-session-iso-out-'));
  let n = 0;
  async function turn(spec, message, toolCall) {
    const out = path.join(outDir, `${n++}.jsonl`);
    const client = new RpcClient({
      cliPath: spec.cliPath, cwd: spec.cwd, args: ['--extension', PROVIDER, ...spec.args],
      provider: 'airp-inject-probe', model: 'deterministic',
      env: { ...spec.env, PI_OFFLINE: '1', AIRP_INJECT_PROBE_OUT: out, ...(toolCall ? { AIRP_INJECT_PROBE_TOOLCALL: JSON.stringify(toolCall) } : {}) },
    });
    await client.start();
    try {
      await client.prompt(message);
      await client.waitForIdle(60_000);
    } finally {
      await client.stop();
    }
    const lines = fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    return { wire: lines.map((l) => l.texts.join('\n')).join('\n'), tools: new Set(lines.flatMap((l) => l.tools ?? [])) };
  }
  const readVera = { name: 'read_conversation', arguments: { char_id: 'vera', last_n: 5 } };
  try {
    await turn(characterLaunch(REPO, world, VENDOR_CLI, 'vera'), 'VERA_SECRET the key is under the bell');
    // The dialogue closes: the server's chat end (summary model faked, no paid call).
    const store = new LocalWorldStore(world);
    try {
      const ends = new ChatEndCoordinator({
        summarize: async () => ({ text: 'SUMMARY_VERA they talked about the bell.', clues_learned: ['the key is under the bell'], promises_made: [], relationship_change: '', player_intent: '', notable_quotes: [], important: false }),
        quietWriterTurn: async () => {},
        beatsEnabled: () => false,
      });
      const ended = await ends.end(store, 'vera', { via: 'dialogue', beat: true });
      assert.equal(ended.turns, 1, 'one real exchange');
      assert.equal(ended.event.detail.summary.text, 'SUMMARY_VERA they talked about the bell.');
    } finally {
      store.close();
    }

    const writer = await turn(writerLaunch(REPO, world, VENDOR_CLI), 'WRITER_TURN', readVera);
    assert.ok(writer.tools.has('read_conversation'), 'the writer is offered read_conversation');
    assert.ok(writer.wire.includes('SUMMARY_VERA'), 'the summary is in the writer\'s world state');
    assert.ok(writer.wire.includes('VERA_SECRET'), 'read_conversation returned the transcript');

    const mo = await turn(characterLaunch(REPO, world, VENDOR_CLI, 'old-mo'), 'MO_TURN', readVera);
    assert.ok(!mo.tools.has('read_conversation'), 'a character is never offered read_conversation');
    assert.ok(!mo.wire.includes('VERA_SECRET'), 'old-mo cannot read vera\'s chat');
    assert.ok(!mo.wire.includes('SUMMARY_VERA'), 'old-mo never sees vera\'s summary');
  } finally {
    fs.rmSync(world, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

/* ------------------------- 3. browser-mode programs ------------------------- */

const browserRuntime = path.join(REPO, 'apps/browser-runtime');
let esbuild = null;
try {
  esbuild = createRequire(pathToFileURL(path.join(browserRuntime, 'package.json')))('esbuild');
} catch {
  esbuild = null;
}

test('browser mode: each pi spawn looks up its OWN extension instances', { skip: !esbuild && 'esbuild missing' }, async () => {
  // A miniature pi program: registers an extension module that captures its
  // run's `process`, then (later, after other spawns) loads it through jiti and
  // a runtime import(), the two ways pi-rp reaches extensions.
  const r = await esbuild.build({
    stdin: {
      contents: [
        `import { registerModule, createJiti } from './src/platform/jiti.ts';`,
        `registerModule('/repo/extensions/context.ts', { role: () => process.env.AIRP_AGENT_ROLE });`,
        `export const load = () => createJiti('x').import('/repo/extensions/context.ts');`,
        `export const dyn = (s) => __airpImport(s);`,
      ].join('\n'),
      resolveDir: browserRuntime, loader: 'ts',
    },
    bundle: true, format: 'cjs', platform: 'neutral', write: false, logLevel: 'error',
  });
  const code = r.outputFiles[0].text;
  // Same per-run head build.mjs wraps every program in.
  const build = fs.readFileSync(path.join(browserRuntime, 'build.mjs'), 'utf8');
  assert.match(build, /const __airpImport = \(spec\) => globalThis\.__airpImport\(spec, process\.__airpModules\);/);
  const registry = fs.readFileSync(path.join(browserRuntime, 'src/platform/registry.ts'), 'utf8');
  assert.match(registry, /const pre = local\?\.get\(/);
  const previousImport = globalThis.__airpImport;
  globalThis.__airpImport = async (spec, local) => local?.get(String(spec).replace(/^file:\/\//, '')) ?? null;
  const run = (role) => {
    const proc = { env: { AIRP_AGENT_ROLE: role } };
    const module = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('process', 'module', 'exports', `const __airpImport = (spec) => globalThis.__airpImport(spec, process.__airpModules);\n${code}`)(proc, module, module.exports);
    return module.exports;
  };
  try {
    const vera = run('character:vera');
    const mo = run('character:old-mo'); // spawned before vera loaded her extensions
    const writer = run('writer');
    assert.equal((await vera.load()).role(), 'character:vera');
    assert.equal((await mo.load()).role(), 'character:old-mo');
    assert.equal((await writer.load()).role(), 'writer');
    assert.equal((await vera.dyn('file:///repo/extensions/context.ts')).role(), 'character:vera');
    assert.equal(globalThis.__airpPrebundled, undefined, 'no worker-global extension table');
  } finally {
    globalThis.__airpImport = previousImport;
  }
});
