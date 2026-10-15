/**
 * chalk-delta.ts — extract the `content` field's decoded prefix from a
 * *partially accumulated* tool-argument JSON string.
 *
 * the design notes / the design notes The writer's narration body
 * lives in the `chalk` tool's `content` argument (extensions/toolkit/chalk.ts),
 * NOT in the assistant's text reply — see the design notes pi-rp streams
 * that argument as raw JSON fragments (`toolcall_delta`), so the server must
 * pull the growing `content` value out of the raw bytes.
 *
 * Pure, no I/O. The single most important property: a returned prefix NEVER
 * ends on a half-finished escape (`\`, `\u12`) — the whole escape is deferred
 * to the next fragment instead of surfacing a mangled character.
 */

export interface ContentPrefix {
  /** Decoded prefix so far. Never ends mid-escape. */
  text: string;
  /** True once the closing quote of `content` has been seen; `text` is final. */
  complete: boolean;
}

const EMPTY: ContentPrefix = { text: '', complete: false };

/** Decode one JSON string escape whose `\` is at `i`; null when incomplete. */
function decodeEscape(s: string, i: number): { char: string; next: number } | null {
  const c = s[i + 1];
  if (c === undefined) return null; // dangling backslash
  switch (c) {
    case '"': return { char: '"', next: i + 2 };
    case '\\': return { char: '\\', next: i + 2 };
    case '/': return { char: '/', next: i + 2 };
    case 'b': return { char: '\b', next: i + 2 };
    case 'f': return { char: '\f', next: i + 2 };
    case 'n': return { char: '\n', next: i + 2 };
    case 'r': return { char: '\r', next: i + 2 };
    case 't': return { char: '\t', next: i + 2 };
    case 'u': {
      const hex = s.slice(i + 2, i + 6);
      if (hex.length < 4) return null; // \uXXXX split across fragments
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { char: '\uFFFD', next: i + 6 };
      return { char: String.fromCharCode(parseInt(hex, 16)), next: i + 6 };
    }
    default:
      // Unknown escape: JSON.parse would reject it; surface the raw char so we
      // never silently drop content.
      return { char: c, next: i + 2 };
  }
}

/**
 * Read a JSON string body starting at `start` (just after the opening quote).
 * Returns the decoded text up to the first incomplete escape, and whether the
 * closing quote was reached.
 */
function readString(s: string, start: number): { text: string; complete: boolean } {
  let out = '';
  let i = start;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') return { text: out, complete: true };
    if (ch === '\\') {
      const dec = decodeEscape(s, i);
      if (dec === null) return { text: out, complete: false }; // defer escape
      out += dec.char;
      i = dec.next;
      continue;
    }
    out += ch;
    i++;
  }
  return { text: out, complete: false };
}

/** Index just after the closing quote of the string opening at `start`
 *  (start points at the opening quote). Falls back to s.length if unterminated. */
function endOfString(s: string, start: number): number {
  let i = start + 1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '"') return i + 1;
    i++;
  }
  return s.length;
}

/** Skip one JSON value; returns the index after it, or -1 when incomplete. */
function endOfValue(s: string, start: number): number {
  const ch = s[start];
  if (ch === undefined) return -1;
  if (ch === '"') {
    const end = endOfString(s, start);
    return end > s.length ? -1 : end;
  }
  if (ch === '{' || ch === '[') {
    const close = ch === '{' ? '}' : ']';
    let depth = 0;
    let i = start;
    let inStr = false;
    while (i < s.length) {
      const c = s[i];
      if (inStr) {
        if (c === '\\') { i += 2; continue; }
        if (c === '"') inStr = false;
      } else if (c === '"') {
        inStr = true;
      } else if (c === ch) {
        depth++;
      } else if (c === close) {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return -1; // unterminated
  }
  // number / true / false / null — read until a delimiter.
  let i = start;
  while (i < s.length && !',}]'.includes(s[i])) i++;
  return i >= s.length ? -1 : i; // a growing scalar without a delimiter is incomplete
}

/**
 * Top-level scan: find `"content"` as an object key and read its string value's
 * decoded prefix. `content` may be any position (LLM output does not follow the
 * schema's declared key order — the design notes item 3).
 */
export function extractContentPrefix(json: string): ContentPrefix {
  let i = 0;
  while (i < json.length && /\s/.test(json[i])) i++;
  if (json[i] !== '{') return EMPTY;
  i++;
  while (i < json.length && /\s/.test(json[i])) i++;
  if (json[i] === '}') return EMPTY; // empty object, no content

  while (i < json.length) {
    if (json[i] !== '"') return EMPTY; // expect a string key
    const key = readString(json, i + 1);
    if (!key.complete) return EMPTY;
    i = endOfString(json, i);
    while (i < json.length && /\s/.test(json[i])) i++;
    if (json[i] !== ':') return EMPTY;
    i++;
    while (i < json.length && /\s/.test(json[i])) i++;

    if (key.text === 'content') {
      if (json[i] !== '"') return EMPTY; // not a string value
      return readString(json, i + 1);
    }
    const after = endOfValue(json, i);
    if (after < 0) return EMPTY; // value still growing — content not reachable yet
    i = after;
    while (i < json.length && /\s/.test(json[i])) i++;
    if (json[i] !== ',') return EMPTY; // end of object without content
    i++;
    while (i < json.length && /\s/.test(json[i])) i++;
  }
  return EMPTY;
}
