// The lobby's "what is this world" card on the shelf (lobby-intro.ts, the design notes).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readWorldShelf, worldIntroAvatar } from '../dist/world-shelf.js';
import { shelfIntroOf } from '../dist/lobby-intro.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

test('every official template brick carries its authored card, portraits as hashed URLs', async () => {
  const shelf = await readWorldShelf(repo);
  const wuwu = shelf.groups.find((g) => g.id === 'wuwu-zh');
  assert.equal(wuwu.intro.derived, false);
  assert.equal(wuwu.intro.status, 'playable');
  assert.equal(wuwu.intro.recommended, true);
  assert.equal(wuwu.intro.rules, 'coc');
  assert.equal(wuwu.intro.endings, 3);
  assert.equal(wuwu.intro.loop.length, 3);
  assert.equal(wuwu.intro.characters[0].name, '薇拉');
  assert.match(wuwu.intro.characters[0].avatar, /^\/api\/worlds\/intro-avatar\?id=wuwu-zh&n=0&h=[0-9a-f]{32}$/);
  // An NPC card's portrait (not an agent) is named and pictured from the intro itself.
  // Worlds withheld from the open-source copy (fpal, guixiang, mandongbu…) are checked where they are here.
  const shipped = (id) => existsSync(fileURLToPath(new URL(`../../../templates/${id}/world.json`, import.meta.url)));
  const guixiang = shelf.groups.find((g) => g.id === 'guixiang');
  if (shipped('guixiang')) {
    assert.equal(guixiang.intro.characters[1].name, 'Luo Adi');
    assert.ok(guixiang.intro.characters[1].avatar);
  }
  // A character without a portrait gets no URL; the card shows an initial.
  assert.equal(shelf.groups.find((g) => g.id === 'unwritten-door').intro.characters[0].avatar, null);
  for (const id of ['fpal', 'mandongbu'].filter(shipped)) assert.equal(shelf.groups.find((g) => g.id === id).intro.status, 'experimental');
  for (const id of ['moonlit-contract', 'magic-academy']) assert.match(shelf.groups.find((g) => g.id === id).intro.unfinished, /\w/);
});

test('the portrait route resolves only a cast member inside the world', async () => {
  const file = await worldIntroAvatar(repo, 'wuwu', '0', 'template');
  assert.ok(file.endsWith('.webp'));
  assert.equal(await worldIntroAvatar(repo, 'wuwu', '9', 'template'), null);
  assert.equal(await worldIntroAvatar(repo, '../wuwu', '0', 'template'), null);
  assert.equal(await worldIntroAvatar(repo, 'wuwu', 'x', 'template'), null);
});

test('a world without an intro gets a card derived from its own data', async () => {
  const intro = await shelfIntroOf({
    description: 'A made world.', rules: { system: 'dnd' }, clock: { path: 'world/c.md', key: 'left', start: 6 },
    endings: [{ id: 'a' }, { id: 'b' }], characters: [{ id: 'kai', name: 'Kai', description: 'A guide.', avatar: 'assets/k.webp' }],
  }, async (i, rel) => `/x/${i}/${rel}`);
  assert.equal(intro.derived, true);
  assert.equal(intro.status, null);
  assert.equal(intro.hook, 'A made world.');
  assert.deepEqual(intro.mechanics, ['dice', 'clock', 'endings']);
  assert.equal(intro.endings, 2);
  assert.deepEqual(intro.characters, [{ name: 'Kai', line: 'A guide.', avatar: '/x/0/assets/k.webp' }]);
  const open = await shelfIntroOf({ description: 'Open.', exp: true }, async () => null);
  assert.equal(open.status, 'experimental');
  assert.deepEqual(open.mechanics, ['free-explore']);
});

test('a malformed authored intro falls back to the derived card instead of failing the shelf', async () => {
  const intro = await shelfIntroOf({ description: 'Still here.', intro: { status: 'nope' } }, async () => null);
  assert.equal(intro.derived, true);
  assert.equal(intro.hook, 'Still here.');
});

test('every template brick is filed under a world category; experiments carry the 实验 badge', async () => {
  const shelf = await readWorldShelf(repo);
  const of = (id) => shelf.groups.find((g) => g.id === id);
  assert.equal(of('wuwu').category, 'trpg');
  assert.equal(of('unwritten-door-zh').category, 'trpg');
  const shipped = (id) => existsSync(fileURLToPath(new URL(`../../../templates/${id}/world.json`, import.meta.url)));
  if (shipped('first-snow-ko')) assert.equal(of('first-snow-ko').category, 'story');
  assert.equal(of('moonlit-contract-ko').category, 'story');
  if (shipped('mandongbu')) {
    assert.equal(of('mandongbu').category, 'free');
    assert.equal(of('mandongbu').intro.experimental, true);
  }
  assert.equal(of('islet').category, 'free');
  assert.equal(of('magic-academy').intro.experimental, true);
  assert.equal(of('wuwu').intro.experimental, false);
  for (const id of shelf.templates.concat(shelf.expTemplates ?? [])) assert.ok(['trpg', 'story', 'free'].includes(of(id).category), `${id}: category`);
});

test('a derived card has no 实验 badge unless the world is exp', async () => {
  const card = await shelfIntroOf({ description: 'd', exp: true }, async () => null);
  assert.equal(card.experimental, true);
  assert.equal((await shelfIntroOf({ description: 'd' }, async () => null)).experimental, false);
});
