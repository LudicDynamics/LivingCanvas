// Reply chips in any world:
// world.json `ui.replyChips` (on by default where the world wrote `opening.replies`), the opening's replies for the
// first answer, then this place's card options above the reply box — one row of three + 「更多」 on a phone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseFrontmatter, WorldManifestSchema } from '@airp/shared';
import { buildInteractiveFields, visibleChoiceOptions } from '@airp/shared/frontmatter';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const fr = await jiti.import('../src/lib/first-run.ts');
const tutorial = await jiti.import('../src/lib/forced-tutorial.ts');
const xp = await import('@airp/shared/experience');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const templates = new URL('../../../templates/', import.meta.url);
const optionsOf = (card) => {
  const choice = buildInteractiveFields(card.frontmatter ?? {}).choice;
  return choice ? visibleChoiceOptions(choice) : [];
};

test('the switch, per world: ui.replyChips wins; absent → on with opening.replies or a prologue, off elsewhere', () => {
  assert.equal(xp.replyChipsEnabled({ ui: { replyChips: true } }), true);
  assert.equal(xp.replyChipsEnabled({ ui: { replyChips: false }, opening: { replies: ['a'] } }), false, 'a world can turn them off');
  assert.equal(xp.replyChipsEnabled({ opening: { greeter: 'x', replies: ['a', 'b'] } }), true, 'opening.replies → on by default');
  assert.equal(xp.replyChipsEnabled({ opening: { replies: { 'zh-CN': ['甲'] } } }), true);
  assert.equal(xp.replyChipsEnabled({ experience: { kind: 'prologue' } }), true);
  assert.equal(xp.replyChipsEnabled({ opening: { greeter: 'x' } }), false, 'nothing written → the play screen as before');
  assert.equal(xp.replyChipsEnabled({ ui: { replyChips: 'yes' }, opening: { greeter: 'x' } }), false, 'malformed → the default');
  assert.equal(xp.replyChipsEnabled(null), false);
  const parsed = WorldManifestSchema.safeParse({ id: 'w', name: 'W', version: '1.0.0', ui: { replyChips: 'nope' } });
  if (parsed.success) assert.equal(parsed.data.ui, undefined, 'the server drops a malformed ui block instead of refusing the world');
});

for (const [id, lang] of [['last-train', 'en'], ['last-train-zh', 'zh-CN'], ['last-train-jp', 'ja'], ['last-train-ko', 'ko']]) {
  test(`${id}: three opening replies in the world's language, chips on; chips during play come from the cars' options`, async () => {
    const world = JSON.parse(await readFile(new URL(`${id}/world.json`, templates), 'utf8'));
    assert.equal(world.ui?.replyChips, true);
    assert.equal(xp.replyChipsEnabled(world), true);
    const lines = xp.openingRepliesFor(world.opening?.replies, 'en', world.locale);
    assert.equal(lines.length, 3);
    for (const line of lines) {
      if (lang === 'en') assert.match(line, /^[\x20-\x7e’—]+$/, line);
      else assert.match(line, /[぀-ヿ一-鿿가-힯]/, `${line} is in ${lang}`);
    }
    // Inside 2 车: the notebook, the roll, the door to 5 车 once it appears — and never 「talk to 夏澄」 (she is right there).
    const readme = parseFrontmatter(await readFile(new URL(`${id}/world/seated-car/README.md`, templates), 'utf8'));
    const cards = [{ path: 'world/seated-car/README.md', frontmatter: readme.frontmatter }];
    const chips = fr.replyChipsOf(cards, optionsOf, 8);
    assert.ok(chips.length >= 2, 'at least two moves in 2 车');
    assert.ok(chips.every((c) => c.option.id !== 'talk'), 'talk options are left out (the reply box is the talk)');
    const root = parseFrontmatter(await readFile(new URL(`${id}/world/README.md`, templates), 'utf8'));
    assert.ok(fr.replyChipsOf([{ path: 'world/README.md', frontmatter: root.frontmatter }], optionsOf, 8).length >= 2, 'the overview has moves too');
  });
}

