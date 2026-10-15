// The character's view of a world (src/rules/character-view.ts,
// the design notes): which files a character agent may read, and
// what it sees in them. The writer's view is the file itself and never goes
// through this module.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createActionService,
  LocalWorldStore,
  CHARACTER_PUBLIC_KEYS,
  characterViewOf,
  characterViewText,
  hiddenStateIds,
  parseFrontmatter,
  projectCardForCharacter,
  projectFrontmatterForCharacter,
  projectManifestForCharacter,
} from '../dist/index.js';

const SUSPECT = `---
type: npc
name: Eve
avatar: assets/characters/eve.webp
gender: female
voice: mature-elegant
persona: |-
  This run she is the culprit.
knows:
  - world/eve.md
wants: Blame an outsider
fears: Half past ten
intent: "Eve (the culprit this run). Full truth: she struck him at 10:40."
gives: [take-note]
choice:
  options:
    - id: take-note
      label: Take her note
    - id: secret
      label: Ask about the key
      when: asked == "yes"
choice_actions:
  take-note: { kind: take, paths: [player/note.md] }
dialogue:
  - { by: player, text: Where were you? }
  - { by: npc, text: Writing letters. }
---

Eve sits bolt upright, turning her wedding ring.
`;

const README = `---
type: readme
name: Interrogation Room
intent: The culprit is drawn per run; the truth is in the suspect intents.
states:
  - { id: culprit, label: Culprit, type: enum, values: [eve, ross], initial: eve, hidden: true }
  - { id: mood, label: Mood, type: enum, values: [calm, tense], initial: calm }
status:
  data:
    culprit: ross
    mood: tense
run:
  seed: abc
  variants: { culprit: ross }
trigger_log: [accuse]
---

A small room.
`;

test('paths: commands, endings, overlays, engine data and other minds are withheld', () => {
  for (const p of ['command/accuse-eve.yaml', 'endings/confession/README.md', 'variants/culprit/ross/world/ross.md',
    '.airpworld/sessions/writer.jsonl', '.airpworld/snapshots/x/world/eve.md', '.pi/state.json',
    'characters/nils/memory.md', 'characters/nils/unspoken.md', 'characters/nils/preset.json']) {
    const view = characterViewOf(p, 'hans');
    assert.equal(view.kind, 'withheld', p);
    assert.ok(view.reason, `${p} carries a reason`);
  }
});

test('paths: world cards and other characters’ public cards are projected; own files, assets and listings are not', () => {
  for (const p of ['world/eve.md', 'world/README.md', 'player/README.md', 'world.json', 'characters/nils/README.md', 'characters/hans/memory.md']) {
    assert.equal(characterViewOf(p, 'hans').kind, 'projected', p);
  }
  for (const p of ['', '.', 'world', 'characters/nils', 'assets/scenes/study.webp', '.airpworld/assets/x.png', 'characters/hans/preset.json', '../skills/x/SKILL.md']) {
    assert.equal(characterViewOf(p, 'hans').kind, 'full', p);
  }
  assert.equal(characterViewOf('./world//eve.md', 'hans').kind, 'projected', 'spelling does not matter');
});

test('an NPC card loses its brief, intent and actions, keeps its face, its words and what is clickable now', () => {
  const projected = projectCardForCharacter(SUSPECT);
  assert.doesNotMatch(projected, /culprit|truth|10:40|outsider|Half past|world\/eve\.md|choice_actions|player\/note/);
  const { frontmatter, body } = parseFrontmatter(projected);
  assert.equal(body, '\nEve sits bolt upright, turning her wedding ring.\n', 'the body is untouched');
  assert.equal(frontmatter.name, 'Eve');
  assert.equal(frontmatter.avatar, 'assets/characters/eve.webp');
  assert.deepEqual(frontmatter.dialogue.map((d) => d.text), ['Where were you?', 'Writing letters.'], 'what was said in the scene stays');
  assert.deepEqual(frontmatter.choice, { options: [{ id: 'take-note', label: 'Take her note' }] }, 'only options visible right now, without `when`');
  for (const key of ['intent', 'persona', 'knows', 'wants', 'fears', 'gives', 'choice_actions']) assert.ok(!(key in frontmatter), key);
});

test('hidden states and their values disappear; shown states stay; run and trigger log are gone', () => {
  const fm = parseFrontmatter(README).frontmatter;
  assert.deepEqual([...hiddenStateIds(fm)], ['culprit']);
  const projected = projectFrontmatterForCharacter(fm);
  assert.deepEqual(projected.states.map((s) => s.id), ['mood']);
  assert.deepEqual(projected.status, { data: { mood: 'tense' } });
  assert.ok(!('run' in projected) && !('trigger_log' in projected) && !('intent' in projected));
  assert.doesNotMatch(projectCardForCharacter(README), /ross|culprit|seed|truth/);
});

