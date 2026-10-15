// The first-run experience: who gets it, the language screen, the guest entry into
// 末班车 · 序章, the reply chips, the two-choice ending, the build flag and its fallbacks. Pure decisions through
// jiti; the wiring in App / the dock / the ending card by source.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const fr = await jiti.import('../src/lib/first-run.ts');
const gate = await jiti.import('../src/lib/play-gate.ts');
const gt = await jiti.import('../src/lib/guest-trial.ts');
const tiers = await jiti.import('../src/lib/dice-tier.ts');
const xp = await import('@airp/shared/experience');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');

const base = { flag: true, forced: false, deepLink: false, access: 'guest', mark: null, localeChosen: false, groups: [] };
const prologueSave = { id: 'last-train-prologue-zh', saves: [{ path: 'worlds/last-train-prologue-zh-1', updatedAt: '2026-10-10T01:00:00Z' }, { path: 'worlds/last-train-prologue-zh-2', updatedAt: '2026-10-10T02:00:00Z' }] };

test('who gets it: a new visitor who may play signed out; everyone else keeps the lobby', () => {
  assert.deepEqual(fr.decideFirstRun({ ...base, flag: false }), { kind: 'off', reason: 'flag' }, 'build flag off → exactly as before');
  assert.deepEqual(fr.decideFirstRun({ ...base, deepLink: true }), { kind: 'off', reason: 'link' }, 'a link to a world is followed instead');
  assert.deepEqual(fr.decideFirstRun({ ...base, access: 'signed-in' }), { kind: 'off', reason: 'returning' });
  assert.deepEqual(fr.decideFirstRun({ ...base, mark: 'done' }), { kind: 'off', reason: 'returning' });
  assert.deepEqual(fr.decideFirstRun({ ...base, groups: [{ id: 'wuwu', saves: [{ path: 'worlds/wuwu-1' }] }] }), { kind: 'off', reason: 'returning' }, 'any other save = a returning visitor');
  // …but not the local server's boot copy, which every fresh install has.
  assert.deepEqual(fr.decideFirstRun({ ...base, groups: [{ id: 'wuwu', saves: [{ path: 'worlds/wuwu-default' }] }] }), { kind: 'start', askLanguage: true });
  // §9.5: whether a guest session can be had never hides the language screen from a new visitor.
  assert.deepEqual(fr.decideFirstRun({ ...base, access: 'sign-in' }), { kind: 'start', askLanguage: true });
});

test('new visitors: the language screen unless already chosen (?lang= / stored); an unfinished prologue resumes', () => {
  assert.deepEqual(fr.decideFirstRun(base), { kind: 'start', askLanguage: true });
  assert.deepEqual(fr.decideFirstRun({ ...base, localeChosen: true }), { kind: 'start', askLanguage: true }, 'a chosen language only preselects (the screen also holds 直接试玩 / 看看所有世界)');
  assert.deepEqual(fr.decideFirstRun({ ...base, access: 'go' }), { kind: 'start', askLanguage: true }, 'local without an account requirement plays too');
  assert.deepEqual(fr.decideFirstRun({ ...base, groups: [prologueSave] }), { kind: 'resume', path: 'worlds/last-train-prologue-zh-2' }, 'the newest prologue save');
  assert.deepEqual(fr.decideFirstRun({ ...base, groups: [prologueSave], mark: 'done' }), { kind: 'off', reason: 'returning' });
});

test('?first-run=1 forces it (local testing): the language screen always, whatever the access and the saves', () => {
  assert.deepEqual(fr.decideFirstRun({ ...base, forced: true, access: 'signed-in', mark: 'done', localeChosen: true }), { kind: 'start', askLanguage: true });
  assert.deepEqual(fr.decideFirstRun({ ...base, forced: true, access: 'sign-in' }), { kind: 'start', askLanguage: true });
  // the team's own machine: login on, not signed in, guest trial on, many saves (a returning visitor) → forced still asks
  assert.deepEqual(fr.decideFirstRun({ ...base, forced: true, access: 'guest', groups: [{ id: 'wuwu', saves: [{ path: 'worlds/wuwu-1' }] }, prologueSave] }), { kind: 'start', askLanguage: true });
  assert.deepEqual(fr.decideFirstRun({ ...base, forced: true, flag: false }), { kind: 'off', reason: 'flag' }, 'never without the build flag');
  assert.deepEqual(fr.firstRunParams('?first-run=1'), { forced: true, deepLink: false });
  assert.deepEqual(fr.firstRunParams('?world=wuwu'), { forced: false, deepLink: true });
  assert.deepEqual(fr.firstRunParams(''), { forced: false, deepLink: false });
});

