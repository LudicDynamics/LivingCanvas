// every way into a world asks a
// signed-out player to sign in (or sign up) first, then carries on — local via
// the 「账号」 panel, hosted via the same panel against the seat gateway. No account system → never blocked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const { gateDecision, guestDecision, hostedAnswer, isSharedWorldPath, localAnswer, playTargetOf, takeResumePath, PENDING_MS } = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/play-gate.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');

test('who must sign in before playing', () => {
  assert.equal(gateDecision({ kind: 'hosted', signedIn: true }), 'go');
  assert.equal(gateDecision({ kind: 'hosted', signedIn: false }), 'sign-in-hosted');
  assert.equal(gateDecision({ kind: 'local', signedIn: true, required: true }), 'go');
  assert.equal(gateDecision({ kind: 'local', signedIn: false, required: true }), 'sign-in-local');
  assert.equal(gateDecision({ kind: 'local', signedIn: false, required: false }), 'go', 'AIRP_PLAY_WITHOUT_ACCOUNT=1');
  assert.equal(gateDecision({ kind: 'none' }), 'go', 'no account system: never blocked');
});

test('three build modes: local login on asks only for shared worlds; local login off never; remote always', () => {
  // The server's /api/remote/settings in each mode (sync/remote-client.ts playAccountScope).
  const localOn = localAnswer({ signedIn: false, playRequiresAccount: true, playAccountScope: 'shared', guestTrial: false });
  const localOff = localAnswer({ signedIn: false, playRequiresAccount: false, playAccountScope: 'none' });
  const remote = localAnswer({ signedIn: false, playRequiresAccount: true, playAccountScope: 'all', guestTrial: true });
  assert.deepEqual(localOn, { kind: 'local', signedIn: false, required: true, sharedOnly: true });
  assert.deepEqual(localOff, { kind: 'local', signedIn: false, required: false });
  assert.deepEqual(remote, { kind: 'local', signedIn: false, required: true, guestTrial: true });
  for (const path of ['templates/wuwu', 'templates/whitechapel-zh', 'worlds/islet-ab12', null]) {
    assert.equal(playTargetOf(path), 'local', path);
    assert.equal(gateDecision(localOn, playTargetOf(path)), 'go', `local login on: ${path} plays signed out with the player's own key`);
    assert.equal(gateDecision(localOff, playTargetOf(path)), 'go');
    assert.equal(gateDecision(remote, playTargetOf(path)), 'sign-in-local', `remote: ${path} still asks`);
  }
  assert.equal(isSharedWorldPath('published/made-0000abcd'), true);
  assert.equal(playTargetOf('published/made-0000abcd'), 'account');
  assert.equal(gateDecision(localOn, playTargetOf('published/made-0000abcd')), 'sign-in-local', 'a shared world needs the account');
  assert.equal(gateDecision(localOn), 'sign-in-local', 'the default target is the account (publish, the cloud)');
  assert.equal(gateDecision(localOff, 'account'), 'go', 'login off: no account anywhere');
  assert.equal(gateDecision({ ...localOn, signedIn: true }, 'account'), 'go');
  assert.equal(gateDecision({ kind: 'hosted', signedIn: false }, 'local'), 'sign-in-hosted', 'the hosted gateway keeps its rule');
  // The guest trial only applies where every world is locked.
  assert.equal(guestDecision({ ...localOn, guestTrial: true }, false), null);
  assert.equal(guestDecision(remote, false), 'unlock');
  assert.equal(guestDecision(remote, true), 'guest');
});

test('the lobby, a hosted resume and 「做一个世界」 pass the world they open to the gate', async () => {
  const app = await src('../src/App.tsx');
  assert.match(app, /void withAccount\('play', open, worldPath, playTargetOf\(worldPath\)\)/);
  assert.match(app, /withAccount\('play', \(\) => \{ void loadWorld\(resume\); \}, undefined, playTargetOf\(resume\)\)/);
  assert.match(app, /withAccount\('play', \(\) => setCreateOpen\(true\), undefined, 'local'\)/);
  assert.match(app, /if \(failure\.kind === 'sign-in'\) void withAccount\('play', \(\) => \{ void loadWorld\(worldPath, options\); \}, worldPath\);/, 'a download the server refused signed out still asks');
});