test('a character’s own files keep every key, but not hidden state values', () => {
  const own = projectFrontmatterForCharacter(
    { type: 'readme', name: 'Hans', greeting: 'Hi', note: 'mine', states: [{ id: 'hp', label: 'HP', type: 'number', initial: 3, hidden: true }], status: { data: { hp: 1, trust: 2 } } },
    { own: true },
  );
  assert.equal(own.note, 'mine');
  assert.ok(!('states' in own));
  assert.deepEqual(own.status, { data: { trust: 2 } });
  assert.match(characterViewText('characters/hans/memory.md', '---\nnote: mine\n---\nI saw the lamp.\n', 'hans'), /note: mine/);
});

test('search rewards, dice outcomes and engine hooks are writer-only; the die itself is public', () => {
  const projected = projectFrontmatterForCharacter({
    type: 'gate', title: 'Study',
    roll_dice: { type: '1d100', desc: 'Search', expect: '<=60', result: 30, passed: true, secret: 'x' },
    search: [{ id: 'scene', dice_outcomes: [{ min: 1, max: 12, text: 'a pearl earring' }] }],
    dice_outcomes: [{ text: 'The basket is Eve’s' }], on: { choice_selected: [] }, requires: { items: ['player/key.md'] },
    accepts: { items: ['player/key.md'] }, skill_check: { skill: 'spot_hidden' },
  });
  assert.deepEqual(Object.keys(projected).sort(), ['roll_dice', 'title', 'type']);
  assert.deepEqual(projected.roll_dice, { type: '1d100', desc: 'Search', expect: '<=60', result: 30, passed: true });
});

test('unknown keys are hidden (fail closed); a broken block is dropped whole', () => {
  assert.ok(!CHARACTER_PUBLIC_KEYS.has('intent'));
  assert.deepEqual(projectFrontmatterForCharacter({ type: 'note', title: 'A', future_writer_note: 'x' }), { type: 'note', title: 'A' });
  assert.equal(projectCardForCharacter('---\nintent: "unterminated\n---\nbody\n'), 'body\n');
  assert.equal(projectCardForCharacter('no frontmatter at all\n'), 'no frontmatter at all\n');
});

test('world.json: lobby fields only — no variants, triggers, endings, ticks', () => {
  const projected = JSON.parse(projectManifestForCharacter(JSON.stringify({
    id: 'w', name: 'W', description: 'd', intro: { hook: 'h' },
    variants: [{ id: 'culprit', options: ['eve', 'ross'] }], triggers: [{ id: 't' }], endings: [{ id: 'confession' }], tick: {}, mysteries: [],
  })));
  assert.deepEqual(Object.keys(projected).sort(), ['description', 'id', 'intro', 'name']);
  assert.equal(projectManifestForCharacter('not json'), '{}\n');
  // The lobby's act-by-act plan is not something a person in the story knows.
  const withLoop = JSON.parse(projectManifestForCharacter(JSON.stringify({ id: 'w', intro: { hook: 'h', loop: ['第三幕：钥匙打开行李车'] } })));
  assert.deepEqual(withLoop.intro, { hook: 'h' });
  assert.equal(characterViewText('endings/caught/README.md', 'x', 'hans'), null);
});

test('look_at: a character sees no hidden state and cannot look into endings; the writer sees everything', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'character-view-'));
  await fs.mkdir(path.join(root, 'world'), { recursive: true });
  await fs.mkdir(path.join(root, 'endings', 'caught'), { recursive: true });
  await fs.writeFile(path.join(root, 'world.json'), JSON.stringify({ id: 'cv', name: 'CV', version: '1.0.0', schema: 1 }));
  await fs.writeFile(path.join(root, 'world', 'README.md'), README);
  await fs.writeFile(path.join(root, 'world', 'eve.md'), SUSPECT);
  await fs.writeFile(path.join(root, 'endings', 'caught', 'README.md'), '---\ntype: ending\ntitle: Caught\n---\nEve did it.\n');
  const store = new LocalWorldStore(root);
  const look = (actor, p) => createActionService(store, actor, { turn: 'turn:cv' }).lookAt({ path: p });

  const writer = await look({ type: 'writer' }, 'world/README.md');
  assert.match(writer.text, /culprit: ross/);
  const hans = await look({ type: 'character', id: 'hans' }, 'world/README.md');
  assert.doesNotMatch(hans.text, /culprit|ross/);
  assert.match(hans.text, /mood: tense/);

  const card = await look({ type: 'character', id: 'hans' }, 'world/eve.md');
  assert.doesNotMatch(card.text, /Ask about the key/, 'an option hidden by its `when` stays hidden');
  assert.match(card.text, /Take her note/);

  await assert.rejects(look({ type: 'character', id: 'hans' }, 'endings/caught/README.md'), /not something you can see/);
  assert.match((await look({ type: 'writer' }, 'endings/caught/README.md')).text, /Eve did it/);
});
