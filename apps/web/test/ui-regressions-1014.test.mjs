//(main @ e039b66): four interface regressions. Source constraints, each naming its root cause, so the
// same thing cannot slip out again unnoticed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const proto = strip(await read('../src/prototype.css'));
const launcherCss = strip(await read('../src/components/world-launcher.css'));
const launcher = await read('../src/components/WorldLauncher.tsx');
const boardCss = strip(await read('../src/components/board/board.css'));
const app = await read('../src/App.tsx');
const rail = await read('../src/components/sidebar/CharacterRail.tsx');

const rule = (css, selector) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `${selector} is declared`);
  return css.slice(at, css.indexOf('}', at));
};

test('the character rail has its own box again: a column at the top right, orbs in the flow (lost in 92dfa6b)', () => {
  // The rail root still carries the class the rule styles.
  assert.match(rail, /className="prototype-residents prototype-chrome character-rail"/);
  const box = rule(proto, '.prototype-residents');
  assert.match(box, /position: absolute;/);
  assert.match(box, /display: flex;/);
  assert.match(box, /flex-direction: column;/);
  assert.match(box, /z-index: var\(--depth-writer\);/);
  // Without this every orb lands on the lone-orb spot (top 68 / right 24) and the hover actions open off screen.
  const orb = rule(proto, '.prototype-residents .prototype-companion-orb');
  assert.match(orb, /position: relative;/);
  assert.match(orb, /inset: auto;/);
  // A dialogue stage open in the right column: the others in one row inside its head room.
  assert.match(proto, /\.character-dock--expanded \.prototype-residents \{[^}]*flex-direction: row-reverse;/);
});

test('the map shows only people the player can know about', () => {
  assert.match(app, /const boardCharacters = useMemo\(\s*\(\) => presenceViews[\s\S]{0,400}\.filter\(view => view\.state !== 'absent' && \(view\.state === 'in-scene' \|\| view\.following \|\| metIds\.has\(view\.id\)\)\)/);
  assert.match(app, /\[presenceViews, metIds\],\s*\);\s*\/\/ The rail carrier's call/);
});

test('the lobby\'s three kinds take one line at every scale', () => {
  const li = rule(launcherCss, '.world-launcher__explain li');
  assert.match(li, /white-space: nowrap;/);
  assert.match(li, /text-overflow: ellipsis;/);
  assert.doesNotMatch(li, /display: grid;/);
  // Narrow or short windows: the chips alone, plus the chosen kind's sentence on one line.
  assert.match(launcherCss, /@media \(max-height: 640px\), \(max-width: 700px\) \{\s*\.world-launcher__explain \{ display: none; \}\s*\.world-launcher__line \{ display: block; \}/);
  assert.match(launcher, /title=\{chip\.id === ALL_CATEGORIES \? undefined : worldCategoryOf\(chip\.id\)\?\.line\[categoryLocale\]\}/);
  assert.match(launcher, /<p className="world-launcher__line">/);
});

test('the map caption sits in a fixed slot and only its own pill takes the pointer', () => {
  const band = rule(boardCss, '.board--picture .board__story');
  assert.match(band, /top: var\(--map-caption-top, 72px\);/);
  assert.match(band, /pointer-events: none;/);
  const pill = rule(boardCss, '.board--picture .board__narration');
  assert.match(pill, /-webkit-line-clamp: 2;/);
  assert.match(pill, /max-width: 640px;/);
  // Pins are framed below it.
  assert.match(boardCss, /top: calc\(var\(--map-caption-top, 72px\) \+ var\(--map-caption-height, 0px\) \+ 12px\);/);
  // Narrow: clear of the avatar column at the right.
  assert.match(boardCss, /\.board--picture \.board__story\.board__story \{ padding: 0 108px 0 12px; \}/);
});

// ── 「状态」「技能」 beside every avatar ─────────────────────────────────

const quick = await read('../src/components/chrome/AvatarQuick.tsx');
const quickCss = strip(await read('../src/components/chrome/avatar-quick.css'));
const dice = await read('../src/components/narrative/DiceRoller.tsx');
const cue = await read('../src/components/chrome/TutorialCueCard.tsx');

test('the player and every companion with them carry 「状态」「技能」, always visible, one press to one panel', () => {
  assert.match(app, /\{!nookChar && !launcherOpen && quickFor\('player', 'player'\)\}/);
  assert.match(app, /return view && \(view\.following \|\| view\.state === 'in-scene'\) \? quickFor\(id, 'companion'\) : null;/);
  assert.equal(app.match(/quick=\{railQuick\}/g)?.length, 2, 'the dock and the classic rail both');
  assert.match(rail, /\{quick\?\.\(view\.id\)\}/);
  // Icon + word, not hover-only.
  assert.match(quick, /<span className="avatar-quick__word">\{label\}<\/span>/);
  // A finger's 40px: 24px pill + 8px above and below on wide screens, 32 + 4 + 4 on narrow ones.
  assert.match(quickCss, /\.avatar-quick__button \{[^}]*min-height: 24px;/);
  assert.match(quickCss, /\.avatar-quick__button::before \{[^}]*inset: -8px -2px;/);
  assert.match(quickCss, /@media \(max-width: 1100px\) \{[^@]*min-height: 32px;[^@]*inset: -4px -2px;/);
  // The player's skills: use a skill, the inspiration roll, who rolls for you. A companion's: read-only, assist marked.
  assert.match(app, /canUse=\{quickOpen\.who === 'player'\}/);
  assert.match(app, /quickOpen\.who === 'player' && <InspirationRoll inspiration=\{worldSheets\.inspiration\}/);
  assert.match(app, /quickOpen\.who === 'player' && <CompanionSkills sheets=\{worldSheets\} \/>/);
});

test('the panel shares the drawer rules: it lowers a drawer / writer, and they close it', () => {
  assert.match(app, /if \(!quickOpen\) return;\s*setStreamSolo\(false\);\s*setProfileOpen\(false\);\s*if \(writerSheetOpen\) onWriterOpenChange\(false\);/);
  assert.match(app, /useEffect\(\(\) => \{ if \(streamOpen \|\| launcherOpen\) setQuickOpen\(null\); \}, \[streamOpen, launcherOpen\]\);/);
  assert.match(quickCss, /\.airp-prototype\[data-stream-open='true'\] \.avatar-quick--player \{ display: none; \}/);
  assert.match(quick, /avoid: avoidRects\(null\),/);
});

test('a check card names who rolls for you first; the skill teach-once cues point at the 「技能」 button', () => {
  assert.match(dice, /t\('\{name\} rolls for you', \{ name: assistName \}\)\} · \$\{baseLine\}/);
  assert.match(dice, /typeof assistField\?\.assist === 'string' && assistField\.assist !== 'player' \? characterName\(assistField\.assist\)/);
  assert.match(cue, /'first-skill': \['\[data-avatar-skills="player"\]'/);
  assert.match(cue, /'first-inspiration': \['\[data-testid="inspiration-roll"\]', '\[data-avatar-skills="player"\]'/);
});
