// 账号弹窗 source contracts (components/account/AccountDialog.tsx; the design notes):
// ONE entry → ONE tabbed glass popup; every former account-panel function reachable from a tab; the old full-page
// 个人页面 folded into the 我的记录 / 奖励 / CG tabs (no duplicate loading); the claimable dot and where it may show;
// share cards kept per CG; phone sheet, Esc and focus; languages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const dialog = read('../src/components/account/AccountDialog.tsx');
const tab = read('../src/components/account/AccountTab.tsx');
const tabs = read('../src/components/profile/ProfileTabs.tsx');
const css = read('../src/components/account/account-dialog.css');
const pcss = read('../src/components/profile/profile-page.css');
const panel = read('../src/components/chrome/AccountPanel.tsx');
const plans = read('../src/components/chrome/PlansPreview.tsx');
const usage = read('../src/components/chrome/UsageSummary.tsx');
const players = read('../src/components/chrome/StatePanels.tsx');
const shareDialog = read('../src/components/chrome/ShareCardDialog.tsx');
const rewardList = read('../src/components/chrome/RewardList.tsx');
const invite = read('../src/components/chrome/InviteFriends.tsx');
const tts = read('../src/components/TtsSettings.tsx');
const app = read('../src/App.tsx');
const launcher = read('../src/components/WorldLauncher.tsx');
const journal = read('../src/lib/profile-journal.ts');
const achievements = read('../src/lib/achievements.ts');
const messages = JSON.parse(read('../src/lib/messages.json'));
const server = read('../../server/src/index.ts');

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });

