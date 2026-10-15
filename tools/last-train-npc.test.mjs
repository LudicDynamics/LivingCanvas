// last-train's people as NPC cards.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, readNpcCard } from '../packages/shared/dist/index.js';
import { npcProblems } from './npc-problems.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = path.join(REPO, 'templates/last-train-zh');
const read = async (f) => parseFrontmatter(await fs.readFile(path.join(TEMPLATE, f), 'utf8'));

const NPCS = [
  ['world/freight-car/su-he.md', '苏禾', 'female', ['world/freight-car/su-he-testimony.md'], ['take-testimony']],
  ['world/seated-car/zhou-zihang.md', '周子航', 'male', ['world/seated-car/witness-account.md'], []],
  ['world/cab/lao-qin.md', '老秦', 'male', ['world/cab/repair-notice.md', 'world/cab/lao-qin.md'], []],
  ['world/dining-car/lao-he.md', '老贺', 'male', ['world/dining-car/two-teacups.md'], []],
];

test('the four people are valid NPC cards with their portraits wired', async () => {
  assert.deepEqual(await npcProblems(TEMPLATE), []);
  for (const [file, name, gender, knows, gives] of NPCS) {
    const { frontmatter } = await read(file);
    const npc = readNpcCard(frontmatter);
    assert.ok(npc, file);
    assert.equal(npc.name, name);
    assert.equal(npc.gender, gender);
    assert.deepEqual(npc.knows, knows);
    assert.deepEqual(npc.gives, gives);
    const id = path.basename(file, '.md');
    assert.equal(npc.avatar, `assets/characters/${id}.webp`, `${file}: avatar is the delivered portrait`);
    await fs.access(path.join(TEMPLATE, npc.avatar));
  }
});

test('苏禾 can never hand over the logbook page', async () => {
  const { frontmatter } = await read('world/freight-car/su-he.md');
  const text = JSON.stringify({ knows: frontmatter.knows, choice_actions: frontmatter.choice_actions });
  assert.doesNotMatch(text, /logbook-page|torn-corner/);
  assert.match(frontmatter.intent, /04-confront-dice\.md/);
});

test('no NPC knows a dice-only find it could give away', async () => {
  for (const [file] of NPCS) {
    const { frontmatter } = await read(file);
    for (const k of frontmatter.knows) assert.doesNotMatch(k, /freight-key|key-board|logbook-page|pill-strip/, `${file} knows ${k}`);
  }
});

test('each car points its intent at the card and pins the person on the map', async () => {
  for (const [file] of NPCS) {
    const dir = path.posix.dirname(file), stem = path.posix.basename(file, '.md');
    for (const f of ['README.md', '01-opening.md']) {
      const { frontmatter } = await read(`${dir}/${f}`);
      assert.match(frontmatter.intent, new RegExp(`NPC 卡 ${stem}\\.md`), `${dir}/${f}`);
      assert.doesNotMatch(frontmatter.intent, /不是登记角色，由作家演/);
    }
    const readme = (await read(`${dir}/README.md`)).frontmatter;
    assert.ok(Array.isArray(readme.map.plan.pins[stem]), `${dir}: pin for ${stem}`);
  }
});
