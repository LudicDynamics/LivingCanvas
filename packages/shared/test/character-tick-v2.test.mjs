/**
 * Character tick v2: the people's own tick prompts and words.
 *
 * Pure: the prompt block (localized fields, files), the strict answer check (closed menu, garbage,
 * lengths, one line, language, never_say, the four-language confession / accusation patterns, the
 * proper-noun allowlist, notes about oneself only), credits, and the pacing rules (page grace, line
 * gap, cooldown, chatter budget, never the beat before an intent, never while one is pending).
 *
 * Engine, over a real 「最后的证人」 save with a fake model: the model's pick among the person's own
 * legal moves and their line on the intent; chatter (speak / invite / note into its slot); the claim
 * marking in `page_moves` and the NPC brief; a failing / garbage / absent model changes nothing about
 * the v1 rules; the per-run credit cap; only the page the player looks at; the prefetch key; the
 * fence (tick.md withheld from everyone, `tick` stripped from projected cards); and the pacing over a
 * long run (≤ one line per 2.5 beats, never back to back, per-person cooldown, nothing in a page's
 * first two beats).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { skipUnlessShipped } from '../../../tools/shipped-worlds.mjs';
// The engine tests play 最后的证人 (every edition for the shipped prompts); skipped where this copy does not carry it.
const LAST_WITNESS = skipUnlessShipped('last-witness', 'last-witness-zh', 'last-witness-jp', 'last-witness-ko');
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  LocalWorldStore,
  createActionService,
  prepareRun,
  parseWorldTick,
  parseTickPromptBlock,
  parseTickPromptFile,
  resolveTickPrompt,
  parseTickModelAnswer,
  buildTickModelRequest,
  tickCallCredits,
  tickTextInLanguage,
  freshTickState,
  planTickChatter,
  recordTickLine,
  runTickBeat,
  markTickIntentSeen,
  readTickState,
  loadTickWorld,
  readTickPrompt,
  tickPageMoves,
  tickNotesForNpc,
  planTickPrefetch,
  characterViewOf,
  projectCardForCharacter,
  parseFrontmatter,
  TICK_PACE_DEFAULTS,
} from '../dist/index.js';

const templateOf = (edition) => fileURLToPath(new URL(`../../../templates/${edition}`, import.meta.url));

/* ─────────────────────────── the prompt block ─────────────────────────── */

test('tick prompt: strict block, localized fields, defaults; tick.md body is the prompt', () => {
  const { prompt, errors } = parseTickPromptBlock({ goal: { en: 'Leave', 'zh-CN': '离开' }, temper: 'calm', voice: ['Hm.'], never_say: ['ledger'] });
  assert.deepEqual(errors, []);
  const zh = resolveTickPrompt(prompt, 'zh-CN');
  assert.equal(zh.goal, '离开');
  assert.equal(resolveTickPrompt(prompt, 'ja').goal, 'Leave', 'missing language → en');
  assert.deepEqual(zh.may, ['say'], 'may defaults to say');
  assert.ok(parseTickPromptBlock({ goal: 'x', temper: 'y', teleport: true }).errors.length > 0, 'unknown key refused');
  assert.ok(parseTickPromptBlock({ goal: 'x', temper: 'y', may: ['shout'] }).errors.length > 0);
  assert.ok(parseTickPromptBlock({ goal: 'x', temper: 'y', prompt: 'x'.repeat(601) }).errors.length > 0, '≤ 600 characters');
  const file = parseTickPromptFile('---\ngoal: Watch\ntemper: Quiet\nmay: [say]\n---\n\nYou help.\n');
  assert.equal(resolveTickPrompt(file.prompt, 'en').prompt, 'You help.');
});

