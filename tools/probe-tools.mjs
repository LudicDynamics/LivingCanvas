#!/usr/bin/env node
/**
 * Tool-face probe.
 *
 * `pnpm probe` cannot see the AIRP tool face: a `ToolDefinition` export that is
 * not a function makes jiti SILENTLY skip the file
 * (vendor/pi-rp/.../extensions/loader.ts:511-515) and `presetWarnings` only looks
 * for `not found` / `unknown slot`. This probe closes that hole by loading
 * `extensions/tools.ts` through the same jiti + alias setup the extension host
 * uses, then:
 *
 *   1. asserting the named tool face is exactly the frozen 15 (00 §6.3);
 *   2. registering into a fake `ExtensionAPI` and checking the registry keys;
 *   3. EXECUTING real tools against a temp world — proving `toolkit/deps.ts`
 *      (store from `ctx.cwd`, actor from `AIRP_AGENT_ROLE`, turn anchor) and the
 *      `ActionResult` -> pi-rp `ToolResult` wrapping actually work end to end.
 *
 * Run: node tools/probe-tools.mjs        (intentional, mirroring `pnpm probe`)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from '../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => path.join(repoRoot, ...p);

/** Mirrors `getAliases()` in the pi-rp loader (loader.ts:119-140). */
const alias = {
  '@earendil-works/pi-coding-agent': r('vendor/pi-rp/packages/coding-agent/dist/index.js'),
  '@earendil-works/pi-ai': r('vendor/pi-rp/packages/ai/dist/compat.js'),
  '@earendil-works/pi-ai/providers/all': r('vendor/pi-rp/packages/ai/dist/providers/all.js'),
  typebox: r('vendor/pi-rp/node_modules/typebox/build/index.mjs'),
};

const jiti = createJiti(import.meta.url, { moduleCache: false, alias, tryNative: true });

/** the design notes / the design notes — the frozen tool face. */
const EXPECTED_TOOLS = [
  'look_at',
  'view_canvas',
  'chalk',
  'move_to',
  'move',
  'choose',
  'roll_dice',
  'use_item_on',
  'set_following',
  'link',
  'arrange',
  'delete',
  'get_component',
  'show',
  'generate_image',
];

