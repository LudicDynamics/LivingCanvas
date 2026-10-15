// 末班车 · character tick — the contract, in all four editions.
//
//   1. One tick block, the same shape in every edition: 夏澄 (companion) only chats (speak / invite, her nudge
//      points at car 2's two exits); 周子航, 老贺, 钟怀礼 each have one harmless page-scoped intent (look at /
//      move to a card — a status flag, nothing taken, moved or rewritten) plus a line; 周子航 never invites
//      (talking to him is not a smooth default — the roll is the way to his account). The prologue has none.
//   2. Pace: no busier than the v2 defaults.
//   3. No spoilers: the written labels and sample lines carry none of the truth words, and every sample line
//      passes its own person's checks (else the stub model would say nothing).
//   4. Ticks on (every intent lands) / off / a model (the stub: picks the first option, says a voice line) /
//      a garbage model: both endings stay reachable, key evidence is untouched, a hint and a person's own
//      line never share a beat, and the lines keep their distance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LocalWorldStore,
  createActionService,
  markTickIntentSeen,
  reachedEnding,
  clockLeft,
  readTickState,
  loadTickWorld,
  runTurnEnd,
  parseFrontmatter,
  parseTickPromptBlock,
  parseTickPromptFile,
  resolveTickPrompt,
  tickTextDenied,
  tickTextInLanguage,
  tickNamesOk,
  TICK_PACE_DEFAULTS,
  TICK_GLOBAL_DENY,
} from '../packages/shared/dist/index.js';
import { runDeclaredRoll } from '../apps/server/dist/engine/declared-actions.js';
import { stubTickAnswer } from '../apps/server/dist/tick-model.js';

const EDITIONS = ['last-train', 'last-train-jp', 'last-train-zh', 'last-train-ko'];
const PROLOGUES = ['last-train-prologue', 'last-train-prologue-jp', 'last-train-prologue-zh', 'last-train-prologue-ko'];
const templateOf = (edition) => fileURLToPath(new URL(`../templates/${edition}`, import.meta.url));
const GOD = { type: 'god' };
const KEY_CARDS = ['world/seated-car/su-he-notebook.md', 'world/dining-car/two-teacups.md', 'world/dining-car/tea-bill.md', 'world/sleeper/grey-coat.md'];
const RADIO = 'world/cab/02-radio-report.md';
const PROMPT_FILE = { 'xia-cheng': 'characters/xia-cheng/tick.md', 'zhong-huaili': 'characters/zhong-huaili/tick.md', 'zhou-zihang': 'world/seated-car/zhou-zihang.md', 'lao-he': 'world/dining-car/lao-he.md' };

const stubModel = () => ({ tier: 'registered', answer: async (req) => ({ content: stubTickAnswer(req), credits: 0.5 }) });
const garbageModel = () => ({ tier: 'registered', answer: async () => ({ content: '<<not json>>', credits: 0.5 }) });

const json = async (edition) => JSON.parse(await fs.readFile(path.join(templateOf(edition), 'world.json'), 'utf8'));
async function promptOf(edition, actor) {
  const text = await fs.readFile(path.join(templateOf(edition), PROMPT_FILE[actor]), 'utf8');
  const { prompt, errors } = actor === 'zhou-zihang' || actor === 'lao-he' ? parseTickPromptBlock(parseFrontmatter(text).frontmatter?.tick) : parseTickPromptFile(text);
  assert.deepEqual(errors, [], `${edition} ${actor}`);
  return resolveTickPrompt(prompt, (await json(edition)).locale);
}
/** Ids, verbs, targets, runs, counters, suggest — everything but words. */
const shapeOf = (tick) => ({
  ...Object.fromEntries(['every', 'window', 'grace', 'budget', 'landCap', 'chooser', 'wip', 'pace'].map((k) => [k, tick[k]])),
  deny: tick.deny.length,
  actors: Object.fromEntries(Object.entries(tick.actors).map(([id, a]) => [id, { card: a.card, moves: a.moves.map(({ label, ...m }) => m) }])),
});

test('末班车 prologue: no character tick', async () => {
  for (const p of PROLOGUES) assert.equal((await json(p)).tick, undefined, p);
});

