// The read fence (extensions/toolkit/read-fence.ts): story agents' read / grep
// / find / ls may only look inside their world and the shared skills. Built on
// a real temporary directory tree, because the escapes that matter — `..`, an
// absolute path, a symlink pointing out — are filesystem facts, not strings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJiti } from '../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const PI = new URL('../vendor/pi-rp/packages/coding-agent/dist/index.js', import.meta.url).pathname;
const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true, alias: { '@earendil-works/pi-coding-agent': PI } });
const { firstOutside, requestedPaths, registerReadFence, repoSkillsDir, FENCED_TOOLS } = await jiti.import('../extensions/toolkit/read-fence.ts');
const { createReadToolDefinition } = await import(PI);
const WRITER = { type: 'writer' };
const HANS = { type: 'character', id: 'hans' };

// repo/
//   .local.env                 ← what must stay unreadable
//   skills/craft/SKILL.md      ← shared, allowed
//   worlds/w1/                 ← the agent's cwd
//     world/letter.md
//     escape -> ../../          (symlink out of the world)
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'read-fence-')));
const repo = path.join(base, 'repo');
const world = path.join(repo, 'worlds', 'w1');
const skills = path.join(repo, 'skills');
fs.mkdirSync(path.join(world, 'world'), { recursive: true });
fs.mkdirSync(path.join(skills, 'craft'), { recursive: true });
fs.writeFileSync(path.join(repo, '.local.env'), 'OPENAI_API_KEY=not-a-real-key\n');
fs.writeFileSync(path.join(world, 'world', 'letter.md'), 'hello');
fs.writeFileSync(path.join(skills, 'craft', 'SKILL.md'), '# craft');
fs.symlinkSync(path.join(repo), path.join(world, 'escape'));
const roots = [world, skills];
const outside = (...requested) => firstOutside(requested, world, roots);

test('inside the world is fine, however it is spelled', () => {
  assert.equal(outside('world/letter.md'), null);
  assert.equal(outside('./world/letter.md'), null);
  assert.equal(outside(path.join(world, 'world', 'letter.md')), null);
  assert.equal(outside('world/not-created-yet.md'), null, 'a file that does not exist yet is judged by where it would be');
  assert.equal(outside('.'), null);
  assert.equal(outside('@world/letter.md'), null, 'pi-rp strips a leading @');
});

test('the shared skills are readable by absolute path, because pi-rp sends the model there', () => {
  assert.equal(outside(path.join(skills, 'craft', 'SKILL.md')), null);
});

test('the keys two directories up are not', () => {
  assert.equal(outside('../../.local.env'), '../../.local.env');
  assert.equal(outside(path.join(repo, '.local.env')), path.join(repo, '.local.env'));
  assert.equal(outside('@../../.local.env'), '@../../.local.env', 'the @ prefix does not launder a path');
  assert.equal(outside('/etc/passwd'), '/etc/passwd');
  assert.equal(outside('world/../../../.local.env'), 'world/../../../.local.env');
});

test('the remote account session file is out of reach, wherever it is spelled', () => {
  // the design notes: the account session (access + refresh
  // token) lives in ~/.config/airp/remote.json, outside the repository and
  // every world.
  const home = path.join(base, 'home');
  const tokenFile = path.join(home, '.config', 'airp', 'remote.json');
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, '{"session":{"accessToken":"not-real","refreshToken":"not-real"}}');
  assert.equal(outside('~/.config/airp/remote.json'), '~/.config/airp/remote.json');
  assert.equal(outside(tokenFile), tokenFile);
  const relative = path.relative(world, tokenFile);
  assert.equal(outside(relative), relative);
  assert.equal(outside('escape/home/.config/airp/remote.json'), 'escape/home/.config/airp/remote.json', 'nor through a link out of the world');
});

test('a symlink inside the world cannot point out of it', () => {
  assert.equal(outside('escape/.local.env'), 'escape/.local.env');
});

test('home-relative paths are refused rather than guessed at', () => {
  assert.equal(outside('~/.ssh/id_ed25519'), '~/.ssh/id_ed25519');
});

test('one bad path in a batched read blocks the whole call', () => {
  assert.equal(outside('world/letter.md', '../../.local.env'), '../../.local.env');
});

test('each tool’s path argument is found where that tool keeps it', () => {
  assert.deepEqual(requestedPaths('read', { path: 'a.md' }), ['a.md']);
  assert.deepEqual(requestedPaths('read', { path: ['a.md', 'b.md', 3] }), ['a.md', 'b.md']);
  assert.deepEqual(requestedPaths('grep', { pattern: 'x', path: '../..' }), ['../..']);
  assert.deepEqual(requestedPaths('grep', { pattern: 'x' }), [], 'no path means the cwd');
  assert.deepEqual(requestedPaths('ls', {}), []);
  assert.deepEqual([...FENCED_TOOLS], ['read', 'grep', 'find', 'ls']);
});

