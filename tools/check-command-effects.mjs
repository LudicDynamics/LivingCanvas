#!/usr/bin/env node
/**
 * Generate `skills/world-commands/references/effects.md` from the effect
 * registry, and (as a gate) assert the committed copy is byte-identical.
 *
 * Precedent: `tools/check-voices.mjs` renders `voice-casting`'s
 * `references/voice-palette.md` from `rules/voices.ts` and gate V5 compares the
 * two byte-for-byte (`the design notes`). The reason is the same here:
 * hand-copying the 7-effect table into the skill is "the same rule written
 * twice" (`doc-23 §2.9`) — change one and miss the other, and the skill starts
 * advertising an effect the executor no longer knows.
 *
 * `the design notes` is the contract for each effect's argument surface; this
 * script reads the CODE (`WORLD_COMMAND_EFFECT_ARGS`), not the doc, so drift
 * between the two shows up as a diff instead of as a stale skill page.
 *
 * Usage:
 *   node tools/check-command-effects.mjs            # gate
 *   node tools/check-command-effects.mjs --write-ref # regenerate
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE_REF = process.argv.includes('--write-ref');

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' :: ' + extra : ''}`);
  if (!ok) failed += 1;
};

const {
  WORLD_COMMAND_EFFECTS,
  WORLD_COMMAND_EFFECT_ARGS,
  RESERVED_FRONTMATTER_KEYS,
} = await import(path.join(REPO, 'packages/shared/dist/commands/effects.js'));

/**
 * One sentence per effect saying what it does and what it refuses. Kept beside
 * this renderer rather than in the registry: the registry is machine-read
 * (`04`'s validator consumes it), and an English sentence in it would be a
 * second, translatable copy of the contract.
 */
const PROSE = {
  give: 'Creates one entity, or one per element when `rewards` is an array. `path` and `rewards` are mutually exclusive.',
  move: 'Moves an entity to another path, or to a layer directory (the filename is kept).',
  edit: 'Edits an entity in place: `frontmatter` shallow-merges, `body` replaces, `append_body` appends.',
  set_status: 'Writes scalar keys into the entity\'s `status.data`. This is the deep-merge form of `edit`.',
  consume: 'Takes the first existing path from `from`, then either moves it away (`to`) or changes it in place.',
  enter: 'Enters a layer. Usable only when the layer\'s gate requirement is satisfied.',
  link: 'A rider of `give`; it writes no event of its own. Prefer `give` with `link_to`.',
  tick: 'Closed worlds only: moves the world clock by `by` (default -1, never below 0); running it out reaches the clock ending.',
  end: 'Closed worlds only: ends the story with the ending named in world.json `endings`. A second `end` changes nothing.',
  event: 'Says in words what just happened to a character (`characters/<id>`), an item (a card path) or a place (a layer directory). The player sees an event card; agents in that layer read it on their next turn.',
  set_state: 'Sets a declared state (`states:` on `player`, `world` or `characters/<id>` README) to `value`, checked against its type and clamped to its range. See docs/gameplay/触发器.md.',
  add_state: 'Moves a declared number state by `by` (negative to lower it), clamped to its range — e.g. `target: player, state: hp, by: -1`.',
  show_cg: 'Shows a pre-made picture (`assets/…`, must exist) full-screen, with an optional `caption`. Recorded in the save, so the ending can list the CGs seen; `once` (default `"true"`) skips a CG this save has already shown.',
  swap_background: 'Changes the scene background of `layer` (`map` or a `world/…` layer) to the picture at `path` for good: it writes that layer README\'s `bg:`, so a reload keeps it and a rollback undoes it.',
  loop_reset: 'Looping worlds only (world.json `loop`): puts the world back to the run\'s loop-start snapshot — cards, items, backgrounds, clock, triggers, character files and conversations — while the player keeps their notes, clue board and the states / files `loop.persist` declares; `player.loop` goes up by one. Put it last in a command a trigger runs. Once per turn. See docs/gameplay/循环重置.md.',
  pass_time: 'Living worlds only (world.json `living`): lets `minutes` of world time pass, or `until` the next start of a phase (e.g. `morning` after sleeping). Residents walk, days turn and pictures change when the action settles. See docs/worlds/活着的世界.md.',
};

