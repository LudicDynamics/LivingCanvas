// Ambient life gate: the shape owner in packages/shared,
// the disk rule in tools/ambient-problems.mjs, and the official starter content.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AMBIENT_BARK_MAX, ambientEntryProblems, sanitizeAmbientEntry } from '../packages/shared/dist/index.js';
import { ambientProblems } from './ambient-problems.mjs';
import { editionFamilies, editionId, editionLocales } from './world-editions.mjs';
import { templateShipped } from './shipped-worlds.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));

async function world(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-ambient-check-'));
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), typeof text === 'string' ? text : JSON.stringify(text));
  }
  return root;
}

const BASE = {
  'world/README.md': '---\ntype: readme\n---\n',
  'world/cab/README.md': '---\ntype: readme\n---\n',
  'world/cab/lao-qin.md': '---\ntype: npc\nname: Old Qin\n---\nHi.\n',
  'world/cab/notice.md': '---\ntype: note\n---\nA notice.\n',
  'characters/xia-cheng/README.md': '---\ntype: readme\n---\n',
};

test('shape: a bark is ≤ 40 characters (code points), one line, in a list or per-locale map', () => {
  assert.equal(AMBIENT_BARK_MAX, 40);
  assert.deepEqual(ambientEntryProblems({ barks: ['x'.repeat(40)] }), []);
  // 40 CJK characters are 40, not 120 bytes.
  assert.deepEqual(ambientEntryProblems({ barks: ['字'.repeat(40)] }), []);
  assert.match(ambientEntryProblems({ barks: ['x'.repeat(41)] }).join('\n'), /41 characters; a bark is at most 40/);
  assert.match(ambientEntryProblems({ barks: ['two\nlines'] }).join('\n'), /one line/);
  assert.deepEqual(ambientEntryProblems({ barks: { en: ['Hello'], 'zh-CN': ['你好'], ja: ['やあ'], ko: ['안녕'] } }), []);
  assert.match(ambientEntryProblems({ barks: { fr: ['Salut'] } }).join('\n'), /unknown locale "fr"/);
  assert.match(ambientEntryProblems({ emotes: ['wink'] }).join('\n'), /"wink" is not one of/);
  assert.match(ambientEntryProblems({ when: [{ barks: ['a'] }] }).join('\n'), /names a layer, a time or a card/);
  assert.match(ambientEntryProblems({ when: [{ time: 'noon', barks: ['a'] }] }).join('\n'), /time: one of/);
  assert.match(ambientEntryProblems({ chats: [{ with: 'lao-qin', barks: ['only one'] }] }).join('\n'), /at least 2 lines/);
  assert.match(ambientEntryProblems({ chats: [{ with: 'lao-qin', barks: ['a', 'b', 'c', 'd', 'e'] }] }).join('\n'), /2–4 lines/);
  assert.match(ambientEntryProblems({ secret: 'x', barks: ['a'] }).join('\n'), /unknown key "secret"/);
  assert.match(ambientEntryProblems({}).join('\n'), /declares nothing/);
});

test('sanitize keeps the valid lines and drops the rest (one bad line never silences a person)', () => {
  const entry = sanitizeAmbientEntry({
    barks: ['ok', 'x'.repeat(41), 42, ''],
    emotes: ['dots', 'wink', 'dots'],
    when: [{ layer: 'world/cab', barks: ['cab'] }, { barks: ['no condition'] }],
    chats: [{ with: 'Bad Id', barks: ['a', 'b'] }, { with: 'lao-qin', barks: ['a', 'b'] }],
    junk: true,
  });
  assert.deepEqual(entry, {
    barks: ['ok'],
    emotes: ['dots'],
    when: [{ layer: 'world/cab', barks: ['cab'] }],
    chats: [{ with: 'lao-qin', barks: ['a', 'b'] }],
  });
  assert.equal(sanitizeAmbientEntry({ barks: ['x'.repeat(50)] }), null);
  assert.equal(sanitizeAmbientEntry('nope'), null);
});

