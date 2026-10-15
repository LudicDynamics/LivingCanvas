// Rewards in 「邀请好友」 (anti-abuse): billing grants rewards only from play it served itself.
// A `pending_verification` reward shows 「玩一会儿后解锁」 with its progress (n/20 回合, 「再打出一个结局」) and no claim
// button; a claimable one keeps 领取. An invite code's credits unlock after play, they are not "added".
// Run: node --test apps/web/test/rewards.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const read = (rel) => fs.readFileSync(path.join(webRoot, rel), 'utf8');
const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
const { rewardState } = await jiti.import('../src/lib/account-data.ts');
const messages = JSON.parse(read('src/lib/messages.json'));

const PENDING = { id: 'r2', kind: 'invite_welcome', credits: 500, state: 'pending_verification', status: 'pending_verification', progress: { calls: 7, need: 20, endingNeeded: true, ending: false }, expiresAt: null, createdAt: null, claimedAt: null };
const CLAIMABLE = { id: 'r1', kind: 'invite', credits: 200, state: 'claimable', status: 'pending', progress: null, expiresAt: null, createdAt: null, claimedAt: null };

test('rewardState: the server\'s state, else the legacy status (a bare pending is claimable)', () => {
  assert.equal(rewardState(PENDING), 'pending_verification');
  assert.equal(rewardState(CLAIMABLE), 'claimable');
  assert.equal(rewardState({ status: 'pending' }), 'claimable');
  assert.equal(rewardState({ status: 'pending_verification' }), 'pending_verification');
  assert.equal(rewardState({ status: 'claimed' }), 'claimed');
});

test('render: a pending reward shows its progress and no button; a claimable one keeps 领取', async () => {
  const require = createRequire(pathToFileURL(path.join(webRoot, 'test/x.mjs')));
  const esbuild = require(path.join(repoRoot, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js'));
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const cacheDir = path.join(webRoot, 'node_modules/.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(cacheDir, 'airp-rewards-'));
  const out = await esbuild.build({
    entryPoints: [path.join(webRoot, 'src/components/chrome/RewardList.tsx')],
    bundle: true, write: false, format: 'esm', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'], platform: 'node', logLevel: 'error',
  });
  const bundle = path.join(dir, 'reward-list.mjs');
  fs.writeFileSync(bundle, out.outputFiles[0].text, 'utf-8');
  const { RewardList } = await import(pathToFileURL(bundle).href);
  const html = renderToStaticMarkup(React.createElement(RewardList, { rewards: [CLAIMABLE, PENDING], busy: null, onClaim() {} }));
  fs.rmSync(dir, { recursive: true, force: true });
  const [claimable, pending] = html.split('<li').slice(1);
  assert.match(claimable, /Invite reward: 200 credits/);
  assert.match(claimable, /<button[^>]*>Claim<\/button>/);
  assert.match(pending, /Invite welcome gift: 500 credits/);
  assert.match(pending, /Unlocks after you play a little/); // English copy; the key stays
  assert.match(pending, /7\/20 turns/);
  assert.match(pending, /Then reach an ending/);
  assert.doesNotMatch(pending, /<button/, 'not claimable yet');
  const done = renderToStaticMarkup(React.createElement(RewardList, { rewards: [{ ...PENDING, progress: { calls: 25, need: 20, endingNeeded: true, ending: true } }], busy: null, onClaim() {} }));
  assert.match(done, /20\/20 turns/);
  assert.doesNotMatch(done, /Then reach an ending/);
});

test('invite redeem: credits unlock after play (toast and the redeem field); the old line stays for an older billing', () => {
  for (const file of ['src/components/chrome/RedeemCode.tsx', 'src/components/chrome/InviteAutoRedeem.tsx']) {
    const s = read(file);
    assert.match(s, /pendingVerification\s*\n?\s*\? t\('Invite code applied: your \{credits\} credits unlock after you play a bit\.'/, file);
    assert.match(s, /: t\('Invite code applied: \{credits\} credits added\.'/, file);
  }
  // 邀请好友 lists claimable + pending through the shared hook (RewardList.tsx useRewardClaims; default states).
  assert.match(read('src/components/chrome/InviteFriends.tsx'), /useRewardClaims\(\)/);
  assert.match(read('src/components/chrome/RewardList.tsx'), /states: readonly RewardState\[\] = \['claimable', 'pending_verification'\]/);
  assert.match(read('src/components/chrome/RewardList.tsx'), /states\.includes\(rewardState\(x\)\)/);
});

test('i18n: the reward strings in zh-CN, ja and ko', () => {
  assert.equal(messages['Unlocks after you play a bit']['zh-CN'], '玩一会儿后解锁');
  assert.equal(messages['{calls}/{need} turns']['zh-CN'], '{calls}/{need} 回合');
  assert.equal(messages['Then reach one ending']['zh-CN'], '再打出一个结局');
  for (const key of ['Your rewards', 'Unlocks after you play a bit', '{calls}/{need} turns', 'Then reach one ending', 'Invite welcome gift: {credits} credits', 'Rest of your welcome credits: {credits} credits', 'Invite code applied: your {credits} credits unlock after you play a bit.']) {
    for (const l of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[l], `${key} [${l}]`);
  }
});
