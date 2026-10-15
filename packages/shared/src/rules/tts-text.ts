/**
 * What of a character's line is SPOKEN, and what is only shown.
 *
 * A character reply can mix the character's own words with third-person
 * narration about them (「她低下头，指尖摩挲着信封。」 / "She looks away.").
 * The screen keeps both; the voice says only the words
 *
 *
 * The convention every character prompt carries (extensions/instructions.ts
 * `CHARACTER_INSTRUCTION`, the NPC brief in rules/npc.ts):
 *   - actions / narration go inside full-width parentheses （…） in Chinese,
 *     Japanese and Korean, and inside (...) or *...* in English;
 *   - everything outside them is the character speaking.
 * Half-width (), [] and 【】 are honoured in every language as well, because
 * that is what models already do when they slip.
 *
 * On top of the markers there is ONE conservative fallback for unmarked
 * narration: a sentence that opens with the speaker's own name or a
 * third-person pronoun immediately followed by a small closed list of body
 * actions (低下头 / 目を伏せ / 고개를 숙 / looks away …), carries no question
 * mark and no first-person pronoun. Quoted words inside such a sentence are
 * still spoken. Anything that does not match is spoken — dropping real speech
 * is the worse failure.
 *
 * TTS is fail-closed on malformed brackets (an unclosed or crossed pair speaks
 * nothing); the DISPLAY split is not — a malformed line is shown plain.
 */

const EMO_TAG_RE = /^\[emo:\s*[a-z]+\]\s*/;

const OPEN_TO_CLOSE: Readonly<Record<string, string>> = {
  '(': ')',
  '（': '）',
  '[': ']',
  '【': '】',
};

const CLOSERS: Record<string, true> = { ')': true, '）': true, ']': true, '】': true };

/** One run of a line: words the character says, narration about them, or markup (`**`). */
export interface LineSegment {
  kind: 'speech' | 'narration' | 'markup';
  text: string;
}

export interface NarrationOptions {
  /** The speaker's display name(s): a sentence opening with one of them may be narration. */
  names?: readonly (string | null | undefined)[];
}

function stripEmoTags(raw: string): string {
  let text = raw;
  // Keep this aligned with parseEmoTag's grammar while consuming every
  // consecutive leading tag so a second call cannot expose a control tag.
  while (true) {
    const match = EMO_TAG_RE.exec(text);
    if (!match) break;
    text = text.slice(match[0].length);
  }
  return text;
}

function push(out: LineSegment[], kind: LineSegment['kind'], text: string): void {
  if (text === '') return;
  const last = out[out.length - 1];
  if (last && last.kind === kind) last.text += text;
  else out.push({ kind, text });
}

/**
 * Marker pass: brackets and `*…*`. Returns null for a malformed bracket
 * structure. Asterisks are line-bounded: an unpaired `*` is shown as text and
 * never narrates the rest of the line.
 */
function markerSegments(text: string): LineSegment[] | null {
  const out: LineSegment[] = [];
  const stack: string[] = [];
  let bracket = '';
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    if (li > 0) {
      if (stack.length > 0) bracket += '\n';
      else push(out, 'speech', '\n');
    }
    const chars = Array.from(lines[li]);
    // Line-local asterisk state: segments since an open `*` stay pending until it closes.
    let starOpen = false;
    let starBuffer = '';
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (starOpen) {
        if (ch === '*' && chars[i + 1] !== '*') {
          push(out, 'narration', `*${starBuffer}*`);
          starOpen = false;
          starBuffer = '';
        } else {
          starBuffer += ch;
        }
        continue;
      }
      const closing = OPEN_TO_CLOSE[ch];
      if (closing !== undefined) {
        stack.push(closing);
        bracket += ch;
        continue;
      }
      if (Object.hasOwn(CLOSERS, ch)) {
        if (stack.length === 0 || stack.pop() !== ch) return null;
        bracket += ch;
        if (stack.length === 0) {
          push(out, 'narration', bracket);
          bracket = '';
        }
        continue;
      }
      if (stack.length > 0) {
        bracket += ch;
        continue;
      }
      if (ch === '*') {
        if (chars[i + 1] === '*') {
          push(out, 'markup', '**');
          i++;
          continue;
        }
        starOpen = true;
        starBuffer = '';
        continue;
      }
      push(out, 'speech', ch);
    }
    if (starOpen) {
      // Unpaired: the star is markup, what followed it is ordinary speech.
      push(out, 'markup', '*');
      push(out, 'speech', starBuffer);
    }
  }
  // An unmatched opening bracket (including one crossing a newline) is unsafe
  // to interpret as ordinary prose.
  if (stack.length > 0) return null;
  return out;
}