test('one entry: the lobby pill and the world header icon are the same AccountPanel; the player panel opens it too', () => {
  assert.equal((launcher.match(/<AccountPanel variant="launcher" focus=\{focus\} \/>/g) ?? []).length, 1);
  assert.equal((app.match(/<AccountPanel focus=\{focusCoordinator\} \/>/g) ?? []).length, 1);
  assert.match(panel, /\{open && <AccountDialog who=\{who\} reason=\{reason\} tab=\{tab\} onTab=\{setTab\} onClose=\{close\} focus=\{focus\} \/>\}/);
  assert.match(panel, /registerAccountOpener\(\{[^]*setTab\('account'\); setOpen\(true\);/);
  assert.match(players, /data-testid="player-open-account"[^\n]*openAccountPanel\(\)/);
  assert.ok(!fs.existsSync(new URL('../src/components/profile/ProfilePage.tsx', import.meta.url)), 'the full-page 个人页面 is gone');
  assert.ok(!/ProfilePage|open-profile/.test(panel + app + tab + dialog), 'no second way into a separate profile page');
});

test('tabs: 账号 · 我的记录 · 奖励 · CG · 设置, a real tablist (arrow keys), each with its content', () => {
  const ids = [...dialog.matchAll(/\{ id: '(\w+)', label: '([^']+)' \}/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(ids, [['account', 'Account'], ['records', 'My records'], ['rewards', 'Rewards'], ['cg', 'CG'], ['settings', 'Settings']]);
  assert.match(dialog, /role="tablist"/);
  assert.match(dialog, /role="tab"/);
  assert.match(dialog, /aria-selected=\{tab === x\.id\}/);
  assert.match(dialog, /role="tabpanel"/);
  assert.match(dialog, /ArrowRight/);
  // 账号 shows the sign-in only when this build has Worldlines login on (lib/build-mode.ts)
  assert.match(dialog, /tab === 'account' && \(loginEnabled\(\)\s*\? <AccountTab who=\{who\}/);
  for (const el of ["tab === 'records' && <RecordsTab", "tab === 'rewards' && <RewardsTab", "tab === 'cg' && <CgTab", "tab === 'settings' &&"]) assert.ok(dialog.includes(el), el);
  assert.match(dialog, /<VoiceSettingsBody onOpenAccount=\{signIn\} \/>/);
});

test('every former account-panel function is reachable from the 账号 / 设置 tabs', () => {
  // sign-in / out (local, hosted, gateway session)
  assert.match(tab, /who\.kind === 'local' && <LocalAccount account=\{account\} \/>/);
  assert.match(tab, /who\.kind === 'guest' && <HostedAccount hosted=\{hosted\} \/>/);
  assert.match(tab, /withBase\('logout'\)/);
  assert.match(tab, /<SignInForm /);
  assert.match(tab, /<DeviceSignIn /);
  // the play / publish gate's reason line
  assert.match(tab, /Sign in or sign up to play\./);
  // plan + balance + daily claim + redeem + plan look (PlansEntry → UsageSummary → DailyClaim, RedeemCode, PlanLookSwitch)
  assert.match(tab, /<PlansEntry \/>/);
  assert.match(plans, /<RedeemCode /);
  assert.match(plans, /<PlanLookSwitch /);
  assert.match(usage, /<DailyClaim /);
  // invite, nickname, API keys, community
  assert.match(tab, /<InviteFriends \/>/);
  assert.match(tab, /<NicknameField \/>/);
  assert.match(tab, /<ApiKeys \/>/);
  assert.match(tab, /<ChannelRow /);
  // local keys + voice live in 设置, ONE copy shared with the 语音与连接 dialog
  assert.match(tts, /export function VoiceSettingsBody/);
  assert.match(tts, /<LocalKeySettings \/>/);
  assert.match(tts, /<NanamiTtsSettings /);
  assert.match(tts, /<VoiceSettingsBody onOpenAccount=\{requestClose\} \/>/);
});

test('我的记录 / 奖励 / CG read the same sources once (useProfile in the dialog), only this app\'s server', () => {
  assert.equal((dialog.match(/useProfile\(\)/g) ?? []).length, 1);
  for (const url of ["'/api/profile/saves'", "'/api/profile/account'", '/api/profile/cg?save=']) assert.ok(tabs.includes(url), url);
  assert.ok(tabs.includes('airpGateway.worlds()'));
  for (const src of [tabs, journal]) {
    assert.doesNotMatch(src, /worldlines\.gg/);
    assert.doesNotMatch(src, /authorization|Bearer/i);
  }
  assert.equal((app.match(/useProfileRecorder\(/g) ?? []).length, 1);
});

test('我的记录: playthroughs with world, ending, date, play time, turns, secrets x/y and 「再玩一次」', () => {
  assert.match(tabs, /<History model=\{model\} onPlay=\{onPlay\} \/>/);
  assert.match(tabs, /t\('Ending: \{title\}'/);
  assert.match(tabs, /t\('\{turns\} turns'/);
  assert.match(tabs, /f\.duration\(row\.playMs\)/);
  assert.match(tabs, /t\('Secrets \{found\}\/\{total\}'/);
  assert.match(tabs, /data-testid="play-again" onClick=\{\(\) => onPlay\(row\.playPath!\)\}/);
  assert.match(dialog, /requestPlayWorld\(path\)/);
  assert.match(app, /onPlayWorldRequest\(\(path\) => playWorldRef\.current\(path\)\)/, 'the same gated start as the launcher');
});

test('奖励: today\'s allowance, rewards in every state (claim through the server, 「玩一会儿后解锁 · n/20」, 已领取), achievements', () => {
  assert.match(tabs, /useRewardClaims\(\['claimable', 'pending_verification', 'claimed'\]\)/);
  assert.match(tabs, /<DailyClaim /);
  assert.match(tabs, /<Achievements model=\{model\} \/>/);
  assert.match(rewardList, /data\.claimReward\(r\.id, deviceId\(\)\)/);
  assert.match(rewardList, /t\('Unlocks after you play a bit'\)/);
  assert.match(rewardList, /t\('\{calls\}\/\{need\} turns'/);
  assert.match(rewardList, /data-testid="reward-claimed"/);
  assert.match(invite, /useRewardClaims\(\)/, '邀请好友 uses the same claim code');
  assert.match(tabs, /a\.earned \? <Icon \/> : <Lock \/>/);
});

test('CG: gallery → large view with that CG\'s share cards + 「生成分享卡」; 「我的分享卡」 strip; cards kept on download / share', () => {
  assert.match(tabs, /useShareCards\(cg\.path\)/);
  assert.match(tabs, /data-testid="make-share-card"/);
  assert.match(tabs, /initialPick=\{artId\}/);
  assert.match(tabs, /cgPath: cg\.path/);
  assert.match(tabs, /testId="my-share-cards"/);
  assert.match(tabs, /shareCards\(\)\.remove\(c\.id\)/);
  assert.match(tabs, /loading="lazy"/);
  assert.match(shareDialog, /void shareCards\(\)\.save\(png\.blob, \{/);
  assert.match(shareDialog, /download=\{fileName\} onClick=\{keep\}/);
  assert.match(shareDialog, /const share = async \(\) => \{\s*if \(!file\) return;\s*keep\(\);/);
});

test('the dot: claimable reward or today\'s allowance; never on the orb (first look); on the entry, rewards tab and player panel', async () => {
  const { accountDotVisible, claimableCount } = await jiti.import('../src/lib/account-dot.ts');
  const claimable = { state: 'claimable' };
  const pending = { state: 'pending_verification' };
  const claimed = { state: 'claimed' };
  assert.equal(accountDotVisible({ rewards: [pending, claimed], daily: { claimable: false }, surface: 'lobby' }), false);
  assert.equal(accountDotVisible({ rewards: [claimable], daily: null, surface: 'lobby' }), true);
  assert.equal(accountDotVisible({ rewards: null, daily: { claimable: true }, surface: 'world-header' }), true);
  assert.equal(accountDotVisible({ rewards: [claimable], daily: { claimable: true }, surface: 'world-orb' }), false);
  assert.equal(claimableCount({ rewards: [claimable, pending], daily: { claimable: true } }), 2);
  assert.match(panel, /useAccountDot\(variant === 'launcher' \? 'lobby' : 'world-header'\)/);
  assert.match(dialog, /x\.id === 'rewards' && dot &&/);
  assert.match(players, /useAccountDot\('world-menu'\)/);
  assert.doesNotMatch(app, /useAccountDot/, 'nothing on the world stage itself');
  assert.match(read('../src/lib/ui-shell.mjs'), /initialShell = \{ header: false/, 'the header (and its entry) is closed on entry');
});

test('a dialog above everything: portal, aria-modal, Esc (nested view first), focus trap and return', () => {
  assert.match(dialog, /createPortal\(/);
  assert.match(dialog, /role="dialog" aria-modal="true"/);
  assert.match(dialog, /e\.key === 'Escape'/);
  assert.match(dialog, /e\.key !== 'Tab'/);
  assert.match(dialog, /returnTo\?\.focus/);
  assert.match(tabs, /useAccountLayer\('cg-view', viewing !== null, \(\) => setViewing\(null\)\)/);
  assert.match(tabs, /e\.stopPropagation\(\); setViewing\(null\);/, 'own key when no router');
  assert.match(css, /\.account-dialog \{[^}]*z-index: var\(--depth-ui\);/);
  assert.doesNotMatch(css + pcss, /z-index:\s*\d/, 'no numeric depth (docs/ux/02 §4.3)');
  assert.match(css, /@media \(max-width: 640px\) \{[^@]*height: 100dvh;/);
});

test('every new string exists in zh-CN, ja and ko', () => {
  const marked = [...achievements.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]);
  const used = new Set([...dialog, tabs, tab].join('\n').matchAll(/\bt\('([^']+)'/g) ? [...[dialog, tabs, tab].join('\n').matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]) : []);
  for (const key of [...marked, ...used, 'Account', 'My records', 'Rewards', 'CG', 'Settings']) {
    for (const loc of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[loc], `${key} · ${loc}`);
  }
});

test('the server mounts the profile routes', () => {
  assert.match(server, /app\.use\('\/api', createProfileRouter\(REPO_ROOT\)\);/);
});
