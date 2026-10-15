import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { editionFamilies, editionId, editionLocales, shippedFamilies } from './world-editions.mjs';
import { checkEditions } from './check-world-editions.mjs';
import { filesUnder, protect, restore } from './localize-world-editions.mjs';
import { LocalWorldStore, parseFrontmatter } from '../packages/shared/dist/index.js';
import { createWorldRouter } from '../apps/server/dist/routes/world.js';
import { readWorldShelf } from '../apps/server/dist/world-shelf.js';
const repo = process.cwd();
const staged = process.env.AIRP_TEST_STAGED_EDITIONS === '1';
const templates = path.join(repo, staged ? '.artifacts/bilingual-worlds/editions' : 'templates');

test('first snow ships as first-snow, with -jp and -zh editions', () => {
  const family = editionFamilies.find(f => f.base === 'firstsnow');
  assert.ok(family);
  assert.equal(editionId(family, 'en'), 'first-snow');
  assert.equal(editionId(family, 'ja'), 'first-snow-jp');
  assert.equal(editionId(family, 'zh-CN'), 'first-snow-zh');
});

test('registry contains the ten canonical worlds in English, Japanese, Chinese and Korean', () => {
  assert.deepEqual(editionLocales, ['en', 'ja', 'zh-CN', 'ko']);
  assert.deepEqual(
    editionFamilies.flatMap(f => editionLocales.map(locale => editionId(f, locale))).sort(),
    ['divergence', 'divergence-jp', 'divergence-zh', 'first-snow', 'first-snow-jp', 'first-snow-zh', 'forger', 'forger-jp', 'forger-zh', 'guixiang', 'guixiang-jp', 'guixiang-zh', 'islet', 'islet-jp', 'islet-zh', 'last-train', 'last-train-jp', 'last-train-zh', 'last-train-prologue', 'last-train-prologue-jp', 'last-train-prologue-zh', 'last-witness', 'last-witness-jp', 'last-witness-zh', 'magic-academy', 'magic-academy-jp', 'magic-academy-zh', 'moonlit-contract', 'moonlit-contract-jp', 'moonlit-contract-zh', 'unwritten-door', 'unwritten-door-jp', 'unwritten-door-zh', 'whitechapel', 'whitechapel-jp', 'whitechapel-zh', 'wuwu', 'wuwu-jp', 'wuwu-zh']
      .flatMap(id => (/-(jp|zh)$/.test(id) ? [id] : [id, `${id}-ko`])).sort(),
  );
});

test('every edition preserves every file, executable field, character profile and asset', async () => { await checkEditions({ staged }); });
test('translation guards reject changed or missing paths and dice numbers', () => {
  const text = 'Read world/test/README.md and roll 2d10, >=11.';
  const p = protect(text); assert.equal(restore(p.masked, p.literals), text);
  assert.throws(() => restore(p.masked.replace('⟪0⟫', ''), p.literals), /protected/);
  assert.throws(() => restore(p.masked + '⟪0⟫', p.literals), /protected/);
});
test('the world shelf separates the canonical editions from experimental sandboxes', async () => {
  if (staged) return;
  const shelf = await readWorldShelf(repo);
  assert.deepEqual(shelf.templates.sort(), shippedFamilies().flatMap(f => editionLocales.map(l => editionId(f, l))).sort());
  // `expTemplates` is the OTHER half of the contract: a sandbox must be listed
  // there (so the Launcher can open it) while staying out of `templates` (so the
  // edition corpus above stays exactly 21). Asserting both keeps either half
  // from quietly disappearing.
  for (const id of shelf.expTemplates ?? []) {
    assert.ok(!shelf.templates.includes(id), `${id}: experimental world leaked into the edition list`);
    assert.ok(shelf.groups.some(g => g.id === id && g.templatePath), `${id}: experimental world is not openable from the Launcher`);
  }
});

test('fresh saves of every edition resolve the same layers and direct choices without calling an Agent', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-edition-test-'));
  const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
  for (const family of staged ? editionFamilies : shippedFamilies()) {
    let englishLayers;
    for (const locale of staged ? ['en', 'ja'] : editionLocales) {
      const id = editionId(family, locale), root = path.join(tmp, id);
      await fs.cp(path.join(templates, id), root, { recursive: true, filter: f => !['assets', '.airpworld', '.pi'].includes(path.basename(f)) });
      const store = new LocalWorldStore(root);
      let dispatches = 0;
      const lifecycle = new Proxy({}, { get: () => () => { dispatches++; throw new Error('Unexpected model call'); } });
      const app = require('express')(); app.use(require('express').json());
      app.use('/api', createWorldRouter(repo, lifecycle, { broadcast() {} }, () => store, () => {}));
      const server = app.listen(0, '127.0.0.1');
      await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
      const post = async (route, body) => {
        const r = await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        return { status: r.status, body: await r.json() };
      };
      try {
        const manifest = await store.getManifest();
        const layers = Object.keys(manifest.layers).sort();
        if (locale === 'en') englishLayers = layers; else assert.deepEqual(layers, englishLayers, `${id}: identical scene topology`);
        assert.ok(manifest.layers[manifest.entry]);
        for (const c of manifest.characters) assert.ok(manifest.layers[c.home], c.id);
        if (family.base === 'wuwu') assert.equal((await post('enter-layer', { layer: 'world/harbor-chart' })).status, 409);
        let choices = 0;
        // Every card's declared choices — the layer READMEs too: they own a layer's
        // options, and an opening chalk no longer repeats them (tools/choice-problems.mjs).
        for (const file of (await filesUnder(path.join(templates, id))).filter(f => f.startsWith('world/') && f.endsWith('.md'))) {
          const p = parseFrontmatter(await fs.readFile(path.join(templates, id, file), 'utf8'));
          for (const option of p.interactive.choice?.options ?? []) {
            const action = p.frontmatter.choice_actions?.[option.id];
            // An option hidden by its `when` (e.g. 末班车 car 2's exits before the account) is not offered yet.
            if (!action || option.visible === false) continue;
            const result = await post('choice', { path: file, choice: option.label });
            assert.equal(result.status, 200, `${id}/${file}: ${JSON.stringify(result.body)}`);
            assert.equal(result.body.action.kind, action.kind); choices++;
          }
        }
        if (family.base !== 'moonlit-contract') assert.ok(choices > 0);
        if (family.base === 'wuwu') assert.equal((await post('enter-layer', { layer: 'world/harbor-chart' })).status, 200);
        assert.equal(dispatches, 0, `${id}: direct choices must not start an Agent`);
        console.log(`Playable ${id}: ${layers.length} layers, ${choices} declared choices`);
      } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
    }
  }
});
