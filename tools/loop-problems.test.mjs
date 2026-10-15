import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loopProblems } from './loop-problems.mjs';

async function world(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-loop-check-'));
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  }
  return root;
}

const PLAYER = '---\ntype: readme\nstates:\n- { id: loop, label: Loop, type: number, initial: 1, range: [1, 99] }\n- { id: known_a, label: A, type: flag, initial: false }\n---\n';
const RESET = 'name: fire\ndo:\n- action: loop_reset\n  with: {}\n';

test('check:worlds: a clean looping world', async () => {
  const root = await world({ 'player/README.md': PLAYER, 'command/fire.yaml': RESET });
  assert.deepEqual(await loopProblems(root, { loop: { persist: { states: ['loop', 'known_*'] }, keep: ['player/message.md'] } }), []);
});

test('check:worlds reports every looping-world authoring mistake', async () => {
  const root = await world({
    'player/README.md': '---\ntype: readme\nstates:\n- { id: loop, label: Loop, type: flag, initial: false }\n---\n',
    'command/fire.yaml': 'name: fire\ndo:\n- action: loop_reset\n  with: {}\n- action: tick\n  with:\n    by: \'-1\'\n',
  });
  const problems = await loopProblems(root, { living: {}, loop: { persist: { states: ['known_*'] } } });
  assert.deepEqual(problems, [
    'world.json: loop and living do not go together (one rewinds, the other keeps time)',
    'command/fire.yaml: loop_reset must be the last step (what follows it would land in the new loop)',
    'player/README.md: loop.counter "loop" must be a declared number state',
    'world.json: loop.persist.states "known_*" matches no state declared in player/README.md',
  ]);
  assert.deepEqual(await loopProblems(root, { loop: { persist: { notes: 'yes', files: ['world/x.md'] }, keep: 'player/a.md' } }), [
    'world.json: loop.persist.notes must be true or false',
    'world.json: loop.persist.files: "world/x.md" must be a player/<name>.md file (not README.md)',
    'world.json: loop.keep must be a list of player/*.md paths',
  ]);
});

test('check:worlds: loop_reset without loop; loop without loop_reset', async () => {
  const withReset = await world({ 'player/README.md': PLAYER, 'command/fire.yaml': RESET });
  assert.deepEqual(await loopProblems(withReset, {}), ['command/fire.yaml: loop_reset needs world.json loop']);
  const noReset = await world({ 'player/README.md': PLAYER });
  assert.deepEqual(await loopProblems(noReset, { loop: {} }), ['world.json: loop is declared but no command uses loop_reset']);
  assert.deepEqual(await loopProblems(noReset, {}), []);
});

const STAGED = {
  'player/README.md': PLAYER,
  'command/fire.yaml': RESET,
  'world/README.md': '---\ntype: readme\nname: Map\n---\n',
  'world/inn/README.md': '---\ntype: readme\nname: Inn\n---\n',
  'loops/second/world/inn/sign.md': '---\ntype: note\ntitle: Sign\n---\nOne notch.\n',
  'loops/second/command/early.yaml': 'name: early\ndo:\n- action: tick\n  with:\n    by: \'-1\'\n',
  'loops/second/stage.json': JSON.stringify({ triggers: [{ id: 'early', kind: 'place', when: { layer: 'world/inn' }, do: 'early' }] }),
  'loops/known/world/inn/door.md': '---\ntype: note\ntitle: Door\n---\nA door.\n',
};
const stagedLoop = (stages) => ({ loop: { persist: { states: ['loop', 'known_*'] }, keep: ['player/message.md'], stages } });

test('check:worlds: a clean world with loop stages', async () => {
  const root = await world(STAGED);
  assert.deepEqual(await loopProblems(root, stagedLoop([
    { from: 2, overlay: 'loops/second' },
    { from: 3, when: 'player.known_a == true && player.loop >= 3', overlay: 'loops/known' },
  ])), []);
});

test('check:worlds reports every loop-stage authoring mistake', async () => {
  const root = await world({
    ...STAGED,
    'player/README.md': '---\ntype: readme\nstates:\n- { id: loop, label: Loop, type: number, initial: 1, range: [1, 99] }\n- { id: known_a, label: A, type: flag, initial: false }\n- { id: hp, label: HP, type: number, initial: 3, range: [0, 3], hidden: true }\n---\n',
    'loops/bad/world/README.md': '---\ntype: readme\n---\n',
    'loops/bad/player/message.md': 'mine\n',
    'loops/bad/command/fire.yaml': RESET,
    'loops/bad/world.json': '{}',
    'loops/bad/world/inn/card.md': '---\ntype: note\ntitle: Card\ntrigger_log: {}\n---\n',
    'loops/bad/stage.json': JSON.stringify({ endings: [] }),
    'loops/orphan/world/x.md': 'x\n',
  });
  assert.deepEqual(await loopProblems(root, stagedLoop([
    { from: 2, overlay: 'loops/bad' },
    { from: 2, when: 'player.hp > 1', overlay: 'loops/second' },
    { from: 2, when: 'player.nope == true', overlay: 'loops/known' },
    { from: 3, overlay: 'loops/missing' },
  ])), [
    'loops/orphan/: no loop.stages entry uses this overlay',
    'world.json: loop.stages[1].when reads player.hp, which goes back to its start every loop (keep it in loop.persist.states)',
    'world.json: loop.stages[2].when reads player.nope, not a state declared in player/README.md',
    'loops/bad/command/fire.yaml: command/ is not rewound by a reset — a stage may add files there, not replace command/fire.yaml',
    'loops/bad/player/message.md: this file is one the player keeps across loops (loop.persist.files / loop.keep)',
    'loops/bad/stage.json: (root): Unrecognized key(s) in object: \'endings\'',
    'loops/bad/world.json: an overlay carries world/, characters/, player/, command/, assets/ files and stage.json only (never world.json, variants/ or loops/)',
    'loops/bad/world/README.md: the root README is the world\'s own (its states, trigger_log, the run record): a stage may not replace it',
    'loops/bad/world/inn/card.md: "trigger_log" is written by the engine, not carried by a stage',
    'loops/missing/: the overlay directory is missing or empty',
  ]);
  assert.deepEqual(await loopProblems(root, stagedLoop([{ from: 1, overlay: 'loops/second' }])).then((p) => p.slice(0, 1)), [
    'world.json: loop.stages[0].from must be a whole number >= 2 (loop 1 is the template itself)',
  ]);
});

test('check:worlds: the world loop N sees passes the trigger checks (a stage trigger needs its command)', async () => {
  const { 'loops/second/command/early.yaml': _command, ...rest } = STAGED;
  const root = await world(rest);
  const problems = await loopProblems(root, stagedLoop([{ from: 2, overlay: 'loops/second' }, { from: 3, overlay: 'loops/known' }]));
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.match(problems[0], /^loop 2 \(loops\/second\): trigger early: do "early"/);
  assert.match(problems[1], /^loop 3 \(loops\/second \+ loops\/known\): trigger early/);
});