test('world.json tick v2: chatter moves need no run / counter; intents still do; pace and caps default', () => {
  const { tick, errors } = parseWorldTick({ actors: { ross: { card: 'world/ross.md', goal: 'g', moves: [{ id: 'say', verb: 'speak' }, { id: 'note', verb: 'note', slot: 'world/tick-note-ross.md' }] } } });
  assert.deepEqual(errors, []);
  assert.deepEqual(tick.actors.ross.moves, []);
  assert.deepEqual(tick.actors.ross.chatter.map((m) => m.id), ['say', 'note']);
  assert.deepEqual(tick.pace, TICK_PACE_DEFAULTS);
  assert.deepEqual(tick.modelCap, { credits: 20, guestCredits: 8 });
  assert.deepEqual(TICK_PACE_DEFAULTS, { pageGrace: 2, lineGap: 3, cooldown: 6, chatter: 4, chatterChance: 0.35 });
  for (const bad of [
    { id: 'say', verb: 'speak', counter: ['talk'] },
    { id: 'x', verb: 'mark', target: 'world/study' },
    { id: 'n', verb: 'note', slot: 'player/x.md' },
    { id: 's', verb: 'speak', slot: 'world/x.md' },
  ]) assert.ok(parseWorldTick({ actors: { ross: { goal: 'g', moves: [bad] } } }).errors.length > 0, JSON.stringify(bad));
});

/* ─────────────────────────── the answer check ─────────────────────────── */

const PROMPT = resolveTickPrompt({ goal: '别让账本的事传出去', temper: '热络', may: ['say', 'invite', 'note'], voice: ['哎呀。'], never_say: ['账本', '四千'] }, 'zh-CN');
const plan = (over = {}) => ({
  kind: 'intent', beat: 5, locale: 'zh-CN', actor: 'ross', name: '罗斯', about: '', prompt: PROMPT, page: '', recent: [],
  options: [{ id: 'visit-study', verb: 'mark', about: '书房', label: '罗斯 → 书房的门' }, { id: 'look-board', verb: 'note', about: '软木板', label: '罗斯 → 软木板' }],
  allow: { say: true, note: false, invite: false },
  allowedNames: ['罗斯', '伊芙', '书房', '软木板'], knownNames: ['罗斯', '伊芙', '小春', '书房', '马厩里的信', '奥古斯特'], peopleNames: ['罗斯', '伊芙', '小春'],
  deny: [], ...over,
});
const answer = (o) => JSON.stringify(o);

test('answer: a pick outside the offered list, or garbage, is void (the rules decide)', () => {
  assert.equal(parseTickModelAnswer(answer({ move: 'tamper-hall', say: '哎呀。' }), plan()), null);
  assert.equal(parseTickModelAnswer('not json at all', plan()), null);
  assert.equal(parseTickModelAnswer('{"say": "x"}', plan()), null);
  assert.equal(parseTickModelAnswer(42, plan()), null);
  const ok = parseTickModelAnswer('```json\n{"move":"look-board","say":"「我去透口气。」","mood":"sweat"}\n```', plan());
  assert.deepEqual(ok.words, { say: '我去透口气。', mood: 'sweat' });
  assert.equal(ok.move, 'look-board');
});

test('answer: a bad text is dropped, the pick stays', () => {
  const drop = (say, over) => {
    const r = parseTickModelAnswer(answer({ move: 'visit-study', say }), plan(over));
    assert.ok(r, say);
    assert.equal(r.words.say, undefined, say);
    return r.dropped.join(' ');
  };
  assert.match(drop('哎'.repeat(41)), /longer/);
  assert.match(drop('第一行\n第二行'), /line/);
  assert.match(drop('看 https://x.com'), /link/);
  assert.match(drop('**真的**'), /markup/);
  assert.match(drop('I just need some air.'), /language/);
  assert.match(drop('账本不是我的。'), /denied/);
  assert.match(drop('人是我杀的。'), /denied/, 'confession');
  assert.match(drop('凶手就是伊芙。'), /denied/, 'accusation');
  assert.match(drop('小春刚才不在。'), /name/, 'a person not on this page');
  assert.match(drop('马厩里的信呢？'), /name/, 'a card not on this page');
  // allowed: people and cards here
  assert.equal(parseTickModelAnswer(answer({ move: 'visit-study', say: '伊芙，书房冷不冷？' }), plan()).words.say, '伊芙，书房冷不冷？');
  // not allowed at all on this call
  assert.equal(parseTickModelAnswer(answer({ move: 'visit-study', say: '哎呀。' }), plan({ allow: { say: false, note: false, invite: false } })).words.say, undefined);
});

