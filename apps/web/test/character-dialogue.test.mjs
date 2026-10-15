// The companion dialogue projection, run for real under a
// React that doubles its state updaters the way StrictMode does.
//
// The bug this file exists for: the hook claimed a line id by assigning
// `openLineRef.current` INSIDE its `setLines` updater. StrictMode invokes an
// updater twice and keeps the second result, so the second pass saw a ref that
// was no longer null, took the "update the open line" branch, found no such
// line in `prev` and returned `prev` unchanged. Every character line was
// dropped. The player's lines rendered, the portrait's mood still moved and the
// first act still advanced to its invitation, so on screen it read as "the
// agent acts but never answers".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';
import { render, rerender, unmount } from './react-strict-stub.mjs';

const stub = fileURLToPath(new URL('./react-strict-stub.mjs', import.meta.url));
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { react: stub } });

const { useCharacterDialogue, DIALOGUE_LINE_LIMIT, forgetDialogueScrollback } = await jiti.import('../src/lib/character-dialogue.ts');
const queueModule = await jiti.import('../src/lib/character-frame-queue.ts');

/** Mount the hook on a fresh queue and return a driver for it. */
function mount({ characterId = 'vera', seed = null, keepMemory = false, worldPath } = {}) {
  // Each test is its own save unless it says otherwise.
  if (!keepMemory) forgetDialogueScrollback();
  queueModule.resetCharacterFrameQueueForTest();
  const queue = queueModule.getCharacterFrameQueue();
  let current = render(() => useCharacterDialogue(characterId, queue, seed, worldPath));
  const sync = () => { current = rerender(); };
  return {
    queue,
    get lines() { return current.lines; },
    get phase() { return current.phase; },
    get emo() { return current.emo; },
    texts: () => current.lines.map(line => `${line.who}: ${line.text}`),
    say: (text) => { current.pushPlayerLine(text); sync(); },
    feed: (frame) => { queue.enqueue({ characterId, ...frame }, queue.nextDeliverySeq()); sync(); },
    stop: () => unmount(),
  };
}

test('a character turn reaches the scrollback under doubled updaters', () => {
  const dock = mount();
  dock.say('你现在看见什么？');
  assert.deepEqual(dock.texts(), ['player: 你现在看见什么？']);
  assert.equal(dock.phase, 'thinking');

  dock.feed({ type: 'character_delta', delta: '[emo: normal] 我看见' });
  // THE regression: before the fix this array still held only the player line.
  assert.equal(dock.lines.length, 2, 'the character line must exist while it streams');
  assert.equal(dock.lines[1].who, 'character');
  assert.equal(dock.lines[1].pending, true);
  assert.equal(dock.phase, 'streaming');

  dock.feed({ type: 'character_delta', delta: '你，还有那张桌子。' });
  assert.equal(dock.lines.length, 2, 'the same turn keeps ONE line, it does not spawn a second');
  assert.equal(dock.lines[1].text, '我看见你，还有那张桌子。');

  dock.feed({ type: 'character_message', text: '[emo: normal] 我看见你，还有那张桌子。' });
  dock.feed({ type: 'character_idle' });
  assert.deepEqual(dock.texts(), ['player: 你现在看见什么？', 'character: 我看见你，还有那张桌子。']);
  assert.equal(dock.lines[1].pending, false, 'an idle turn is settled, not pending');
  assert.equal(dock.phase, 'idle');
  dock.stop();
});

test('two turns are two lines, and the ids stay distinct', () => {
  const dock = mount();
  dock.say('一');
  dock.feed({ type: 'character_delta', delta: '答一' });
  dock.feed({ type: 'character_idle' });
  dock.say('二');
  dock.feed({ type: 'character_delta', delta: '答二' });
  dock.feed({ type: 'character_idle' });
  assert.deepEqual(dock.texts(), ['player: 一', 'character: 答一', 'player: 二', 'character: 答二']);
  const ids = dock.lines.map(line => line.id);
  assert.equal(new Set(ids).size, ids.length, 'a reused id would overwrite an earlier bubble');
  dock.stop();
});

test('the mood follows the last character text, and an author greeting seeds the scrollback', () => {
  const dock = mount({ seed: '你来了，好。' });
  assert.deepEqual(dock.texts(), ['character: 你来了，好。']);
  dock.say('你是谁？');
  dock.feed({ type: 'character_delta', delta: '[emo: smile] 我是薇拉。' });
  dock.feed({ type: 'character_idle' });
  assert.equal(dock.emo, 'smile');
  assert.deepEqual(dock.texts(), ['character: 你来了，好。', 'player: 你是谁？', 'character: 我是薇拉。']);
  dock.stop();
});

test('a failed turn says so instead of stalling silently', () => {
  const dock = mount();
  dock.say('在吗');
  dock.feed({ type: 'error', source: 'character', message: 'The model refused.' });
  assert.deepEqual(dock.texts(), ['player: 在吗', 'character: The character could not finish this turn.']);
  assert.equal(dock.lines[1].notice, true, 'a notice, not the character speaking');
  assert.equal(dock.phase, 'idle');
  dock.stop();
});

