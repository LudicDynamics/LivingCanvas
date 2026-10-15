import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { triggerProblems } from './trigger-problems.mjs';

async function world(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-trigger-check-'));
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  }
  return root;
}

const HP = 'states: [{ id: hp, label: 伤势, type: number, initial: 3, range: [0, 3], shown_as: [{ min: 1, text: 还撑得住 }, { max: 0, text: 奄奄一息 }] }]';

test('check:worlds reports every authoring mistake in triggers and states', async () => {
  const root = await world({
    'player/README.md': `---\ntype: readme\n${HP}\n---\n`,
    'characters/wayne/README.md': '---\ntype: readme\nstates: [{ id: hp, label: HP, type: number, initial: 3, range: [0, 3] }]\n---\n',
    'world/README.md': '---\ntype: readme\n---\n',
    'world/fog/README.md': '---\ntype: readme\n---\n',
    'command/ok.yaml': 'name: Ok\ndo:\n  - action: add_state\n    with:\n      target: player\n      state: hp\n      by: "-1"\n',
    'assets/cg/here.webp': 'x',
  });
  const manifest = {
    mode: 'closed',
    characters: [{ id: 'wayne', home: 'map' }],
    endings: [{ id: 'dead', title: 'Dead', path: 'endings/dead/README.md' }],
    triggers: [
      { id: 'good', kind: 'state', when: 'player.hp <= 0 || wayne.hp <= 0', ending: 'dead', assets: [{ kind: 'cg', path: 'assets/cg/here.webp', prompt: 'p' }] },
      { id: 'ok-cmd', kind: 'place', when: { layer: 'world/fog' }, do: 'ok' },
      { id: 'no-cmd', kind: 'place', when: { layer: 'world/fog' }, do: 'missing' },
      { id: 'no-end', kind: 'keyword', when: { intent: 'give up' }, ending: 'nope' },
      { id: 'no-state', kind: 'state', when: 'player.sanity < 5', fallback: 'x' },
      { id: 'no-clues', kind: 'state', when: 'clues.held >= 2', fallback: 'x' },
      { id: 'no-clock', kind: 'clock', when: 'clock <= 0', ending: 'dead' },
      { id: 'no-layer', kind: 'place', when: { layer: 'world/nowhere' }, fallback: 'x' },
      { id: 'no-asset', kind: 'place', when: { layer: 'world/fog' }, fallback: 'x', assets: [{ kind: 'cg', path: 'assets/cg/missing.webp', prompt: 'p' }] },
    ],
  };
  const problems = await triggerProblems(root, manifest);
  const has = (re) => assert.ok(problems.some((p) => re.test(p)), `${re} in:\n${problems.join('\n')}`);
  has(/characters\/wayne\/README.md: hp is shown only as prose/);
  has(/no-cmd: do "missing"/);
  has(/no-end: ending "nope"/);
  has(/no-state: "player.sanity" is not a declared state/);
  has(/no-clues: clues.held needs a clues: list/);
  has(/no-clock: a clock trigger needs world.json clock/);
  has(/no-layer: layer world\/nowhere/);
  has(/no-asset: asset assets\/cg\/missing.webp is missing/);
  assert.ok(!problems.some((p) => /trigger (good|ok-cmd):/.test(p)), problems.join('\n'));
  assert.equal(problems.length, 8, problems.join('\n'));
});

// the design notes: scene-media effects point at real pictures and
// layers, and a trigger with `do` must actually show its cg / background assets.
test('check:worlds: show_cg / swap_background paths exist, and a do-trigger shows its cg / background assets', async () => {
  const { commandMediaProblems } = await import('./trigger-problems.mjs');
  const root = await world({
    'world/README.md': '---\ntype: readme\n---\n',
    'world/inn/README.md': '---\ntype: readme\n---\n',
    'assets/cg/fire.webp': 'x',
    'assets/bg/inn.webp': 'x',
    'assets/cg/unused.webp': 'x',
    'command/good.yaml': 'name: G\ndo:\n  - action: show_cg\n    with:\n      path: assets/cg/fire.webp\n  - action: swap_background\n    with:\n      layer: world/inn\n      path: assets/bg/inn.webp\n',
    'command/templated.yaml': 'name: T\nparams:\n  pic: { type: string }\ndo:\n  - action: show_cg\n    with:\n      path: "{{ params.pic }}"\n',
    'command/bad.yaml': 'name: B\ndo:\n  - action: show_cg\n    with:\n      path: assets/cg/missing.webp\n  - action: show_cg\n    with:\n      path: world/README.md\n  - action: swap_background\n    with:\n      layer: world/cellar\n      path: assets/bg/inn.webp\n  - action: swap_background\n    with:\n      layer: player\n      path: assets/bg/inn.webp\n',
  });
  const media = await commandMediaProblems(root);
  const all = media.problems.join('\n');
  assert.match(all, /bad\.yaml do\[0\] show_cg: picture assets\/cg\/missing\.webp is missing/);
  assert.match(all, /bad\.yaml do\[1\] show_cg: "world\/README\.md" must be under assets/);
  assert.match(all, /bad\.yaml do\[2\] swap_background: layer world\/cellar does not exist/);
  assert.match(all, /bad\.yaml do\[3\] swap_background: layer "player" must be map/);
  assert.ok(!/good\.yaml|templated\.yaml/.test(all), all);
  assert.equal(media.problems.length, 4, all);
  assert.deepEqual([...media.shown.get('good')].sort(), ['assets/bg/inn.webp', 'assets/cg/fire.webp']);

  const problems = await triggerProblems(root, {
    mode: 'open',
    triggers: [
      { id: 'shown', kind: 'place', when: { layer: 'world/inn' }, do: 'good', assets: [{ kind: 'cg', path: 'assets/cg/fire.webp', prompt: 'p' }] },
      { id: 'orphan', kind: 'place', when: { layer: 'world/inn' }, do: 'good', assets: [{ kind: 'cg', path: 'assets/cg/unused.webp', prompt: 'p' }, { kind: 'item', path: 'assets/cg/unused.webp', prompt: 'p' }] },
      { id: 'engine', kind: 'place', when: { layer: 'world/inn' }, assets: [{ kind: 'cg', path: 'assets/cg/unused.webp', prompt: 'p' }] },
    ],
  });
  const triggerLines = problems.filter((p) => p.startsWith('trigger '));
  assert.deepEqual(triggerLines, ['trigger orphan: cg asset assets/cg/unused.webp is never shown — command/good.yaml has no show_cg for it (or drop "do" and the engine shows it)']);
});
