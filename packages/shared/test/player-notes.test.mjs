import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  ActionError,
  LocalWorldStore,
  PLAYER_BOARD_PATH,
  WRITER_SECTIONS,
  CHARACTER_SECTIONS,
  PLAYER_BOARD_CAPS,
  assertPlayerNoteMutationAllowed,
  cardKindOf,
  createActionService,
  createEntity,
  isPlayerNotePath,
  parseFrontmatter,
  parsePlayerBoard,
  parsePlayerBoardInput,
  parsePlayerNoteInput,
  playerBoardForLayer,
  readPlayerBoard,
  renderEvent,
  updatePlayerBoard,
  writeChalk,
  writePlayerNote,
} from '../dist/index.js';
import { collectSections, makeSectionDeps } from '../dist/inject/collect.js';

const LAYER = 'world/study';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-player-notes-'));
  const store = new LocalWorldStore(root);
  await store.writeFile('world.json', JSON.stringify({
    id: 'pn', name: 'PN', description: '', author: '', genre: 'test', createdAt: '', updatedAt: '',
    characters: [{ id: 'butler', name: 'The Butler', home: LAYER }],
  }));
  await store.writeFile('world/README.md', '---\ntype: readme\nname: Map\n---\n');
  await store.writeFile(`${LAYER}/README.md`, '---\ntype: readme\nname: Study\n---\n');
  await store.writeFile(`${LAYER}/clock.md`, '---\ntype: note\ntitle: Stopped clock\n---\nIt stopped at 9:40.\n');
  await store.writeFile(`${LAYER}/letter.md`, '---\ntype: note\ntitle: Torn letter\n---\nMeet me at ten.\n');
  await store.writeFile('characters/butler/README.md', '---\ntype: readme\nname: The Butler\n---\n');
  return { root, store };
}

const svc = (store, actor) => createActionService(store, actor, { turn: 'req:test' });
const isCode = (code) => (error) => error instanceof ActionError && error.code === code;

test('player-note paths: ownership by path, sticky kind needs type AND file name', () => {
  assert.equal(isPlayerNotePath('world/study/player-note-3.md'), true);
  assert.equal(isPlayerNotePath('world/player-note-1.md'), true);
  assert.equal(isPlayerNotePath('characters/x/player-note-1.md'), false);
  assert.equal(isPlayerNotePath('world/study/note-1.md'), false);
  assert.equal(cardKindOf({ type: 'player-note' }, 'player-note-1.md'), 'sticky');
  assert.notEqual(cardKindOf({ type: 'player-note' }, 'forged.md'), 'sticky');
});

test('request parsing: closed ops, caps, labels', () => {
  assert.throws(() => parsePlayerNoteInput({ op: 'create', layer: LAYER, text: '' }), isCode('invalid_argument'));
  assert.throws(() => parsePlayerNoteInput({ op: 'create', layer: LAYER, text: 'x'.repeat(501) }), isCode('invalid_argument'));
  assert.throws(() => parsePlayerNoteInput({ op: 'update', path: `${LAYER}/clock.md`, text: 'x' }), isCode('invalid_argument'));
  assert.throws(() => parsePlayerNoteInput({ op: 'create', layer: LAYER, text: 'x', color: 'red' }), isCode('invalid_argument'));
  assert.deepEqual(parsePlayerNoteInput({ op: 'create', layer: LAYER, text: ' hi ', x: 10.4, y: 3 }), { op: 'create', layer: LAYER, text: 'hi', x: 10, y: 3 });
  assert.throws(() => parsePlayerBoardInput({ op: 'link', from: 'a.md', to: 'a.md' }), isCode('invalid_argument'));
  assert.throws(() => parsePlayerBoardInput({ op: 'tag', path: 'a.md', tag: 'evil' }), isCode('invalid_argument'));
  assert.deepEqual(parsePlayerBoardInput({ op: 'link', from: 'a.md', to: 'b.md', label: ' 矛盾 ' }), { op: 'link', from: 'a.md', to: 'b.md', label: '矛盾' });
});