test('answer: confession / accusation patterns in all four languages', () => {
  const p = (locale, names = []) => plan({ locale, prompt: { ...PROMPT, neverSay: [] }, allowedNames: names, knownNames: [], peopleNames: [] });
  for (const [locale, text] of [['en', 'I killed him, alright?'], ['en', 'The killer is Eve.'], ['ja', '私が殺したんです。'], ['ja', '犯人はあの人です。'], ['ko', '제가 죽였어요.'], ['ko', '범인은 저 사람이에요.'], ['zh-CN', '是我干的。']]) {
    const r = parseTickModelAnswer(answer({ move: 'visit-study', say: text }), p(locale, ['Eve']));
    assert.equal(r.words.say, undefined, `${locale}: ${text}`);
  }
  assert.equal(parseTickModelAnswer(answer({ move: 'visit-study', say: 'Goodness, it is stuffy in here.' }), p('en')).words.say, 'Goodness, it is stuffy in here.');
  assert.equal(parseTickModelAnswer(answer({ move: 'visit-study', say: 'I saw Koharu outside.' }), p('en')).words.say, undefined, 'English: an unknown capitalised name mid-sentence');
});

test('answer: invite and note only with their move; a note speaks of its writer only', () => {
  const chat = plan({ kind: 'chatter', options: [{ id: 'invite', verb: 'invite', about: '', label: '' }, { id: 'note', verb: 'note', about: '', label: '' }], allow: { say: false, note: true, invite: true } });
  assert.deepEqual(parseTickModelAnswer(answer({ move: 'invite', invite: '督察，能单独说两句吗？' }), chat).words, { invite: '督察，能单独说两句吗？' });
  assert.deepEqual(parseTickModelAnswer(answer({ move: 'note', note: { title: '致督察', body: '我只想早点下山，我什么都没碰。' } }), chat).words, { note: { title: '致督察', body: '我只想早点下山，我什么都没碰。' } });
  assert.equal(parseTickModelAnswer(answer({ move: 'note', note: { title: '', body: '伊芙十点半不在房里。' } }), chat).words.note, undefined, 'a note naming someone else');
  assert.equal(parseTickModelAnswer(answer({ move: 'note', note: { title: '', body: '罗斯什么都没碰。' } }), chat).words.note.body, '罗斯什么都没碰。', 'its own name is fine');
  assert.equal(parseTickModelAnswer(answer({ move: 'invite', note: { body: '我什么都没碰。' } }), chat).words.note, undefined, 'a note needs the note move');
});

test('language check per edition, and credits from usage', () => {
  assert.ok(tickTextInLanguage('哎呀。', 'zh-CN') && !tickTextInLanguage('ああ。', 'zh-CN'));
  assert.ok(tickTextInLanguage('部屋にいました。', 'ja') && tickTextInLanguage('방에 있었어요.', 'ko') && !tickTextInLanguage('방', 'ja'));
  assert.ok(tickTextInLanguage('Hm.', 'en') && !tickTextInLanguage('Hm 嗯', 'en'));
  assert.equal(tickCallCredits({ prompt_tokens: 1600, completion_tokens: 120 }), 1.2);
  assert.equal(tickCallCredits(null), 1.5);
});

test('the request carries only this person\'s prompt, the offered ids and the language', () => {
  const req = buildTickModelRequest('seed', plan());
  assert.match(req.key, /^seed:5:intent:ross:visit-study,look-board$/);
  assert.match(req.system, /Simplified Chinese/);
  assert.match(req.system, /账本, 四千/);
  assert.match(req.user, /- visit-study \[mark → 书房\]/);
  assert.match(req.user, /别让账本的事传出去/);
});