for (const edition of EDITIONS) {
  test(`${edition}: one tick block, the same shape as the Chinese edition; companion chats only; intents harmless`, async () => {
    const m = await json(edition);
    const tick = m.tick;
    assert.deepEqual(shapeOf(tick), shapeOf((await json('last-train-zh')).tick));
    assert.deepEqual(Object.keys(tick.actors).sort(), ['lao-he', 'xia-cheng', 'zhong-huaili', 'zhou-zihang']);
    // 夏澄: speak / invite only — no intent of her own; the nudge points at car 2's two exits.
    assert.ok(tick.actors['xia-cheng'].moves.every((mv) => mv.verb === 'speak' || mv.verb === 'invite'));
    assert.deepEqual(tick.actors['xia-cheng'].moves.find((mv) => mv.id === 'nudge-on').suggest.map((s) => s.option), ['go-sleeper', 'go-train']);
    // 周子航 never comes over to chat: the roll is how his account is got.
    assert.ok(!tick.actors['zhou-zihang'].moves.some((mv) => mv.verb === 'invite'));
    for (const [id, actor] of Object.entries(tick.actors)) {
      const intents = actor.moves.filter((mv) => mv.run);
      assert.ok(intents.length <= 1, `${id}: at most one intent`);
      for (const mv of intents) {
        assert.ok(['approach', 'mark'].includes(mv.verb), `${id}/${mv.id}: look at / move to a card only`);
        assert.ok(!mv.counter.includes('take') && !mv.counter.includes('enter'));
        const cmd = await fs.readFile(path.join(templateOf(edition), 'command', `${mv.run}.yaml`), 'utf8');
        const actions = [...cmd.matchAll(/^- action: ([a-z_]+)/gm)].map((x) => x[1]);
        assert.deepEqual(actions, ['set_status'], `${mv.run}: a flag, never a take / move / rewrite`);
        assert.ok(!KEY_CARDS.filter((k) => k !== mv.target).some((k) => cmd.includes(k)), `${mv.run} touches no other key card`);
        assert.ok(!cmd.includes(`path: ${mv.target}`) || mv.target === 'world/sleeper/grey-coat.md', mv.run);
      }
    }
    // 钟怀礼 (the culprit) is a registered character: his prompt is fenced in characters/<id>/tick.md.
    assert.equal(tick.actors['zhong-huaili'].card, undefined);
    assert.ok(m.characters.some((c) => c.id === 'zhong-huaili'));
  });

  test(`${edition}: pace no busier than the v2 defaults`, async () => {
    const { tick } = await json(edition);
    assert.ok(tick.every >= 4 && tick.budget <= 6 && tick.landCap <= 4);
    assert.ok(tick.pace.pageGrace >= TICK_PACE_DEFAULTS.pageGrace);
    assert.ok(tick.pace.lineGap >= TICK_PACE_DEFAULTS.lineGap);
    assert.ok(tick.pace.cooldown >= TICK_PACE_DEFAULTS.cooldown);
    assert.ok(tick.pace.chatter <= TICK_PACE_DEFAULTS.chatter);
    assert.ok(tick.pace.chatterChance <= TICK_PACE_DEFAULTS.chatterChance);
  });

  test(`${edition}: no spoilers in the written words; every sample line passes its own person's checks`, async () => {
    const m = await json(edition);
    // The truth words: the world's deny list (each person's own never_say is checked per line below).
    const truth = m.tick.deny;
    const labels = Object.values(m.tick.actors).flatMap((a) => a.moves.flatMap((mv) => (mv.label ? Object.values(mv.label) : [])));
    for (const text of labels) {
      for (const w of m.tick.deny) assert.ok(!text.toLowerCase().includes(w.toLowerCase()), `${text} ⊃ ${w}`);
      assert.ok(!TICK_GLOBAL_DENY.some((re) => re.test(text)), text);
    }
    for (const actor of Object.keys(PROMPT_FILE)) {
      const p = await promptOf(edition, actor);
      assert.ok(p.voice.length >= 2, actor);
      for (const v of p.voice) {
        assert.ok(tickTextInLanguage(v, m.locale), `${actor}: ${v}`);
        assert.equal(tickTextDenied(v, { prompt: p, deny: m.tick.deny }), false, `${actor}: «${v}» trips its own checks`);
        assert.ok(tickNamesOk(v, { allowedNames: [], knownNames: [], peopleNames: [], locale: m.locale }), `${actor}: «${v}» names someone`);
        for (const w of truth) assert.ok(!v.toLowerCase().includes(w.toLowerCase()), `${actor}: «${v}» ⊃ ${w}`);
      }
      assert.ok(p.neverSay.length > 0, `${actor}: never_say`);
    }
    // 周子航 never says his account unprompted.
    const zhou = await promptOf(edition, 'zhou-zihang');
    assert.ok(zhou.neverSay.length >= 4);
  });

  async function play(mode) {
    // A fixed folder name: the run's seed falls back to it, so every run of this test draws the same beats.
    const root = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'lt-tick-')), 'run');
    await fs.cp(templateOf(edition), root, { recursive: true });
    const store = new LocalWorldStore(root);
    let n = 0;
    const svc = (actor = { type: 'player' }) => createActionService(store, actor, { turn: `req:ltt-${++n}` });
    await svc().setFollowing({ character: 'xia-cheng', following: true });
    const model = mode === 'model' ? stubModel() : mode === 'garbage' ? garbageModel() : null;
    const beats = [];
    const beat = async (page, count) => {
      for (let i = 0; i < count; i++) {
        const r = await runTurnEnd(svc().ctx, { tick: { page, mode: mode === 'off' ? 'off' : 'standard', model } });
        const { tick, hint } = r.details;
        beats.push({ page, tick, hint });
        if (tick.issued) await markTickIntentSeen(svc().ctx, tick.issued);
      }
    };
    const walk = async () => {
      await beat('world/seated-car', 6);
      await beat('map', 3);
      await beat('world/sleeper', 7);
      await beat('world/dining-car', 7);
      await beat('world/cab', 3);
    };
    const bodies = async () => Promise.all(KEY_CARDS.map(async (k) => (await fs.readFile(path.join(root, k), 'utf8')).replace(/^---[\s\S]*?---\n/, '')));
    const close = () => store.close();
    return { root, store, svc, beat, walk, beats, bodies, close };
  }

  for (const mode of ['land', 'off', 'model', 'garbage']) {
    test(`${edition} [${mode}]: both endings reachable; key evidence untouched; a hint and a person's line never share a beat`, async () => {
      const m = await json(edition);
      // found: walk the train with ticks, then the evidence and the radio.
      const a = await play(mode);
      try {
        const before = await a.bodies();
        await a.walk();
        assert.deepEqual(await a.bodies(), before, 'the key cards read the same');
        for (const k of KEY_CARDS) assert.equal(await a.store.statKind(k), 'file', k);
        const s = await readTickState(a.store, await loadTickWorld(a.store));
        assert.ok(s.issued <= m.tick.budget && s.landed <= m.tick.landCap);
        assert.ok(s.log.every((e) => !e.error), JSON.stringify(s.log.filter((e) => e.error)));
        if (mode === 'off') assert.equal(s.log.length, 0);
        if (mode === 'land' || mode === 'garbage') assert.ok(s.log.every((e) => e.result !== 'said' && !e.words), 'no model, no words');
        // Hints win when due; a person's own line waits — never both in one beat (a nudge's own slips excepted).
        for (const b of a.beats) assert.ok(!(b.hint && !b.hint.id.startsWith('tick:') && b.tick.spoke), `${b.page}: hint ${b.hint?.id} and a tick line in one beat`);
        if (mode === 'model') {
          const said = s.log.filter((e) => e.result === 'said');
          assert.ok(said.length <= m.tick.pace.chatter, 'chatter budget');
          const lineBeats = s.lines.map((l) => l.beat);
          for (let i = 1; i < lineBeats.length; i++) assert.ok(lineBeats[i] - lineBeats[i - 1] >= 2, `lines back to back: ${lineBeats}`);
          const words = s.log.flatMap((e) => (e.words ? [e.words.say, e.words.invite, e.words.note?.body].filter(Boolean) : []));
          assert.ok(words.length > 0, 'the people spoke');
          for (const w of words) for (const d of m.tick.deny) assert.ok(!w.includes(d), w);
          // Only people on the page speak: 钟怀礼 only in the sleeper, 老贺 only in the dining car.
          for (const e of s.log) {
            if (e.actor === 'zhong-huaili') assert.equal(e.page, 'world/sleeper');
            if (e.actor === 'lao-he') assert.equal(e.page, 'world/dining-car');
            if (e.actor === 'zhou-zihang') assert.equal(e.page, 'world/seated-car');
          }
        }
        for (const name of ['su-he-testimony.md', 'logbook-page.md']) {
          await a.store.writeFile(`player/${name}`, `---\nname: ${name}\ntype: note\nportable: true\n---\n\nEvidence.\n`);
        }
        await a.beat('world/cab', 1);
        await a.svc(GOD).chooseOption({ path: RADIO, choice: 'report' });
        assert.equal((await reachedEnding(a.store))?.id, 'found');
      } finally {
        a.close();
      }
      // departed: the same beats, then every roll misses.
      const b = await play(mode);
      try {
        await b.walk();
        for (const card of ['world/seated-car', 'world/sleeper', 'world/dining-car']) {
          if (await reachedEnding(b.store)) break;
          await b.svc(GOD).searchPlace({ layer: card, spot: 'scene' });
          await runDeclaredRoll(b.svc(GOD), `${card}/search-scene.md`, 98);
          await b.beat(card, 1);
        }
        if (!(await reachedEnding(b.store))) await runDeclaredRoll(b.svc(GOD), 'world/freight-car/04-confront-dice.md', 80);
        while (!(await reachedEnding(b.store)) && (await clockLeft(b.store)) > 0) await b.svc(GOD).chooseOption({ path: RADIO, choice: 'report' });
        assert.equal((await reachedEnding(b.store))?.id, 'departed');
      } finally {
        b.close();
      }
    });
  }

  test(`${edition}: the testimony is still the roll's, with ticks on — any tier, and the exits follow`, async () => {
    for (const [roll, file] of [[5, 'witness-account.md'], [30, 'witness-account.md'], [80, 'witness-half.md'], [98, 'witness-half.md']]) {
      const h = await play('model');
      try {
        await h.beat('world/seated-car', 3);
        await h.svc(GOD).searchPlace({ layer: 'world/seated-car', spot: 'scene' });
        await runDeclaredRoll(h.svc(GOD), 'world/seated-car/search-scene.md', roll);
        assert.equal(await h.store.statKind(`world/seated-car/${file}`), 'file', `d100 ${roll}`);
        const fm = parseFrontmatter(await h.store.readFile('world/seated-car/README.md')).frontmatter;
        assert.equal(fm.status.data.exits, 'open');
      } finally {
        h.close();
      }
    }
  });
}
