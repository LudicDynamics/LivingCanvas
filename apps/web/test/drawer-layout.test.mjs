// One layout for the message drawer, the people and the writer; one placement for every tutorial pointer
//. Pure parts as units, the wiring as source constraints.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const app = await read('../src/App.tsx');
const drawerCss = await read('../src/components/chrome/message-drawer.css');
const guide = await read('../src/components/chrome/OnboardingGuide.tsx');
const guideCss = await read('../src/components/chrome/onboarding-guide.css');
const forced = await read('../src/components/chrome/ForcedTutorial.tsx');
const forcedCss = await read('../src/components/chrome/forced-tutorial.css');
const cueCard = await read('../src/components/chrome/TutorialCueCard.tsx');
const npc = await read('../src/components/sidebar/NpcDialogue.tsx');
const drawer = await read('../src/components/chrome/MessageDrawer.tsx');

const jiti = createJiti(import.meta.url, { moduleCache: false });
const L = await jiti.import('../src/lib/drawer-layout.ts');
const { placeGuideBubble } = await jiti.import('../src/lib/guide-placement.ts');

// ── pure ─────────────────────────────────────────────────────────────────────────

test('the bottom stack is the distance to the highest visible bottom panel', () => {
  assert.equal(L.bottomStackOf([null, 800, 650], 844), 194);
  assert.equal(L.bottomStackOf([null, null, null], 844), 0);
  assert.equal(L.bottomStackOf([900], 844), 0, 'a panel below the fold does not count');
  assert.equal(L.BOTTOM_PANELS.length, 3);
});

test('a pointer bubble keeps clear of an avoided panel while another side fits, else stands where it was', () => {
  const viewport = { width: 1440, height: 900 };
  const bubble = { width: 248, height: 100 };
  // A target in the middle of the screen: the plain rule puts the bubble on its right.
  const box = { top: 400, left: 600, width: 100, height: 40 };
  const plain = placeGuideBubble({ box, viewport, bubble });
  assert.equal(plain.side, 'right');
  // The writer sheet sits right there: the bubble goes to the left instead.
  const sheet = { top: 300, left: 700, width: 400, height: 300 };
  const moved = placeGuideBubble({ box, viewport, bubble, avoid: [sheet] });
  assert.equal(moved.side, 'left');
  // Panels on every side: the plain placement stands (never off screen, never nowhere).
  const walls = [{ top: 0, left: 0, width: 600, height: 900 }, { top: 0, left: 700, width: 740, height: 900 }, { top: 0, left: 600, width: 100, height: 400 }, { top: 440, left: 600, width: 100, height: 460 }];
  assert.deepEqual(placeGuideBubble({ box, viewport, bubble, avoid: walls }), plain);
});

test('the guide steps whose target lives in the drawer name the page to pull up', () => {
  assert.equal(L.DRAWER_HOSTED_TARGETS.options, 'options');
  assert.equal(L.NARROW_LAYOUT_QUERY, '(max-width: 1100px)');
});

// ── the drawer and the people ────────────────────────────────────────────────────