/* ─────────────────────────── pacing ─────────────────────────── */

const TICK = parseWorldTick({
  every: 4, grace: 1,
  actors: {
    ross: { card: 'world/ross.md', goal: 'g', moves: [{ id: 'say', verb: 'speak' }] },
    eve: { card: 'world/eve.md', goal: 'g', moves: [{ id: 'say', verb: 'speak' }, { id: 'invite', verb: 'invite' }] },
  },
}).tick;
const ALWAYS = { ...TICK, pace: { ...TICK.pace, chatterChance: 1 } };
const movesOf = (id) => ALWAYS.actors[id].chatter;
const at = (over) => ({ ...freshTickState('s', ['ross', 'eve']), beat: 10, page: 'map', pageBeats: 5, quiet: 1, ...over });

test('chatter pacing: page grace, line gap, cooldown, budget, before an intent, pending, chance', () => {
  const both = { present: ['ross', 'eve'], movesOf };
  assert.ok(planTickChatter(at(), ALWAYS, both));
  assert.equal(planTickChatter(at({ pageBeats: 2 }), ALWAYS, both), null, 'first two beats on a page');
  assert.equal(planTickChatter(at({ beat: 1 }), ALWAYS, both), null, 'grace');
  assert.equal(planTickChatter(at({ lines: [{ beat: 8, actor: 'ross' }] }), ALWAYS, both), null, 'line gap 3');
  const cooled = planTickChatter(at({ lines: [{ beat: 6, actor: 'ross' }], chatterTurn: 0, order: ['ross', 'eve'] }), ALWAYS, both);
  assert.equal(cooled.actor, 'eve', 'ross is in his 6-beat cooldown; eve speaks');
  assert.equal(planTickChatter(at({ chatter: 4 }), ALWAYS, both), null, 'chatter budget');
  assert.equal(planTickChatter(at({ quiet: 3 }), ALWAYS, both), null, 'the beat before an intent is due');
  assert.ok(planTickChatter(at({ quiet: 3, issued: 99 }), ALWAYS, both), 'no intents left: chatter may go on');
  assert.equal(planTickChatter(at({ pending: { id: 'x' } }), ALWAYS, both), null, 'never over a pending intent');
  assert.equal(planTickChatter(at(), ALWAYS, { present: [], movesOf }), null, 'nobody here');
  assert.equal(planTickChatter(at(), { ...TICK, pace: { ...TICK.pace, chatterChance: 0 } }, both), null, 'chance 0');
  // One open invite at a time.
  const open = at({ order: ['eve', 'ross'], chatterTurn: 0, log: [{ id: 'i', actor: 'eve', move: 'invite', verb: 'invite', target: 'characters/eve', page: 'map', beat: 9, result: 'said', words: { invite: '来' } }], lines: [{ beat: 2, actor: 'eve' }] });
  assert.deepEqual(planTickChatter(open, ALWAYS, { present: ['eve'], movesOf }).moves.map((m) => m.id), ['say']);
  const s = at();
  recordTickLine(s, 'ross');
  assert.deepEqual(s.lines, [{ beat: 10, actor: 'ross' }]);
});

/* ─────────────────────────── the fence ─────────────────────────── */

test('fence: characters/*/tick.md is withheld from every character, its owner too; projected cards lose `tick`', () => {
  assert.equal(characterViewOf('characters/hans/tick.md', 'hans').kind, 'withheld');
  assert.equal(characterViewOf('characters/hans/tick.md', 'watson').kind, 'withheld');
  assert.equal(characterViewOf('characters/hans/memory.md', 'hans').kind, 'projected');
  const card = '---\ntype: npc\nname: 罗斯\npersona: x\ntick:\n  goal: 秘密\n  temper: t\n  never_say: [账本]\n---\n\nbody\n';
  const seen = projectCardForCharacter(card);
  assert.doesNotMatch(seen, /tick|秘密|账本/);
});