test('access: the account mode → how a signed-out visitor gets in', () => {
  assert.equal(fr.firstRunAccessOf({ kind: 'none' }), 'go');
  assert.equal(fr.firstRunAccessOf({ kind: 'local', signedIn: false, required: false }), 'go');
  assert.equal(fr.firstRunAccessOf({ kind: 'local', signedIn: false, required: true, guestTrial: true }), 'guest');
  assert.equal(fr.firstRunAccessOf({ kind: 'local', signedIn: false, required: true }), 'sign-in', 'the trial off');
  assert.equal(fr.firstRunAccessOf({ kind: 'local', signedIn: true, required: true }), 'signed-in');
  assert.equal(fr.firstRunAccessOf({ kind: 'hosted', signedIn: false }), 'sign-in');
});

test('the prologue edition follows the chosen language; the ending leads to the same language of the next world', () => {
  assert.equal(fr.prologueIdFor('zh-CN'), 'last-train-prologue-zh');
  assert.equal(fr.prologueIdFor('ja'), 'last-train-prologue-jp');
  assert.equal(fr.prologueIdFor('ko'), 'last-train-prologue-ko');
  assert.equal(fr.prologueIdFor('en'), 'last-train-prologue');
  assert.equal(xp.editionIdFor('last-train', 'zh-CN'), 'last-train-zh');
  // The ending's first choice: the full 末班车 in the PROLOGUE's language, whatever the interface says.
  assert.equal(fr.PROLOGUE_NEXT_BASE, 'last-train');
  assert.equal(fr.prologueNextIdFor('last-train', 'last-train-prologue-zh', 'zh-CN', 'en'), 'last-train-zh');
  assert.equal(fr.prologueNextIdFor('last-train', 'last-train-prologue-jp', 'ja', 'zh-CN'), 'last-train-jp');
  assert.equal(fr.prologueNextIdFor('last-train', 'last-train-prologue-ko', 'ko', 'ja'), 'last-train-ko');
  assert.equal(fr.prologueNextIdFor('last-train', 'last-train-prologue', 'en', 'ko'), 'last-train');
  assert.equal(fr.prologueNextIdFor('last-train', 'some-other-prologue', 'ja', 'en'), 'last-train-jp', 'another world: its own language');
  assert.equal(fr.prologueNextIdFor(undefined, 'last-train-prologue-zh', 'zh-CN', 'zh-CN'), null);
  for (const id of ['last-train-prologue', 'last-train-prologue-zh', 'last-train-prologue-jp', 'last-train-prologue-ko']) assert.equal(fr.isPrologueId(id), true, id);
  for (const id of ['last-train', 'last-train-zh', 'last-train-prologue-xx']) assert.equal(fr.isPrologueId(id), false, id);
  assert.equal(fr.prologuePathOf([{ id: 'last-train-prologue-zh', templatePath: 'templates/last-train-prologue-zh' }], 'last-train-prologue-zh'), 'templates/last-train-prologue-zh');
  assert.equal(fr.prologuePathOf([], 'last-train-prologue'), 'templates/last-train-prologue');
});

test('the build flag: only VITE_AIRP_FIRST_RUN=1; on in the hosted config and the local one', async () => {
  assert.equal(fr.firstRunBuild({}), false);
  assert.equal(fr.firstRunBuild({ VITE_AIRP_FIRST_RUN: '0' }), false);
  assert.equal(fr.firstRunBuild({ VITE_AIRP_FIRST_RUN: '1' }), true);
  // The hosted mode file is not part of the open-source copy (only config/.env.local ships).
  const remote = await src('../../../config/.env.remote').catch(() => null);
  if (remote !== null) assert.match(remote, /^VITE_AIRP_FIRST_RUN=[01]$/m, 'the hosted config sets the flag explicitly');
  assert.match(await src('../../../config/.env.local'), /^VITE_AIRP_FIRST_RUN=1$/m);
});