test('check:worlds rule: whose file, chat partner, layer, card, variants, official lists', async () => {
  const good = await world({
    ...BASE,
    'ambient/xia-cheng.json': {
      barks: ['I know every door on this train.'],
      when: [{ layer: 'world/cab', barks: ['Diesel.'] }, { card: 'world/cab/notice.md', barks: ['A notice!'] }],
      chats: [{ with: 'lao-qin', barks: ['Holding up?', 'Ask me at five.'] }],
    },
    'ambient/lao-qin.json': { emotes: ['dots'] },
  });
  assert.deepEqual(await ambientProblems(good), []);
  assert.deepEqual(await ambientProblems(good, { official: true }), []);

  const bad = await world({
    ...BASE,
    'ambient/nobody.json': { barks: ['Hi'] },
    'ambient/Bad_Name.json': { barks: ['Hi'] },
    'ambient/lao-qin.json': '{ not json',
    'ambient/xia-cheng.json': {
      barks: { en: ['Hi'] },
      when: [{ layer: 'world/nowhere', barks: ['x'] }, { card: 'world/cab/gone.md', barks: ['x'] }],
      chats: [{ with: 'ghost', barks: ['a', 'b'] }, { with: 'xia-cheng', barks: ['a', 'b'] }],
    },
    'variants/culprit/a/ambient/xia-cheng.json': { barks: ['It was him.'] },
  });
  const problems = (await ambientProblems(bad, { official: true })).join('\n');
  assert.match(problems, /ambient\/nobody\.json: no characters\/nobody\/ and no NPC card nobody\.md/);
  assert.match(problems, /ambient\/Bad_Name\.json: an ambient file is ambient\/<kebab-id>\.json/);
  assert.match(problems, /ambient\/lao-qin\.json: not JSON/);
  assert.match(problems, /when\[0\]\.layer world\/nowhere is not a layer/);
  assert.match(problems, /when\[1\]\.card world\/cab\/gone\.md is not a card/);
  assert.match(problems, /chats\[0\]\.with ghost is nobody in this world/);
  assert.match(problems, /chats\[1\] is with xia-cheng itself/);
  assert.match(problems, /barks: an official edition writes its own language as a plain list/);
  assert.match(problems, /variants\/culprit\/a\/ambient\/xia-cheng\.json: barks never vary per run/);
  // The per-locale map is fine outside the official editions.
  assert.doesNotMatch((await ambientProblems(bad)).join('\n'), /official edition/);
});

test('starter content: last-train, whitechapel, guixiang ship ambient/ in all four editions; last-witness none', async () => {
  // A world the open-source copy does not carry (shipped-worlds.mjs) is left out.
  for (const base of ['last-train', 'whitechapel', 'guixiang'].filter((b) => templateShipped(b))) {
    const family = editionFamilies.find((f) => f.base === base);
    assert.ok(family, base);
    let shape = null;
    for (const locale of editionLocales) {
      const root = path.join(repo, 'templates', editionId(family, locale));
      const files = (await fs.readdir(path.join(root, 'ambient'))).sort();
      assert.ok(files.length >= 3, `${root}: ambient files`);
      assert.deepEqual(await ambientProblems(root, { official: true }), [], root);
      const sizes = {};
      for (const f of files) {
        const doc = JSON.parse(await fs.readFile(path.join(root, 'ambient', f), 'utf8'));
        sizes[f] = [doc.barks?.length ?? 0, doc.when?.length ?? 0, doc.chats?.length ?? 0];
      }
      if (shape) assert.deepEqual(sizes, shape, `${root}: same people and line counts as the English edition`);
      shape ??= sizes;
    }
    // Every main character has 3–8 barks (minor NPCs may have emotes only).
    for (const [f, [barks]] of Object.entries(shape)) assert.ok(barks === 0 || (barks >= 3 && barks <= 8), `${base}/${f}: ${barks} barks`);
  }
  if (templateShipped('last-witness')) for (const locale of editionLocales) {
    const family = editionFamilies.find((f) => f.base === 'last-witness');
    const root = path.join(repo, 'templates', editionId(family, locale));
    await assert.rejects(fs.access(path.join(root, 'ambient')), `${root}: a variant world gets no barks for now`);
  }
});