/* ─────────────────────────── the engine, on 最后的证人 ─────────────────────────── */

const optionsOf = (req) => [...req.user.matchAll(/^- ([a-z0-9][a-z0-9-]*) \[([a-z]+)/gm)].map((m) => ({ id: m[1], verb: m[2] }));
const voiceOf = (req) => [...(/How you talk: (.+)$/m.exec(req.user)?.[1] ?? '').matchAll(/「([^」]+)」/g)].map((m) => m[1]);

/** A fake model: picks with `pick`, speaks the person's first voice sample (valid in any edition). */
function fakeModel({ pick = (o) => o[o.length - 1], garbage = false, fail = false, credits = 1.2, tier = 'registered' } = {}) {
  const calls = [];
  return {
    calls,
    tier,
    answer: async (req) => {
      calls.push(req);
      if (fail) return null;
      if (garbage) return { content: '{"move": "teleport", "say": 7', credits };
      const o = pick(optionsOf(req));
      const line = voiceOf(req)[0] ?? null;
      return {
        content: JSON.stringify({ move: o.id, say: o.verb === 'note' || o.verb === 'invite' ? null : line, invite: o.verb === 'invite' ? line : null, note: o.verb === 'note' ? { title: '', body: line } : null, mood: 'dots' }),
        credits,
      };
    },
  };
}

async function save(culprit = 'eve', edition = 'last-witness-zh', from = null) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tick2-'));
  // `from`: a copy of an already drawn save (same run seed → same rotation and draws).
  if (from) await fs.cp(from, root, { recursive: true });
  else {
    await fs.cp(templateOf(edition), root, { recursive: true });
    await prepareRun(root, { force: { culprit } });
  }
  const store = new LocalWorldStore(root);
  let n = 0;
  const ctx = () => createActionService(store, { type: 'player' }, { turn: `req:t2-${++n}` }).ctx;
  const state = async () => readTickState(store, await loadTickWorld(store));
  /** Beats on `page`; every intent is seen right away and left alone. Returns per-beat results. */
  const beats = async (count, opts = {}) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      const r = await runTickBeat(ctx(), { page: 'map', ...opts });
      if (r.issued) await markTickIntentSeen(ctx(), r.issued);
      out.push(r);
    }
    return out;
  };
  return { root, store, ctx, state, beats, close: () => { store.close(); return fs.rm(root, { recursive: true, force: true }); } };
}