test('reply chips: the first reply from opening.replies; later the cards\' options — the door first, talk options left out, at most three', () => {
  assert.deepEqual(xp.openingRepliesFor(['a', 'b', 'c'], 'en', 'zh-CN'), ['a', 'b', 'c']);
  assert.deepEqual(xp.openingRepliesFor({ 'zh-CN': ['甲'], en: ['A'] }, 'ja', 'zh-CN'), ['甲'], 'a per-locale map falls back to the world language');
  assert.deepEqual(xp.openingRepliesFor({ en: ['A'] }, 'ko', null), ['A']);
  assert.deepEqual(xp.openingRepliesFor('nope', 'en'), []);
  const cards = [
    { path: 'world/seated-car/README.md', frontmatter: { choice: { options: [{ id: 'ask-student', label: 'Ask' }] }, choice_actions: { 'ask-student': { kind: 'search' } } } },
    { path: 'world/seated-car/search-scene.md', frontmatter: { choice: { options: [{ id: 'collect-reward-0', label: '→ Testimony' }, { id: 'talk', label: 'Tell Xia' }] }, choice_actions: { 'collect-reward-0': { kind: 'take' }, talk: { kind: 'character' } } } },
    { path: 'world/seated-car/freight-door.md', frontmatter: { type: 'gate', target: 'world/freight-car', choice: { options: [{ id: 'go', label: 'Go' }, { id: 'together', label: 'Together' }] }, choice_actions: { go: { kind: 'enter' }, together: { kind: 'enter' } } } },
  ];
  const optionsOf = (c) => (c.frontmatter.choice.options).map((o, i) => ({ index: i + 1, label: o.label, id: o.id }));
  assert.deepEqual(fr.replyChipsOf(cards, optionsOf).map((c) => c.option.label), ['Go', 'Together', '→ Testimony']);
  assert.deepEqual(fr.replyChipsOf(cards.slice(0, 1), optionsOf).map((c) => c.option.label), ['Ask']);
});

test('the ending recap names what this run did, in the page language', () => {
  const t = (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? ''));
  assert.equal(fr.prologueRecap({ spoke: true, took: true, rolled: true, door: true }, 'Xia Cheng', t), 'You just: talked with Xia Cheng · found a notebook · rolled the dice once · opened a door');
  assert.equal(fr.prologueRecap({ spoke: false, took: false, rolled: false, door: true }, 'Xia Cheng', t), 'You just: opened a door');
  assert.equal(fr.prologueRecap({ spoke: false, took: false, rolled: false, door: false }, 'x', t), null);
});

