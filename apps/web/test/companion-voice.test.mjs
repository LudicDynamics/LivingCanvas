// The companion dock has a voice (the design notes;: "一开始点开的
// 时候，它没有直接播一段语音…所以我不会想到要跟它输什么东西").
//
// `lineToSpeak` is the whole decision, so it is tested as the pure function it
// is. The rest are source assertions, because what matters about them is
// structural: ONE `/api/tts` call site in the app, the seeded greeting going
// through it, and the player never being read back their own words.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const spoken = await jiti.import('../src/lib/use-spoken-lines.ts');
const { lineToSpeak, linesToSpeak } = spoken;

const dock = await readFile(new URL('../src/components/sidebar/CharacterDock.tsx', import.meta.url), 'utf8');
const hook = await readFile(new URL('../src/lib/use-spoken-lines.ts', import.meta.url), 'utf8');
// The queue itself (per-speaker, cancellable) moved out of the hook.
const queue = await readFile(new URL('../src/lib/speaker-voice.ts', import.meta.url), 'utf8');
const request = await readFile(new URL('../src/lib/tts-request.ts', import.meta.url), 'utf8');
const modal = await readFile(new URL('../src/components/overlay/CharacterModal.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const bodies = await readFile(new URL('../../../tools/check-request-bodies.mjs', import.meta.url), 'utf8');

const line = (over) => ({ id: 1, who: 'character', text: 'hello', emo: 'normal', pending: false, ...over });

test('the settled newest character line is the one spoken', () => {
  assert.equal(lineToSpeak([]), null);
  const greeting = line({ id: 7, text: 'You came back.' });
  assert.equal(lineToSpeak([greeting]), greeting);
  // Still arriving → nothing to speak yet; half a sentence is not a line.
  assert.equal(lineToSpeak([line({ id: 8, pending: true })]), null);
  // A pending tail does not block the settled line beneath it from being the
  // answer only once it settles — until then the older one already spoke.
  const older = line({ id: 9, text: 'first' });
  assert.equal(lineToSpeak([older, line({ id: 10, pending: true })]), older);
});

test('the player is never read their own words back', () => {
  const mine = { id: 2, who: 'player', text: 'hi', emo: 'normal', pending: false };
  assert.equal(lineToSpeak([mine]), null);
  // A player line on top of a character line means the character has not
  // answered yet: speaking the older character line again would replay it.
  assert.equal(lineToSpeak([line({ id: 1 }), mine]), null);
  // And once the answer lands, that answer is what speaks.
  const answer = line({ id: 3, text: 'and hello to you' });
  assert.equal(lineToSpeak([line({ id: 1 }), mine, answer]), answer);
  // The queue stops at the player's line, so nothing above it is re-read.
  assert.deepEqual(linesToSpeak([line({ id: 1 }), mine, answer]), [answer]);
  assert.deepEqual(linesToSpeak([mine]), []);
  // The queue itself refuses a player line even if handed one.
  assert.match(queue, /if \(line\.who === 'player'\) break;/);
});

test('an app notice (a failed turn) is shown but never read aloud', () => {
  const mine = { id: 2, who: 'player', text: 'hi', emo: 'normal', pending: false };
  const failure = line({ id: 3, text: 'The character could not finish this turn.', notice: true });
  assert.deepEqual(linesToSpeak([mine, failure]), []);
  const answer = line({ id: 4, text: 'there you are' });
  assert.deepEqual(linesToSpeak([mine, failure, answer]), [answer]);
});

test('two character lines in one commit are both said, in the order they were said', () => {
  // The first act ends with the ANSWER and the follow invitation landing in the
  // same React commit. Speaking only the newest swallowed the answer, so the
  // player heard a question with no reason attached.
  const mine = { id: 2, who: 'player', text: 'what do you see?', emo: 'normal', pending: false };
  const answer = line({ id: 3, text: 'cold iron and lamp oil' });
  const invite = line({ id: -1, text: 'shall I come with you?' });
  assert.deepEqual(linesToSpeak([line({ id: 1 }), mine, answer, invite]), [answer, invite]);
  // A tail still arriving is not part of the batch yet.
  assert.deepEqual(linesToSpeak([mine, answer, line({ id: 4, pending: true })]), [answer]);
  // The hook walks that list rather than picking one, and each waits its turn.
  assert.match(queue, /const pending = linesToSpeak\(lines\)\.filter\(line => !set\.has\(line\.id\)\)/);
  assert.match(queue, /for \(const line of pending\) this\.queue\.push/);
});

test('the seeded opening greeting is spoken like any other line', () => {
  // The greeting is seeded INTO the scrollback, so the dock
  // speaking every settled character line speaks it without a special case.
  assert.match(dock, /useSpokenLines\(\{/);
  assert.match(dock, /lines: spokenLines/);
  assert.match(dock, /characterId: active\?\.id \?\? null/);
  // And the seeding itself still happens, or there would be nothing to speak.
  assert.match(dock, /useCharacterDialogue\(active\?\.id \?\? null, frameQueue, opening\?\.line, worldPath\)/);
  // What the speaker gets is the scrollback itself, not a copy that could drift.
  assert.match(dock, /const spokenLines = useMemo\(\(\) => \(opening\?\.invite/);
  assert.match(dock, /\[\.\.\.dialogue\.lines, \{/);
  assert.match(dock, /: dialogue\.lines\), \[dialogue\.lines, opening\?\.invite\]\)/);
});

test('the invitation is synthesised before the moment it is needed', () => {
  // Only the invitation. The greeting is spoken the instant the dock appears,
  // so warming it would be the same request twice rather than earlier.
  assert.match(dock, /const prefetch = useMemo\(/);
  assert.match(dock, /opening\.invite\.trim\(\) !== '' \? \[opening\.invite\] : \[\]/);
  assert.doesNotMatch(dock, /\[opening\?\.line, opening\?\.invite\]\.filter/);
  assert.match(dock, /prefetch,\n\s*\}\);/);
  // Warming goes through the one request function, so it is the same cache
  // entry the speaker will ask for — same emotion, same voice, same language.
  assert.match(hook, /emotion: 'normal' \}, valid\)/);
  assert.match(hook, /warmedRef\.current\.has\(text\)/);
  // And a warm never plays anything.
  const warmBlock = hook.slice(hook.indexOf('// Warm the author-written lines'), hook.indexOf('const pending = linesToSpeak'));
  assert.doesNotMatch(warmBlock, /playVoice/);
});

test('the follow invitation is spoken too — it is the line that asks a question', () => {
  // It renders outside the scrollback because its two buttons hang off it
  //, so it has to be handed to the speaker by name or the one
  // line that asks the player something is the one line they never hear.
  assert.match(dock, /text: opening\.invite/);
  assert.match(dock, /id: INVITE_LINE_ID/);
  assert.match(dock, /who: 'character' as const/);
  assert.match(dock, /pending: false/);
  // Outside the scrollback's own counter, which starts at 1 and counts up, so
  // the speaker's "already said this" set can never confuse the two.
  assert.match(dock, /const INVITE_LINE_ID = -1;/);
});

test('two lines in the same breath take turns instead of cutting each other off', () => {
  // The first act ends with the answer and the invitation arriving together.
  // Interrupting the answer mid-word to start the invitation is worse than the
  // pause between them.
  assert.match(queue, /private async waitForSilence/);
  assert.match(queue, /while \(this\.deps\.isVoicing\(\) && stillValid\(\)/);
  assert.match(queue, /await this\.waitForSilence\(valid\)/);
  // Bounded: a clip that never reports an end must not silence what follows.
  assert.match(queue, /VOICE_IDLE_TIMEOUT_MS/);
  assert.match(queue, /this\.deps\.now\(\) < deadline/);
  // And the wait itself is abandoned the moment the companion changes.
  assert.match(queue, /if \(!valid\(\)\) continue;/);
  // The hook hands the real clock and the real channel to the queue.
  assert.match(hook, /isVoicing,\n\s+wait,/);
});

test('a line queued for one character never plays over the next one', () => {
  // The character is part of the validity token twice: the request is dropped
  // in flight, and the resolved URL is dropped before it can be played.
  // The speaker key is [save, character]: a save switch cuts the old speaker off too.
  assert.match(hook, /speaker\.setSpeaker\(liveKey\);/);
  assert.match(hook, /const liveKey = live !== null && worldPath != null \? speakerKey\(worldPath, live\) : null;/);
  assert.match(hook, /\}, \[liveKey, speaker\]\);/);
  // One predicate, asked at every await: before the request, after it resolves,
  // and again after waiting for the previous line to finish. Every utterance
  // carries its speaker and epoch (behaviour: speaker-voice.test.mjs).
  assert.match(queue, /return item\.epoch === this\.epoch && item\.speaker === this\.speaker;/);
  assert.match(queue, /late audio for a stopped speaker is dropped/);
  assert.match(hook, /stop: stopVoice,/);
});

test('mute and the TTS switch are honoured by reuse, not by a second check', () => {
  // The gates live in the shared request path and in playVoice; the hook must
  // not grow its own copy that can drift from them.
  assert.match(request, /canRequestTts\(\)/);
  assert.match(request, /ttsEnabled\(\)/);
  // Strip comments first: the hook's docstring NAMES those gates to explain
  // why it delegates to them, and that sentence is worth keeping.
  const code = hook.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /isMuted|ttsEnabled|canRequestTts/);
});

test('there is exactly ONE /api/tts call site, and the gate is pinned to it', async () => {
  const src = new URL('../src/', import.meta.url);
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const next = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) await walk(next);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(next);
    }
  };
  await walk(src);
  const callers = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (/fetch\('\/api\/tts'/.test(text)) callers.push(file.pathname);
  }
  assert.equal(callers.length, 1, `expected one /api/tts call site, found: ${callers.join(', ')}`);
  assert.match(callers[0], /lib\/tts-request\.ts$/);
  // The pin follows the call site, keys unchanged.
  assert.match(bodies, /file: 'apps\/web\/src\/lib\/tts-request\.ts'/);
  assert.match(bodies, /keys: \['text', 'voice', 'language', 'characterId', 'emotion', 'savePath'\]/);
  // The modal did not grow a second path; it calls the shared one.
  assert.match(modal, /import \{ commitVoiceOutcomeIfCurrent, fetchVoiceUrl \} from '\.\.\/\.\.\/lib\/tts-request\.js'/);
  assert.match(modal, /await fetchVoiceUrl\(/);
});

test('both carriers speak the same world with the same voice', () => {
  // One language value, handed to the modal and to the dock.
  assert.match(app, /const contentLanguage = manifest\?\.locale === 'ja'/);
  // Three carriers: the modal, the dock, and the NPC dialogue.
  assert.equal((app.match(/language=\{contentLanguage\}/g) ?? []).length, 3);
  assert.match(app, /<NpcDialogueHost language=\{contentLanguage\}/);
  assert.match(app, /voice: dockCharacter\.voice/);
  assert.match(dock, /voice: active\?\.voice/);
});