test('engine: the model picks among the person\'s own legal moves and says a line; it is a claim everywhere', { skip: LAST_WITNESS }, async () => {
  const h = await save('ross');
  try {
    const model = fakeModel();
    const results = await h.beats(12, { model });
    const issued = results.find((r) => r.issued);
    assert.ok(issued, 'an intent was shown');
    const s = await h.state();
    const intents = [...s.log.filter((e) => e.result !== 'said'), ...(s.pending ? [s.pending] : [])];
    const withWords = intents.filter((e) => e.words?.say);
    assert.ok(withWords.length > 0, 'some intent carried the person\'s words');
    // Every intent call offered only that person's moves.
    for (const req of model.calls.filter((r) => r.key.includes(':intent:'))) {
      const actor = req.key.split(':')[3];
      const card = (await fs.readFile(path.join(h.root, 'world', `${actor}.md`), 'utf8'));
      const fm = parseFrontmatter(card).frontmatter;
      assert.ok(req.user.includes(fm.tick.goal), `${actor}: own goal`);
      for (const other of ['eve', 'ross', 'koharu'].filter((x) => x !== actor)) {
        const ofm = parseFrontmatter(await fs.readFile(path.join(h.root, 'world', `${other}.md`), 'utf8')).frontmatter;
        assert.ok(!req.user.includes(ofm.tick.goal) && !req.user.includes(ofm.tick.prompt), `${actor}'s call never carries ${other}'s prompt`);
      }
      assert.ok(!req.user.includes(fm.intent.slice(0, 40)), 'never the writer\'s truth');
    }
    const moves = await tickPageMoves(h.store, 'map');
    // The page summary keeps only the latest moves: a line, a note or an invite may be the one left — each is marked a claim.
    assert.match(moves, /«.+» \((their words — a claim|their claim, not a world fact|a claim)/);
    assert.match(moves, /claims, never truth/);
  } finally {
    await h.close();
  }
});

test('engine: a failing, garbage or absent model changes nothing about the v1 rules', { skip: LAST_WITNESS }, async () => {
  const drawn = await save('koharu');
  drawn.store.close();
  const trace = async (opts) => {
    const h = await save('koharu', 'last-witness-zh', drawn.root);
    try {
      await h.beats(30, opts);
      const s = await h.state();
      return s.log.filter((e) => e.result !== 'said').map((e) => `${e.id}:${e.result}`).join('|');
    } finally {
      await h.close();
    }
  };
  const rules = await trace({});
  assert.ok(rules.length > 0);
  assert.equal(await trace({ model: fakeModel({ fail: true }) }), rules, 'null answers');
  assert.equal(await trace({ model: fakeModel({ garbage: true }) }), rules, 'garbage answers');
  assert.equal(await trace({ model: fakeModel(), voices: false }), rules, 'voices off');
  // And with voices off the model is never asked.
  const off = fakeModel();
  const h = await save('koharu');
  try {
    await h.beats(10, { model: off, voices: false });
    assert.equal(off.calls.length, 0);
  } finally {
    await h.close();
    await fs.rm(drawn.root, { recursive: true, force: true });
  }
});

test('engine: chatter — said, invited, a note in its slot (a chalk the engine owns); the NPC brief carries their own words', { skip: LAST_WITNESS }, async () => {
  const h = await save('eve');
  try {
    // Prefer chatter kinds in turn: invite, note, else the first.
    let k = 0;
    const model = fakeModel({ pick: (o) => o.find((x) => x.verb === ['invite', 'note', 'speak'][k++ % 3]) ?? o[0] });
    await h.beats(40, { model });
    const s = await h.state();
    const said = s.log.filter((e) => e.result === 'said');
    assert.ok(said.length >= 1 && said.length <= TICK_PACE_DEFAULTS.chatter, `chatter within budget (${said.length})`);
    for (const e of said) assert.ok(e.words.say || e.words.invite || e.words.note);
    const note = said.find((e) => e.verb === 'note');
    if (note) {
      const slot = path.join(h.root, note.target);
      const fm = parseFrontmatter(await fs.readFile(slot, 'utf8')).frontmatter;
      assert.equal(fm.type, 'chalk');
      assert.deepEqual(fm.tick_note, { by: note.actor, claim: true });
    }
    const npcSaid = said.find((e) => e.actor !== 'hans' && e.page === 'map' && s.beat - e.beat <= 6);
    if (npcSaid) assert.ok((await tickNotesForNpc(h.store, `world/${npcSaid.actor}.md`)).some((l) => /unprompted/.test(l)));
  } finally {
    await h.close();
  }
});

test('engine: the per-run credit cap stops the calls (registered 20, guest 8)', { skip: LAST_WITNESS }, async () => {
  for (const [tier, cap] of [['registered', 20], ['guest', 8]]) {
    const h = await save('ross');
    try {
      const model = fakeModel({ tier, credits: 3 });
      // Beat until the cap is spent: how many beats that takes depends on the run seed's draws.
      let s = await h.state();
      for (let i = 0; i < 20 && s.model.credits < cap; i++) { await h.beats(20, { model }); s = await h.state(); }
      assert.ok(s.model.credits >= cap - 3 && s.model.credits <= cap + 3, `${tier}: ${s.model.credits}`);
      assert.equal(model.calls.length, s.model.calls);
      const before = model.calls.length;
      await h.beats(10, { model });
      assert.equal(model.calls.length, before, `${tier}: nothing more once the cap is reached`);
    } finally {
      await h.close();
    }
  }
});

test('engine: only the page the player looks at — off-page people never act or speak', { skip: LAST_WITNESS }, async () => {
  const h = await save('ross');
  try {
    const model = fakeModel();
    await h.beats(30, { model, page: 'world/study' });
    const s = await h.state();
    for (const e of [...s.log, ...(s.pending ? [s.pending] : [])]) assert.ok(!['eve', 'ross', 'koharu'].includes(e.actor), `${e.actor} acted off-page`);
    for (const req of model.calls) assert.ok(!/:(eve|ross|koharu)$/.test(req.key.split(':').slice(0, 4).join(':')), req.key);
  } finally {
    await h.close();
  }
});

test('pacing over a long run: ≤ one line per 2.5 beats, never back to back, cooldown per person, nothing in a page\'s first 2 beats', { skip: LAST_WITNESS }, async () => {
  for (const culprit of ['eve', 'ross', 'koharu']) {
    const h = await save(culprit);
    try {
      const model = fakeModel({ credits: 0.1 });
      const lines = new Map();
      const results = await h.beats(40, { model });
      const s = await h.state();
      for (const e of s.log) if (e.words && (e.words.say || e.words.invite || e.words.note)) lines.set(`${e.beat}`, e.actor);
      if (s.pending?.words?.say) lines.set(`${s.pending.beat}`, s.pending.actor);
      // Lines on intents are recorded at their issue beat (state.lines) — use that record, the source of truth.
      const all = s.lines;
      const beats = all.map((l) => l.beat);
      assert.ok(all.length >= 2, `${culprit}: people do speak (${all.length})`);
      assert.ok(all.length <= Math.ceil(40 / 2.5), `${culprit}: ${all.length} lines in 40 beats`);
      for (let i = 1; i < beats.length; i++) assert.ok(beats[i] - beats[i - 1] >= 2, `${culprit}: back to back at ${beats[i]}`);
      const lastBy = new Map();
      for (const l of all) {
        if (lastBy.has(l.actor)) assert.ok(l.beat - lastBy.get(l.actor) >= TICK_PACE_DEFAULTS.cooldown, `${culprit}: ${l.actor} cooldown`);
        lastBy.set(l.actor, l.beat);
      }
      assert.ok(beats.every((b) => b > 2), 'nothing in the first two beats');
      assert.equal(results.slice(0, 2).filter((r) => r.issued || r.said).length, 0);
    } finally {
      await h.close();
    }
  }
});

test('prefetch: the planned request has the key the beat then asks for', { skip: LAST_WITNESS }, async () => {
  const h = await save('eve');
  try {
    const model = fakeModel();
    for (let i = 0; i < 25; i++) {
      const pre = await planTickPrefetch(h.ctx(), { page: 'map' });
      const before = model.calls.length;
      const r = await runTickBeat(h.ctx(), { page: 'map', model });
      if (r.issued) await markTickIntentSeen(h.ctx(), r.issued);
      if (model.calls.length > before) {
        assert.ok(pre, `beat ${i + 1}: the prefetch saw the call coming`);
        assert.equal(pre.key, model.calls[model.calls.length - 1].key);
      }
    }
    assert.ok(model.calls.length > 0);
  } finally {
    await h.close();
  }
});

test('the shipped prompts: every suspect has one in every variant, in every edition; Hans has tick.md', { skip: LAST_WITNESS }, async () => {
  for (const edition of ['last-witness', 'last-witness-zh', 'last-witness-jp', 'last-witness-ko']) {
    for (const culprit of ['eve', 'ross', 'koharu']) {
      const h = await save(culprit, edition);
      try {
        const world = await loadTickWorld(h.store);
        for (const id of ['eve', 'ross', 'koharu', 'hans']) {
          const p = await readTickPrompt(h.store, world, id);
          assert.ok(p && p.goal && p.temper && p.voice.length && p.neverSay.length, `${edition}/${culprit}/${id}`);
        }
      } finally {
        await h.close();
      }
    }
  }
});