test('the d100 roll: four tiers listed before, from the card\'s own skill target', async () => {
  assert.deepEqual(tiers.cocTierRows({ system: 'coc', label: 'Persuade', value: 60 }), [
    { tier: 'crit_success', from: 1, to: 12 }, { tier: 'success', from: 13, to: 60 }, { tier: 'fail', from: 61, to: 95 }, { tier: 'crit_fail', from: 96, to: 100 },
  ]);
  assert.equal(tiers.cocTierRows({ system: 'dnd', value: 5 }), null);
  assert.equal(tiers.cocTierRows(null), null);
  const roller = await src('../src/components/narrative/DiceRoller.tsx');
  assert.match(roller, /data-lit=\{rolled && !held && rolled\.outcome === row\.tier/, 'the rolled tier lights up after the ceremony');
  const css = await src('../src/components/chrome/first-run.css');
  assert.match(css, /\.dice-tier-table \{ display: none; \}/, 'outside the prologue the dice card is unchanged');
  assert.match(css, /:root\[data-airp-first-run='on'\] \.dice-tier-table \{ display: grid;/);
});

test('App wiring: the lobby waits for the decision; the language screen; the prologue gets the minimal chrome', async () => {
  const app = await src('../src/App.tsx');
  assert.match(app, /useState<'checking' \| 'language' \| 'starting' \| 'off'>\(\(\) => \(firstRunBuild\(\) \? 'checking' : 'off'\)\)/, 'flag off → off from the first render');
  assert.match(app, /\{launcherOpen && firstRunPhase === 'off' && \(\s*<WorldLauncher/);
  assert.match(app, /<FirstRunLanguage[\s\S]*?onLocale=\{setLocale\}\s*onPlay=\{\(\) => startPrologue\(locale\)\}\s*onAllWorlds=\{\(\) => \{ markFirstRunDone\(\); setFirstRunPhase\('off'\); \}\}/, 'language buttons only set the language; 直接试玩 → prologue; 看看所有世界 → lobby');
  assert.match(app, /const prologueOpen = !launcherOpen && isPrologueWorld\(manifest\);/);
  assert.match(app, /className=\{`airp-prototype\$\{prologueOpen \? ' app--first-run' : ''\}/);
  assert.match(app, /data-first-run-bag=\{prologueOpen \? \(handItems\.length \? 'some' : 'empty'\) : undefined\}/, 'the bag appears with the first thing picked up');
  assert.match(app, /\{prologueOpen && <FirstRunMenu onAllWorlds=\{leavePrologueToLobby\} \/>\}/);
  assert.match(app, /const tutorialArmed = tutorialArmedState && !prologueOpen;/, 'no forced tutorial in the prologue');
  assert.match(app, /!prologueOpen && <OnboardingGuide/, 'no four-step guide in the prologue');
  assert.match(app, /const companion = layoutMode === 'companion' \|\| prologueOpen;/);
});

test('App wiring: guest entry and its fallbacks (§9.5): always the prologue, the sign-in card when there is no guest session', async () => {
  const app = await src('../src/App.tsx');
  const enter = app.slice(app.indexOf('const enterFirstRun = async'), app.indexOf('const signInFromFirstRun ='));
  assert.match(enter, /startGuestTrial\(\)/, 'a guest session first');
  assert.match(enter, /if \(!v\?\.active\) \{ entry = 'gate'; gate = gateOfGuestRefusal\(v\?\.refused, v\?\.refusedBy\); \}/, 'no guest session → the gate, not the lobby');
  assert.match(enter, /setFirstRunGate\(gate\);\s*await loadWorldRef\.current\?\.\(path\);/, 'every branch opens the prologue');
  assert.doesNotMatch(enter, /setLauncherOpen\(true\)|withAccount|openAccountPanel|askGuestToSignIn|notify\(/, 'no lobby, no dialog, no toast from the entry');
  assert.match(enter, /window\.setTimeout\(\(\) => done\(null\), 8_000\)/, 'an 8-second timeout');
  const signIn = app.slice(app.indexOf('const signInFromFirstRun ='), app.indexOf('const startPrologue ='));
  assert.match(signIn, /void withAccount\('play', \(\) => \{\s*setFirstRunGate\(null\);\s*if \(save\) void loadWorldRef\.current\?\.\(save\);/, 'only the card\'s button asks; after sign-in the same save reopens (agents start signed in)');
  assert.match(app, /gate=\{prologueOpen && firstRunGate \? \(\s*<FirstRunSignInCard reason=\{firstRunGate\} onSignIn=\{signInFromFirstRun\} onAllWorlds=\{leavePrologueToLobby\} \/>/);
  const dock = await src('../src/components/sidebar/CharacterDock.tsx');
  assert.match(dock, /\{gate \? gate : \([\s\S]{0,700}?<div className="character-dock__reply"/, 'the card replaces the replies, the chips and the reply box');
  const card = await src('../src/components/chrome/FirstRun.tsx');
  assert.match(card, /t\('To start this part, sign in first \(500 credits on sign-up; your progress is kept\)\.'\)/);
  assert.match(card, /t\('See all worlds first'\)/);
  // The card says WHY (live 2026-10-11: billing's per-network cap read as 「这台设备已经试玩过了」).
  assert.equal(fr.gateOfGuestRefusal('claim_limited', 'device'), 'trial-used');
  assert.equal(fr.gateOfGuestRefusal('claim_limited', 'network'), 'trial-used-network');
  assert.equal(fr.gateOfGuestRefusal('guest_limited', 'device-or-network'), 'trial-used-here');
  assert.equal(fr.gateOfGuestRefusal('claim_limited'), 'trial-used-here');
  assert.equal(fr.gateOfGuestRefusal('guest_unavailable'), 'unavailable');
  assert.equal(fr.gateOfGuestRefusal('remote_unreachable'), 'unavailable');
  assert.equal(fr.gateOfGuestRefusal(null), 'unavailable');
  assert.equal(fr.GATE_WHY['sign-in'], null);
  for (const reason of ['trial-used', 'trial-used-network', 'trial-used-here', 'unavailable']) assert.ok(fr.GATE_WHY[reason], reason);
  assert.match(card, /const why = GATE_WHY\[reason\];\s*return \([\s\S]*?\{why && <p className="first-run-gate__why" data-testid="first-run-gate-why">\{t\(why\)\}<\/p>\}/);
  const messages = JSON.parse(await src('../src/lib/messages.json'));
  for (const key of Object.values(fr.GATE_WHY).filter(Boolean)) for (const l of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[l], `${key} ${l}`);
  assert.equal(messages['The free trial has already been used on this network.']['zh-CN'], '这个网络已经试玩过了。');
  // In the dock's flow under the greeter's line, never over it; the line keeps its height in the prologue.
  const css = await src('../src/components/chrome/first-run.css');
  assert.doesNotMatch(css.slice(css.indexOf('.first-run-gate {')), /position:\s*(absolute|fixed)/, 'the card is never positioned over the dock');
  assert.match(css, /\.app--first-run \.character-dock__lines \{ flex-shrink: 0; max-height: 34dvh; \}/);
});

test('App wiring: turns end by command, the ending gives two choices, and done is written', async () => {
  const app = await src('../src/App.tsx');
  assert.match(app, /onCharacterAnswered=\{\(\) => \{ markGuide\('speak'\); characterAnswerSettled\(\); experienceAnswered\(\); (?:releaseTray\(\); )?\}\}/);
  assert.match(app, /const experienceAnswered = \(\) => \{\s*if \(!experienceTurnEnd\) return;[\s\S]*?airpGateway\.turnEnd\(\)/);
  // A world with a hint table beats through the coalescer instead: one call per beat, not two.
  assert.match(app, /if \(worldExperienceOf\(current\)\?\.turnEnd && !worldTickOf\(current\)(?: && \(current as \{ hints\?: unknown \} \| null\)\?\.hints !== true)?\) void airpGateway\.turnEnd\(\)/, 'a writer turn ends a turn too');
  assert.match(app, /prologue=\{prologueOpen \? \{[\s\S]*?onNext: continueFromPrologue,\s*onAllWorlds: leavePrologueToLobby,/);
  assert.match(app, /const prologueNextId = prologueNextIdFor\(worldExperienceOf\(manifest\)\?\.next, manifest\?\.id, manifest\?\.locale, locale\);/);
  assert.match(app, /const continueFromPrologue = \(\) => \{\s*markFirstRunDone\(\);\s*hideForcedTutorial\(\);[\s\S]*?markFromPrologue\(prologueNextId\);\s*playWorld\(prologuePathOf\(shelf\.groups \?\? \[\], prologueNextId\), \(\) => \{\s*notify\(t\('The prologue is over\. The full Last Train — more passengers, more cars\.'\)\);/, 'straight into the full world through the lobby\'s own gated start, then the bridge line');
  assert.doesNotMatch(app, /withAccount\('continue'|setLobbyIntro|openIntro=/, 'no sign-in wall and no lobby card between the prologue and the full world');
  assert.match(app, /if \(!prologueOpen \|\| !closedRun\.ending\) return;\s*markFirstRunDone\(\);\s*hideForcedTutorial\(\);/);
  const run = await src('../src/components/chrome/ClosedRun.tsx');
  assert.match(run, /if \(prologueRef\.current\) return;\s*const ask = window\.setTimeout\(\(\) => \{ askGuestToSignIn\('ending'\); \}/, 'no account panel stacked on the prologue\'s ending');
  assert.match(run, /data-testid="prologue-next"/);
  assert.match(run, /\{t\('Stay on this train: the full \{name\}', \{ name: prologue\.next\.name \}\)\}/);
  assert.match(run, /data-testid="prologue-all-worlds"/);
  const launcher = await src('../src/components/WorldLauncher.tsx');
  assert.doesNotMatch(launcher, /openIntro/);
  const gateway = await src('../src/lib/airp-gateway.ts');
  assert.match(gateway, /request<[^>]+>\('\/api\/turn-end', json\('POST', \{ layer: layer \?\? undefined \}\)\)/);
});

test('the dock: the first replies are one tap each and send without the keyboard; the prologue chips sit in the same place', async () => {
  const dock = await src('../src/components/sidebar/CharacterDock.tsx');
  assert.match(dock, /replies\.map\(\(line\) => \(\s*<button key=\{line\} type="button" className="reply-chip" disabled=\{busy\} onClick=\{\(\) => sendText\(line\)\}>/);
  assert.match(dock, /\) : chips\}/);
  const css = await src('../src/components/chrome/first-run.css');
  assert.match(css, /\.reply-chip \{\s*min-height: 44px;/, 'touch-sized');
});

test('the lobby never shows the prologue as a tile of its own', async () => {
  const launcher = await jiti.import('../src/lib/world-launcher.ts');
  const groups = [
    { id: 'last-train-prologue-zh', name: '末班车 · 序章', templatePath: 'templates/last-train-prologue-zh', cover: '/c.webp', locale: 'zh-CN', intro: { hidden: true }, saves: [] },
    { id: 'last-train-zh', name: '末班车', templatePath: 'templates/last-train-zh', cover: '/c.webp', locale: 'zh-CN', saves: [] },
  ];
  const ids = launcher.launcherWorlds(groups, 'zh-CN').map((g) => g.id);
  assert.ok(ids.includes('last-train-zh'));
  assert.ok(!ids.includes('last-train-prologue-zh'));
});

//: on a local server that requires sign-in (pnpm dev / preview:local without AIRP_PLAY_WITHOUT_ACCOUNT),
// picking a language dropped into the lobby with the account dialog open — the forced run's old 「sign in first」.
// The rules now, for every way in and every language button:
test('regression: login required + no guest trial → the language screen, then the prologue behind the sign-in card (forced too)', () => {
  const mode = { kind: 'local', signedIn: false, required: true };
  const access = fr.firstRunAccessOf(mode);
  assert.equal(access, 'sign-in');
  assert.deepEqual(fr.decideFirstRun({ ...base, access }), { kind: 'start', askLanguage: true });
  assert.deepEqual(fr.decideFirstRun({ ...base, access, forced: true }), { kind: 'start', askLanguage: true });
  assert.equal(fr.firstRunEntryOf(access), 'gate', 'the prologue with the sign-in card, never the lobby');
});

test('regression: login required + guest trial available → the prologue as a guest; play without an account → the prologue', () => {
  const guest = fr.firstRunAccessOf({ kind: 'local', signedIn: false, required: true, guestTrial: true });
  assert.deepEqual(fr.decideFirstRun({ ...base, access: guest }), { kind: 'start', askLanguage: true });
  assert.deepEqual(fr.decideFirstRun({ ...base, access: guest, forced: true }), { kind: 'start', askLanguage: true });
  assert.equal(fr.firstRunEntryOf(guest), 'guest');
  const open = fr.firstRunAccessOf({ kind: 'local', signedIn: false, required: false });
  assert.deepEqual(fr.decideFirstRun({ ...base, access: open, forced: true }), { kind: 'start', askLanguage: true });
  assert.equal(fr.firstRunEntryOf(open), 'load');
  assert.equal(fr.firstRunEntryOf('signed-in'), 'load');
});

for (const guessed of ['zh-CN', 'ja', 'ko', 'en']) {
  test(`regression: every language button on a ${guessed}-guessed screen does what the big button does`, () => {
    const editions = { 'zh-CN': 'last-train-prologue-zh', ja: 'last-train-prologue-jp', ko: 'last-train-prologue-ko', en: 'last-train-prologue' };
    for (const access of ['go', 'guest', 'signed-in', 'sign-in']) {
      const big = fr.planFirstRunPick(guessed, access);
      for (const pick of ['zh-CN', 'ja', 'ko', 'en']) {
        const plan = fr.planFirstRunPick(pick, access);
        assert.equal(plan.locale, pick);
        assert.equal(plan.prologueId, editions[pick], `${pick} opens its own prologue edition`);
        assert.equal(plan.entry, big.entry, `${pick} on a ${guessed} screen (${access}) enters like the guessed button`);
        assert.ok(['load', 'guest', 'gate'].includes(plan.entry), 'every entry is the prologue — no lobby during a first run');
      }
    }
  });
}

test('regression: the language screen: four language buttons set the language; 直接试玩 / 看看所有世界', async () => {
  const screen = await src('../src/components/chrome/FirstRun.tsx');
  assert.match(screen, /className=\{l === suggested && l !== locale \? 'first-run__lang first-run__lang--suggested' : 'first-run__lang'\} data-locale=\{l\} data-suggested=\{[^}]+\} disabled=\{busy\} onClick=\{\(\) => onLocale\(l\)\}/, 'all four language buttons only set the language (the browser\'s one only marked)');
  assert.match(screen, /data-testid="first-run-play" disabled=\{busy\} onClick=\{onPlay\}/, '直接试玩: the big one');
  assert.match(screen, /data-testid="first-run-all-worlds-start" disabled=\{busy\} onClick=\{onAllWorlds\}/, '看看所有世界: the smaller one');
  assert.match(screen, /'zh-CN': \{ play: '直接试玩', all: '看看所有世界'/);
  const app = await src('../src/App.tsx');
  const pick = app.slice(app.indexOf('const startPrologue ='), app.indexOf('const enterFirstRunRef'));
  assert.match(pick, /enterFirstRun\(prologuePathOf\(groups, prologueIdFor\(pick\)\)\)/, 'the picked language\'s prologue');
  assert.doesNotMatch(app, /no-guest-play/, 'access never turns the first run off');
});


// the design notes leftovers
test('「5 分钟序章」 on the full 末班车 card: the same-language prologue, only in a build that ships it', async () => {
  const groups = [{ id: 'last-train-prologue-zh', templatePath: 'templates/last-train-prologue-zh' }, { id: 'last-train-prologue' }];
  assert.equal(fr.prologueReplayFor('last-train-zh', groups, true), 'templates/last-train-prologue-zh');
  assert.equal(fr.prologueReplayFor('last-train', groups, true), 'templates/last-train-prologue');
  assert.equal(fr.prologueReplayFor('last-train-jp', groups, true), null, 'that edition is not on the shelf');
  assert.equal(fr.prologueReplayFor('last-train-zh', groups, false), null, 'flag off: no entry');
  assert.equal(fr.prologueReplayFor('last-witness-zh', groups, true), null);
  assert.equal(fr.prologueReplayFor('last-train-prologue-zh', groups, true), null);
  const card = await src('../src/components/WorldIntroCard.tsx');
  assert.match(card, /data-testid="world-intro-prologue" disabled=\{busy\} onClick=\{\(\) => onStart\(prologue\)\}/, 'opens through the card\'s own start (the same gate)');
  assert.match(card, /\{t\('5-minute prologue'\)\}/);
  const launcher = await src('../src/components/WorldLauncher.tsx');
  assert.match(launcher, /prologue=\{prologueReplayFor\(introWorld\.id, shelf\.groups \?\? \[\]\)\}/);
});

test('the full 末班车 after the prologue: the guide says only 「想做选项里没有的事？告诉作家」 on the writer button', async () => {
  const ob = await jiti.import('../src/lib/onboarding.ts');
  assert.equal(fr.isHandoffWorld('last-train-zh', 'last-train-zh'), true);
  assert.equal(fr.isHandoffWorld('last-train', 'last-train'), true);
  assert.equal(fr.isHandoffWorld('last-train-zh', null), false, 'not from the prologue → the usual four steps');
  assert.equal(fr.isHandoffWorld('last-train-jp', 'last-train-zh'), false, 'another edition opened later');
  assert.equal(fr.isHandoffWorld('last-witness-zh', 'last-witness-zh'), false, '最后的证人 is no longer the hand-over');
  const store = new Map();
  const session = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); } };
  assert.equal(fr.readFromPrologue(session), null);
  fr.markFromPrologue('last-train-ko', session);
  assert.equal(fr.readFromPrologue(session), 'last-train-ko');
  assert.deepEqual(ob.stepsFor('handoff'), ['beyond']);
  assert.equal(ob.GUIDE_TARGET_OF.beyond, 'writer');
  assert.equal(ob.GUIDE_LINES.beyond, 'Want to do something the options don’t offer? Tell the writer.');
  assert.equal(ob.currentGuideStep(ob.EMPTY_GUIDE_STATE, () => true, ob.stepsFor('handoff')), 'beyond');
  assert.equal(ob.currentGuideStep(ob.markStep(ob.EMPTY_GUIDE_STATE, 'beyond'), () => true, ob.stepsFor('handoff')), null);
  assert.ok(ob.silenceGuide().done.includes('beyond'));
  assert.deepEqual(ob.parseGuideState({ done: ['beyond', 'nope'] }).done, ['beyond']);
  const app = await src('../src/App.tsx');
  assert.match(app, /const handoff = isHandoffWorld\(manifest\?\.id, readFromPrologue\(\)\);/);
  assert.match(app, /useOnboardingGuide\(companion, authoring \? 'creator' : handoff \? 'handoff' : 'player'\)/);
  assert.match(app, /markGuide\('writer'\);\s*markGuide\('beyond'\);/, 'a writer turn clears it');
});

test('the dice card speaks the interface language (「Roll the Dice」 was English everywhere)', async () => {
  const roller = await src('../src/components/narrative/DiceRoller.tsx');
  assert.doesNotMatch(roller, /'Roll the Dice'|\? 'Resolving…'|> Check (Passed|Failed)|>The dice are rolling…<|>The result will be shown/);
  assert.match(roller, /\{busy \? t\('Resolving…'\) : t\('Roll the dice'\)\}/);
  const messages = JSON.parse(await src('../src/lib/messages.json'));
  for (const key of ['Roll the dice', 'Resolving…', 'The dice are rolling…', 'Check passed', 'Check failed', 'Requires: {expect}', 'The result will be shown in the dice ceremony.', '5-minute prologue', 'Want to do something the options don’t offer? Tell the writer.']) {
    for (const locale of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[locale], `${key} ${locale}`);
  }
  assert.equal(messages['Roll the dice']['zh-CN'], '掷骰');
});

test('the ending\'s two choices: a guest continues into the full 末班车 without signing in; signed in goes straight in; 看看所有世界 → the lobby', async () => {
  const shelf = { templates: [], worlds: [], groups: [{ id: 'last-train-zh', name: '末班车 · 中文', templatePath: 'templates/last-train-zh', saves: [] }] };
  for (const id of ['last-train', 'last-train-zh', 'last-train-jp', 'last-train-ko']) {
    const p = fr.prologuePathOf(shelf.groups, id);
    assert.equal(gt.isTrialWorldPath(shelf, p), true, `${p}: a trial world`);
  }
  const guestMode = gate.localAnswer({ signedIn: false, playRequiresAccount: true, guestTrial: true });
  assert.equal(gate.guestDecision(guestMode, true), 'guest', 'signed out where the trial is on: the guest session carries on, no sign-in');
  const signedIn = gate.localAnswer({ signedIn: true, playRequiresAccount: true, guestTrial: true });
  assert.equal(gate.guestDecision(signedIn, true), null);
  assert.equal(gate.gateDecision(signedIn), 'go', 'signed in: straight in');
  assert.equal(gate.gateDecision({ kind: 'none' }), 'go', 'no account system: straight in');
  const app = await src('../src/App.tsx');
  // The guest path of the lobby's own start: a live guest session opens the world, no account panel.
  assert.match(app, /if \(guest === 'guest'\) \{\s*const v = await startGuestTrial\(\);\s*if \(v\?\.active\) \{ open\(\); return; \}/);
  assert.match(app, /const open = \(\) => \{ void loadWorld\(worldPath\)\.then\(\(\) => \{ if \(typeof then === 'function'\) then\(\); \}\); \};/);
  assert.match(app, /const leavePrologueToLobby = \(\) => \{\s*markFirstRunDone\(\);\s*setFirstRunGate\(null\);\s*setLauncherOpen\(true\);/);
  assert.match(app, /onNext: continueFromPrologue,\s*onAllWorlds: leavePrologueToLobby,/);
  for (const ed of ['', '-zh', '-jp', '-ko']) {
    const manifest = JSON.parse(await src(`../../../templates/last-train-prologue${ed}/world.json`));
    assert.equal(xp.worldExperienceOf(manifest)?.next, 'last-train', `last-train-prologue${ed}`);
    assert.equal(fr.prologueNextIdFor(manifest.experience.next, manifest.id, manifest.locale, 'en'), `last-train${ed}`);
  }
  const g = await jiti.import('../src/lib/guest-trial.ts');
  assert.equal(g.GUEST_REASONS.includes('continue'), false, 'the old 「登录保存这一局」 reason is gone');
});
