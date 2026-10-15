import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitiseTtsText, splitNarration } from '../dist/rules/tts-text.js';

test('sanitiseTtsText removes action brackets and leading emotion tags', () => {
  const cases = [
    ['（笑了一下）好啊', '好啊'],
    ['(laughs) Sure', 'Sure'],
    ['【把信递给你】拿着', '拿着'],
    ['[emo: smile] 好啊', '好啊'],
    ['[emo: sad] （今は、答えが返ってこない。）', ''],
    ['（笑了一下）', ''],
    ['（）好', '好'],
    ['()好', '好'],
  ];
  for (const [raw, expected] of cases) assert.equal(sanitiseTtsText(raw), expected, raw);
});

test('sanitiseTtsText supports properly nested actions and preserves prose', () => {
  assert.equal(sanitiseTtsText('(aside [quiet]) Hello'), 'Hello');
  assert.equal(sanitiseTtsText('  Keep [aside] this  '), 'Keep  this');
  assert.equal(sanitiseTtsText('[emo: smile] [emo: sad] hello'), 'hello');
});

test('sanitiseTtsText fails closed for malformed bracket structures', () => {
  for (const raw of [
    '（说完就走了',
    '还好）',
    '（他说\n完了',
    '(cross [types)',
    'cross] types',
  ]) {
    assert.equal(sanitiseTtsText(raw), '', raw);
  }
});

test('sanitiseTtsText is idempotent', () => {
  for (const raw of [
    '（笑）hello',
    '[emo: smile] (laughs) Sure',
    '（说完就走了',
    'plain text',
  ]) {
    const cleaned = sanitiseTtsText(raw);
    assert.equal(sanitiseTtsText(cleaned), cleaned, raw);
  }
});

// ── Narration is shown, not spoken ─────────────────────────
// Samples are shaped like real character output from local saves (wuwu /
// first-snow / last-train / whitechapel char-* sessions).

test('sanitiseTtsText drops marked narration in all four languages', () => {
  const cases = [
    // zh: full-width parentheses, the convention
    ['[emo: sad]（她低下头，指尖摩挲着信封。）这封信，我一直没敢拆。', '这封信，我一直没敢拆。'],
    // ja: the one real slip found in first-snow-jp (nanami)
    ['[emo: smile]（片方のヘッドホンを指で押さえて、小さく笑う）……ねえ、今の「hello」、発音よすぎ。', '……ねえ、今の「hello」、発音よすぎ。'],
    // ko
    ['（잠시 시선을 피한다）그건… 제가 본 게 아니에요.', '그건… 제가 본 게 아니에요.'],
    // en: asterisks and half-width parentheses
    ['*She sets the clasp down under the lamp.* Right. Scratches first, then the crest.', 'Right. Scratches first, then the crest.'],
    ['(looks away) I said I would not make a scene of it.', 'I said I would not make a scene of it.'],
    // narration in the middle and at the end
    ['好啊。（把茶杯推过来）坐吧。', '好啊。坐吧。'],
    ['Fine. *She wipes her hands on her apron.*', 'Fine.'],
  ];
  for (const [raw, expected] of cases) assert.equal(sanitiseTtsText(raw), expected, raw);
});

test('sanitiseTtsText: quotes inside narration go with the narration; nested brackets nest', () => {
  assert.equal(sanitiseTtsText('（她看着你，轻声说：“好”）'), '');
  assert.equal(sanitiseTtsText('(she mutters "fine" [barely audible]) We go at five.'), 'We go at five.');
  assert.equal(sanitiseTtsText('（窓の外を見る（雪だ））降ってきたね。'), '降ってきたね。');
});

test('sanitiseTtsText: a reply that is all narration speaks nothing', () => {
  for (const raw of [
    '（她没有回答，只是把名单攥得更紧了。）',
    '*He says nothing.*',
    '[emo: sad] （黙って首を横に振る）',
    '（고개를 숙인다）',
    '彼女は目を伏せた。',
    'She looks away.',
  ]) assert.equal(sanitiseTtsText(raw), '', raw);
});