test('player creates, edits, deletes own notes; events are player entity_* with playerNote', async () => {
  const { root, store } = await fixture();
  try {
    const player = svc(store, { type: 'player' });
    const created = await writePlayerNote(player.ctx, { op: 'create', layer: LAYER, text: 'The butler lied\nabout the time', color: 'pink', x: 400, y: 120 });
    const p = created.details.path;
    assert.equal(p, `${LAYER}/player-note-1.md`);
    const fm = parseFrontmatter(await store.readFile(p)).frontmatter;
    assert.equal(fm.type, 'player-note');
    assert.equal(fm.author, 'player');
    assert.equal(fm.color, 'pink');
    assert.equal(fm.title, 'The butler lied');
    const [card] = store.getLayerCards([p]);
    assert.equal(card.x, 400);
    assert.equal(card.y, 120);
    assert.equal(created.details.event.type, 'entity_created');
    assert.equal(created.details.event.detail.playerNote, true);

    const second = await writePlayerNote(player.ctx, { op: 'create', layer: LAYER, text: 'two' });
    assert.equal(second.details.path, `${LAYER}/player-note-2.md`);

    await writePlayerNote(player.ctx, { op: 'update', path: p, text: 'Rewritten', size: 'l' });
    const after = parseFrontmatter(await store.readFile(p));
    assert.equal(after.body.trim(), 'Rewritten');
    assert.equal(after.frontmatter.size, 'l');
    assert.equal(after.frontmatter.color, 'pink');

    await writePlayerNote(player.ctx, { op: 'delete', path: second.details.path });
    assert.equal(await store.statKind(second.details.path), 'missing');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('writer, characters and god cannot use the note route; writer/characters cannot touch notes through any generic path', async () => {
  const { root, store } = await fixture();
  try {
    const player = svc(store, { type: 'player' });
    const { details } = await writePlayerNote(player.ctx, { op: 'create', layer: LAYER, text: 'mine' });
    const note = details.path;
    for (const actor of [{ type: 'writer' }, { type: 'character', id: 'butler' }, { type: 'god' }]) {
      const ctx = svc(store, actor).ctx;
      await assert.rejects(() => writePlayerNote(ctx, { op: 'delete', path: note }), isCode('player_owned'));
      await assert.rejects(() => updatePlayerBoard(ctx, { op: 'tag', path: `${LAYER}/clock.md`, tag: 'suspect' }), isCode('player_owned'));
    }
    for (const actor of [{ type: 'writer' }, { type: 'character', id: 'butler' }]) {
      const s = svc(store, actor);
      await assert.rejects(() => s.removeEntity({ path: note }), isCode('player_owned'));
      await assert.rejects(() => s.editEntity({ path: note, body: 'hacked' }), isCode('player_owned'));
      await assert.rejects(() => s.moveEntity({ from: note, to: `${LAYER}/moved.md` }), isCode('player_owned'));
      await assert.rejects(() => writeChalk(s.ctx, { title: 'x', body: 'y', path: `${LAYER}/player-note-7.md` }), isCode('player_owned'));
      await assert.rejects(() => createEntity(s.ctx, { path: `${LAYER}/player-note-9.md`, body: 'forged' }), isCode('player_owned'));
      assert.throws(() => assertPlayerNoteMutationAllowed(actor, note, 'edit'), isCode('player_owned'));
    }
    assert.equal(parseFrontmatter(await store.readFile(note)).body.trim(), 'mine');
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('board: links and tags persist in player-board.json, survive a fresh store, never edit the cards', async () => {
  const { root, store } = await fixture();
  const clockBefore = await store.readFile(`${LAYER}/clock.md`);
  try {
    const player = svc(store, { type: 'player' });
    const linked = await updatePlayerBoard(player.ctx, { op: 'link', from: `${LAYER}/clock.md`, to: `${LAYER}/letter.md`, label: '矛盾' });
    assert.equal(linked.details.layer, LAYER);
    assert.equal(linked.details.board.links.length, 1);
    assert.equal(linked.details.event.type, 'player_board_changed');
    // same pair again (either direction) updates the label, never duplicates
    await updatePlayerBoard(player.ctx, { op: 'link', from: `${LAYER}/letter.md`, to: `${LAYER}/clock.md`, label: '同一个人？' });
    await updatePlayerBoard(player.ctx, { op: 'tag', path: `${LAYER}/clock.md`, tag: 'suspect' });
    await updatePlayerBoard(player.ctx, { op: 'tag', path: 'characters/butler', tag: 'confirmed' });
    const same = await updatePlayerBoard(player.ctx, { op: 'tag', path: `${LAYER}/clock.md`, tag: 'suspect' });
    assert.equal(same.details.changed, false);
    await assert.rejects(() => updatePlayerBoard(player.ctx, { op: 'link', from: `${LAYER}/clock.md`, to: 'world/README.md' }), isCode('invalid_argument'));
    await assert.rejects(() => updatePlayerBoard(player.ctx, { op: 'tag', path: `${LAYER}/nope.md`, tag: 'suspect' }), isCode('not_found'));
  } finally {
    store.close();
  }
  const reopened = new LocalWorldStore(root);
  try {
    const board = await readPlayerBoard(reopened);
    assert.equal(board.links.length, 1);
    assert.equal(board.links[0].label, '同一个人？');
    assert.equal(board.tags[`${LAYER}/clock.md`], 'suspect');
    const slice = await playerBoardForLayer(reopened, LAYER);
    assert.equal(slice.tags['characters/butler'], 'confirmed');
    assert.equal(await reopened.readFile(`${LAYER}/clock.md`), clockBefore);
    // deleting a note drops its lines and mark
    const player = svc(reopened, { type: 'player' });
    const { details } = await writePlayerNote(player.ctx, { op: 'create', layer: LAYER, text: 'n' });
    await updatePlayerBoard(player.ctx, { op: 'link', from: details.path, to: `${LAYER}/clock.md` });
    await updatePlayerBoard(player.ctx, { op: 'tag', path: details.path, tag: 'irrelevant' });
    await writePlayerNote(player.ctx, { op: 'delete', path: details.path });
    const cleaned = await readPlayerBoard(reopened);
    assert.equal(cleaned.links.length, 1);
    assert.equal(cleaned.tags[details.path], undefined);
    const unl = await updatePlayerBoard(player.ctx, { op: 'unlink', id: cleaned.links[0].id });
    assert.equal(unl.details.board.links.length, 0);
    assert.deepEqual(parsePlayerBoard('{broken'), { version: 1, links: [], tags: {} });
    assert.ok(JSON.parse(await reopened.readFile(PLAYER_BOARD_PATH)).version === 1);
  } finally {
    reopened.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('writer section: notes, lines, marks on the current page; capped; absent from layer_files and characters', async () => {
  const { root, store } = await fixture();
  try {
    const player = svc(store, { type: 'player' });
    for (let i = 0; i < 9; i++) await writePlayerNote(player.ctx, { op: 'create', layer: LAYER, text: `note ${i} ${'x'.repeat(300)}` });
    await updatePlayerBoard(player.ctx, { op: 'link', from: `${LAYER}/clock.md`, to: `${LAYER}/letter.md`, label: '矛盾' });
    await updatePlayerBoard(player.ctx, { op: 'tag', path: `${LAYER}/clock.md`, tag: 'suspect' });
    store.writeViewpoint({ layer: LAYER, focus: null, selected: [], bagCount: 0 });

    const deps = await makeSectionDeps({ store, actor: { type: 'writer' }, reader: 'writer', specs: WRITER_SECTIONS });
    const sections = await collectSections(deps);
    const board = sections.find((s) => s.key === 'player_board');
    assert.ok(board, 'player_board section present');
    assert.ok(board.text.startsWith("Player's notes & deductions"));
    assert.match(board.text, /never edit them/);
    assert.match(board.text, /"Stopped clock" ↔ "Torn letter" · "矛盾"/);
    assert.match(board.text, /"Stopped clock" — suspicious/);
    assert.match(board.text, /…and 3 more/);
    assert.ok(board.text.length <= PLAYER_BOARD_CAPS.text);
    const files = sections.find((s) => s.key === 'layer_files');
    assert.ok(files && !files.text.includes('player-note-'), 'notes are not scene cards for the writer');
    const recent = sections.find((s) => s.key === 'recent_chalk');
    assert.ok(!recent || !recent.text.includes('player-note-'));

    // the event sentences
    const events = await store.getEventsSince(0);
    const linked = events.find((e) => e.type === 'player_board_changed' && e.detail.op === 'linked');
    assert.equal(renderEvent(linked, { layerNames: {} }), 'The player drew a line on their clue board between "Stopped clock" and "Torn letter" labelled "矛盾".');

    // characters: no section, no layer listing, no events about notes/board
    await store.setPresence?.('butler', LAYER, 0, 0);
    const cdeps = await makeSectionDeps({ store, actor: { type: 'character', id: 'butler' }, reader: 'character:butler', specs: CHARACTER_SECTIONS });
    const csections = await collectSections(cdeps);
    assert.ok(!csections.some((s) => s.key === 'player_board'));
    assert.ok(!csections.some((s) => s.text.includes('player-note-') || s.text.includes('clue board')));
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