function renderEffectsRef() {
  const rows = WORLD_COMMAND_EFFECTS.map((name) => {
    const form = WORLD_COMMAND_EFFECT_ARGS[name];
    const args = form.names.map((n) => `\`${n}\``).join(', ');
    const req = form.required?.length
      ? form.required.map((n) => `\`${n}\``).join(' + ')
      : '—';
    const oneOf = form.oneOf?.length ? form.oneOf.map((n) => `\`${n}\``).join(' | ') : '—';
    const arrayForm = form.arrays?.length
      ? `${form.arrays.map((n) => `\`${n}\``).join(', ')} (${form.arrayForm ?? 'scalar'})`
      : '—';
    return `| \`${name}\` | ${args} | ${req} | ${oneOf} | ${arrayForm} | ${PROSE[name]} |`;
  }).join('\n');

  return `# The effect list

The ${WORLD_COMMAND_EFFECTS.length} verbs a \`do\` step may name, with the arguments each one accepts. Write the verb, not
the action method behind it: \`give\`, never \`createEntity\`.

This file is GENERATED from \`packages/shared/src/commands/effects.ts\` — do not edit it by hand.
To change an effect, follow \`docs/command/04\` and run
\`node tools/check-command-effects.mjs --write-ref\`.

| Effect | Arguments | Required | Exactly one | Array form | What it does |
|---|---|---|---|---|---|
${rows}

## Rules that apply to every effect

- \`path\` values are world-root-relative: \`world/\`, \`player/\`, or \`characters/\`, and a \`.md\` file.
- The exceptions are \`show_cg\` and \`swap_background\`: their \`path\` is a picture under \`assets/\`
  that already exists in the world (\`check:worlds\` refuses a missing one). Nothing is generated at play time.
- An array argument is passed WHOLE, as a static reference: \`"{{ trigger.entry.rewards }}"\`. A
  literal array is refused — content lives on the entity, not in the command.
- These keys are never writable: ${RESERVED_FRONTMATTER_KEYS.map((k) => `\`${k}\``).join(', ')}.
  They carry already-settled facts, and writing them would forge a result the player has seen.
- Whether an effect CAN happen is not checked at write time (a missing file, an item the player
  does not have). Those fail at trigger time, visibly.
`;
}

const REF_PATH = path.join(REPO, 'skills', 'world-commands', 'references', 'effects.md');
const expected = renderEffectsRef();

if (WRITE_REF) {
  fs.mkdirSync(path.dirname(REF_PATH), { recursive: true });
  fs.writeFileSync(REF_PATH, expected);
  console.log(`wrote ${path.relative(REPO, REF_PATH)}`);
  process.exit(0);
}

check('the effect registry is non-empty', WORLD_COMMAND_EFFECTS.length > 0, `${WORLD_COMMAND_EFFECTS.length} effects`);

for (const name of WORLD_COMMAND_EFFECTS) {
  check(`\`${name}\` declares an argument form`, WORLD_COMMAND_EFFECT_ARGS[name] !== undefined);
  check(`\`${name}\` has a description in the renderer`, typeof PROSE[name] === 'string');
}

// `show_cg` / `swap_background` point at pictures: in every template, a literal
// picture must exist and a literal layer must have a README.
const { commandMediaProblems } = await import(path.join(REPO, 'tools/trigger-problems.mjs'));
const TEMPLATES = path.join(REPO, 'templates');
for (const d of fs.readdirSync(TEMPLATES).sort()) {
  if (!fs.existsSync(path.join(TEMPLATES, d, 'command'))) continue;
  const { problems } = await commandMediaProblems(path.join(TEMPLATES, d));
  check(`templates/${d}: scene-media effects point at pictures and layers that exist`, problems.length === 0, problems.join('; '));
}

if (!fs.existsSync(REF_PATH)) {
  check(`${path.relative(REPO, REF_PATH)} exists (run with --write-ref)`, false, 'missing');
} else {
  const actual = fs.readFileSync(REF_PATH, 'utf-8');
  const matches = actual === expected;
  check(
    `${path.relative(REPO, REF_PATH)} matches the effect registry (docs/command/04 §2.6)`,
    matches,
    matches ? '' : 'stale — run `node tools/check-command-effects.mjs --write-ref`'
  );
}

console.log(`\n${failed === 0 ? 'ALL COMMAND-EFFECT ASSERTIONS PASSED' : `${failed} ASSERTION(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
