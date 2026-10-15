// The four tiers on screen: tier from any
// payload, the consequence chip, the rendered badge + chip in four languages,
// the ceremony's per-tier look and sound, and the debrief tally.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true, jsx: true });
const tier = await jiti.import('../src/lib/dice-tier.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');

test('outcomeOfPayload: the server outcome wins; else grade, else booleans', () => {
  assert.equal(tier.outcomeOfPayload({ outcome: 'crit_fail', passed: true }), 'crit_fail');
  assert.equal(tier.outcomeOfPayload({ passed: false, skill: { grade: 'failure' } }), 'crit_fail');
  assert.equal(tier.outcomeOfPayload({ passed: true, outcomeGrade: 'great-success' }), 'crit_success');
  assert.equal(tier.outcomeOfPayload({ passed: false, fumble: true }), 'crit_fail');
  assert.equal(tier.outcomeOfPayload({ passed: true }), 'success');
  assert.equal(tier.outcomeOfPayload(null), null);
});

test('chips: applied cost / bonus, pending, nothing', () => {
  assert.deepEqual(tier.consequenceChipOf({ due: 'cost', applied: [{ direction: 'cost', what: '潮水 -1', by: 'default' }] }), { status: 'applied', direction: 'cost', line: '潮水 −1' });
  assert.deepEqual(tier.consequenceChipOf({ due: 'cost', applied: [] }), { status: 'pending', direction: 'cost', line: null });
  assert.deepEqual(tier.consequenceChipOf({ due: 'bonus', applied: [{ direction: 'bonus', what: 'A note' }] }), { status: 'applied', direction: 'bonus', line: 'A note' });
  assert.equal(tier.consequenceChipOf({ due: null, applied: [] }), null);
});

test('card tier: record first, then receipt, then legacy dice_grade', () => {
  assert.equal(tier.cardTierOf({ roll_dice: { result: 3 }, dice_consequence: { outcome: 'crit_fail', due: 'cost', applied: [] } }).outcome, 'crit_fail');
  assert.equal(tier.cardTierOf({ roll_dice: { result: 5, passed: false }, dice_receipt: { outcome: 'fail', passed: false } }).outcome, 'fail');
  assert.equal(tier.cardTierOf({ roll_dice: { result: 19, passed: true }, dice_grade: 'great-success' }).outcome, 'crit_success');
  assert.equal(tier.cardTierOf({ roll_dice: { result: 12, passed: true } }).outcome, 'success');
});

test('DiceTierLine renders the badge and the chip; words in four languages', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { translate } = await jiti.import('../src/lib/i18n.ts');
  const { DiceTierLine, chipText, outcomeText } = await jiti.import('../src/components/narrative/DiceTierLine.tsx');
  // SSR renders the server snapshot (en); the markup is the contract.
  const html = renderToStaticMarkup(React.createElement(DiceTierLine, { outcome: 'crit_fail', chip: { status: 'applied', direction: 'cost', line: '潮水 \u22121' } }));
  assert.match(html, /data-outcome="crit_fail"/);
  assert.match(html, /data-testid="dice-tier-badge"[^>]*>Critical failure</);
  assert.match(html, /data-chip="cost"[^>]*>Cost: 潮水 −1</);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(DiceTierLine, { outcome: 'success' })), /dice-tier-chip/);
  assert.match(renderToStaticMarkup(React.createElement(DiceTierLine, { outcome: 'crit_fail', chip: { status: 'pending', direction: 'cost', line: null } })), /data-chip="pending"[^>]*>A price is owed/);
  const t = (locale) => (k, v) => translate(locale, k, v);
  assert.equal(outcomeText('crit_fail', t('zh-CN')), '大失败');
  assert.equal(outcomeText('crit_success', t('ja')), '大成功');
  assert.equal(outcomeText('fail', t('ko')), '실패');
  assert.equal(chipText({ status: 'applied', direction: 'cost', line: '潮水 −1' }, t('zh-CN')), '代价：潮水 −1');
  assert.equal(chipText({ status: 'applied', direction: 'bonus', line: 'メモ' }, t('ja')), '追加の成果：メモ');
  assert.equal(chipText({ status: 'applied', direction: 'cost', line: '조수 −1' }, t('ko')), '대가: 조수 −1');
});

test('each tier has its own sound; the ceremony styles and voices by tier, not by crit flags', async () => {
  const sounds = Object.values(tier.TIER_SOUND).map((s) => s.foley);
  assert.equal(new Set(sounds).size, 4);
  const ceremony = await src('../src/components/performance/DiceCeremony.tsx');
  assert.match(ceremony, /TIER_SOUND\[/);
  assert.match(ceremony, /<DiceTierLine outcome=\{outcome\} chip=\{chip\} \/>/);
  assert.match(ceremony, /data-outcome=\{phase === 'settled' \? outcome : undefined\}/);
  const css = await src('../src/index.css');
  for (const t of ['crit_success', 'success', 'fail', 'crit_fail']) assert.match(css, new RegExp(`\\.dice-tier-badge\\[data-outcome='${t}'\\]`));
  assert.match(await src('../src/components/narrative/ChalkCard.tsx'), /cardTierOf\(/);
});

test('debrief tally counts the four tiers and keeps what each crit cost / gave', () => {
  const t = tier.diceTally([
    { name: 'Lock', passed: false, outcome: 'crit_fail', consequence: { direction: 'cost', what: '潮水 −1' } },
    { name: 'Desk', passed: true, outcome: 'crit_success', consequence: { direction: 'bonus', what: 'A note' } },
    { name: 'Door', passed: true, outcome: 'success' },
    { name: 'Old', passed: false },
    { name: 'Unknown', passed: null },
  ]);
  assert.equal(t.rolls, 4);
  assert.deepEqual(t.byTier, { crit_success: 1, success: 1, fail: 1, crit_fail: 1 });
  assert.deepEqual(t.crits, [
    { outcome: 'crit_fail', name: 'Lock', what: '潮水 −1' },
    { outcome: 'crit_success', name: 'Desk', what: 'A note' },
  ]);
});
