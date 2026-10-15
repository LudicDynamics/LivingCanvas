import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';
const jiti = createJiti(import.meta.url);
const { gateFeedback } = await jiti.import('../src/lib/gate-feedback.ts');
const { airpGateway, AirpRequestError } = await jiti.import('../src/lib/airp-gateway.ts');
const items = [
  { path: 'world/harbor-chart/README.md', frontmatter: { title: '港の地図', blocked: '依頼書と徽章を、鞄に入れてから。' } },
  { path: 'world/commission-letter.md', frontmatter: { title: '依頼書' } },
  { path: 'world/investigator-badge.md', frontmatter: { title: '調査員の徽章' } },
];
test('real gateway decodes a gameplay refusal into a localized beat', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'requirements_not_met', missing: ['player/commission-letter.md'] }), { status: 409 });
  try {
    await assert.rejects(airpGateway.enterLayer('world/harbor-chart'), error => {
      const beat = gateFeedback(error, 'world/harbor-chart', items);
      assert.equal(beat.title, '港の地図');
      assert.equal(beat.text, '依頼書と徽章を、鞄に入れてから。');
      assert.equal(beat.items.length, 1);
      assert.equal(beat.items[0].title, '依頼書');
      assert.doesNotMatch(beat.text, /409|POST|player\//);
      return true;
    });
  } finally { globalThis.fetch = original; }
});
test('technical failures and malformed responses never become story', () => {
  for (const error of [new Error('Network failure'), new AirpRequestError('broken', 500, {}), new AirpRequestError('bad gate', 409, { code: 'invalid_gate' }), new AirpRequestError('broken', 409, { code: 'requirements_not_met', missing: false })]) {
    assert.equal(gateFeedback(error, 'world/harbor-chart', items), null);
  }
});
test('unresolved items do not expose paths or invent places', () => {
  const error = new AirpRequestError('diagnostic', 409, { code: 'requirements_not_met', missing: ['player/unknown.md'] });
  assert.deepEqual(gateFeedback(error, 'world/harbor-chart', []).items, []);
});
