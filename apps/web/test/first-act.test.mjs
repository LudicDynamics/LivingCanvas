// The first act: a greeter is already speaking when the world
// opens, ONE coach mark points at the reply box, and the conversation itself is
// the tutorial. The invariants worth pinning are the ones a refactor would
// quietly break: the greeting is DISPLAY (no agent), the dock opens expanded
// without a click, the marker is written when the greeting is SHOWN (it is said
// once per save —), `classic` has none of it, and declining the invitation sends nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const opening = await jiti.import('../src/lib/opening.ts');
const { planOpening } = opening;

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const dock = await readFile(new URL('../src/components/sidebar/CharacterDock.tsx', import.meta.url), 'utf8');
const dialogue = await readFile(new URL('../src/lib/character-dialogue.ts', import.meta.url), 'utf8');

const vera = { id: 'vera', greeting: 'Ask me what I saw.', invitesFollowLine: 'Want me along?' };

test('a declared greeter with a line speaks; the invitation is optional', () => {
  assert.deepEqual(planOpening({ opening: { greeter: 'vera' }, characters: [vera] }), {
    greeterId: 'vera',
    line: 'Ask me what I saw.',
    invite: 'Want me along?',
  });
  // No invitation line → the plan still stands, the act ends after the answer.
  assert.equal(planOpening({ opening: { greeter: 'vera' }, characters: [{ id: 'vera', greeting: 'Hi.' }] })?.invite, null);
});

test('a world with nobody to speak opens in the narrator’s voice', () => {
  const plan = planOpening({ opening: { greeting: 'Rain on the roof.' }, characters: [] });
  assert.deepEqual(plan, { greeterId: null, line: 'Rain on the roof.', invite: null });
});

test('a half-authored greeter falls back rather than showing an empty bubble', () => {
  // Named but absent from the cast.
  assert.equal(planOpening({ opening: { greeter: 'ghost', greeting: 'Rain.' }, characters: [vera] })?.greeterId, null);
  // Present but with no line of their own.
  assert.equal(planOpening({ opening: { greeter: 'vera', greeting: 'Rain.' }, characters: [{ id: 'vera' }] })?.line, 'Rain.');
  // Nothing at all declared → no first act, not an empty one.
  assert.equal(planOpening({ characters: [vera] }), null);
  assert.equal(planOpening({ opening: { greeter: '  ', greeting: '  ' }, characters: [vera] }), null);
});

test('the four-step tour is gone: no steps, no spotlight, no step counter', async () => {
  // The module that described the tour no longer exports one (2026-09-20).
  assert.equal(opening.TUTORIAL_STEPS, undefined);
  assert.equal(opening.INVITE_STEP, undefined);
  // And the sheet that rendered it is deleted, not merely unmounted.
  await assert.rejects(readFile(new URL('../src/components/chrome/TutorialSpotlight.tsx', import.meta.url), 'utf8'));
  assert.doesNotMatch(app, /TutorialSpotlight|tutorial-spotlight/);
  assert.doesNotMatch(dock, /Step \{n\} of \{total\}/);
});

test('the dock opens already expanded on the greeter — no click starts the act', () => {
  // The greeter is the dock's subject when no agent is active, and a live
  // opening is what opens the stage on them — so the expanded state is reached
  // by entering the world rather than by pressing an avatar.
  assert.match(app, /const dockCharacter = activeCharacter \?\? defaultCompanion;/);
  assert.match(app, /const dockExpanded = activeCharacter !== null[\s\S]{0,140}opening\?\.greeterId/);
  // Expanding focuses the reply box; that focus is what the coach mark points
  // at. It follows the stage OPENING, not the mere presence of a companion.
  assert.match(dock, /if \(active && expanded\) inputRef\.current\?\.focus\(\)/);
  assert.match(dock, /const onStage = active !== null && expanded;/);
  assert.match(dock, /data-dock-state=\{onStage \? 'expanded' : 'collapsed'\}/);
});

