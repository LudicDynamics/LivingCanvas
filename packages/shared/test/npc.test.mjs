// NPC cards: schema, brief, reply parsing, dialogue.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendNpcDialogue,
  buildNpcBrief,
  declaredRewardCard,
  npcCardErrors,
  npcDialogueOf,
  npcVoiceAlias,
  parseNpcReply,
  readNpcCard,
  NPC_DIALOGUE_KEEP,
} from '../dist/index.js';

const valid = () => ({
  type: 'npc',
  name: '苏禾',
  gender: 'female',
  persona: '冻得发抖的年轻女人。\n说话很轻。',
  knows: ['world/freight-car/su-he-testimony.md'],
  wants: '让人知道日志被拿走了',
  gives: ['take-testimony'],
  choice: { options: [{ id: 'take-testimony', label: '记下苏禾的话' }] },
  choice_actions: { 'take-testimony': { kind: 'take', paths: ['world/freight-car/su-he-testimony.md'] } },
});

test('a complete NPC card is valid and reads back as data', () => {
  assert.deepEqual(npcCardErrors(valid()), []);
  const npc = readNpcCard(valid());
  assert.equal(npc.name, '苏禾');
  assert.deepEqual(npc.gives, ['take-testimony']);
});

test('the schema rejects what the engine cannot honour', () => {
  const cases = [
    [{ name: '' }, /name is required/],
    [{ persona: 'a\nb\nc\nd' }, /persona must be 1–3 lines/],
    [{ knows: [] }, /knows must list/],
    [{ knows: ['../secret.md'] }, /knows entry/],
    [{ knows: ['assets/x.png'] }, /knows entry/],
    [{ avatar: 'https://x/y.png' }, /avatar/],
    [{ voice: 'no-such-voice' }, /palette voice/],
    [{ gender: 'robot' }, /gender/],
    [{ gives: ['logbook'] }, /not an option/],
    [{ choice_actions: {} }, /needs a choice_actions entry/],
    [{ portable: true }, /cannot be portable/],
  ];
  for (const [patch, pattern] of cases) {
    const errors = npcCardErrors({ ...valid(), ...patch });
    assert.ok(errors.some((e) => pattern.test(e)), `${JSON.stringify(patch)} → ${errors.join('; ')}`);
    assert.equal(readNpcCard({ ...valid(), ...patch }), null);
  }
});

test('the brief carries only the knows cards, the declared gives and the world language', () => {
  const npc = readNpcCard(valid());
  const brief = buildNpcBrief({
    path: 'world/freight-car/su-he.md',
    npc,
    frontmatter: valid(),
    knows: [
      { path: 'world/freight-car/su-he-testimony.md', title: '苏禾的话', body: '茶很苦。' },
      { path: 'world/freight-car/logbook-page.md', title: '日志页', body: '01:12 红灯放行' },
    ],
    history: [{ by: 'player', text: '你还好吗？' }, { by: 'npc', text: '冷……' }],
    line: '日志在哪？',
    language: 'zh-CN',
  });
  assert.match(brief, /茶很苦/);
  assert.doesNotMatch(brief, /红灯放行/, 'a card not in knows never reaches the brief');
  assert.match(brief, /take-testimony — 记下苏禾的话/);
  assert.match(brief, /Simplified Chinese/);
  assert.match(brief, /ONLY facts written in the "Knows" cards/);
  assert.match(brief, /1–3 sentences/);
  assert.match(brief, /让人知道日志被拿走了/);
  assert.match(brief, /Player now says: "日志在哪？"/);
  const given = buildNpcBrief({ path: 'p', npc, knows: [], history: [], line: 'x', language: 'ja', given: ['take-testimony'] });
  assert.match(given, /has nothing to hand over/);
  assert.match(given, /Japanese/);
});

test('a reply keeps only the words and only declared gives', () => {
  const npc = { name: '苏禾', gives: ['take-testimony'] };
  assert.deepEqual(parseNpcReply('苏禾：「我……记不清了。」', npc), { line: '我……记不清了。', gives: [] });
  assert.deepEqual(parseNpcReply('拿去吧。\n[give: take-testimony]', npc), { line: '拿去吧。', gives: ['take-testimony'] });
  assert.deepEqual(parseNpcReply('给你。[give: logbook-page]', npc), { line: '给你。', gives: [] });
});

test('the recorded exchange is cleaned and bounded', () => {
  assert.deepEqual(npcDialogueOf({ dialogue: [{ by: 'npc', text: 'hi' }, { by: 'x', text: 'y' }, 'junk'] }), [{ by: 'npc', text: 'hi' }]);
  let log = [];
  for (let i = 0; i < NPC_DIALOGUE_KEEP + 5; i++) log = appendNpcDialogue(log, [{ by: 'player', text: ` ${i} ` }]);
  assert.equal(log.length, NPC_DIALOGUE_KEEP);
  assert.equal(log.at(-1).text, String(NPC_DIALOGUE_KEEP + 4));
});

test('voice: the card’s own, else by gender', () => {
  assert.equal(npcVoiceAlias({ voice: 'hoarse-weathered' }), 'hoarse-weathered');
  assert.equal(npcVoiceAlias({ gender: 'male' }), 'soothing-smooth');
  assert.equal(npcVoiceAlias({ gender: 'female' }), 'gentle-calm');
  assert.equal(npcVoiceAlias({}), 'warm-cheerful');
  // the card's own gender overrules a voice of the other sex
  assert.equal(npcVoiceAlias({ voice: 'bold-resonant', gender: 'male' }), 'soothing-smooth');
  assert.equal(npcVoiceAlias({ voice: 'cool-composed', gender: 'female' }), 'gentle-calm');
  assert.equal(npcVoiceAlias({ voice: 'bold-resonant', gender: 'female' }), 'bold-resonant');
});

test('a declared find is known by its reward text before the roll', () => {
  const fm = { search: [{ id: 'scene', dice_outcomes: [{ rewards: [{ path: 'world/a/witness.md', title: 'W', body: 'saw a coat' }] }] }] };
  assert.deepEqual(declaredRewardCard(fm, 'world/a/witness.md'), { title: 'W', body: 'saw a coat' });
  assert.equal(declaredRewardCard(fm, 'world/a/other.md'), null);
});