/* ------------------------------------------------------------------ *
 * Unmarked narration fallback
 * ------------------------------------------------------------------ */

const ADVERBS_ZH = '(?:轻轻|微微|缓缓|慢慢|默默|静静|只是|又|先|稍稍|略略)?(?:地)?';
const ACTIONS_ZH = '(?:低下头|低头|垂下眼|垂眸|抬起头|抬头|抬眼|笑了笑|笑了一下|轻笑|苦笑|叹了口气|叹气|沉默|顿了顿|停顿|点了点头|点点头|点头|摇了摇头|摇摇头|摇头|别过脸|别开脸|转过身|移开视线|移开目光|耸了耸肩|耸耸肩|皱起眉|皱了皱眉|抿了抿嘴|抿嘴|攥紧|握紧|咬了咬|眨了眨眼|闭上眼)';
const ACTIONS_JA = '(?:少し|小さく|そっと|静かに|ふっと|ゆっくり)?(?:目を伏せ|目を逸ら|目をそら|うつむ|俯|顔を上げ|顔を背け|視線を逸ら|視線をそら|視線を落と|ため息|溜息|微笑|ほほえ|笑っ|笑う|肩をすくめ|首を振|首を横に振|頷|うなず|黙|息をつ|唇を噛|拳を握)';
const ACTIONS_KO = '(?:잠시|조용히|살짝|천천히|작게)?\\s?(?:고개를 숙|고개를 들|고개를 끄덕|고개를 저|고개를 돌|시선을 돌|시선을 피|눈을 내리깔|눈을 감|미소|웃|한숨|어깨를 으쓱|입을 다물|입술을 깨물|침묵|주먹을 쥐)';
const ACTIONS_EN = '(?:(?:slowly|quietly|softly|briefly|just)\\s+)?(?:looks away|looks down|looks up|glances|smiles|smirks|sighs|shrugs|nods|shakes (?:her|his|their) head|pauses|hesitates|lowers (?:her|his|their)|turns away|turns (?:her|his|their) back|falls silent|bites (?:her|his|their) lip|frowns|winces|laughs softly|tilts (?:her|his|their) head|rubs|fiddles|taps|crosses (?:her|his|their) arms)\\b';

const FIRST_PERSON = /我|咱|私|俺|僕|あたし|わたし|うち|나는|내가|나도|저는|제가|저도|\b(?:I|I'm|I'll|I've|I'd|me|my|mine)\b/;
/** A question, or a quote left open across a sentence break, is never narration. */
const SPEECH_MARK = /[?？「」『』“”"]/;
/** Quoted words inside a narrated sentence are still the character speaking. */
const QUOTE_RE = /「[^「」]*」|『[^『』]*』|“[^“”]*”|"[^"]*"/g;

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sentence-start pattern; null when there is no subject to look for. */
function narrationStart(names: readonly string[], pronouns: boolean): RegExp | null {
  const subjects = names.map(escapeRe);
  if (!pronouns && subjects.length === 0) return null;
  const pick = (pronoun: string): string => `(?:${[...(pronouns ? [pronoun] : []), ...subjects].join('|')})`;
  const zh = `${pick('她|他')}${ADVERBS_ZH}${ACTIONS_ZH}`;
  const ja = `${pick('彼女|彼')}[はがも]${ACTIONS_JA}`;
  const ko = `${pick('그녀|그')}(?:는|은|가|이|도)\\s${ACTIONS_KO}`;
  const en = `${pick('She|He')}\\s+${ACTIONS_EN}`;
  return new RegExp(`^\\s*(?:${zh}|${ja}|${ko}|${en})`);
}

