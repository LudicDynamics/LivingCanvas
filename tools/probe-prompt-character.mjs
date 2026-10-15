#!/usr/bin/env node
/**
 * Character system-prompt (wire) probe — the character half of the design notes
 * assertion 3 and 04 §⑧ A9.
 *
 * `probe-prompt.mjs` spawns the WRITER. The phase-05 fix is mostly about the
 * CHARACTER (F8: no `tools` slot, no `--skill`), so the character assembly needs
 * its own observation — otherwise A9 ("<available_skills> shows both tiers") is
 * only proven for the writer.
 *
 * Measured red-before / green-after (/tmp/airp-wire/charpre.json, charpost.json):
 *   pre-fix  : 23 lines, 35 tools, no `- look_at:`, no `<available_skills>`
 *   post-fix : 115 lines with a fixture skill, 24 tools, both present
 *
 * Run: node tools/probe-prompt-character.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { characterLaunch } from '../apps/server/dist/engine/launch.js';
import { RpcClient } from '../vendor/pi-rp/packages/coding-agent/dist/index.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VENDOR_CLI = path.join(REPO, 'vendor/pi-rp/packages/coding-agent/dist/cli.js');
const TEST_WORLD = path.join(REPO, 'archive/templates/pre-bilingual-2026-09-14/holmes-world');
const DUMP_PROVIDER = path.join(REPO, 'tools/prompt-dump-provider.ts');
const CHARACTER_ID = 'watson';

/**
 * `CHARACTER_INSTRUCTION`'s first sentence, copied VERBATIM from the redesigned
 * prose (`02-角色提示词.md` §③). 02 rewrites it in the same commit (05 §10), so
 * only the NEW line passes.
 */
const CHARACTER_FIRST_LINE =
  'You are a person living inside the AIRP interactive narrative world,';

/**
 * A sentence from the character body's emotion-tag section, verbatim from
 * `extensions/instructions.ts` (`02`'s frozen prose). It proves the PERFORMANCE
 * discipline — not just the header — reached the model.
 */
const CHARACTER_BODY_ANCHOR =
  'Those six are the only moods that exist; do not invent a seventh or spell one differently.';

/** The six moods of the closed set (`audio.ts:37`), each tag spelled exactly. */
const EMO_TAGS = ['normal', 'smile', 'shock', 'sad', 'angry', 'thinking'];

/** Same frozen 24 as the writer probe (the character face is identical after deny). */
const EXPECTED_TOOLS = [
  'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls',
  'subagent_profiles', 'subagent',
  'look_at', 'view_canvas', 'chalk', 'move_to', 'move', 'choose', 'roll_dice',
  'use_item_on', 'set_following', 'link', 'arrange', 'delete', 'get_component',
  'show', 'generate_image',
];
const FORBIDDEN_TOOL_NAMES = [
  'recall', 'retrieve', 'memorize', 'revise', 'forget', 'relocate', 'associate',
  'trigger', 'consolidate', 'retrace', 'set_time', 'awaken', 'get_state', 'state_update',
];

/**
 * A Pi default guideline. `includePiDefaultGuidelines: false` must drop it (F9);
 * if the vendored pi-rp dist was not rebuilt it reappears — the option is a no-op.
 */
const PI_DEFAULT_GUIDELINE_SENTINEL = 'Be concise in your responses';

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' :: ' + extra : ''}`);
  if (!ok) failed++;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-prompt-char-'));
fs.cpSync(TEST_WORLD, tmp, { recursive: true });
fs.rmSync(path.join(tmp, '.airpworld', 'sessions'), { recursive: true, force: true });

// World-side fixture skill — proves `--skill <world>/skills` + the character's
// `skills` slot (F8) without adding files to the repo.
const FIXTURE_SKILL = 'zz-fixture';
const fixtureDir = path.join(tmp, 'skills', FIXTURE_SKILL);
fs.mkdirSync(fixtureDir, { recursive: true });
fs.writeFileSync(
  path.join(fixtureDir, 'SKILL.md'),
  `---\nname: ${FIXTURE_SKILL}\ndescription: probe fixture skill\n---\nbody\n`
);

const dumpFile = path.join(tmp, 'char-dump.json');
// `characterLaunch` installs the world-side `characters/watson/preset.json` when it
// exists (launch.ts:145-148) — which is exactly the file §3.3 rewrites.
const spec = characterLaunch(REPO, tmp, VENDOR_CLI, CHARACTER_ID);
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
  await client.prompt('hello');
  await client.waitForIdle(30000);

  assert.ok(fs.existsSync(dumpFile), 'the provider never wrote a dump — check AIRP_PROMPT_OUT');
  const wire = JSON.parse(fs.readFileSync(dumpFile, 'utf-8'));
  check('context.systemPrompt is the empty string (F1)', wire.systemPrompt === '');
  const system = wire.messages[0]?.text ?? '';

  // The character identity reached the model (02's redesigned prose).
  check('messages[0] starts with CHARACTER_INSTRUCTION', system.startsWith(CHARACTER_FIRST_LINE));
  check('messages[0] carries the emotion-tag discipline (02 body anchor)', system.includes(CHARACTER_BODY_ANCHOR));
  // The six moods of the closed set, spelled `[emo: <mood>]` (audio.ts:37).
  for (const mood of EMO_TAGS) {
    check(`messages[0] spells the [emo: ${mood}] tag`, system.includes(`[emo: ${mood}]`));
  }
  // The three platform slots the character never had (F8).
  check('the tools slot rendered a bullet for look_at', system.includes('- look_at:'));
  check('the tool-guidelines slot rendered its heading', system.includes('Guidelines:'));
  check('messages[0] carries <available_skills>', system.includes('<available_skills>'));
  check(`<available_skills> lists the world fixture (${FIXTURE_SKILL})`, system.includes(`<name>${FIXTURE_SKILL}</name>`));
  // Floor, not an exact count (M2): pre-fix 23, assembled 115 with the fixture.
  check('messages[0] grew past the 23-line pre-fix baseline', system.split('\n').length > 40, `${system.split('\n').length} lines`);

  for (const name of FORBIDDEN_TOOL_NAMES) {
    check(`messages[0] does not mention "${name}"`, !new RegExp(`\\b${name}\\b`).test(system));
  }
  check('messages[0] drops the Pi default guideline sentinel', !system.includes(PI_DEFAULT_GUIDELINE_SENTINEL));

  const names = wire.tools.map((t) => t.name);
  check('context.tools == the frozen 24', JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS), `${names.length} tools`);
  for (const name of FORBIDDEN_TOOL_NAMES) {
    check(`context.tools does not expose "${name}"`, !names.includes(name));
  }
} finally {
  await client.stop().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${failed === 0 ? 'ALL CHARACTER PROMPT-WIRE ASSERTIONS PASSED' : `${failed} ASSERTION(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
