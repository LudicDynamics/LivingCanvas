/**
 * Keeps a model's reasoning out of a character's spoken lines
 *
 *
 * Reasoning normally arrives apart from the text (pi-rp `thinking` blocks / `reasoning_content`, dropped by
 * `messageText`), but some vendors behind the gateway put it INTO the text: inline `<think>…</think>` blocks, or a
 * plain-prose preamble before the line. Two guards, one for a whole message and one for the live stream:
 *
 *   - `stripReasoning(text)`        — the final `character_message`;
 *   - `createReasoningFilter()`     — `character_delta` as it streams: holds the head of the reply until it can tell
 *                                     a preamble from the line, and anything inside a think block.
 *
 * What counts as a preamble (conservative — a real line must never be eaten):
 *   - in a reply that goes on in Chinese / Japanese / Korean: the Latin-script text before the first CJK line,
 *     when it reads like planning (the user / I should / let me / respond / in character …);
 *   - in any language: a first paragraph that talks ABOUT the reply (the user …, I need to respond, as <name> I
 *     should …) and is followed by another paragraph.
 */

const THINK_OPEN = /<(think|thinking|reasoning)>/i;
const THINK_TAGS = /<(think|thinking|reasoning)>[\s\S]*?(<\/\1>|$)/gi;
const STRAY_CLOSE = /^[\s\S]*?<\/(think|thinking|reasoning)>/i;
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿！-｠]/;
/** Planning prose: words a spoken line never starts with but a chain of thought does. */
const PLANNING = /\b(the user|user (?:says|said|asks|asked|wants|is)|i (?:should|need to|will|'ll|must|have to)|let me|let's (?:think|see|respond|reply)|we need to|respond(?:ing)? (?:as|in|with)|in character|my (?:reply|response)|the (?:reply|response) should|as [A-Z][\w-]*(?: [A-Z][\w-]*)?,? i\b|chain of thought|reasoning)\b/i;
/** A first paragraph that is clearly about the reply rather than the reply itself (any language). */
const META = /\b(the user|i (?:should|need to|must) (?:respond|reply|answer|stay|keep|write)|respond(?:ing)? as|in character|my (?:reply|response) (?:should|will))\b/i;
/** How a chain of thought tends to open (a line may too: then it is held until a paragraph break or its end, never eaten). */
const OPENERS = ['okay', 'ok,', 'ok ', 'alright', 'so,', 'so ', 'hmm', 'well,', 'let me', "let's", 'i need', 'i should', "i'll", 'i will', 'the user', 'we need', 'first,', 'now,', 'thinking', 'as '];
const LEAD = /^[\s*_"'“]*/;
const THOUGHT_OPENING = { test: (text: string) => { const h = text.replace(LEAD, '').toLowerCase(); return OPENERS.some((o) => h.startsWith(o)); } };
/** Could this head still turn into an opener (`Ok` → `Okay`, `The` → `The user`)? */
const mayOpenThought = (text: string): boolean => { const h = text.replace(LEAD, '').toLowerCase(); return h.length === 0 || OPENERS.some((o) => o.startsWith(h)); };
/** How much of a reply's head the stream holds while deciding. */
export const REASONING_HOLD_CHARS = 600;

const dropThinkBlocks = (text: string): string => {
  let out = text.replace(THINK_TAGS, '');
  // A reply that STARTS inside a think block whose opening tag was never sent: drop through the stray close tag.
  if (/<\/(think|thinking|reasoning)>/i.test(out) && !THINK_OPEN.test(out)) out = out.replace(STRAY_CLOSE, '');
  return out;
};

/** Where the spoken line starts in a reply with a Latin-script planning head before CJK text (or -1). */
function cjkPreambleEnd(text: string): number {
  const first = text.search(CJK);
  if (first <= 0) return -1;
  // the line the first CJK character is on — or, when that line itself opens in Latin prose, the CJK run itself
  // (with the quote / bracket that opens it)
  const lineStart = text.lastIndexOf('\n', first - 1) + 1;
  const lineLead = text.slice(lineStart, first);
  const start = /[A-Za-z]{3,}/.test(lineLead) ? first - (lineLead.match(/[\s"'“「『（(*—–-]*$/)?.[0].length ?? 0) : lineStart;
  const head = text.slice(0, start);
  if (!/[A-Za-z]{3,}/.test(head)) return -1;
  return PLANNING.test(head) ? start : -1;
}

/** Where the line starts after a meta first paragraph (any language), or -1. */
function metaParagraphEnd(text: string): number {
  const m = /\n\s*\n/.exec(text);
  if (!m) return -1;
  const head = text.slice(0, m.index);
  const rest = text.slice(m.index + m[0].length);
  if (!rest.trim() || !META.test(head) || /[「『“"]/.test(head)) return -1;
  return m.index + m[0].length;
}

/** A finished reply without its reasoning. Never returns an empty string for a non-empty reply that was not all reasoning. */
export function stripReasoning(text: string): string {
  if (!text) return text;
  let out = dropThinkBlocks(text);
  const cjk = cjkPreambleEnd(out);
  if (cjk > 0) out = out.slice(cjk);
  else {
    const meta = metaParagraphEnd(out);
    if (meta > 0) out = out.slice(meta);
  }
  return out.replace(/^\s+/, '');
}

export interface ReasoningFilter {
  /** One streamed delta → the part safe to show now (may be ''). */
  push(delta: string): string;
  /** The reply ended: whatever is still held, cleaned. */
  end(): string;
}

/** The live counterpart of `stripReasoning` for one reply. */
export function createReasoningFilter(): ReasoningFilter {
  let head = '';
  let deciding = true;
  let inThink = false;
  let carry = '';
  /** Think blocks out of a chunk; `carry` keeps a possibly split tag for the next one. */
  const unthink = (chunk: string): string => {
    let s = carry + chunk;
    carry = '';
    let out = '';
    while (s) {
      if (inThink) {
        const close = /<\/(think|thinking|reasoning)>/i.exec(s);
        if (!close) {
          const lt = s.lastIndexOf('<');
          carry = lt >= 0 && s.length - lt < 13 ? s.slice(lt) : '';
          return out;
        }
        inThink = false;
        s = s.slice(close.index + close[0].length);
        continue;
      }
      const open = THINK_OPEN.exec(s);
      if (open) {
        out += s.slice(0, open.index);
        inThink = true;
        s = s.slice(open.index + open[0].length);
        continue;
      }
      const lt = s.lastIndexOf('<');
      if (lt >= 0 && s.length - lt < 12 && /^<\/?[a-z]*$/i.test(s.slice(lt))) {
        carry = s.slice(lt);
        return out + s.slice(0, lt);
      }
      return out + s;
    }
    return out;
  };
  const decide = (final: boolean): string => {
    const cjk = cjkPreambleEnd(head);
    if (cjk > 0) { deciding = false; const out = head.slice(cjk).replace(/^\s+/, ''); head = ''; return out; }
    const meta = metaParagraphEnd(head);
    if (meta > 0) { deciding = false; const out = head.slice(meta).replace(/^\s+/, ''); head = ''; return out; }
    const firstCjk = head.search(CJK);
    // The line has started (CJK at the head, or a CJK line after plain Latin that is not planning), the head is
    // long enough to be a line in its own right, or the reply ended: let it through.
    const settled = firstCjk === 0 || (firstCjk > 0 && !PLANNING.test(head.slice(0, firstCjk)))
      || (firstCjk < 0 && /\n\s*\n/.test(head) && !META.test(head.split(/\n\s*\n/)[0]!))
      // a Latin-script line that does not open like a chain of thought streams at once
      || (firstCjk < 0 && !THOUGHT_OPENING.test(head) && !mayOpenThought(head))
      || head.length >= REASONING_HOLD_CHARS;
    if (!settled && !final) return '';
    deciding = false;
    const out = head;
    head = '';
    return out;
  };
  return {
    push(delta) {
      const clean = unthink(delta);
      if (!deciding) return clean;
      head += clean;
      return decide(false);
    },
    end() {
      const tail = inThink ? '' : carry;
      carry = '';
      if (!deciding) return tail;
      head += tail;
      return decide(true);
    },
  };
}
