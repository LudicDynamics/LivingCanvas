// Sign-in lives in the 「账号」 panel
// the opener registry, the local account state, and
// that the other screens point at the panel rather than at settings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const { localAccountState, pickAccountOpener, openAccountPanel, registerAccountOpener } = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/account-open.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');

test('the reachable panel opens anchored; otherwise the newest one floats', () => {
  const header = { id: 'header', reachable: () => true };
  const launcher = { id: 'launcher', reachable: () => true };
  const covered = { id: 'covered', reachable: () => false };
  assert.deepEqual(pickAccountOpener([header, launcher]), { opener: launcher, floating: false });
  assert.deepEqual(pickAccountOpener([header, covered]), { opener: header, floating: false });
  assert.deepEqual(pickAccountOpener([covered]), { opener: covered, floating: true });
  assert.equal(pickAccountOpener([]), null);
});

test('openAccountPanel opens a registered panel and forgets unmounted ones', () => {
  assert.equal(openAccountPanel(), false);
  const calls = [];
  const off = registerAccountOpener({ reachable: () => false, open: (floating) => calls.push(floating) });
  assert.equal(openAccountPanel(), true);
  assert.deepEqual(calls, [true]);
  off();
  assert.equal(openAccountPanel(), false);
});

test('local account state follows the server settings', () => {
  assert.deepEqual(localAccountState(null), { kind: 'unavailable' });
  assert.deepEqual(localAccountState({ signedIn: true, email: 'a@b.c', uid: 'u1' }), { kind: 'signed-in', who: 'a@b.c' });
  assert.deepEqual(localAccountState({ signedIn: true, email: null, uid: 'u1' }), { kind: 'signed-in', who: 'u1' });
  assert.deepEqual(localAccountState({ signedIn: false, email: null, uid: null, pending: true }), { kind: 'signed-out', pending: true });
});

test('the account popup carries the local sign-in; settings only points at it', async () => {
  // The sign-in lives in the popup's 账号 tab (components/account/AccountTab.tsx; the design notes).
  const panel = await src('../src/components/account/AccountTab.tsx');
  assert.match(await src('../src/components/chrome/AccountPanel.tsx'), /registerAccountOpener\(/);
  assert.match(panel, /useRemoteAccount\(\{ enabled: who\.kind === 'local' \}\)/);
  for (const key of ['Sign in with account (Google)', 'Send sign-in email', 'Sign in with code', 'Sign out', 'Sign in / Sign up', 'New here? Your first sign-in with Google or an email code creates your account. Signed in, you can play, publish and sync your worlds.']) assert.ok(panel.includes(`t('${key}')`), key);
  // Hosted: a guest signs in in this same panel (the gateway's JSON routes); sign-out stays the gateway's /logout.
  assert.match(panel, /useHostedSignIn\(\{ enabled: who\.kind === 'guest' \}\)/);
  assert.match(panel, /who\.kind === 'guest' && <HostedAccount hosted=\{hosted\} \/>/);
  assert.ok(!panel.includes("withBase('login')"), 'no detour to the gateway login page');
  assert.match(panel, /withBase\('logout'\)/);
  // ONE form for local and hosted.
  assert.equal(panel.match(/<SignInForm /g)?.length, 2);

  const settings = await src('../src/components/RemoteSettings.tsx');
  for (const gone of ['startRemoteLogin', 'verifyRemoteLoginCode', 'logoutRemote', "t('Sign in with account (Google)')", "t('Sign out')"]) assert.ok(!settings.includes(gone), `settings still has ${gone}`);
  assert.match(settings, /Account sign-in is under “Account” in the top bar\./);
  assert.match(settings, /<OpenAccountButton/);
  assert.match(settings, /t\('Remote address'\)/);
  const tts = await src('../src/components/TtsSettings.tsx');
  assert.match(tts, /<VoiceSettingsBody onOpenAccount=\{requestClose\} \/>/);
  assert.match(tts, /<RemoteSettings onOpenAccount=\{onOpenAccount\} \/>/);
});

test('screens that need an account open the account panel', async () => {
  for (const file of ['../src/components/RemoteWorlds.tsx', '../src/components/chrome/WorkshopArtPanel.tsx']) {
    const text = await src(file);
    // `cloud`: a guest (trial) sees 「登录后保存到云端」 + the gift line (lib/guest-trial.ts)
    assert.match(text, /<OpenAccountButton cloud \/>/, file);
    assert.ok(!text.includes('Settings → Remote'), `${file} still points at settings`);
  }
  assert.match(await src('../src/components/RemoteWorlds.tsx'), /ACCOUNT_CHANGED_EVENT/);
});

test('the account popup uses a registered depth and is a full-height sheet on a phone', async () => {
  const css = await src('../src/components/account/account-dialog.css');
  assert.match(css, /\.account-dialog \{[^}]*z-index: var\(--depth-ui\)/);
  assert.match(css, /@media \(max-width: 640px\) \{[^@]*\.account-dialog__sheet \{[^}]*height: 100dvh;[^}]*border-radius: 0;/);
});

// the key's value lives only in the component's memory.
test('the API key section shows the value once and never persists it', async () => {
  const keys = await src('../src/components/chrome/ApiKeys.tsx');
  const panel = await src('../src/components/account/AccountTab.tsx');
  assert.match(panel, /<ApiKeys \/>/, 'the signed-in account tab carries the API key section');
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'console.', 'document.cookie']) {
    assert.ok(!keys.includes(forbidden), `ApiKeys.tsx must not use ${forbidden}`);
  }
  assert.match(keys, /setFresh\(null\)/, 'the shown value is dropped (Done / close / revoke)');
  assert.match(keys, /apiKeys\(\)/);
  assert.match(keys, /revokeApiKey\(/);
  assert.match(keys, /https:\/\/ai\.worldlines\.gg\/v1/);
  assert.match(keys, /X-Worldlines-Product/);
  const messages = JSON.parse(await src('../src/lib/messages.json'));
  for (const [, key] of keys.matchAll(/\bt\('([^']+)'/g)) {
    assert.ok(messages[key]?.['zh-CN'] && messages[key]?.ja, `translated: ${key}`);
  }
});
