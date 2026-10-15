// The companion shell's invariants. Source assertions: the
// point of every one of these is that `classic` keeps rendering exactly what
// shipped, so the 24 UX-contract rules and the existing tests keep meaning
// what they meant.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const dock = await readFile(new URL('../src/components/sidebar/CharacterDock.tsx', import.meta.url), 'utf8');
const rail = await readFile(new URL('../src/components/sidebar/CharacterRail.tsx', import.meta.url), 'utf8');
const fab = await readFile(new URL('../src/components/chrome/WriterFab.tsx', import.meta.url), 'utf8');
const choiceRail = await readFile(new URL('../src/components/sidebar/ChoiceRail.tsx', import.meta.url), 'utf8');
const entity = await readFile(new URL('../src/components/narrative/EntityInteractions.tsx', import.meta.url), 'utf8');
const fm = await readFile(new URL('../src/lib/fm.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const dockCss = await readFile(new URL('../src/components/sidebar/character-dock.css', import.meta.url), 'utf8');
const railCss = await readFile(new URL('../src/components/sidebar/choice-rail.css', import.meta.url), 'utf8');
const fabCss = await readFile(new URL('../src/components/chrome/writer-fab.css', import.meta.url), 'utf8');

const jiti = createJiti(import.meta.url, { moduleCache: false });
const layout = await jiti.import('../src/lib/layout-mode.ts');
const railLib = await jiti.import('../src/lib/choice-rail-model.ts');

test('the shell is a switch with companion as the default and classic one step away', () => {
  assert.equal(layout.DEFAULT_LAYOUT_MODE, 'companion');
  assert.equal(layout.isLayoutMode('classic'), true);
  assert.equal(layout.isLayoutMode('companion'), true);
  assert.equal(layout.isLayoutMode('galgame'), false);
  assert.equal(layout.isLayoutMode(undefined), false);
  // A denied / empty storage must not break the shell.
  assert.equal(layout.readLayoutMode(), 'companion');
});

test('classic mounts the modal and the writer dock; companion mounts the dock and the FAB', () => {
  // The full-screen stage and the bottom dock are BOTH behind `!companion`.
  assert.match(app, /\{!companion && activeCharacter && \(\s*<CharacterModal/);
  assert.match(app, /\{!companion && \(<>/);
  assert.match(app, /\{!nookChar && \(companion \? \(/);
  assert.match(app, /<CharacterDock/);
  // The FAB with its tray of moves: WriterTrayFab wraps WriterFab.
  assert.match(app, /\{companion && \(\s*<WriterTrayFab/);
  // One definition of the prompt surface for both shells — no drift.
  assert.match(app, /const writerBarProps: WriterBarProps = \{/);
  assert.match(app, /<WriterBar \{\.\.\.writerBarProps\} \/>/);
  assert.match(app, /bar=\{writerBarProps\}/);
});

test('the rail root class literal keeps its single owner (check:ux)', () => {
  assert.match(rail, /className="prototype-residents prototype-chrome character-rail"/);
  // The dock wraps that rail rather than re-declaring the literal, so the
  // contract rule still has exactly one target file.
  assert.doesNotMatch(dock, /prototype-residents prototype-chrome character-rail/);
  assert.match(dock, /<CharacterRail \{\.\.\.railProps\} \/>/);
});

test('the companion dock is non-modal: the canvas keeps pointer input and the dialogue owner', () => {
  // `inert` is gated on the classic stage only.
  assert.match(app, /const dialogueBlocksCanvas = !companion && activeCharacter !== null;/);
  assert.match(app, /inert=\{dialogueBlocksCanvas \|\| worldPickerOpen\}/);
  assert.doesNotMatch(app, /inert=\{activeCharacter !== null \|\| worldPickerOpen\}/);
  assert.match(app, /syncFocus\('character-dialogue', !companion && activeCharacter !== null\)/);
  // The dock takes a workspace surface instead, so Escape still reaches it.
  assert.match(dock, /owner: 'workspace'/);
  assert.match(dock, /key: `character-dock:\$\{active\.id\}`/);
});

test('the companion stays on stage (only the writer sends them off); others fold away on an outside press', () => {
  //.
  // The dock no longer collapses on an arbitrary outside press — only a press
  // inside the writer (`closeFor`) does.
  assert.match(dock, /window\.addEventListener\('pointerdown', onPointerDown, true\)/);
  assert.match(dock, /if \(closeFor\?\.some\(ref => ref\.current\?\.contains\(target\)\)\) \{ requestCloseRef\.current\(\); return; \}/);
  assert.match(dock, /if \(stayOnStage\) return;/);
  // Anyone else opened for a word still folds away on a press outside them.
  assert.match(dock, /if \(rootRef\.current\?\.contains\(target\)\) return;/);
  assert.match(app, /stayOnStage=\{dockStaysOnStage\}/);
  assert.match(app, /if \(dockStaysOnStage\) setDockDismissed\(true\);/);
  assert.match(app, /closeFor=\{dockCloseFor\}/);
  assert.match(app, /const dockCloseFor = useRef\(\[writerFabRef\]\)\.current;/);
  // The writer sheet closes on an outside press only while its draft is empty
  //
  // — see writer-panel.test.mjs. Opening it still
  // collapses the character.
  assert.match(fab, /if \(draftRef\.current\.trim\(\) !== ''\) return;/);
  assert.match(app, /if \(activeCharacter\) closeCharacter\(\);/);
  assert.match(app, /if \(companion\) setWriterSheetOpen\(false\);/);
});

// ── P2: the left rail and the canvas emphasis ────────────────────────────────

test('companion mounts the option list in the message drawer; classic never does, and the cards keep their options', () => {
  // the design notes: the parked left rail became the drawer's 「选项」 page — the same ChoiceRail, drawn flat.
  assert.match(app, /\{streamOn && \(\s*<MessageDrawer[\s\S]{0,1600}options=\{\(\s*<ChoiceRail\s+variant="drawer"/);
  assert.match(app, /const streamOn = companion && !nookChar && !launcherOpen;/);
  assert.equal(app.match(/<ChoiceRail\b/g)?.length, 1);
  // The layer README carries `choice` too and arrives as `scene`, outside
  // `items` — it heads the list rather than being dropped.
  assert.match(app, /cards=\{readme \? \[readme, \.\.\.canvasItems\] : canvasItems\}/);
  // The card panel drops ONLY the options, and only in companion.
  assert.match(entity, /const showChoices = layoutMode !== 'companion';/);
  assert.match(entity, /hideChoices: !showChoices/);
  assert.match(fm, /const choices = interactive\.choice && !opts\.hideChoices/);
  // Everything else the card offers is untouched by the mode.
  // (They moved from the side arrows to the big action buttons, the design notes §卡片行动按钮.)
  for (const kept of [/t\('Take along'\)/, /t\('Enter place'\)/, /t\('Talk with this person'\)/]) assert.match(entity, kept);
});

test('the rail groups by card and names the declared kind', () => {
  const groups = railLib.railGroups([
    { path: 'world/README.md', frontmatter: { title: 'Harbour', choice: { options: [{ label: 'Go in' }] } } },
    { path: 'world/letter.md', frontmatter: { title: 'Letter' } },            // no options → no group
    { path: 'world/desk.md', frontmatter: { choice: { options: [{ id: 'a', label: 'Read it' }] } } },
  ]);
  assert.deepEqual(groups.map(g => g.path), ['world/README.md', 'world/desk.md']);
  assert.equal(groups[0].title, 'Harbour');
  assert.equal(groups[1].title, 'desk', 'a card with no title falls back to its filename');
  // Broken widget data degrades to "no options", exactly like the card does.
  assert.deepEqual(railLib.railGroups([{ path: 'world/x.md', frontmatter: { choice: 'not-an-object' } }]), []);

  const glyph = (fmData, option) => railLib.choiceGlyph(fmData, option);
  const opt = { index: 1, label: 'x', id: 'a', visible: true };
  assert.equal(glyph({ choice_actions: { a: { kind: 'enter' } } }, opt), '→');
  assert.equal(glyph({ choice_actions: { a: { kind: 'read' } } }, opt), '📖');
  assert.equal(glyph({ choice_actions: { a: { kind: 'take' } } }, opt), '✋');
  assert.equal(glyph({ choice_actions: { a: { kind: 'character' } } }, opt), '💬');
  assert.equal(glyph({ dice_outcomes: {} }, opt), '🎲');
  assert.equal(glyph({}, opt), '✎', 'a plain / writer choice');
});

test('two cards declaring the same option list it once (Holmes: README + opening chalk)', () => {
  const holmes = {
    title: '221B · Stop the next incident',
    choice: { options: [{ id: 'action-1', label: 'Read the letter' }, { id: 'action-2', label: 'Take the lid' }] },
    choice_actions: { 'action-1': { kind: 'read', paths: ['world/letter.md'] }, 'action-2': { paths: ['world/lid.md'], kind: 'take' } },
  };
  // Same options, same targets (key order differs): one group, under the first card.
  const reordered = { ...holmes, choice_actions: { 'action-2': { kind: 'take', paths: ['world/lid.md'] }, 'action-1': { paths: ['world/letter.md'], kind: 'read' } } };
  const groups = railLib.railGroups([
    { path: 'world/README.md', frontmatter: holmes },
    { path: 'world/01-opening.md', frontmatter: reordered },
  ]);
  assert.deepEqual(groups.map(g => g.path), ['world/README.md']);
  assert.equal(groups[0].options.length, 2);
  // Same label, different target: both stay (not deduped by path or label alone).
  const elsewhere = { ...holmes, choice_actions: { ...holmes.choice_actions, 'action-1': { kind: 'read', paths: ['world/other.md'] } } };
  const mixed = railLib.railGroups([
    { path: 'world/README.md', frontmatter: holmes },
    { path: 'world/02.md', frontmatter: elsewhere },
  ]);
  assert.deepEqual(mixed.map(g => [g.path, g.options.map(o => o.id)]), [['world/README.md', ['action-1', 'action-2']], ['world/02.md', ['action-1']]]);
  // Writer options (no declared action) match only under the same card title.
  const writer = title => ({ title, choice: { options: [{ label: 'Look around' }] } });
  assert.equal(railLib.railGroups([{ path: 'world/a.md', frontmatter: writer('Desk') }, { path: 'world/b.md', frontmatter: writer('Desk') }]).length, 1);
  assert.equal(railLib.railGroups([{ path: 'world/a.md', frontmatter: writer('Desk') }, { path: 'world/b.md', frontmatter: writer('Shelf') }]).length, 2);
});

test('hovering a rail option emphasises its card without moving the camera', () => {
  assert.match(choiceRail, /onPointerEnter=\{\(\) => emphasizeCard\(group\.path\)\}/);
  assert.match(choiceRail, /onFocus=\{\(\) => emphasizeCard\(group\.path\)\}/);
  assert.match(choiceRail, /onPointerLeave=\{\(\) => clearCardEmphasis\(\)\}/);
  // A layer switch leaves no card lit behind it (and closes a tapped-open rail).
  assert.match(choiceRail, /useEffect\(\(\) => \{ clearCardEmphasis\(\);[^}]*\}, \[projection\]\)/);
  // Emphasis is CSS over two attributes; the rail must not move the view.
  assert.match(css, /\.object\[data-emphasis='on'\][\s\S]{0,200}scale\(1\.06\)/);
  assert.match(css, /data-emphasis-active='on'\] \.object:not\(\[data-emphasis='on'\]\)[\s\S]{0,80}opacity: 0\.85/);
  // The authored tilt survives the lift.
  assert.match(css, /\.object\[data-emphasis='on'\][\s\S]{0,120}rotate\(var\(--target-rot, 0deg\)\)/);
  assert.doesNotMatch(choiceRail, /flyTo|camera|restoreTarget/);
});

/** The declarations of one CSS rule, by selector — `.foo { … }` without the braces. */
function ruleBody(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `no rule for ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  assert.notEqual(close, -1, `unterminated rule for ${selector}`);
  return css.slice(open + 1, close);
}

// ── Polish: the cut-out, the live cursor, the glass rails ───────────────────

test('the expanded dock is a cut-out on the scene, not a card around a person', () => {
  // The panel class is gone: a background/border/shadow box around the portrait
  // reads as a window containing a person, which is what this layout undoes.
  assert.doesNotMatch(dock, /character-dock__panel/);
  assert.match(dock, /className="character-dock__stage"/);
  assert.doesNotMatch(dockCss, /\.character-dock__panel\b/);
  const stage = dockCss.slice(dockCss.indexOf('.character-dock__stage {'), dockCss.indexOf('.character-dock__portrait {'));
  assert.doesNotMatch(stage, /^\s*(background|border|box-shadow):/m);
  // Legibility is the chalk halo, not a slab behind the words.
  assert.match(dockCss, /\.character-dock__line \{[\s\S]{0,200}text-shadow: var\(--ux-shadow-chalk-glow-dark\)/);
  // The figure is deaf to the pointer, so a drag near the right edge is still a
  // canvas drag; the stage only takes input where a control actually sits.
  // Slice the rule body rather than budgeting characters — a comment or a new
  // declaration must not be able to make this rule quietly stop checking.
  assert.match(ruleBody(dockCss, '.character-dock__stage'), /pointer-events: none/);
  assert.match(ruleBody(dockCss, '.character-dock__portrait'), /pointer-events: none/);
  for (const control of ['__collapse', '__lines', '__input-row']) {
    assert.match(dockCss, new RegExp(`\\.character-dock${control} \\{[\\s\\S]{0,500}pointer-events: auto`), control);
  }
});

test('the expanded dock is the whole right column and the head is never cropped', () => {
  //: "他这个剪影，他直接头被截断了…右边如果要聚焦一个角色，它不
  // 一定在按钮的位置，可以直接覆盖整个右边；如果位置在上面的话，让整个头显示出来".
  const stage = ruleBody(dockCss, '.character-dock__stage');
  // Top to bottom, at a fixed column width — not hung off the avatar it was
  // opened from, which is what made the figure grow past the top of the screen.
  assert.match(stage, /position: fixed/);
  assert.match(stage, /top: 0/);
  assert.match(stage, /bottom: 0/);
  assert.match(stage, /width: var\(--character-dock-column\)/);
  assert.doesNotMatch(stage, /top: 150px/);
  assert.doesNotMatch(stage, /max-height:/);

  // The cut-out fills that column instead of carrying a height of its own: a
  // fixed height bottom-aligned in a short box is exactly what cut the head off.
  const portrait = ruleBody(dockCss, '.character-dock__portrait');
  assert.match(portrait, /position: absolute/);
  assert.match(portrait, /top: 0/);
  assert.match(portrait, /bottom: 0/);
  assert.match(portrait, /align-items: flex-end/);
  assert.doesNotMatch(portrait, /height: min\(/);
  assert.doesNotMatch(portrait, /^\s*height: \d/m);

  // `contain` is the guarantee — it cannot crop — and `bottom` is what keeps
  // the character standing on the floor rather than floating in the column.
  const media = dockCss.slice(dockCss.indexOf('.character-dock__portrait img,'));
  const figure = media.slice(0, media.indexOf('}'));
  assert.match(figure, /object-fit: contain/);
  assert.match(figure, /object-position: bottom/);
  assert.match(figure, /height: 100%/);
  assert.doesNotMatch(figure, /object-fit: cover/);

  // Still a cut-out: no card, no frame, and still pointer-transparent.
  assert.doesNotMatch(stage, /^\s*(background|border|box-shadow):/m);
  assert.doesNotMatch(portrait, /^\s*(background|border|box-shadow):/m);
  assert.match(portrait, /pointer-events: none/);
});

test('in companion the character pointer runs live instead of deferring to a replay', () => {
  // Deferral is paid for by the classic stage dimming the canvas; the dock does
  // not dim it, so there is nothing to buy.
  assert.match(app, /agentCursorStore\.setDialogue\(companion \? null : activeCharacter\?\.id \?\? null\)/);
  // The dice / radial admission is a different gate and is untouched.
  assert.match(app, /syncFocus\('character-dialogue', !companion && activeCharacter !== null\)/);
});

test('the left rail is glass and parks at the edge until hovered, focused or tapped', () => {
  // The parked-state rule body, so a later rule cannot satisfy these by accident.
  const parked = railCss.slice(railCss.indexOf('\n.choice-rail {'), railCss.indexOf('\n.choice-rail:hover'));
  // Glass, not an opaque slab.
  assert.match(parked, /backdrop-filter: blur/);
  assert.doesNotMatch(railCss, /background: color-mix\(in srgb, var\(--ux-color-paper\)/);
  // Parked by transform, and not a hit target until it opens — a canvas drag
  // that starts at the left edge stays a canvas drag.
  assert.match(parked, /transform: translateX\(calc\(-100% \+ var\(--choice-rail-peek\)\)\)/);
  assert.match(parked, /pointer-events: none/);
  assert.match(railCss, /\.choice-rail:hover,\s*\.choice-rail:focus-within,\s*\.choice-rail\[data-rail-state='open'\] \{[\s\S]{0,200}transform: translateX\(0\)[\s\S]{0,120}pointer-events: auto/);
  // Keyboard reaches it without a pointer, and touch (no hover) taps the grip.
  assert.match(choiceRail, /data-rail-state=\{pinned \? 'open' : 'parked'\}/);
  assert.match(choiceRail, /className="choice-rail__grip"/);
  assert.match(choiceRail, /aria-expanded=\{pinned\}/);
  // A row must read as something you can press. Fully transparent with a
  // transparent border it was words floating on the scene
  // so it carries a thin dark plate
  // and a hairline. Hover still adds brightness rather than a solid fill, which
  // is what keeps the column from becoming a slab.
  const option = railCss.slice(railCss.indexOf('.choice-rail__option {'), railCss.indexOf('.choice-rail__option:hover'));
  assert.match(option, /background: color-mix\(in srgb, var\(--ux-color-ink\) \d+%, transparent\)/);
  assert.match(option, /border: 1px solid color-mix\(in srgb, var\(--ux-color-cream\) \d+%, transparent\)/);
  assert.doesNotMatch(option, /background: transparent/);
  assert.doesNotMatch(option, /border: 1px solid transparent/);
  // Still glass, not paper: the plate is ink over the scene, never a surface.
  assert.doesNotMatch(option, /var\(--ux-color-paper\)/);
  // Reduced motion: the rail still parks and opens, it just does not travel.
  assert.match(railCss, /@media \(prefers-reduced-motion: reduce\) \{\s*\.choice-rail \{\s*transition: none/);
});

test('the writer sheet never opens itself and never duplicates the classic stop control', () => {
  // The FAB only flashes its ring while the writer works.
  assert.match(fab, /writer-fab__ring/);
  // The only way in is a press: the ✎ itself, or the tray's 「全部 · N」.
  assert.deepEqual(fab.match(/onOpenChange\(true\)/g) ?? [], ['onOpenChange(true)']);
  assert.match(fab, /onMore=\{\(\) => onOpenChange\(true\)\}/);
  // `writer-stop-control` stays unique to the classic chrome (app-nook-camera-contract).
  assert.equal((app.match(/className="writer-stop-control"/g) ?? []).length, 1);
  assert.doesNotMatch(fab, /writer-stop-control/);
});

test('the places list names everywhere you can go, nearest first', () => {
  const { railPlaces, PLACE_GLYPHS } = railLib;
  const layers = {
    map: { name: '雾坞镇' },
    harbour: { name: '港口', parent: 'map' },
    'harbour-office': { name: '调查所', parent: 'harbour' },
    lighthouse: { name: '灯塔', parent: 'map' },
  };
  const here = railPlaces(layers, 'harbour');
  assert.deepEqual(here.map(place => `${place.relation}:${place.id}`), [
    'here:harbour',            // where you are, listed and never a link
    'parent:map',              // the way out comes first
    'child:harbour-office',    // then the rooms inside this one
    'elsewhere:lighthouse',    // then the rest of the world
  ]);
  // Names come from the manifest; an undeclared one is made readable, not raw.
  assert.equal(here[1].name, '雾坞镇');
  assert.equal(railPlaces({ map: {}, 'old-pier': { parent: 'map' } }, 'map')[1].name, 'old pier');
  // Total over whatever the manifest holds.
  assert.deepEqual(railPlaces(undefined, 'map'), []);
  assert.deepEqual(railPlaces({}, 'map'), []);
  // A layer whose parent does not exist is still listed, just not as a way out.
  assert.equal(railPlaces({ map: {}, ghost: { parent: 'gone' } }, 'map')[1].relation, 'elsewhere');
  // Every relation has an arrow, and where-you-are is not a door.
  for (const relation of ['here', 'parent', 'child', 'elsewhere']) {
    assert.ok(PLACE_GLYPHS[relation], relation);
  }
  assert.notEqual(PLACE_GLYPHS.here, PLACE_GLYPHS.parent);
});

test('the rail renders the places at its foot, and the current one is not a button', () => {
  assert.match(choiceRail, /className="choice-rail__group choice-rail__places"/);
  assert.match(choiceRail, /Places you can go/);
  assert.match(choiceRail, /disabled=\{place\.relation === 'here' \|\| declared\.busy\}/);
  assert.match(choiceRail, /aria-current=\{place\.relation === 'here' \? 'location' : undefined\}/);
  // Below the layer's own options: those are about this room, this is leaving it.
  assert.ok(choiceRail.indexOf('choice-rail__places') > choiceRail.indexOf('choice-rail__option'));
  // App hands it the manifest's layers and the real navigation call.
  assert.match(app, /layers=\{manifest\?\.layers\}/);
  assert.match(app, /currentLayer=\{layer\}/);
  assert.match(app, /onEnterLayer=\{\(target\) => \{/);
  assert.match(app, /void enterLayer\(target\)\.then\(applyFollowFailures\)/);
});

test('coming back to a world reopens the companion where the player left it', () => {
  // A world with a companion opens WITH them, on any layer.
  assert.match(app, /\|\| \(!dockDismissed && defaultCompanion !== null\)/);
  // It must NOT be conditioned on standing on the entry layer, which is exactly
  // where a resumed save usually is not — that guard is what kept the stage
  // shut on every save the player had walked away from.
  const expanded = app.slice(app.indexOf('const dockExpanded ='), app.indexOf("const contentLanguage"));
  assert.doesNotMatch(expanded, /manifest\?\.entry/);
  assert.doesNotMatch(expanded, /layer ===/);
  // Only the player's own collapse suppresses it, and only until the next entry.
  assert.match(app, /const \[dockDismissed, setDockDismissed\] = useState\(false\)/);
  assert.match(app, /setDockDismissed\(false\);\s*\n\s*\}, \[manifest\?\.id\]\)/);
  // And reset on ENTERING a world, not only on a manifest id change: two saves
  // of one world share an id, and the presses that reach the launcher are
  // themselves outside-presses that collapse the dock on the way through — which
  // is what left the companion shut on every save loaded from the hall.
  assert.match(app, /await loadChromeData\(\);[\s\S]{0,520}setDockDismissed\(false\);[\s\S]{0,400}setWorldPickerOpen\(false\)/);
});

test('the writer button steps clear of the companion column instead of onto it', () => {
  // One number, read by both files, so the clearance cannot drift from the
  // width it is clearing.
  assert.match(css, /--ux-companion-column: \d+px;/);
  assert.match(dockCss, /--character-dock-column: var\(--ux-companion-column\)/);
  assert.match(fab, /data-clear-companion=\{clearCompanion \? 'true' : undefined\}/);
  // An NPC dialogue holds the same corner, so it clears for that too.
  assert.match(app, /clearCompanion=\{stageOnScreen && !nookChar\}/);
  assert.match(app, /const stageOnScreen = \(dockExpanded \|\| npcTalking\) && !stageYields;/);
  // `margin-right`, not a bigger `right`: this root is absolutely positioned in
  // the canvas shell with `right` already set, so adding to the margin moves the
  // box without touching the offset the corner is measured from.
  assert.match(fabCss, /\.writer-fab\[data-clear-companion='true'\] \{\s*margin-right: calc\(var\(--ux-companion-column\) \+ 4px\);/);
  assert.match(fabCss, /transition: margin-right var\(--ux-motion-panel\)/);
  // Narrow: the dock spans the width, so there is no column to step around.
  assert.match(fabCss, /@media \(max-width: 1100px\) \{\s*\.writer-fab\[data-clear-companion='true'\] \{\s*margin-right: 0;/);
  // The component carries the flag only; the offset itself is not inlined.
  assert.doesNotMatch(fab, /marginRight/);
});

test('the call is reachable from the conversation, and it is still ONE call', () => {
  // The entry used to exist only inside an avatar's hover menu, two gestures
  // from the person you are already talking to.
  assert.match(dock, /className=\{`character-dock__call is-\$\{call\.phase\}`\}/);
  assert.match(dock, /const call = useLiveCallState\(\)/);
  assert.match(dock, /const callAvailable = useLiveCallAvailable\(\)/);
  // Owner-scoped: hanging up here cannot end a call the rail started, and a
  // call someone else owns is not startable from here either.
  assert.match(dock, /const dockCallOwner = active \? `dock:\$\{active\.id\}` : null/);
  assert.match(dock, /const callBusyElsewhere = callLive && call\.owner !== dockCallOwner/);
  assert.match(dock, /disabled=\{callBusyElsewhere \|\| \(!dockOnCall && !worldPath\)\}/);
  // The dock holds no call state of its own — it owns a door, not a session.
  assert.doesNotMatch(dock, /useState<[^>]*LiveCall/);
  // Hidden entirely when the service cannot take a call.
  assert.match(dock, /\{callAvailable && active && \(/);
});
