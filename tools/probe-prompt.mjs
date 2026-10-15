#!/usr/bin/env node
/**
 * System-prompt (wire) probe — the design notes assertion 3.
 *
 * `probe-tools.mjs` can see the tool REGISTRY (jiti) but not what the model is
 * sent; `probe-tools-engine.mjs` proves a tool EXECUTES but never inspects the
 * prompt. This probe closes the last gap: it spawns the real writer through
 * `writerLaunch` (so the real presets and `extensions/instructions.ts` load),
 * points it at a dump provider, and asserts on the exact payload the engine
 * hands the provider.
 *
 * Every assertion below has a measured "red before / green after" state
 * (05 baseline table at the top, scripts under /tmp/airp-wire):
 *   - the pre-fix writer had messages[0] = 19 lines, 35 tools (F2/F3/F5);
 *   - a slots-only half-fix gives 111 lines + 35 tools (Chinese memory tools leak);
 *   - a deny-only half-fix gives 19 lines + 24 tools (nothing reaches the prompt);
 *   - the target assembly gives 92 lines (writer, no skills) + 24 tools; 94 with
 *     the proper pi-rp rebuild, 125 once a world skill is present. Hence the
 *     line assertion is a FLOOR (`> 40`), never an exact count (M2).
 * The negative and positive assertions must be checked TOGETHER: "no `retrieve`"
 * passes vacuously on the pre-fix (no tools slot at all), so it only means
 * something alongside "- look_at:".
 *
 * Run: node tools/probe-prompt.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writerLaunch } from '../apps/server/dist/engine/launch.js';
import { RpcClient } from '../vendor/pi-rp/packages/coding-agent/dist/index.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VENDOR_CLI = path.join(REPO, 'vendor/pi-rp/packages/coding-agent/dist/cli.js');
const TEST_WORLD = path.join(REPO, 'archive/templates/pre-bilingual-2026-09-14/holmes-world');
const DUMP_PROVIDER = path.join(REPO, 'tools/prompt-dump-provider.ts');

/**
 * `WRITER_INSTRUCTION`'s first sentence, copied VERBATIM from the redesigned prose
 * (`01-作家提示词.md` §③, the opening sentence of its plain-text prose block). It is NOT the
 * pre-fix line in `extensions/instructions.ts:53` — 01 rewrote it, and 05 §10 ships
 * both in the same commit, so the old string would fail on every single run (B1).
 */
const WRITER_FIRST_LINE =
  'You are the Writer of the AIRP interactive narrative world, and its lead director.';

/**
 * The frozen tool face after the assembly (measured: /tmp/airp-wire/frozen-fixed.json).
 * 15 AIRP + 9 pi-rp builtins (read/bash/edit/write/grep/find/ls/subagent*)
 * = 24. A name added upstream must be
 * added here AND to `presets/*.json`'s `tools.deny` or this probe fails (00 §4.2).
 */
const EXPECTED_TOOLS = [
  'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls',
  'subagent_profiles', 'subagent',
  'look_at', 'view_canvas', 'chalk', 'move_to', 'move', 'choose', 'roll_dice',
  'use_item_on', 'set_following', 'link', 'arrange', 'delete', 'get_component',
  'show', 'generate_image',
];

/** The pi-rp inline-extension memory/state tools AIRP must never expose (F5/F6). */
const FORBIDDEN_TOOL_NAMES = [
  'recall', 'retrieve', 'memorize', 'revise', 'forget', 'relocate', 'associate',
  'trigger', 'consolidate', 'retrace', 'set_time', 'awaken', 'get_state', 'state_update',
];

/**
 * A Pi default guideline. With `includePiDefaultGuidelines: false` it must be gone;
 * if the vendored pi-rp dist was not rebuilt after the loader fix (F9) it reappears,
 * so this string is the sentinel for BOTH "the option works" and "the fix is built".
 */