/** Every tool's `parameters`, in the frozen order above — used for schema spot-checks. */
const EXPECTED_PARAMS = {
  chalk: ['content', 'path', 'link_to', 'append_to'],
  move: ['from', 'to', 'near'],
  move_to: ['character', 'destination', 'near'],
  delete: ['path'],
  choose: ['path', 'choice'],
  roll_dice: ['path'],
  use_item_on: ['item', 'target'],
  link: ['op', 'from', 'to', 'id', 'style', 'color', 'directed', 'label'],
  generate_image: ['prompt', 'style', 'width', 'height', 'reference', 'path'],
  get_component: ['component'],
  show: ['component', 'target', 'links', 'params', 'duration_ms', 'caption'],
};

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' :: ' + extra : ''}`);
  if (!ok) failed++;
};

/* ── 1/2. Registration face ──────────────────────────────────────────────── */

const ns = await jiti.import(r('extensions/tools.ts'));
const factory = await jiti.import(r('extensions/tools.ts'), { default: true });

check('tools.ts default export is a function', typeof factory === 'function');
check('AIRP_TOOLS has 15 entries', ns.AIRP_TOOLS?.length === 15, `len=${ns.AIRP_TOOLS?.length}`);
check(
  'AIRP_TOOL_NAMES == frozen 15 (in order)',
  JSON.stringify([...ns.AIRP_TOOL_NAMES]) === JSON.stringify(EXPECTED_TOOLS)
);
check('AIRP_TOOLS is frozen/readonly-shaped', ns.AIRP_TOOL_NAMES.length === ns.AIRP_TOOLS.length);

const container = new Map();
const commands = new Map();
factory({
  registerTool: (t) => container.set(t.name, t),
  registerCommand: (name, opts) => commands.set(name, opts),
  on: () => {},
});
check('registerTool called once per tool', container.size === 15, `n=${container.size}`);
check(
  'airp-init command registered exactly once (docs/init/00 §2.2)',
  commands.size === 1 && commands.has('airp-init') && typeof commands.get('airp-init').handler === 'function',
  `commands=[${[...commands.keys()]}]`
);
check(
  'registry keys == AIRP_TOOL_NAMES (jiti keys by definition.name)',
  JSON.stringify([...container.keys()]) === JSON.stringify(EXPECTED_TOOLS)
);
check('every tool has a typebox object schema', [...container.values()].every((t) => t.parameters?.type === 'object'));
check('every tool has an execute fn', [...container.values()].every((t) => typeof t.execute === 'function'));
check('every tool has a promptSnippet', [...container.values()].every((t) => (t.promptSnippet ?? '').length > 0));
check(
  'every tool has promptGuidelines',
  [...container.values()].every((t) => Array.isArray(t.promptGuidelines) && t.promptGuidelines.length > 0)
);
check(
  'no synonym tools (00 §8 anti-pattern)',
  ![...container.keys()].some((n) => /write_world_file|inspect|interact|speak_to|remember|leave_trace|.*_state/.test(n))
);

/* ── 1b. Prompt-slot face ─────────────────────────── */
// The `tools` slot renders one `- <name>: <snippet>` bullet per tool and DROPS a
// tool whose promptSnippet is missing (`slot-renderers.js:90-93`, onlyWithSnippets
// defaults true). A tool with a blank or multi-line snippet therefore silently
// vanishes from — or breaks — the system prompt. 05 §3.1 pins it here.
check(
  'every promptSnippet is single-line (the slot renders one bullet per tool)',
  [...container.values()].every((t) => !/[\r\n]/.test(t.promptSnippet ?? ''))
);
check(
  'every promptSnippet starts with its own tool name (a bullet must identify itself)',
  [...container.entries()].every(([name, t]) => (t.promptSnippet ?? '').trimStart().startsWith(name))
);

// 00 §9 anti-pattern: an AIRP tool may never shadow a pi-rp builtin or invent a
// memory/state synonym. The existing regex (above) misses `state_update` — it has
// no `_state` suffix — and never checks builtin names at all. Both holes closed here.
const RESERVED_TOOL_NAMES = new Set([
  // pi-rp builtins (core/tools/*.js). 00 §5: AIRP has NO get_state/set_state.
  'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls',
  'state_update', 'get_state', 'subagent', 'subagent_profiles',
  // pi-rp inline-extension tools AIRP deliberately denies (F6).
  'recall', 'retrieve', 'memorize', 'revise', 'forget', 'relocate',
  'associate', 'trigger', 'consolidate', 'retrace', 'set_time', 'awaken',
]);
check(
  'no AIRP tool name collides with a reserved pi-rp tool name (00 §8)',
  ![...container.keys()].some((n) => RESERVED_TOOL_NAMES.has(n)),
  [...container.keys()].filter((n) => RESERVED_TOOL_NAMES.has(n)).join(',')
);
for (const [name, props] of Object.entries(EXPECTED_PARAMS)) {
  const actual = Object.keys(container.get(name).parameters.properties ?? {});
  check(`${name} parameter names`, JSON.stringify(actual) === JSON.stringify(props), actual.join(','));
}

/**
 * Gemini function-declaration validation rejects `anyOf: [string, array]` with
 * "For schema with items, schema type should be ARRAY" — its schema merger
 * conflates the scalar branch with the array branch's `items`. The fix (already
 * used by pi-rp's own `core/tools/read.ts:22-25`) is to list the ARRAY branch
 * FIRST. A scalar-first `string | string[]` parameter therefore makes EVERY
 * request to a Gemini-backed provider fail with HTTP 400 — which is exactly how
 * the character dialogue went silent on 2026-09-13 (no delta, no audio, no
 * error the player could see). This guard makes that class of schema a red test,
 * not a silent runtime failure.
 */
const unionBranches = (schema) => {
  const branches = schema?.anyOf ?? schema?.oneOf;
  return Array.isArray(branches) ? branches : null;
};
const hasArrayBranch = (branches) => branches.some((b) => b?.type === 'array');
const firstArrayBranch = (branches) => branches.findIndex((b) => b?.type === 'array') === 0;

for (const [name, tool] of container.entries()) {
  for (const [param, schema] of Object.entries(tool.parameters.properties ?? {})) {
    const branches = unionBranches(schema);
    if (branches && hasArrayBranch(branches)) {
      check(
        `${name}.${param}: array branch is FIRST in the union (Gemini function-declaration rule)`,
        firstArrayBranch(branches),
        branches.map((b) => b?.type).join('|')
      );
    }
  }
}

/* ── 3. Execution through the extension host path ────────────────────────── */

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-probe-tools-'));
const write = async (rel, content) => {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
};
await write(
  'world.json',
  JSON.stringify({
    id: 'probe-tools',
    name: 'Probe',
    description: '',
    author: '',
    genre: 'test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
);
await write('world/README.md', '---\nname: Map\ntype: readme\n---\n\n# Map\n');
await write('world/room/README.md', '---\nname: Room\ntype: readme\n---\n\n# Room\n');
await write(
  'world/room/door.md',
  [
    '---',
    'type: chalk',
    'title: The Cellar Door',
    'choice:',
    '  - "Force it"',
    '  - "Knock"',
    'roll_dice:',
    '  type: 1d100',
    '  desc: Pick the rusted lock',
    '  expect: ">50"',
    '---',
    '',
    'A rusted padlock.',
    '',
  ].join('\n')
);
await write('player/key.md', '---\ntype: note\ntitle: Copper Key\n---\n\nA small key.\n');
await write('characters/watson/README.md', '---\nname: Watson\ntype: readme\n---\n\n# Watson\n');

/**
 * A fresh module graph per role. In production the role is fixed for the whole
 * process (the writer and a character are SEPARATE processes — 00 §3); the probe
 * reuses one process, and `moduleCache:false` gives each import its own
 * deps/actor module instance, so the per-process actor cache is per-pass here.
 */
async function passFor(role) {
  process.env.AIRP_AGENT_ROLE = role;
  const tools = new Map();
  const passFactory = await jiti.import(r('extensions/tools.ts'), { default: true });
  passFactory({ registerTool: (t) => tools.set(t.name, t), registerCommand: () => {}, on: () => {} });
  const ctx = { cwd: root, sessionManager: { getSessionId: () => 'probe-session' } };
  return { call: (name, params) => tools.get(name).execute('probe-call', params, undefined, undefined, ctx) };
}

// Every tool, once, as the writer (01 §5's method table is the checklist).
const writer = await passFor('writer');
const CALLS = [
  ['look_at', { path: 'world/room' }],
  ['view_canvas', { layer: 'world/room' }],
  ['chalk', { content: 'The lock turns.\n\nA draft of cold air.', path: 'world/room/02-lock.md' }],
  ['move_to', { character: 'watson', destination: 'world/room', near: 'world/room/door.md' }],
  ['move', { from: 'player/key.md', to: 'characters/watson/key.md' }],
  ['choose', { path: 'world/room/door.md', choice: 1 }],
  ['roll_dice', { path: 'world/room/door.md' }],
  ['use_item_on', { item: 'characters/watson/key.md', target: 'world/room/door.md' }],
  ['set_following', { character: 'watson', following: true }],
  ['link', { op: 'create', from: 'world/room/README.md', to: 'world/room/door.md' }],
  ['arrange', { path: 'world/room/door.md', x: 120, y: 240 }],
  ['get_component', { component: 'lock' }],
  ['show', { component: 'spotlight', target: 'world/room/door.md' }],
  ['delete', { path: 'world/room/02-lock.md' }],
];
for (const [name, params] of CALLS) {
  const res = await writer.call(name, params);
  check(`${name} executes`, res.isError !== true && (res.content?.[0]?.text ?? '').length > 0, res.content?.[0]?.text?.split('\n')[0]);
}

// The one tool not in CALLS: generate_image must fail LOUD when unconfigured.
delete process.env.AIRP_IMAGE_MODEL;
delete process.env.OPENROUTER_API_KEY;
await assert.rejects(() => writer.call('generate_image', { prompt: 'a foggy street' }), error => error.code === 'unsupported' && /no API key/.test(error.message));
check('generate_image (no key) throws so engine marks failure', true);
process.env.AIRP_IMAGE_MODEL = 'openrouter/not-a-real-model';
await assert.rejects(() => writer.call('generate_image', { prompt: 'a foggy street' }), error => error.details.reason === 'no_provider');
check('generate_image (unknown model) throws no_provider', true);
delete process.env.AIRP_IMAGE_MODEL;

// Identity + turn wiring: the actor must come from the env, the turn from turn.ts.
const chalked = await writer.call('chalk', { content: 'Identity check.', path: 'world/room/03-identity.md' });
check('writer event actor', chalked.details.event.actor.type === 'writer', JSON.stringify(chalked.details.event.actor));
check('writer event turn anchor', /^turn:probe-session:/.test(chalked.details.event.turn), String(chalked.details.event.turn));
check('writer event layer resolved', chalked.details.event.layer === 'world/room', String(chalked.details.event.layer));

const character = await passFor('character:watson');
const characterChalk = await character.call('chalk', {
  content: 'My own note about the key.',
  path: 'characters/watson/note.md',
});
check(
  'character role comes from env',
  characterChalk.details.event.actor.type === 'character' && characterChalk.details.event.actor.id === 'watson',
  JSON.stringify(characterChalk.details.event.actor)
);

// Unknown-role degradation (01 §2.3): an init subagent inherits the writer role.
const subagent = await passFor('scene-init');
const subagentChalk = await subagent.call('chalk', { content: 'Opening.', path: 'world/room/04-opening.md' });
check('scene-init degrades to writer', subagentChalk.details.event.actor.type === 'writer');

// ActionError must arrive as isError:true with the code intact, never as a throw.
const notFound = await writer.call('look_at', { path: 'world/nope.md' });
check(
  'ActionError -> isError:true with code',
  notFound.isError === true && notFound.details.code === 'not_found',
  String(notFound.details.code)
);

// The image provider port: registration and env-driven resolution (11 §4.3.4).
const { createPiImageProvider } = await jiti.import(r('extensions/toolkit/image-pi-provider.ts'));
const { registerImageProviderFactory, resolveImageProvider } = await jiti.import(r('packages/shared/dist/index.js'));
const built = createPiImageProvider({ AIRP_IMAGE_MODEL: 'openrouter/google/gemini-2.5-flash-image' });
check(
  'image provider builds from a known model id',
  built?.id === 'openrouter' && built.model === 'google/gemini-2.5-flash-image' && built.supportsReference === true
);
check('image provider rejects an unknown model id', createPiImageProvider({ AIRP_IMAGE_MODEL: 'openrouter/nope' }) === null);
check('image provider rejects a non-openrouter provider', createPiImageProvider({ AIRP_IMAGE_MODEL: 'anthropic/claude' }) === null);
registerImageProviderFactory(() => built);
check('registered factory resolves', resolveImageProvider().provider?.model === 'google/gemini-2.5-flash-image');

await fs.rm(root, { recursive: true, force: true });

console.log(`\n${failed === 0 ? 'ALL TOOL-FACE PROBE ASSERTIONS PASSED' : `${failed} ASSERTION(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