/** Split into sentences, each keeping its terminator, closing quote and trailing space. */
function sentences(text: string): string[] {
  const out: string[] = [];
  const chars = Array.from(text);
  let current = '';
  const isEnd = (ch: string, next: string | undefined): boolean =>
    /[。！？!?…\n]/.test(ch) || (ch === '.' && (next === undefined || /[\s"”」』.]/.test(next)));
  for (let i = 0; i < chars.length; i++) {
    current += chars[i];
    if (!isEnd(chars[i], chars[i + 1])) continue;
    if (chars[i] !== '\n') {
      while (i + 1 < chars.length && /[。！？!?….]/.test(chars[i + 1])) current += chars[++i];
      while (i + 1 < chars.length && /["”」』]/.test(chars[i + 1])) current += chars[++i];
      while (i + 1 < chars.length && /[ \t]/.test(chars[i + 1])) current += chars[++i];
    }
    out.push(current);
    current = '';
  }
  if (current !== '') out.push(current);
  return out;
}

function splitNarratedSentence(sentence: string, out: LineSegment[]): void {
  let last = 0;
  for (const match of sentence.matchAll(QUOTE_RE)) {
    const at = match.index ?? 0;
    push(out, 'narration', sentence.slice(last, at));
    push(out, 'speech', match[0]);
    last = at + match[0].length;
  }
  push(out, 'narration', sentence.slice(last));
}

/**
 * A bare pronoun is ambiguous — a character may be describing someone else
 * (「他摇了摇头，说不知道。」 halfway through an account). So a pronoun opens
 * narration only in the FIRST sentence of a line, where stage business sits;
 * the speaker's own name may open it anywhere.
 */
function heuristicSegments(segments: LineSegment[], names: readonly string[]): LineSegment[] {
  const atLineStart = narrationStart(names, true);
  const anywhere = narrationStart(names, false);
  const out: LineSegment[] = [];
  let lineStart = true;
  for (const segment of segments) {
    if (segment.kind !== 'speech') {
      push(out, segment.kind, segment.text);
      continue;
    }
    for (const sentence of sentences(segment.text)) {
      const outsideQuotes = sentence.replace(QUOTE_RE, '');
      const start = lineStart ? atLineStart : anywhere;
      if (start && start.test(sentence) && !SPEECH_MARK.test(outsideQuotes) && !FIRST_PERSON.test(outsideQuotes)) {
        // A run of stage business keeps the line "at its start", so stripping
        // it and reading the rest again finds the same answer (idempotence).
        splitNarratedSentence(sentence, out);
      } else {
        push(out, 'speech', sentence);
        if (sentence.trim() !== '' && !sentence.endsWith('\n')) lineStart = false;
      }
      if (sentence.endsWith('\n')) lineStart = true;
    }
  }
  return out;
}


function cleanNames(options: NarrationOptions | undefined): string[] {
  const names: string[] = [];
  for (const name of options?.names ?? []) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length >= 1 && trimmed.length <= 40 && !names.includes(trimmed)) names.push(trimmed);
  }
  return names;
}

function segmentsOrNull(text: string, options?: NarrationOptions): LineSegment[] | null {
  const marked = markerSegments(text);
  if (!marked) return null;
  return heuristicSegments(marked, cleanNames(options));
}

/**
 * The display split of one line: speech, narration (to be styled as such) and
 * markup. Concatenating every segment's text gives back the input exactly; a
 * malformed bracket structure yields one plain speech segment.
 */
export function splitNarration(text: string, options?: NarrationOptions): LineSegment[] {
  if (text === '') return [];
  return segmentsOrNull(text, options) ?? [{ kind: 'speech', text }];
}

const PICTOGRAPH_RE = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

/**
 * Return the text that is safe to send to TTS: only what the character says.
 *
 * Leading emotion control tags are removed (including consecutive tags), then
 * narration — bracketed, `*starred*`, or an unmarked third-person action
 * sentence — is dropped, along with `**` markup and emoji. Any unmatched,
 * crossed, or otherwise malformed bracket causes an empty result; this
 * includes an unclosed pair spanning a newline. A reply that is all narration
 * speaks nothing. The operation is pure and idempotent.
 */
export function sanitiseTtsText(raw: string, options?: NarrationOptions): string {
  const text = stripEmoTags(raw);
  const segments = segmentsOrNull(text, options);
  if (!segments) return '';
  const spoken = segments.filter(segment => segment.kind === 'speech').map(segment => segment.text).join('');
  return spoken.replace(PICTOGRAPH_RE, '').trim();
}