test('one failure reported twice is shown once', () => {
  const dock = mount();
  dock.say('在吗');
  dock.feed({ type: 'error', source: 'character', message: 'The model refused.' });
  dock.feed({ type: 'turn_aborted', source: 'character', message: 'The model refused.' });
  assert.equal(dock.lines.length, 2);
  // A different failure is still its own line.
  dock.feed({ type: 'error', source: 'character', message: 'OpenAI API error (401)' });
  assert.equal(dock.lines.length, 3);
  dock.stop();
});

test('a provider error never shows its body — least of all a piece of the key', async () => {
  const { agentErrorNotice, AGENT_ERROR_NOTICES } = await jiti.import('../src/lib/character-dialogue.ts');
  const raw = 'OpenAI API error (401): {"message":"Incorrect API key provided: sk-proj-****yvkA. You can find your API key at https://platform.openai.com/account/api-keys.","code":"invalid_api_key"}';
  assert.equal(agentErrorNotice(raw), AGENT_ERROR_NOTICES.auth);
  assert.equal(agentErrorNotice('429 Too Many Requests: rate limit reached'), AGENT_ERROR_NOTICES.quota);
  assert.equal(agentErrorNotice('insufficient_quota'), AGENT_ERROR_NOTICES.quota);
  assert.equal(agentErrorNotice('socket hang up'), AGENT_ERROR_NOTICES.generic);
  assert.equal(agentErrorNotice(undefined), AGENT_ERROR_NOTICES.generic);
  // Whatever arrives, what the player sees contains no key-shaped text.
  const dock = mount();
  dock.say('hi');
  dock.feed({ type: 'error', source: 'character', message: raw });
  assert.doesNotMatch(dock.texts().join('\n'), /sk-|yvkA|api-keys/);
  dock.stop();
});

test('the scrollback stays bounded at the documented depth', () => {
  const dock = mount();
  for (let i = 0; i < DIALOGUE_LINE_LIMIT + 3; i += 1) dock.say(`第${i}句`);
  assert.equal(dock.lines.length, DIALOGUE_LINE_LIMIT);
  assert.equal(dock.lines[dock.lines.length - 1].text, `第${DIALOGUE_LINE_LIMIT + 2}句`);
  dock.stop();
});

test('no state updater in this module decides anything from a ref', async () => {
  // The behavioural tests above are the real guard; this one names the RULE, so
  // a future edit that moves ref bookkeeping back inside an updater fails with
  // the reason attached rather than with a puzzling empty bubble.
  const source = await readFile(new URL('../src/lib/character-dialogue.ts', import.meta.url), 'utf8');
  let found = 0;
  for (const match of source.matchAll(/set[A-Z]\w*\(/g)) {
    // Walk to the matching ')' so the body is the call's arguments and nothing
    // after them — a regex cannot find that boundary and quietly swallows the
    // rest of the file when it tries.
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < source.length && depth > 0; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') depth -= 1;
    }
    const body = source.slice(match.index + match[0].length, i - 1);
    if (!/=>/.test(body)) continue; // a plain value, not an updater
    found += 1;
    assert.doesNotMatch(body, /Ref\.current\s*(=[^=]|\+\+)/,
      `${match[0]}…) — a React updater may run twice: claim ids and refs outside it`);
  }
  assert.ok(found >= 3, 'the scan found no updaters, so it is no longer checking anything');
});

test('closing a character and opening them again brings back what was said', () => {
  //.
  const first = mount({ characterId: 'old-mo' });
  first.say('灯熄的那十二分钟你在做什么？');
  first.feed({ type: 'character_delta', delta: '是我熄的。' });
  first.feed({ type: 'character_idle' });
  first.stop();

  const again = mount({ characterId: 'old-mo', keepMemory: true });
  assert.deepEqual(again.texts(), ['player: 灯熄的那十二分钟你在做什么？', 'character: 是我熄的。']);
  // A new line still gets a fresh id after the remembered ones.
  again.say('为什么？');
  const ids = again.lines.map((line) => line.id);
  assert.equal(new Set(ids).size, ids.length);
  again.stop();

  // Another save forgets them.
  const other = mount({ characterId: 'old-mo' });
  assert.deepEqual(other.texts(), []);
  other.stop();
});

test('same-character frames and scrollback stay isolated across save paths', () => {
  const saveA = '/saves/a';
  const saveB = '/saves/b';
  const a = mount({ characterId: 'vera', worldPath: saveA });
  a.feed({ type: 'character_delta', delta: 'A response', savePath: saveA });
  a.feed({ type: 'character_idle', savePath: saveA });
  assert.deepEqual(a.texts(), ['character: A response']);
  a.stop();

  const b = mount({ characterId: 'vera', worldPath: saveB, keepMemory: true });
  assert.deepEqual(b.texts(), [], 'save B must not restore save A scrollback');
  b.feed({ type: 'character_delta', delta: 'late A chunk', savePath: saveA });
  b.feed({ type: 'character_idle', savePath: saveA });
  assert.deepEqual(b.texts(), [], 'late save A frames cannot enter save B dialogue');
  b.feed({ type: 'character_delta', delta: 'B response', savePath: saveB });
  b.feed({ type: 'character_idle', savePath: saveB });
  assert.deepEqual(b.texts(), ['character: B response']);
  b.stop();
});