const PI_DEFAULT_GUIDELINE_SENTINEL = 'Be concise in your responses';

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' :: ' + extra : ''}`);
  if (!ok) failed++;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-prompt-'));
fs.cpSync(TEST_WORLD, tmp, { recursive: true });
// A world-side fixture skill proves the `--skill <world>/skills` + `skills` slot
// wiring end to end (04 A9 / M3) WITHOUT polluting the repo. `skillArgs` passes
// `<worldRoot>/skills` when it exists (presets.ts:112), and the slot renders one
// `<skill>` entry per loaded skill (core/skills.ts:335-361).
const FIXTURE_SKILL = 'zz-fixture';
const fixtureDir = path.join(tmp, 'skills', FIXTURE_SKILL);
fs.mkdirSync(fixtureDir, { recursive: true });
fs.writeFileSync(
  path.join(fixtureDir, 'SKILL.md'),
  `---\nname: ${FIXTURE_SKILL}\ndescription: probe fixture skill\n---\nbody\n`
);
// The template ships a stale world-side `writer.json`; `installPreset` overwrites it
// on launch, but removing it first makes the repo preset the only source (00 §4.2).
fs.rmSync(path.join(tmp, '.airpworld', 'prompt-presets', 'writer.json'), { force: true });
fs.rmSync(path.join(tmp, '.airpworld', 'sessions'), { recursive: true, force: true });

const dumpFile = path.join(tmp, 'prompt-dump.json');
const spec = writerLaunch(REPO, tmp, VENDOR_CLI);
const client = new RpcClient({
  cliPath: spec.cliPath,
  cwd: spec.cwd,
  args: [...spec.args, '--extension', DUMP_PROVIDER],
  env: { ...spec.env, PI_OFFLINE: '1', AIRP_PROMPT_OUT: dumpFile },
  provider: 'airp-prompt-dump',
  model: 'deterministic',
});

try {
  await client.start();
  await client.prompt('look around');
  await client.waitForIdle(30000);

  assert.ok(fs.existsSync(dumpFile), 'the provider never wrote a dump — check AIRP_PROMPT_OUT');
  const wire = JSON.parse(fs.readFileSync(dumpFile, 'utf-8'));

  // F1: the system prompt is empty and the real text is messages[0].
  check('context.systemPrompt is the empty string (F1)', wire.systemPrompt === '', JSON.stringify(wire.systemPrompt));
  check('messages[0] is role=system', wire.messages[0]?.role === 'system', String(wire.messages[0]?.role));
  const system = wire.messages[0]?.text ?? '';

  // ── positive: the resident instruction + the tools slot reached the model ──
  check('messages[0] starts with WRITER_INSTRUCTION', system.startsWith(WRITER_FIRST_LINE));
  check('messages[0] carries the closing-line stance (NEXT_STEP_RULES)', system.includes('[The closing line of the world state]'));
  check('the tools slot rendered a bullet for look_at', system.includes('- look_at:'));
  check('the tools slot rendered a bullet for chalk', system.includes('- chalk:'));
  // 04 A9 / M3: the skills directory reached the model (end-to-end `--skill` + slot).
  check('messages[0] carries <available_skills>', system.includes('<available_skills>'));
  check(`<available_skills> lists the world fixture (${FIXTURE_SKILL})`, system.includes(`<name>${FIXTURE_SKILL}</name>`));
  // Platform tier: every real `<repo>/skills/*/SKILL.md` must also be listed. Vacuously
  // true until 04 lands those files; once they exist this becomes the platform half of A9.
  const repoSkillsDir = path.join(REPO, 'skills');
  const repoSkillNames = fs.existsSync(repoSkillsDir)
    ? fs.readdirSync(repoSkillsDir).filter((d) => fs.existsSync(path.join(repoSkillsDir, d, 'SKILL.md')))
    : [];
  for (const name of repoSkillNames) {
    check(`<available_skills> lists the platform skill "${name}"`, system.includes(`<name>${name}</name>`));
  }
  // A12: the `skills/README.md` has no `description:` frontmatter, so it must NOT
  // become a skill named README (core/skills.ts:262,277-307).
  check('<available_skills> contains no README pseudo-skill', !system.includes('<name>README</name>'));
  // Pre-fix: 19 lines. Assembled: 92–94 (no skill), ~125 with a world skill.
  // A FLOOR, not an exact count, so a prose/skill edit never touches this probe.
  check('messages[0] grew past the 19-line pre-fix baseline', system.split('\n').length > 40, `${system.split('\n').length} lines`);

  // ── negative: no Chinese memory tool, no state tool, no Pi guideline ──
  for (const name of FORBIDDEN_TOOL_NAMES) {
    check(`messages[0] does not mention "${name}"`, !new RegExp(`\\b${name}\\b`).test(system));
  }
  check('messages[0] drops the Pi default guideline sentinel', !system.includes(PI_DEFAULT_GUIDELINE_SENTINEL));

  // ── the tool face itself (F5): the enforced set, not just the text ──
  const names = wire.tools.map((t) => t.name);
  check('context.tools == the frozen 24', JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS), `${names.length} tools`);
  for (const name of FORBIDDEN_TOOL_NAMES) {
    check(`context.tools does not expose "${name}"`, !names.includes(name));
  }
  check('every exposed tool carries a description (F4)', wire.tools.every((t) => (t.description ?? '').length > 0));
} finally {
  await client.stop().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${failed === 0 ? 'ALL PROMPT-WIRE ASSERTIONS PASSED' : `${failed} ASSERTION(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