test('narrow screens have one bottom area; the writer folds a stage everywhere; folding is derived', () => {
  assert.match(app, /const stageYields = streamOn && \(writerSheetOpen \|\| \(narrowLayout && streamOpen\)\);/);
  assert.match(app, /const stageShown = dockExpanded && !npcTalking && !stageYields;/);
  assert.match(app, /expanded=\{stageShown\}/);
  assert.match(app, /yielded=\{stageYields\}/);
  assert.match(npc, /hidden=\{yielded \|\| undefined\}/);
  assert.match(drawerCss, /\.character-dock__stage\[hidden\] \{ display: none; \}/);
  // A dialogue opened on a narrow screen takes the bottom back.
  assert.match(app, /if \(narrowLayout && \(activeCharacter !== null \|\| npcTalking\)\) setStreamSolo\(false\);/);
  // The character sheet (player panel) and the drawer share the bottom-left: one at a time.
  assert.match(app, /if \(!profileOpen\) return;\s*setStreamSolo\(false\);/);
  assert.match(app, /const openStreamAt = useCallback\(\(path\?: string\) => \{\s*setProfileOpen\(false\);/);
  // No drawer under the lobby.
  assert.match(app, /const streamOn = companion && !nookChar && !launcherOpen;/);
});

test('the writer docks to the drawer it rose with: beside it on wide screens, on top of it on phones', () => {
  assert.match(app, /data-stream-open=\{streamOpen \? 'true' : undefined\}/);
  assert.match(drawerCss, /\.airp-prototype\[data-stream-open='true'\] \.writer-fab__sheet \{\s*left: calc\(/);
  assert.match(drawerCss, /@media \(max-width: 700px\) \{[\s\S]*\.airp-prototype\[data-stream-open='true'\] \.writer-fab__sheet \{[\s\S]{0,200}bottom: calc\(var\(--airp-bottom-stack/);
  // What docks "above the input" on a phone follows the real bottom stack.
  assert.match(drawerCss, /body \.tick-said--dock,\s*body \.tick-invite--dock \{\s*bottom: calc\(var\(--airp-bottom-stack/);
  assert.match(app, /useBottomStack\(streamOn\);/);
  // With the drawer up on a narrow screen an event card (already in the drawer) does not sit on the writer.
  assert.match(drawerCss, /\.airp-prototype\[data-stream-open='true'\] \.story-events \{ display: none; \}/);
});

test('NPC talks go to the stream too, and their stage keeps the latest exchange', () => {
  assert.match(npc, /messageStream\.record\(\{\s*id: `npc:\$\{target\.path\}/);
  assert.match(npc, /latestExchange\(target\.dialogue\.map/);
  assert.match(drawer, /const name = \(entry\.who \? faces\[entry\.who\]\?\.name : undefined\) \?\? entry\.name;/);
});

// ── tutorials ───────────────────────────────────────────────────────────────────

test('a guide step inside the closed drawer pulls the drawer up and is not passed over', () => {
  assert.match(guide, /if \(DRAWER_HOSTED_TARGETS\[GUIDE_TARGET_OF\[step\]\] && document\.querySelector\('\.message-drawer'\)\)/);
  assert.match(guide, /requestDrawer\(hostTab\);/);
  // Once up, closing it is the player's choice; no loop re-opening it.
  assert.match(guide, /\(!asked\.landed && now - asked\.at > DRAWER_RETRY_MS\)/);
  assert.match(app, /useEffect\(\(\) => onDrawerRequest\(\(\{ tab \}\) => \{/);
  assert.match(drawer, /if \(tabRequest && \(tabRequest\.tab === 'stream' \|\| options\)\) setTab\(tabRequest\.tab\);/);
});

test('the first-run tutorial and the guide place their bubbles with one rule, clear of the panels', () => {
  assert.match(forced, /const place = placeGuideBubble\(\{[\s\S]{0,300}avoid: avoidRects\(targetRef\.current\),/);
  assert.match(guide, /avoid: avoidRects\(document\.querySelector\(guideSelector\(step\)\)\),/);
  assert.match(cueCard, /avoid: avoidRects\(anchor\?\.node \?\? null\),/);
  // One look: tokens, the guide's radius and shadow.
  assert.match(forcedCss, /\.forced-tutorial__bubble \{[\s\S]{0,400}border-radius: var\(--ux-radius-panel\);[\s\S]{0,200}background: var\(--ux-color-cream\);/);
  assert.doesNotMatch(forcedCss.slice(forcedCss.indexOf('.forced-tutorial__bubble')), /#[0-9a-fA-F]{6}\b/);
  // A step on the dialogue stage lowers a drawer that covers it; the last step can find its place in the drawer.
  assert.match(forced, /if \(\(state\.step !== 'speak' && state\.step !== 'follow'\) \|\| rect !== null\) return;/);
  assert.match(forced, /requestDrawer\('options'\);/);
});

test('the teach-once cues have a card: one at a time, after the first-run tutorial, beside what they are about', () => {
  assert.match(app, /<TutorialCueCard \/>/);
  assert.match(cueCard, /window\.addEventListener\('airp:tutorial-cue', onCue\)/);
  assert.match(cueCard, /setBlocked\(document\.querySelector\('\.forced-tutorial'\) !== null\)/);
  assert.match(cueCard, /markTaught\(cue\.id\);/);
  for (const id of ['first-inspiration', 'first-passive', 'first-follow', 'first-skill']) assert.match(cueCard, new RegExp(`'${id}': \\[`));
  assert.match(guideCss, /:root\[data-tutorial-cue\] \.onboarding-guide:not\(\.tutorial-cue\) \{ display: none; \}/);
});