test('order: door cards, then this place\'s cards, then its README; a sub-place\'s README (seen from outside) last', () => {
  const opts = (c) => (c.frontmatter.choice?.options ?? []).map((o, i) => ({ index: i + 1, label: o.label, id: o.id }));
  const cards = [
    { path: 'world/README.md', frontmatter: { choice: { options: [{ id: 'read-list', label: 'Read the list' }] } } },
    { path: 'world/sleeper/README.md', frontmatter: { type: 'gate', target: 'world/sleeper', choice: { options: [{ id: 'coat', label: 'Look at the coat' }] } } },
    { path: 'world/passenger-list.md', frontmatter: { choice: { options: [{ id: 'count', label: 'Count heads' }] } } },
  ];
  assert.deepEqual(fr.replyChipsOf(cards, opts, 8).map((c) => c.option.label), ['Count heads', 'Read the list', 'Look at the coat']);
});

test('App wiring: chips in any world that turns them on — moves on the writer\'s tray, lines in the bubble (docs/ux/27 §8)', async () => {
  const app = await src('../src/App.tsx');
  assert.match(app, /const replyChipsOn = replyChipsEnabled\(manifest\);/);
  assert.match(app, /const openingReplies = replyChipsOn && opening && opening\.phase === 'greeting'/);
  assert.match(app, /const routed = replyChipsOn && !nookChar\s*\? routeOptions\(/);
  assert.match(app, /lines=\{dockLines\}/);
  assert.doesNotMatch(app, /<ReplyChips/, 'the old mixed strip is gone from the dock');
  assert.doesNotMatch(app, /PrologueChips/);
});

test('the strip: three chips, then 「更多 · N」 that opens the rest (at most eight); it folds back on a new place', async () => {
  const ui = await src('../src/components/chrome/FirstRun.tsx');
  assert.match(ui, /export const STRIP_VISIBLE = 3;/);
  assert.match(ui, /export const STRIP_MAX = 8;/);
  assert.match(ui, /const shown = overflow && !more \? chips\.slice\(0, STRIP_VISIBLE\) : chips;/);
  assert.match(ui, /data-testid="reply-chips-more" aria-expanded=\{more\}/);
  assert.match(ui, /useEffect\(\(\) => \{ setMore\(false\); \}, \[projection\]\);/);
});

test('phone layout: one row that scrolls sideways (no wall of chips over the scene); still 44px to the touch', async () => {
  const css = await src('../src/components/chrome/first-run.css');
  assert.match(css, /\.reply-chip \{\s*min-height: 44px;/);
  const phone = css.slice(css.indexOf('@media (max-width: 1100px) {\n  .airp-prototype:not(.app--first-run) .reply-chips'));
  assert.match(phone, /flex-wrap: nowrap;\s*overflow-x: auto;/);
  assert.match(phone, /\.reply-chip \{\s*flex: 0 0 auto;\s*max-width: 78vw;\s*white-space: nowrap;/);
  assert.match(phone, /\[data-expanded='true'\] \{ flex-wrap: wrap; overflow-x: visible; max-height: 32dvh; overflow-y: auto; \}/);
});

test('typing stays: the reply box is always under the chips; the tutorial\'s first step lights chips + box together', async () => {
  const dock = await src('../src/components/sidebar/CharacterDock.tsx');
  assert.match(dock, /<div className="character-dock__reply" data-tutorial=\{replies && replies\.length > 0 \? 'speak-replies' : undefined\} data-guide-target=\{replies && replies\.length > 0 \? 'speak' : undefined\}>[\s\S]*?\) : chips\}[\s\S]*?<div className="character-dock__input-row" data-guide-target="speak" data-tutorial="speak">/);
  assert.deepEqual(tutorial.tutorialTargets({ step: 'speak' }), ['[data-tutorial="speak-replies"]', '[data-tutorial="speak"], [data-guide-target="speak"]']);
});
