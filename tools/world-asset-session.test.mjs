import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from '../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

test('world asset URLs stay stable until a successful load, even for identical filenames', async () => {
  const { airpGateway } = await createJiti(import.meta.url).import('../apps/web/src/lib/airp-gateway.ts');
  const originalFetch = globalThis.fetch;
  try {
    const path = 'assets/scenes/intro.webp';
    const before = airpGateway.assetUrl(path, undefined, 'image');
    assert.equal(airpGateway.assetUrl(path, undefined, 'image'), before);
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, manifest: {}, path: 'templates/firstsnow' }));
    await airpGateway.loadWorld('templates/firstsnow');
    const after = airpGateway.assetUrl(path, undefined, 'image');
    assert.notEqual(after, before);
    assert.equal(new URL(after, 'http://localhost').searchParams.get('path'), path);
    assert.equal(new URL(after, 'http://localhost').searchParams.get('kind'), 'image');
    assert.equal(airpGateway.assetUrl(path, undefined, 'image'), after);
    await airpGateway.loadWorld('templates/firstsnow');
    assert.notEqual(airpGateway.assetUrl(path, undefined, 'image'), after);
    const stable = airpGateway.assetUrl(path, undefined, 'image');
    globalThis.fetch = async () => new Response('Failed', { status: 500 });
    await assert.rejects(airpGateway.loadWorld('missing'));
    assert.equal(airpGateway.assetUrl(path, undefined, 'image'), stable);
  } finally { globalThis.fetch = originalFetch; }
});
