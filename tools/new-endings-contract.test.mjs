// Endings for the four story worlds that had none (divergence, first-snow,
// moonlit-contract, unwritten-door) and the magic-academy lesson. Every ending is
// landed by the engine — a place trigger, a keyword trigger or a choice's
// command — never by the writer's prose, and every one is reachable in every
// edition. Each test copies the real template into a scratch directory and
// drives it through the real action layer. No agent, no writer: the files the
// writer would generate (adult Ryo, the courtyard, the outside, a spell's result)
// are planted the way the world skill says they are written.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LocalWorldStore, createActionService, reachedEnding, fireKeywordTrigger, parseFrontmatter } from '../packages/shared/dist/index.js';

const GOD = { type: 'god' };
const SUFFIXES = ['', '-jp', '-ko', '-zh'];
const templateOf = (edition) => fileURLToPath(new URL(`../templates/${edition}`, import.meta.url));
const note = (title) => `---\ntype: note\ntitle: ${title}\nportable: false\n---\n\n${title}.\n`;

async function play(edition) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${edition}-endings-`));
  await fs.cp(templateOf(edition), root, { recursive: true, filter: (src) => !/[/\\](assets|\.airpworld|\.pi)([/\\]|$)/.test(src) });
  const store = new LocalWorldStore(root);
  let n = 0;
  const svc = () => createActionService(store, GOD, { turn: `req:${edition}-${++n}` });
  const ending = async () => (await reachedEnding(store))?.id ?? null;
  const plant = (rel, title = path.basename(rel, '.md')) => store.writeFile(rel, note(title));
  const enter = (layer) => svc().enterLayer({ layer });
  const keyword = async (id, layer) => {
    const fired = await fireKeywordTrigger(svc().ctx, { id, ...(layer ? { layer } : {}) });
    assert.ok(!fired.error, fired.error);
    return fired;
  };
  return { store, svc, ending, plant, enter, keyword };
}

async function manifestOf(edition) {
  return JSON.parse(await fs.readFile(path.join(templateOf(edition), 'world.json'), 'utf8'));
}

/** Shape every edition must share: mode, ending ids and files, triggers without words. */
async function shape(edition) {
  const m = await manifestOf(edition);
  return {
    mode: m.mode,
    endings: m.endings.map((e) => [e.id, e.path]),
    triggers: m.triggers.map(({ label, fallback, when, ...t }) => ({ ...t, when: typeof when === 'string' ? when : { ...when, intent: undefined } })),
    intro: [m.intro.endings, m.intro.mechanics],
  };
}

const WORLDS = {
  divergence: ['restored', 'unchanged'],
  'first-snow': ['nanami', 'sumi', 'entangled', 'solitary'],
  'moonlit-contract': ['bound', 'released', 'broken'],
  'unwritten-door': ['leave-with-iris', 'remember', 'stay'],
  'magic-academy': ['opened-door', 'kept-stars', 'unnamed'],
};

for (const [base, ids] of Object.entries(WORLDS)) {
  test(`${base}: a semi world whose editions share ${ids.length} endings and one trigger structure`, async () => {
    const en = await shape(base);
    assert.equal(en.mode, 'semi');
    assert.deepEqual(en.endings.map(([id]) => id), ids);
    assert.equal(en.intro[0], ids.length);
    assert.ok(en.intro[1].includes('endings') && !en.intro[1].includes('free-explore'));
    for (const suffix of SUFFIXES) {
      const edition = base + suffix;
      if (suffix) assert.deepEqual(await shape(edition), en, edition);
      for (const [, rel] of en.endings) {
        const fm = parseFrontmatter(await fs.readFile(path.join(templateOf(edition), rel), 'utf8')).frontmatter;
        assert.equal(fm.type, 'ending', `${edition}/${rel}`);
        await fs.access(path.join(templateOf(edition), fm.bg));
        assert.match(fm.art?.scene?.path ?? '', /^assets\/scenes\/ending-[a-z-]+\.webp$/, `${edition}/${rel}: art.scene.path`);
        assert.ok((fm.art?.scene?.prompt ?? '').length > 80, `${edition}/${rel}: an image prompt is written`);
      }
    }
  });
}

for (const suffix of SUFFIXES) {
  const D = `divergence${suffix}`;
  const SHOP_2024 = 'world/time-map/thirty-years-later/tokiwa-electronics';
  test(`${D}: the 2024 shop lands "restored" only after the morning was changed`, async () => {
    const w = await play(D);
    await w.plant('player/clockwork-frog.md', 'Clockwork Frog');
    await w.enter(SHOP_2024);
    assert.equal(await w.ending(), null, 'visiting the empty lot ends nothing');
    await w.plant(`${SHOP_2024}/adult-ryo.md`, 'Ryo');
    await w.plant('world/time-map/fax-receipt.md', 'Receipt');
    await w.enter('world/time-map');
    assert.equal(await w.ending(), null);
    await w.enter(SHOP_2024);
    assert.equal(await w.ending(), 'restored');
  });
  test(`${D}: letting that morning stand lands "unchanged"`, async () => {
    const w = await play(D);
    await w.keyword('let-it-stand', 'map');
    assert.equal(await w.ending(), 'unchanged');
  });

  const S = `first-snow${suffix}`;
  const NIGHT = 'world/tonight-promises/first-snow';
  for (const [nanami, sumi, expected] of [[true, true, 'entangled'], [true, false, 'nanami'], [false, true, 'sumi'], [false, false, 'solitary']]) {
    test(`${S}: Conclude Tonight with ${[nanami && 'nanami', sumi && 'sumi'].filter(Boolean).join(' + ') || 'no'} keepsake → ${expected}`, async () => {
      const w = await play(S);
      if (nanami) await w.plant('player/nanami-keepsake.md');
      if (sumi) await w.plant('player/sumi-keepsake.md');
      await w.enter(NIGHT);
      assert.equal(await w.ending(), null, 'entering the decision night ends nothing');
      await w.svc().chooseOption({ path: `${NIGHT}/README.md`, choice: 'action-1' });
      assert.equal(await w.ending(), expected);
    });
  }
  test(`${S}: "I still have things to say" goes back to tonight without ending it`, async () => {
    const w = await play(S);
    await w.enter(NIGHT);
    const r = await w.svc().chooseOption({ path: `${NIGHT}/README.md`, choice: 'action-2' });
    assert.equal(await w.ending(), null);
    const back = r.details.commands.find((c) => c.command === 'back-to-tonight');
    assert.equal(back?.status, 'ok');
    assert.equal(back.effects[0].event.type, 'layer_entered');
    assert.equal(back.effects[0].event.layer, 'world/tonight-promises');
  });
  test(`${S}: asking in words to close the night runs the same decision`, async () => {
    const w = await play(S);
    await w.plant('player/sumi-keepsake.md');
    await w.keyword('conclude-in-words', NIGHT);
    assert.equal(await w.ending(), 'sumi');
  });

  const M = `moonlit-contract${suffix}`;
  test(`${M}: keeping or releasing her needs the pact; turning her away always ends`, async () => {
    let w = await play(M);
    await w.keyword('ask-her-to-stay', 'map');
    await w.keyword('release-her', 'map');
    assert.equal(await w.ending(), null, 'no pact yet: nothing to keep or release');
    await w.plant('world/moonlit-courtyard/README.md', 'Moonlit Courtyard');
    await w.keyword('ask-her-to-stay', 'map');
    assert.equal(await w.ending(), 'bound');
    w = await play(M);
    await w.plant('world/moonlit-courtyard/README.md', 'Moonlit Courtyard');
    await w.keyword('release-her', 'map');
    assert.equal(await w.ending(), 'released');
    w = await play(M);
    await w.keyword('turn-her-away', 'map');
    assert.equal(await w.ending(), 'broken');
  });

  const U = `unwritten-door${suffix}`;
  test(`${U}: leaving or remembering needs the outside; staying always ends`, async () => {
    let w = await play(U);
    await w.keyword('leave-with-her', 'map');
    await w.keyword('say-who-you-are', 'map');
    assert.equal(await w.ending(), null, 'the outside is not written yet');
    await w.plant('world/outside/README.md', 'Outside');
    await w.keyword('leave-with-her', 'map');
    assert.equal(await w.ending(), 'leave-with-iris');
    w = await play(U);
    await w.plant('world/outside/README.md', 'Outside');
    await w.keyword('say-who-you-are', 'map');
    assert.equal(await w.ending(), 'remember');
    w = await play(U);
    await w.keyword('stay-here', 'map');
    assert.equal(await w.ending(), 'stay');
  });

  const A = `magic-academy${suffix}`;
  test(`${A}: back in the library with a cast spell ends the lesson; leaving without one is "unnamed"`, async () => {
    let w = await play(A);
    await w.enter('world/spell-atlas');
    await w.enter('map');
    assert.equal(await w.ending(), null, 'no spell yet');
    await w.plant('world/spell-atlas/star-chart-room/01-my-spell.md', 'My Spell');
    await w.enter('map');
    assert.equal(await w.ending(), 'opened-door');
    w = await play(A);
    await w.plant('world/spell-atlas/palm-stars/01-my-spell.md', 'My Spell');
    await w.enter('map');
    assert.equal(await w.ending(), 'kept-stars');
    w = await play(A);
    await w.keyword('leave-without-a-spell', 'map');
    assert.equal(await w.ending(), 'unnamed');
  });
}