test('sanitiseTtsText: speech-only lines are untouched (real samples)', () => {
  const lines = [
    '那十二分钟，是我把灯熄的，这个我不推给别人。',
    '「もう一隻あった」と断定はできないよ。',
    "Loud and clear. Though I'll say this first, before anything else.",
    '깨어났어요? 깨워서 죄송해요—옆에 계신 17번 아가씨가 사라졌어요.',
    // third person ABOUT someone else, mid-account: still speech
    '我担心的是画上那个人：正午，他伸手去接红信封的那一瞬，两只手都占着。',
    '那封信我没拆。他摇了摇头，说不知道。',
    "And if you're heading to the pier, Silver Kite won't care whose crest is in your bag.",
    // a self-name used as a pronoun is not narration
    '涯跟着你，你去哪年，涯就去哪年。',
  ];
  for (const line of lines) assert.equal(sanitiseTtsText(line, { names: ['涯', '夏澄', 'Vera'] }), line, line);
});

test('sanitiseTtsText: unmarked third-person action sentences are narration (conservative)', () => {
  const cases = [
    ['她低下头，指尖摩挲着信封。我没看见那封信。', '我没看见那封信。'],
    ['夏澄笑了笑：「我在这儿。」', '「我在这儿。」'],
    ['彼女は小さく笑った。うん、聞こえてるよ。', 'うん、聞こえてるよ。'],
    ['그녀는 고개를 숙였다. 괜찮아요.', '괜찮아요.'],
    ['She looks away. "I didn\'t see anything."', '"I didn\'t see anything."'],
    ['Vera shrugs. The clasp is mine to trace.', 'The clasp is mine to trace.'],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(sanitiseTtsText(raw, { names: ['夏澄', 'Vera'] }), expected, raw);
  }
  // never on a question, a first-person sentence, or an open quote
  for (const line of ['他点了点头？', '她笑了笑，我也笑了。', '她低下头：「好。走吧。」', 'She smiles at me.']) {
    assert.equal(sanitiseTtsText(line), line, line);
  }
});

test('sanitiseTtsText: emoji and **markup** are not read aloud', () => {
  assert.equal(sanitiseTtsText('好啊😊 **真的**。'), '好啊 真的。');
  assert.equal(sanitiseTtsText('👍🏽'), '');
  assert.equal(sanitiseTtsText('*窓を開ける* 風、気持ちいいね🌸'), '風、気持ちいいね');
  // an unpaired star is just text, not narration for the rest of the line
  assert.equal(sanitiseTtsText('5 * 3 is fifteen.'), '5  3 is fifteen.');
});

test('sanitiseTtsText with names stays idempotent, and the server pass (no names) keeps the client text', () => {
  for (const raw of [
    '她低下头。他摇了摇头，说不知道。',
    '夏澄笑了笑：「我在这儿。」他点了点头。',
    '（笑）*sigh* She looks away. Fine.',
    'Vera shrugs. He nods. Go on.',
  ]) {
    const client = sanitiseTtsText(raw, { names: ['夏澄', 'Vera'] });
    assert.equal(sanitiseTtsText(client, { names: ['夏澄', 'Vera'] }), client, raw);
    assert.equal(sanitiseTtsText(client), client, raw);
  }
});

test('splitNarration keeps every character for display and labels the narration', () => {
  const samples = [
    '（她低下头，指尖摩挲着信封。）这封信，我一直没敢拆。',
    '*She sighs.* Fine, **really**.',
    '그녀는 고개를 숙였다. 괜찮아요.',
    '（说完就走了',
    '',
  ];
  for (const text of samples) assert.equal(splitNarration(text).map(s => s.text).join(''), text, text);
  assert.deepEqual(splitNarration('（笑）好啊'), [{ kind: 'narration', text: '（笑）' }, { kind: 'speech', text: '好啊' }]);
  // malformed → shown plain, never styled half-way
  assert.deepEqual(splitNarration('（说完就走了'), [{ kind: 'speech', text: '（说完就走了' }]);
});