test('the hook blocks with a reason the agent can act on, and ignores other tools', async () => {
  let hook = null;
  registerReadFence({ on: (name, fn) => { if (name === 'tool_call') hook = fn; } }, { actor: WRITER });
  const ctx = { cwd: world };
  const blocked = await hook({ toolName: 'read', input: { path: '../../.local.env' } }, ctx);
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /outside this world/);
  assert.equal(await hook({ toolName: 'read', input: { path: 'world/letter.md' } }, ctx), undefined);
  // write / edit are the world-write gate's job (world-context.ts), not this one's.
  assert.equal(await hook({ toolName: 'write', input: { path: '../../x.md' } }, ctx), undefined);
});

test('bash is refused in code for every agent with this tool face, whatever its preset says', async () => {
  // 96 character presets shadow the repository's; this is what reaches them all.
  let hook = null;
  registerReadFence({ on: (name, fn) => { if (name === 'tool_call') hook = fn; } }, { actor: WRITER });
  const refused = await hook({ toolName: 'bash', input: { command: 'env' } }, { cwd: world });
  assert.equal(refused.block, true);
  assert.match(refused.reason, /engine tools/);
});

test('the real skills directory is the repository’s skills/', () => {
  assert.equal(repoSkillsDir(), path.resolve(new URL('..', import.meta.url).pathname, 'skills'));
});

test('the fence is registered with the rest of the tool face', () => {
  const tools = fs.readFileSync(new URL('../extensions/tools.ts', import.meta.url), 'utf8');
  assert.match(tools, /import \{ registerReadFence \} from '\.\/toolkit\/read-fence\.js';/);
  assert.match(tools, /\n  registerReadFence\(pi\);\n/);
});

test('no story agent keeps a shell, and the delegatable profiles deny it too', () => {
  for (const name of ['writer', 'character', 'scene-init', 'nook-init']) {
    const preset = JSON.parse(fs.readFileSync(new URL(`../presets/${name}.json`, import.meta.url), 'utf8'));
    assert.ok(preset.tools.deny.includes('bash'), `${name} must deny bash`);
  }
});

// ——— the character's view (packages/shared/src/rules/character-view.ts) ———
//
// A world as a save holds it after the draw: a suspect card whose `intent` and
// `persona` carry the run's truth, a README with a hidden state, an ending, a
// command, the companion's own memory and another character's private notes.
const save = path.join(base, 'save');
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(save, rel)), { recursive: true });
  fs.writeFileSync(path.join(save, rel), text);
};
write('world/eve.md', [
  '---', 'type: npc', 'name: Eve', 'persona: This run she is the culprit.', 'knows: [world/eve.md]',
  'intent: "Eve (the culprit this run). She struck him at 10:40."', '---', '',
  'Eve sits bolt upright, turning her wedding ring.', 'At ten I went back to my bedroom.', '',
].join('\n'));
write('world/README.md', [
  '---', 'type: readme', 'name: Room', 'states:',
  '  - { id: culprit, label: Culprit, type: enum, values: [eve, ross], initial: eve, hidden: true }',
  'status:', '  data:', '    culprit: ross', 'run: { seed: s, variants: { culprit: ross } }', '---', 'A small room.', '',
].join('\n'));
write('endings/confession/README.md', '---\ntype: ending\n---\nRoss confesses.\n');
write('command/long-way-hall.yaml', 'name: x\ndo: []\n# The basket is Eve\'s.\n');
write('characters/hans/memory.md', 'I drove the inspector up at four.\n');
write('characters/nils/unspoken.md', 'I lied about the radio.\n');
write('.airpworld/sessions/writer.jsonl', '{"culprit":"ross"}\n');

function fence(actor) {
  const hooks = {};
  registerReadFence({ on: (name, fn) => { hooks[name] = fn; } }, { actor });
  return hooks;
}
const ctxOf = { cwd: save };

/** The real pi-rp read on the raw file, then the fence's tool_result hook — what the model receives. */
async function readAs(actor, input) {
  const raw = await createReadToolDefinition(save).execute('call-1', input, undefined, undefined, ctxOf);
  const hooks = fence(actor);
  const blocked = await hooks.tool_call({ toolName: 'read', input }, ctxOf);
  if (blocked) return { blocked };
  const changed = await hooks.tool_result({ toolName: 'read', toolCallId: 'call-1', input, content: raw.content, details: raw.details, isError: false }, ctxOf);
  return { text: (changed?.content ?? raw.content).map((c) => c.text).join('\n'), changed: changed !== undefined };
}