test('exactly one coach mark exists, and it sits on the reply box', () => {
  assert.equal((dock.match(/character-dock__coach"/g) ?? []).length, 1);
  assert.match(dock, /opening\?\.coach (?:&& !gate )?&& \([\s\S]{0,200}character-dock__coach/);
  // It is shown only while the greeting is unanswered, and only when there is
  // someone to answer — a narrated world has no reply box to point at.
  assert.match(app, /coach: opening\.phase === 'greeting' && opening\.greeterId !== null/);
});

test('the greeting is seeded, not sent: no agent starts until the player answers', () => {
  // The dock hands the line to the dialogue projection as a seed…
  assert.match(dock, /useCharacterDialogue\(active\?\.id \?\? null, frameQueue, opening\?\.line, worldPath\)/);
  // …which plants it in the scrollback rather than routing it through a frame.
  assert.match(dialogue, /seed\?: string \| null/);
  assert.match(dialogue, /setLines\(seedLine[\s\S]*who: 'character'/);
  // `character_start` fires on the first reply, and carries the greeting the
  // agent never saw.
  assert.match(app, /openCharacter\(dockCharacter, opening\?\.line\)/);
  assert.match(app, /recentContext: \[scene, prior\]\.filter\(Boolean\)/);
});

test('the authored greeting is said once per save: the marker is written when it shows', () => {
  // Asked once per world, from the server — not remembered in this browser.
  // One shared read per world load (the opening scene card reads the same answer).
  assert.match(app, /await readOpeningOnce\(runKey\)\)\.shown/);
  assert.match(app, /read: airpGateway\.opening\(\)/);
  // Two `markOpening(true)`: the answered path, and the arrival with NO authored
  // greeting (there is nothing there that could be replayed).
  assert.equal((app.match(/markOpening\(true\)/g) ?? []).length, 2);
  const answered = app.slice(app.indexOf('const openingAnswered ='), app.indexOf('const finishOpening ='));
  assert.match(answered, /markOpeningShown\(\)/);
  assert.match(answered, /current\.invite \? \{ \.\.\.current, phase: 'invite' \} : null/);
  // Showing an AUTHORED greeting marks the save at once
  // replaying the same words on every visit was the bug.
  // The answer still marks it too — harmless, and the no-greeting path is unchanged.
  const planted = app.slice(app.indexOf('      if (plan) {'), app.indexOf("greetReturningPlayerRef.current('arrive');"));
  assert.match(planted, /setOpening\(\{ \.\.\.plan, phase: 'greeting' \}\);/);
  assert.match(planted, /markOpeningShown\(\);\s*\n\s*return;/);
  // The dock reports the answer by watching the turn end, so an aborted turn
  // still counts as answered rather than replaying the greeting forever.
  assert.match(dock, /awaitingAnswer && was !== 'idle' && dialogue\.phase === 'idle'/);
  assert.match(app, /awaitingAnswer: opening\.phase === 'answering'/);
});

test('the first act is companion-only; classic has none of it', () => {
  assert.match(app, /if \(!companion \|\| !worldId \|\| characters\.length === 0\) return;/);
  // The dock itself is only mounted in companion, so the opening prop cannot
  // reach the classic shell.
  assert.match(app, /companion \? \([\s\S]{0,4000}<CharacterDock/);
});

test('the invitation is a line in the conversation, not a step', () => {
  // It renders inside the scrollback, next to the character's other lines.
  const lines = dock.slice(dock.indexOf('character-dock__lines'), dock.indexOf('character-dock__coach'));
  assert.match(lines, /opening\?\.invite &&/);
  assert.match(lines, /character-dock__line--character/);
  // It only appears once they have actually answered.
  assert.match(app, /invite: opening\.phase === 'invite' \? opening\.invite : null/);
});

test('declining the invitation sends nothing; accepting is the existing follow', () => {
  const invite = app.slice(app.indexOf('onAcceptFollow:'), app.indexOf('onClose={() => {'));
  assert.match(invite, /toggleFollowing\(opening\.greeterId, true\)/);
  // The decline handler is `finishOpening` and nothing else — no gateway call,
  // no `set_following`, no message.
  assert.match(invite, /onDeclineFollow: finishOpening,/);
  assert.doesNotMatch(invite.slice(invite.indexOf('onDeclineFollow')), /toggleFollowing|sendMessage/);
  // And `finishOpening` only clears the act; the conversation continues.
  assert.match(app, /const finishOpening = useCallback\(\(\) => setOpening\(null\), \[\]\);/);
});

// ── A companion who was never talked to must not vanish ────
// "我从这个角色里面出来之后，没有跟这个角色聊天，这个角色就消失了…理论上就一直让
// 这个角色在这个环境里就好。默认出现的位置就是第一幕。"

test('the default companion comes from the manifest, not from the opening state', () => {
  // Presence is read off `manifest.opening.greeter` directly. Deriving it from
  // the `opening` STATE is what made the character leave with the first act.
  assert.match(app, /const greeterId = companionIdOf\(manifest\?\.opening, characters\) \?\? '';/);
  assert.match(app, /const defaultCompanion = greeterId !== ''[\s\S]{0,120}characters\.find\(item => item\.id === greeterId\)/);
  assert.match(app, /const dockCharacter = activeCharacter \?\? defaultCompanion;/);
  // The subject must NOT be conditioned on the opening any more.
  assert.doesNotMatch(app, /const dockCharacter = activeCharacter\s*\?\?\s*\(opening\?\.greeterId/);
  // A world that names no greeter still has one: the first of its cast.
  assert.match(app, /falls back to the first of its cast \(`companionIdOf`\)/);
});

test('closing the first act collapses the stage and keeps the companion', () => {
  const close = app.slice(app.indexOf('onClose={() => {'), app.indexOf('onSendMessage={(message) => {'));
  // Dismissal no longer throws the plan away; it only closes the stage.
  assert.match(close, /setOpeningDismissed\(true\); return;/);
  assert.doesNotMatch(close, /setOpening\(null\); return;/);
  // And a collapse is the player's word on it, so the auto-open that restores
  // the stage on entry hears it too — otherwise the close button does nothing.
  assert.match(close, /setDockDismissed\(true\);/);
  // Presence and openness are two different questions in the dock, too.
  assert.match(dock, /expanded\?: boolean;/);
  // An open NPC conversation takes the right column, so the dock yields to it.
  // Derived: the stage also steps back while the writer / a narrow-screen drawer is up.
  assert.match(app, /expanded=\{stageShown\}/);
  assert.match(app, /const stageShown = dockExpanded && !npcTalking && !stageYields;/);
  // The subject is what the dialogue projection is keyed on, so a collapse
  // cannot re-key it and cannot empty the scrollback.
  assert.match(dock, /useCharacterDialogue\(active\?\.id \?\? null, frameQueue, opening\?\.line, worldPath\)/);
});

test('a seed that goes away never wipes the scrollback', () => {
  // The first act ending hands the dock `null` where the greeting used to be.
  // Re-seeding on that is exactly what erased a conversation the player had
  // just read, so the effect must ignore a seed that merely stops being offered.
  assert.match(dialogue, /lastSeedRef/);
  assert.match(
    dialogue,
    /previous\.characterId === characterId &&\s*previous\.worldPath === worldPath &&\s*\(seedLine === null \|\| seedLine === previous\.seed\)\s*\) return;/,
  );
});

test('a greeter the player came back to is still answering the first act', () => {
  // Reopening carries the greeting as the agent's prior line, so the screen and
  // the agent still agree on what was said.
  assert.match(app, /const prior = opening\?\.greeterId === id && opening\.phase === 'greeting'/);
  assert.match(app, /openCharacter\(character, prior\)/);
  // And answering there still ends the act, so the save's marker is written.
  assert.match(app, /current\.greeterId === activeCharacter\.id && current\.phase === 'greeting'/);
  assert.match(app, /\{ \.\.\.current, phase: 'answering' \}/);
});

// ── The companion speaks first, in every world, every time
//    ─────────────────────────────

test('every world names a companion who has a first line', async () => {
  const { readdir } = await import('node:fs/promises');
  const templates = new URL('../../../templates/', import.meta.url);
  const worlds = (await readdir(templates, { withFileTypes: true })).filter(entry => entry.isDirectory());
  assert.ok(worlds.length >= 20, `expected the template worlds, found ${worlds.length}`);
  for (const world of worlds) {
    let manifest;
    try { manifest = JSON.parse(await readFile(new URL(`${world.name}/world.json`, templates), 'utf8')); } catch { continue; }
    const greeter = manifest.opening?.greeter;
    assert.ok(typeof greeter === 'string' && greeter.trim(), `${world.name}: no one speaks first — name opening.greeter`);
    assert.ok(manifest.characters.some(character => character.id === greeter), `${world.name}: greeter "${greeter}" is not in the cast`);
    const readme = await readFile(new URL(`${world.name}/characters/${greeter}/README.md`, templates), 'utf8');
    assert.match(readme, /^greeting: .+$/m, `${world.name}: ${greeter} has no greeting line`);
  }
});

test('coming back, the companion is asked to open — in the world’s own language', () => {
  const { returnCue } = opening;
  const zh = returnCue('zh-CN');
  const ja = returnCue('ja');
  const en = returnCue('en');
  const ko = returnCue('ko');
  assert.match(zh, /请你先开口/);
  assert.match(ja, /あなたから先に/);
  assert.match(en, /Speak first/);
  assert.match(ko, /네가 먼저/, 'a Korean world gets a Korean cue (an English one would pull the reply into English)');
  assert.match(returnCue('ko', 'arrive'), /아직 서로 말을 나누지 않았다/);
  // It is a note, not a line the player said, and the character must not echo it.
  for (const cue of [zh, ja, en, ko]) assert.ok(cue.length < 320, 'a short cue, not a second system prompt');
  assert.match(zh, /不是玩家说的话/);
  assert.match(zh, /不要提到这条提示/);
  assert.match(en, /Do not mention this note/);
  assert.equal(returnCue(undefined), en, 'an unknown locale falls back to English');
});

test('a spent first act is answered by a greeting, not by silence', () => {
  // Where the marker says "shown", the companion is opened and prompted.
  assert.match(app, /if \(\(await readOpeningOnce\(runKey\)\)\.shown\) \{\s*\n[^\n]*\n[^\n]*\n\s*if \(live\) \{ concluded = true; greetReturningPlayerRef\.current\(\); \}\s*\n\s*return;/);
  assert.match(app, /openCharacterRef\.current\(greeter\);\s*\n\s*sendMessage\(\{ type: 'character_prompt', characterId: greeter\.id, message: returnCue\(manifest\?\.locale, occasion\), savePath: activeWorldPath \}\);/);
  // The cue never lands in the scrollback as the player's line.
  const greet = app.slice(app.indexOf('greetReturningPlayerRef.current = () => {'), app.indexOf('greetReturningPlayerRef.current = () => {') + 600);
  assert.doesNotMatch(greet, /pushPlayerLine/);
  // Every load decides afresh: two saves of one world share an id.
  assert.match(app, /setDockDismissed\(false\);[\s\S]{0,300}openingWorldRef\.current = null;\s*\n\s*setWorldPickerOpen\(false\);/);
});

test('a world or save with no authored greeting still has a companion who speaks first', () => {
  const { companionIdOf, returnCue } = opening;
  const cast = [{ id: 'vera' }, { id: 'old-mo' }];
  assert.equal(companionIdOf({ greeter: 'old-mo' }, cast), 'old-mo', 'the declared greeter');
  assert.equal(companionIdOf(undefined, cast), 'vera', 'a save made before openings: the first of the cast');
  assert.equal(companionIdOf({ greeter: 'ghost' }, cast), 'vera', 'a greeter not in the cast is not trusted');
  assert.equal(companionIdOf(undefined, []), null, 'only an empty world is silent');
  // The first arrival is asked differently from a return, in each language.
  assert.match(returnCue('zh-CN', 'arrive'), /刚来到这里/);
  assert.match(returnCue('ja', 'arrive'), /今ここに着いた/);
  assert.match(returnCue('en', 'arrive'), /just arrived/);
  assert.notEqual(returnCue('zh-CN', 'arrive'), returnCue('zh-CN', 'return'));
  // With no plan, the app asks the companion to open and sets the marker so the
  // next visit is a return, not another first arrival.
  assert.match(app, /greetReturningPlayerRef\.current\('arrive'\);\s*\n\s*void airpGateway\.markOpening\(true\)/);
  assert.match(app, /const greeterId = companionIdOf\(manifest\?\.opening, characters\) \?\? '';/);
});

test('the first line waits for a live socket, because entering a world replaces it', async () => {
  // The companion's first line was lost on 2026-09-25: it was sent in the same
  // instant the world load swapped the socket. It is now queued and sent once
  // the socket is open AND past its replay window.
  const useWorld = await readFile(new URL('../src/state/useWorld.ts', import.meta.url), 'utf8');
  assert.match(useWorld, /socketLive: socketOpen && !replaying,/);
  assert.match(useWorld, /ws\.onopen = \(\) => \{\s*\n[^\n]*\n\s*setSocketOpen\(true\);/);
  assert.match(useWorld, /wsRef\.current = null;\s*\n\s*setSocketOpen\(false\);/);
  assert.match(app, /if \(manifest\?\.id\) setPendingGreeting\(\{ occasion, worldId: manifest\.id, entry: runKey \}\);/);
  assert.match(app, /if \(!pendingGreeting \|\| !world\.socketLive\) return;/);
  // A greeting queued for a world the player already left is not delivered there.
  assert.match(app, /if \(worldId !== manifest\?\.id\) \{ settleArrival\(entry, 'none'\); return; \}/);
});
