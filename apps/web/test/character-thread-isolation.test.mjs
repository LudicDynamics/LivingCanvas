// One character's thread never shows up in another's
//
//
// The dock swaps characters on ONE `useCharacterDialogue` mount. For the render
// in which `characterId` is already the new character but `lines` still holds
// the previous one's thread, the hook used to (a) file the previous thread in
// the scrollback memory under the NEW id — so reopening that character showed
// someone else's conversation — and (b) return those lines, which the dock
// hands straight to its speaker, so the previous character's last words were
// read aloud in the new character's voice. Every pass is recorded here, so the
// one bad render cannot hide between two good ones.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';
import { render, rerender, unmount } from './react-strict-stub.mjs';

const stub = fileURLToPath(new URL('./react-strict-stub.mjs', import.meta.url));
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { react: stub } });
const { useCharacterDialogue, forgetDialogueScrollback } = await jiti.import('../src/lib/character-dialogue.ts');
const queueModule = await jiti.import('../src/lib/character-frame-queue.ts');

function dock(first, seeds = {}) {
  forgetDialogueScrollback();
  queueModule.resetCharacterFrameQueueForTest();
  const queue = queueModule.getCharacterFrameQueue();
  let id = first;
  const passes = [];
  let current = render(() => {
    const value = useCharacterDialogue(id, queue, seeds[id] ?? null);
    passes.push({ id, texts: value.lines.map((line) => line.text) });
    return value;
  });
  const sync = () => { current = rerender(); };
  return {
    passes,
    texts: () => current.lines.map((line) => `${line.who}: ${line.text}`),
    open: (next) => { id = next; sync(); },
    say: (text) => { current.pushPlayerLine(text); sync(); },
    answer: (text) => {
      queue.enqueue({ characterId: id, type: 'character_message', text }, queue.nextDeliverySeq());
      sync();
      queue.enqueue({ characterId: id, type: 'character_idle' }, queue.nextDeliverySeq());
      sync();
    },
  };
}

test('switching characters never renders, remembers or speaks the previous thread', () => {
  const d = dock('vera', { vera: '你来了。' });
  d.say('VERA_Q 这个零件是谁的？');
  d.answer('[emo: normal] VERA_A 领主家的。');
  const veraWords = ['VERA_Q 这个零件是谁的？', 'VERA_A 领主家的。', '你来了。'];

  // Open someone the player has never talked to (no greeting, no memory): a core
  // character who is not the companion.
  const from = d.passes.length;
  d.open('old-mo');
  for (const pass of d.passes.slice(from)) {
    if (pass.id !== 'old-mo') continue;
    for (const word of veraWords) assert.ok(!pass.texts.includes(word), `old-mo's dock rendered Vera's line "${word}"`);
  }
  assert.deepEqual(d.texts(), []);

  // Leave without a word, come back: still nobody's thread but his own.
  d.open('vera');
  assert.deepEqual(d.texts(), ['character: 你来了。', 'player: VERA_Q 这个零件是谁的？', 'character: VERA_A 领主家的。']);
  d.open('old-mo');
  assert.deepEqual(d.texts(), [], 'reopening old-mo must not bring back Vera\'s conversation');

  // His own conversation, then back and forth: each keeps exactly theirs.
  d.say('MO_Q 灯是谁熄的？');
  d.answer('MO_A 是我。');
  d.open('vera');
  assert.ok(!d.texts().some((t) => t.includes('MO_')), 'Vera must not show old-mo\'s lines');
  d.open('old-mo');
  assert.deepEqual(d.texts(), ['player: MO_Q 灯是谁熄的？', 'character: MO_A 是我。']);
  for (const pass of d.passes) {
    const foreign = pass.id === 'old-mo' ? veraWords : ['MO_Q 灯是谁熄的？', 'MO_A 是我。'];
    for (const word of foreign) assert.ok(!pass.texts.includes(word), `${pass.id}'s pass carried "${word}"`);
  }
  unmount();
});

test('source: lines are owned by a character, and only the owner\'s are shown or remembered', async () => {
  const src = await readFile(new URL('../src/lib/character-dialogue.ts', import.meta.url), 'utf8');
  assert.match(src, /const \[linesOwner, setLinesOwner\] = useState<string \| null>\(null\);/);
  assert.match(src, /const ownLines = linesOwner === characterId;/);
  // Remembered per [save, character] (scopeKey), and only the owner's lines of the current save.
  assert.match(src, /if \(renderScope === scopeKey && ownLines && characterId !== null && lines\.length > 0\) \{\s*scrollbackMemory\.set\(scopeKey, lines\);/);
  assert.match(src, /const visible = ownLines \? lines : NO_LINES;/);
  // The dock speaks exactly what the hook returns: no second path to the speaker.
  const dockSrc = await readFile(new URL('../src/components/sidebar/CharacterDock.tsx', import.meta.url), 'utf8');
  assert.match(dockSrc, /useCharacterDialogue\(active\?\.id \?\? null, frameQueue, opening\?\.line, worldPath\)/);
});