async function grepAs(actor, input) {
  const hooks = fence(actor);
  const blocked = await hooks.tool_call({ toolName: 'grep', input }, ctxOf);
  if (blocked) return { blocked };
  const raw = [{ type: 'text', text: '(raw rg output)' }];
  const changed = await hooks.tool_result({ toolName: 'grep', toolCallId: 'call-2', input, content: raw, isError: false }, ctxOf);
  return { text: (changed?.content ?? raw).map((c) => c.text).join('\n'), changed: changed !== undefined };
}

test('a character reading a suspect card gets no intent, persona or hidden state; the writer reads the file as it is', async () => {
  const writer = await readAs(WRITER, { path: 'world/eve.md' });
  assert.equal(writer.changed, false, 'the writer\'s result is never touched');
  assert.match(writer.text, /culprit this run/);

  const hans = await readAs(HANS, { path: 'world/eve.md' });
  assert.equal(hans.changed, true);
  assert.doesNotMatch(hans.text, /culprit|10:40|intent|persona|knows/);
  assert.match(hans.text, /name: Eve/);
  assert.match(hans.text, /turning her wedding ring/);

  const room = await readAs(HANS, { path: ['world/README.md', 'world/eve.md'] });
  assert.doesNotMatch(room.text, /culprit|ross|seed/, 'arrays are projected too');
  assert.match((await readAs(WRITER, { path: 'world/README.md' })).text, /culprit: ross/);
});

test('offset / limit page through the projected file, not the raw one', async () => {
  const hans = await readAs(HANS, { path: 'world/eve.md', offset: 1, limit: 4 });
  assert.doesNotMatch(hans.text, /culprit/);
  assert.match(hans.text, /type: npc/);
});

test('a character cannot read endings, commands, engine data or another character\'s mind; its own memory is its own', async () => {
  for (const p of ['endings/confession/README.md', 'command/long-way-hall.yaml', '.airpworld/sessions/writer.jsonl', 'characters/nils/unspoken.md']) {
    const { blocked } = await readAs(HANS, { path: p });
    assert.equal(blocked?.block, true, p);
    assert.match(blocked.reason, /not something you can see/);
    assert.equal((await readAs(WRITER, { path: p })).blocked, undefined, `the writer reads ${p}`);
  }
  const own = await readAs(HANS, { path: 'characters/hans/memory.md' });
  assert.match(own.text, /drove the inspector/);
  for (const tool of ['grep', 'find', 'ls']) {
    const blocked = await fence(HANS).tool_call({ toolName: tool, input: { pattern: 'x', path: 'endings' } }, ctxOf);
    assert.equal(blocked?.block, true, `${tool} endings/`);
  }
});

test('grep searches the character view: a word only the writer\'s notes hold is not found', async () => {
  const hidden = await grepAs(HANS, { pattern: 'culprit|10:40|Ross confesses|basket' });
  assert.equal(hidden.text, 'No matches found');
  const body = await grepAs(HANS, { pattern: 'wedding ring' });
  assert.match(body.text, /^world\/eve\.md:\d+: Eve sits bolt upright/);
  const literal = await grepAs(HANS, { pattern: 'name: eve', literal: true, ignoreCase: true, glob: '*.md' });
  assert.match(literal.text, /world\/eve\.md/);
  const writer = await grepAs(WRITER, { pattern: 'culprit' });
  assert.equal(writer.changed, false, 'the writer\'s grep is ripgrep, untouched');
});

test('subagents inherit the fence: pi-rp forwards the parent\'s tool_call / tool_result handlers into every subagent', () => {
  // A character keeps `subagent`; what it spawns runs in the same process
  // (same AIRP_AGENT_ROLE) with these two hooks attached, so the child reads
  // exactly what the character reads. If pi-rp stops forwarding them, this
  // fails and characters must lose `subagent` instead.
  const vendor = new URL('../vendor/pi-rp/packages/coding-agent/src/core/subagent/', import.meta.url);
  const run = fs.readFileSync(new URL('run.ts', vendor), 'utf8');
  assert.match(run, /for \(const eventName of \[\s*"tool_call",\s*"tool_result",/);
  assert.match(run, /attachSyntheticExtension\(/);
  assert.match(run, /const parentSession = preparation\.session \?\? options\.parentSession;/);
  const prepare = fs.readFileSync(new URL('prepare.ts', vendor), 'utf8');
  assert.match(prepare, /session: options\.session,/);
  for (const file of ['extension.ts', 'spawn.ts']) {
    const source = fs.readFileSync(new URL(file, vendor), 'utf8');
    assert.match(source, /prepareSubagentConversation\(\{[\s\S]*?\n\t+session,\n/, `${file} passes the parent session`);
  }
});