test('the deployment is read from /auth/me, then the local remote settings', () => {
  assert.deepEqual(hostedAnswer(200, 'application/json', { signedIn: true, uid: 'u1' }), { signedIn: true });
  assert.deepEqual(hostedAnswer(200, 'application/json; charset=utf-8', { signedIn: false, anonymous: true }), { signedIn: false });
  assert.equal(hostedAnswer(200, 'text/html', null), null, 'the dev server answers the SPA');
  assert.equal(hostedAnswer(404, 'application/json', { signedIn: false }), null);
  assert.deepEqual(localAnswer({ signedIn: false, playRequiresAccount: true }), { kind: 'local', signedIn: false, required: true });
  assert.deepEqual(localAnswer({ signedIn: false }), { kind: 'local', signedIn: false, required: true }, 'an older server still asks');
  assert.deepEqual(localAnswer({ signedIn: false, playRequiresAccount: false }), { kind: 'local', signedIn: false, required: false });
  assert.deepEqual(localAnswer(null), { kind: 'none' });
});

test('the world picked before a hosted sign-in is entered once, only while fresh and well-formed', () => {
  const store = new Map();
  globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const put = (v) => store.set('airp:pending-play', JSON.stringify(v));
  put({ path: 'templates/fog-harbour', at: 1000 });
  assert.equal(takeResumePath(2000), 'templates/fog-harbour');
  assert.equal(takeResumePath(2000), null, 'once');
  put({ path: 'published/made-0000abcd', at: 0 });
  assert.equal(takeResumePath(PENDING_MS + 1), null, 'stale');
  put({ path: '../../etc', at: 1000 });
  assert.equal(takeResumePath(2000), null);
  delete globalThis.sessionStorage;
});

test('the launcher, the saves dialog and 「做一个世界」 go through the gate; publish asks for an account too', async () => {
  const app = await src('../src/App.tsx');
  assert.match(app, /onLoad=\{playWorld\}\s*\n\s*onCreate=\{\(\) => \{ void withAccount\('play'/);
  assert.match(app, /<WorldShelfDialog shelf=\{shelf\} loading=\{loadingWorld\} onLoad=\{playWorld\}/);
  assert.match(app, /withAccount\('publish'/);
  assert.match(app, /airpGateway\.pushToRemote\(target\)[\s\S]*airpGateway\.publishOnRemote\(pushed\.id\)/, 'local publish = upload + publish');
  assert.match(app, /airpGateway\.hostedSync\(id, publish \? 'publish' : 'unpublish'\)/, 'hosted publish goes through sync');
  const panel = await src('../src/components/account/AccountTab.tsx');
  assert.ok(panel.includes("t('Sign in / Sign up')"));
  assert.ok(panel.includes("t('Sign in or sign up to play. You will go straight into the world afterwards.')"));
});

test('a hosted guest signs in in the account panel, not on the gateway page; the picked world waits in sessionStorage', async () => {
  const gate = await src('../src/lib/play-gate.ts');
  const hosted = gate.slice(gate.indexOf("if (decision === 'sign-in-hosted')"), gate.indexOf('// The newest pick wins'));
  assert.match(hosted, /sessionStorage\.setItem\(PENDING_KEY/);
  assert.match(hosted, /if \(!openAccountPanel\(reason\)\) window\.location\.href = `\$\{baseOf\(\)\}login`;/, 'the gateway page only when no panel is mounted');
  const hook = await src('../src/components/chrome/useHostedSignIn.ts');
  assert.match(hook, /await verifyHostedCode\(email, code\);\s*announceAccountChanged\(\);\s*window\.location\.reload\(\);/, 'one reload takes a seat and enters the picked world');
  assert.match(hook, /window\.location\.assign\(hostedGoogleUrl\(returnPathFrom\(window\.location\.pathname, gatewayBase\(\)\)\)\)/);
});
