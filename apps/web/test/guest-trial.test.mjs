// The guest trial: signed out on canvas.worldlines.gg, only the
// trial world (末班车, any edition, or a save of it) plays; every other world is locked behind signing in; the
// prompts (credits nearly / fully used, cloud, another world, an ending) all name the newcomer gift.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const gate = await jiti.import('../src/lib/play-gate.ts');
const g = await jiti.import('../src/lib/guest-trial.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');

const shelf = {
  templates: [], worlds: [],
  groups: [
    { id: 'last-train-zh', name: '末班车', templatePath: 'templates/last-train-zh', saves: [{ id: 'last-train-zh-1', path: 'worlds/last-train-zh-1', updatedAt: '', active: false }] },
    { id: 'harbor', name: 'Harbor', templatePath: 'templates/harbor', saves: [{ id: 'harbor-1', path: 'worlds/harbor-1', updatedAt: '', active: false }] },
    { id: 'last-train', name: 'made copy', templatePath: 'published/made-1', workshop: { status: 'published', owner: 'x', mine: false, editPath: null }, saves: [] },
  ],
};

test('a guest may enter only the trial world: its editions and its saves', () => {
  for (const p of ['templates/last-train', 'templates/last-train-zh', 'templates/last-train-jp', 'templates/last-train-ko', 'worlds/last-train-zh-1']) assert.equal(g.isTrialWorldPath(shelf, p), true, p);
  for (const p of ['templates/harbor', 'worlds/harbor-1', 'published/made-1', 'templates/last-train-xx', '../templates/last-train']) assert.equal(g.isTrialWorldPath(shelf, p), false, p);
});

test('the gate: signed out where the trial is on → guest for the trial world, unlock for any other; otherwise as before', () => {
  const guestMode = gate.localAnswer({ signedIn: false, playRequiresAccount: true, guestTrial: true });
  assert.deepEqual(guestMode, { kind: 'local', signedIn: false, required: true, guestTrial: true });
  assert.equal(gate.guestDecision(guestMode, true), 'guest');
  assert.equal(gate.guestDecision(guestMode, false), 'unlock');
  assert.equal(gate.guestDecision({ ...guestMode, signedIn: true }, false), null, 'signed in: every world');
  assert.equal(gate.guestDecision(gate.localAnswer({ signedIn: false }), true), null, 'no trial here: the old gate');
  assert.equal(gate.guestDecision({ kind: 'hosted', signedIn: false }, true), null);
  // the panel's line in the guest view
  assert.equal(gate.guestReasonFor(guestMode, 'play'), 'unlock');
  assert.equal(gate.guestReasonFor(guestMode, 'publish'), 'cloud');
  assert.equal(gate.guestReasonFor(gate.localAnswer({ signedIn: false }), 'play'), 'play');
});

test('lobby marks: the trial tile 免登录试玩, every other tile locked; none when signed in', () => {
  assert.equal(g.guestTileMark({ id: 'last-train-jp' }, true), 'trial');
  assert.equal(g.guestTileMark({ id: 'harbor' }, true), 'locked');
  assert.equal(g.guestTileMark({ id: 'last-train', workshop: {} }, true), 'locked', 'a made world with a trial-like id is not the trial');
  assert.equal(g.guestTileMark({ id: 'harbor' }, false), null);
  assert.equal(g.guestModeOf({ enabled: true, signedIn: false }), true);
  assert.equal(g.guestModeOf({ enabled: true, signedIn: true }), false);
  assert.equal(g.guestModeOf({ enabled: false, signedIn: false }), false);
  assert.equal(g.guestModeOf(null), false);
});

test('prompts: nearly-used and ending once per page, the others every time', () => {
  const asked = new Set();
  assert.equal(g.shouldAsk('trial-low', asked), true);
  asked.add('trial-low');
  assert.equal(g.shouldAsk('trial-low', asked), false);
  assert.equal(g.shouldAsk('ending', new Set(['ending'])), false);
  for (const r of ['trial', 'unlock', 'cloud']) assert.equal(g.shouldAsk(r, new Set([r])), true, r);
  assert.equal(g.askGuestToSignIn('unlock', { enabled: true, signedIn: true }), false, 'signed in: never');
  assert.deepEqual([...g.GUEST_REASONS].sort(), ['cloud', 'ending', 'trial', 'trial-low', 'unlock']);
  assert.equal(g.isGuestReason('play'), false);
});

test('wiring: every way in goes through the guest gate; the prompts are where they belong; four languages', async () => {
  const app = await src('../src/App.tsx');
  const play = app.slice(app.indexOf('const playWorld = '), app.indexOf('const playWorldRef'));
  assert.ok(play.indexOf('guestDecision(') < play.indexOf("withAccount('play'"), 'guest gate first');
  assert.match(play, /startGuestTrial\(\)/);
  assert.match(play, /withAccount\('trial'/, 'trial used on this device / network → sign in, then carry on');
  assert.match(app, /void afterGuestTurn\(\)/, 'credits re-read after every turn');
  assert.match(await src('../src/components/chrome/ClosedRun.tsx'), /askGuestToSignIn\('ending'\)/);
  assert.match(await src('../src/lib/browser-mode.ts'), /m\.reason === 'trial'\) askAfterTrial\(\)/, 'credits used up (worker) → the trial prompt');
  const launcher = await src('../src/components/WorldLauncher.tsx');
  assert.match(launcher, /guestMark=\{guestTileMark\(worlds\[index\], guestMode\)\}/);
  assert.match(launcher, /t\('Free trial, no sign-in'\)/);
  assert.match(launcher, /t\('Sign in to unlock every world'\)/);
  const tab = await src('../src/components/account/AccountTab.tsx');
  assert.match(tab, /isGuestReason\(reason\) && .*t\('Sign in for a 500-credit newcomer gift\. Your progress is kept\.'\)/);
  const messages = JSON.parse(await src('../src/lib/messages.json'));
  const gift = messages['Sign in for a 500-credit newcomer gift. Your progress is kept.'];
  assert.equal(gift['zh-CN'], '登录送新手礼包 500 积分，进度会保留。');
  for (const k of ['Free trial, no sign-in', 'Sign in to unlock every world', 'The free trial is over for now. Sign in to keep playing.', 'Your trial credits are nearly used up.', 'Sign in to save to the cloud.', 'You reached an ending! Sign in to keep this run.']) {
    for (const l of ['zh-CN', 'ja', 'ko']) assert.ok(messages[k]?.[l], `${k} ${l}`);
  }
  assert.equal(messages['Free trial, no sign-in']['zh-CN'], '免登录试玩');
  assert.equal(messages['Sign in to unlock every world']['zh-CN'], '登录后解锁全部世界');
});
