// 末班车 · 序章 (templates/last-train-prologue{,-zh,-jp,-ko}; the design notes): the first-run prologue
// plays its six beats through the real action layer and the server's declared actions — the same code the
// routes run — on a scratch copy of every edition:
//   - the notebook drops after the FIRST turn end (POST /api/turn-end → experience.turnEnd → state trigger),
//     by command, not by the model;
//   - taking it puts it in the bag; asking the student is one search roll; any band opens the door to car 5;
//   - with no roll at all the door still appears by turn 8 (and never twice);
//   - walking into car 5 lands the one ending, `found-her`, within eight turns; nothing runs afterwards;
//   - the prologue never names 钟怀礼 (or his id) anywhere, and leaves the full last-train untouched.
// Runs against built dist (`pnpm --filter @airp/server build`).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { skipUnlessShipped } from '../../../tools/shipped-worlds.mjs';
import { fileURLToPath } from 'node:url';
import { LocalWorldStore, createActionService, reachedEnding, clockLeft, runTurnEnd, worldExperienceOf, openingRepliesFor, isGuestTrialWorldId, GUEST_PROLOGUE_WORLDS } from '@airp/shared';
import { runDeclaredChoice, runDeclaredRoll } from '../dist/engine/declared-actions.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const EDITIONS = ['last-train-prologue', 'last-train-prologue-zh', 'last-train-prologue-jp', 'last-train-prologue-ko'];
const SEAT = 'world/seated-car';
const NOTEBOOK = `${SEAT}/su-he-notebook.md`;
const DOOR = `${SEAT}/freight-door.md`;
const FREIGHT = 'world/freight-car';
const exists = (p) => fs.access(p).then(() => true, () => false);

async function play(t, edition) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prologue-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(REPO, 'templates', edition), root, { recursive: true });
  const store = new LocalWorldStore(root);
  let n = 0;
  const svc = (actor = { type: 'player' }) => createActionService(store, actor, { turn: `req:prologue-${++n}` });
  const turnEnd = () => runTurnEnd(svc().ctx);
  const has = (rel) => exists(path.join(root, rel));
  return { root, store, svc, turnEnd, has };
}

