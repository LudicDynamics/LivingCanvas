// The page side of NPC cards: pure helpers and wiring.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { npcTalkTarget, npcInitial, npcLineId, npcSpeakableLines, isNpcCard } = await jiti.import('../src/lib/npc-dialogue.ts');
const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');

const fm = {
  type: 'npc', name: '老秦', gender: 'male', persona: 'x', knows: ['world/cab/repair-notice.md'],
  dialogue: [{ by: 'player', text: '几点下的车？', at: 't1' }, { by: 'npc', text: '零点四十二。', at: 't2' }, { by: 'x', text: 'junk' }],
};

test('a card becomes a talk target with its recorded exchange and voice', () => {
  const target = npcTalkTarget({ path: 'world/cab/lao-qin.md', frontmatter: fm });
  assert.equal(target.name, '老秦');
  assert.equal(target.voice, 'soothing-smooth');
  assert.equal(target.avatar, undefined);
  assert.deepEqual(target.dialogue.map((d) => d.by), ['player', 'npc']);
  assert.equal(npcTalkTarget({ path: 'world/cab/x.md', frontmatter: { type: 'note' } }), null);
  assert.equal(isNpcCard(fm), true);
});

test('reopening never re-reads old lines; new NPC lines are spoken as the character', () => {
  const seen = new Set(fm.dialogue.slice(0, 2).map(npcLineId));
  const next = [...fm.dialogue.slice(0, 2), { by: 'player', text: '钥匙呢？', at: 't3' }, { by: 'npc', text: '挂着。', at: 't4' }];
  const lines = npcSpeakableLines(next, seen);
  assert.deepEqual(lines.map((l) => [l.who, l.text]), [['player', '钥匙呢？'], ['character', '挂着。']]);
  assert.equal(npcInitial('lao qin'), 'L');
  assert.equal(npcInitial('老秦'), '老');
});

test('the card, the map pin and the dialogue are wired', async () => {
  const [renderer, interactions, map, board, gateway, app] = await Promise.all([
    src('../src/components/canvas/CardRenderer.tsx'), src('../src/components/narrative/EntityInteractions.tsx'),
    src('../src/components/board/PictureMap.tsx'), src('../src/lib/board-model.ts'),
    src('../src/lib/airp-gateway.ts'), src('../src/App.tsx'),
  ]);
  assert.match(renderer, /frontmatter\?\.type === 'npc'[\s\S]{0,80}<NpcCard/);
  assert.match(interactions, /converse: \(\) => requestNpcTalk\(/);
  assert.match(interactions, /!isNpc && fm\?\.type !== 'chalk'/, 'an NPC is never collectable');
  assert.match(map, /pin\.kind === 'npc'[\s\S]{0,200}requestNpcTalk/);
  assert.match(board, /kind: 'npc'/);
  assert.match(gateway, /'\/api\/npc\/talk'/);
  assert.match(app, /<NpcDialogueHost language=\{contentLanguage\}/);
});

test('the talk button reads 对话 / 話しかける', async () => {
  const messages = JSON.parse(await src('../src/lib/messages.json'));
  assert.equal(messages['Converse']['zh-CN'], '对话');
  assert.ok(messages['Converse'].ja);
});