for (const edition of EDITIONS) {
  test(`${edition}: a prologue experience — one ending, a four-step clock, three replies, hidden from the lobby`, async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(REPO, 'templates', edition, 'world.json'), 'utf8'));
    const xp = worldExperienceOf(manifest);
    assert.deepEqual(xp, { kind: 'prologue', next: 'last-train', maxTurns: 10, turnEnd: 'turn-end' });
    assert.equal(manifest.mode, 'closed');
    assert.deepEqual(manifest.endings.map((e) => e.id), ['found-her'], 'no failure ending in the prologue');
    assert.equal(manifest.clock.start, 4);
    assert.equal(manifest.intro.hidden, true);
    assert.equal(manifest.opening.greeter, 'xia-cheng');
    assert.equal(openingRepliesFor(manifest.opening.replies, 'en', manifest.locale).length, 3);
    assert.ok(isGuestTrialWorldId(edition) && GUEST_PROLOGUE_WORLDS.includes(edition), 'a guest may play it');
  });

  test(`${edition}: the six beats — reply, notebook by command, take, one roll, the door, the ending — in ≤ 8 turns`, async (t) => {
    const { store, svc, turnEnd, has } = await play(t, edition);
    await svc().enterLayer({ layer: SEAT });
    assert.equal(await has(NOTEBOOK), false, 'nothing dropped before the first answer');
    // Beat 1 → 2: the first answer settles; the engine drops the notebook (not the model).
    const first = await turnEnd();
    assert.equal(first.details.turnEnd.ran, true);
    assert.ok(await has(NOTEBOOK), 'the notebook dropped after turn 1');
    assert.equal(await has(DOOR), false);
    // Beat 3: take it (the card's own option) → the bag.
    const take = await runDeclaredChoice(svc(), NOTEBOOK, 'take');
    assert.ok(take, 'the notebook carries a declared take');
    assert.ok(await has('player/su-he-notebook.md'));
    await turnEnd();
    // Beat 4: ask the student — the README's search makes the dice card; one roll (a plain success).
    const ask = await runDeclaredChoice(svc(), `${SEAT}/README.md`, 'ask-student');
    assert.ok(ask);
    const dice = `${SEAT}/search-scene.md`;
    assert.ok(await has(dice));
    const before = await clockLeft(store);
    await runDeclaredRoll(svc({ type: 'god' }), dice, 30);
    assert.equal(await clockLeft(store), before - 1, 'a roll moves the clock one step');
    assert.ok(await has(`${SEAT}/witness-account.md`), 'a success hands over the testimony');
    // Beat 5: the door appears the moment the roll lands.
    assert.ok(await has(DOOR), 'the door to car 5 appeared after the roll');
    await turnEnd();
    // Beat 6: through the door → the ending.
    const go = await runDeclaredChoice(svc(), DOOR, 'go');
    assert.equal(go.details.action.kind, 'enter', 'the door says where it leads; the page walks through it');
    assert.equal(go.details.action.target, FREIGHT);
    await svc().enterLayer({ layer: FREIGHT });
    assert.equal((await reachedEnding(store))?.id, 'found-her');
    const after = await turnEnd();
    assert.equal(after.details.turnEnd.ran, false, 'nothing runs after the ending');
  });

  test(`${edition}: a bad roll still opens the door (half a clue, more time)`, async (t) => {
    const { store, svc, turnEnd, has } = await play(t, edition);
    await svc().enterLayer({ layer: SEAT });
    await turnEnd();
    await runDeclaredChoice(svc(), `${SEAT}/README.md`, 'ask-student');
    await runDeclaredRoll(svc({ type: 'god' }), `${SEAT}/search-scene.md`, 98);
    assert.ok(await has(`${SEAT}/witness-half.md`));
    assert.ok(await has(DOOR));
    assert.ok((await clockLeft(store)) >= 1, 'the prologue clock never runs out on one roll');
    await svc().enterLayer({ layer: FREIGHT });
    assert.equal((await reachedEnding(store))?.id, 'found-her');
  });

  test(`${edition}: no roll at all — the door appears by turn 8, once`, async (t) => {
    const { store, svc, turnEnd, has } = await play(t, edition);
    await svc().enterLayer({ layer: SEAT });
    for (let turn = 1; turn <= 7; turn += 1) {
      await turnEnd();
      assert.equal(await has(DOOR), false, `no door yet after turn ${turn}`);
    }
    const eighth = await turnEnd();
    assert.ok(await has(DOOR), 'the door by turn 8');
    assert.ok(eighth.details.turnEnd.triggers.some((f) => f.id === 'door'));
    const ninth = await turnEnd();
    assert.ok(!ninth.details.turnEnd.triggers.some((f) => f.id === 'door'), 'the door fires once');
    await svc().enterLayer({ layer: FREIGHT });
    assert.equal((await reachedEnding(store))?.id, 'found-her');
  });

  test(`${edition}: keeps the full world's mystery — no name of the culprit anywhere`, async () => {
    const dir = path.join(REPO, 'templates', edition);
    const walk = async (rel = '') => {
      const out = [];
      for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) out.push(...await walk(r));
        else if (/\.(md|json|yaml)$/.test(e.name)) out.push(r);
      }
      return out;
    };
    for (const f of await walk()) {
      const text = await fs.readFile(path.join(dir, f), 'utf8');
      assert.doesNotMatch(text, /钟怀礼|鐘懐礼|zhong-huaili|Zhong Huaili|중화이리|종화이리/i, `${edition}/${f} names the culprit`);
    }
  });
}

test('the prologue shares the full world\'s pictures byte for byte (a bundle stores each once)', async () => {
  const dir = path.join(REPO, 'templates/last-train-prologue-zh/assets');
  for (const sub of await fs.readdir(dir)) {
    for (const f of await fs.readdir(path.join(dir, sub))) {
      const [a, b] = await Promise.all([fs.readFile(path.join(dir, sub, f)), fs.readFile(path.join(REPO, 'templates/last-train-zh/assets', sub, f))]);
      assert.ok(a.equals(b), `${sub}/${f}`);
    }
  }
});

test('a world without experience.turnEnd: turn-end runs nothing', { skip: skipUnlessShipped('last-witness-zh') }, async (t) => {
  // (The full 末班车 now counts its beats by a `story` turn-end — 最后的证人 has none.)
  const { svc, turnEnd } = await play(t, 'last-witness-zh');
  await svc().enterLayer({ layer: 'map' });
  const r = await turnEnd();
  assert.equal(r.details.turnEnd.ran, false);
});
