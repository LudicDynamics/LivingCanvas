// RegExp `v` flag (unicodeSets) → `u`, at build time, for the bundled programs.
//
// Why: pi-rp's TUI width code (vendor/pi-rp/packages/tui/src/utils.ts) builds six module-level regexes with the `v`
// flag (\p{RGI_Emoji}, [\p{Spacing_Mark}--[…]] set subtraction). server.js and pi.js both bundle it. esbuild cannot
// lower `v` for an es2022 / Safari 16 target, so it rewrites each literal into `new RegExp("…", "v")` — the bundle
// parses everywhere, then throws at module evaluation on every engine without `v` (Safari / iOS < 17, Chrome < 112,
// Firefox < 116): "SyntaxError: Invalid flags supplied to RegExp constructor 'v'" and the in-tab server never
// listened (chronicle 2026-10-06 / 10-07).
//
// What this does: every `new RegExp(<string literal>, "<flags with v>")` in an esbuild output is rewritten to an
// equivalent `u` regex — v-only syntax is translated (set subtraction `[A--[B]]` → `(?:(?![B])[A])`, `\p{RGI_Emoji}`
// → an approximation from Emoji_Presentation / Extended_Pictographic / modifiers / ZWJ / keycaps / flags / tags) and
// anything else v-only (intersection `&&`, `\q{}`, nested classes, other string properties) fails the build rather
// than ship. The result is compiled once here with `u` to prove it parses. `findVFlagRegExps` is the guard the build
// and test/regex-v.test.mjs run over the finished bundles: no `v` regex may remain, literal or constructed.

const LIT = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\x60(?:[^\x60\\$]|\\.|\$(?!\{))*\x60`;
const FLAGS_V = String.raw`[dgimsuy]*v[dgimsuy]*`;
const CTOR = new RegExp(String.raw`new RegExp\(\s*(${LIT})\s*,\s*(["'\x60])(${FLAGS_V})\2\s*\)`, 'g');

/** \p{RGI_Emoji} for engines without `v`: one emoji grapheme of the common shapes (not the exact RGI list). */
export const RGI_EMOJI_U = String.raw`(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\u{1F3F4}[\u{E0061}-\u{E007A}]+\u{E007F}|(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation}|\p{Extended_Pictographic}️)️?(?:‍(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation}|\p{Extended_Pictographic})️?)*)`;

const evalLiteral = (lit) => {
  if (lit[0] === '"') { try { return JSON.parse(lit); } catch { /* \x / \' escapes: fall through */ } }
  return Function(`"use strict"; return (${lit});`)();
};

/** Is there a `[` inside a character class (v-only nesting), or `--` / `&&` set operators, or `\q{`? */
function vOnlySyntax(src) {
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { if (src[i + 1] === 'q' && src[i + 2] === '{') return '\\q{…}'; i++; continue; }
    if (!inClass) { if (c === '[') inClass = true; continue; }
    if (c === ']') { inClass = false; continue; }
    if (c === '[') return 'nested class';
    if ((c === '-' && src[i + 1] === '-') || (c === '&' && src[i + 1] === '&')) return `set operator ${c}${c}`;
  }
  if (/\\[pP]\{RGI_|\\[pP]\{(?:Basic_Emoji|Emoji_Keycap_Sequence)\}/.test(src)) return 'property of strings';
  return null;
}

/** One `v` pattern → the same pattern for `u`; throws on v-only syntax it does not know. */
export function toUnicodeFlagPattern(src) {
  let out = src.replace(/\\p\{RGI_Emoji\}/g, RGI_EMOJI_U);
  // [A--[B]] with flat A and B (one level, the only shape esbuild leaves us) → (?:(?![B])[A])
  out = out.replace(/\[((?:\\.|[^\\[\]])+?)--\[((?:\\.|[^\\[\]])+)\]\]/g, (_, a, b) => `(?:(?![${b}])[${a}])`);
  const left = vOnlySyntax(out);
  if (left) throw new Error(`regex-v: cannot lower ${left} in /${src}/v`);
  return out;
}

/** Rewrite every `new RegExp("…", "…v…")` in `code`; returns the new code and what changed. */
export function lowerVFlagRegExps(code) {
  const changed = [];
  const next = code.replace(CTOR, (whole, lit, _q, flags) => {
    const src = evalLiteral(lit);
    const pattern = toUnicodeFlagPattern(src);
    const f = flags.replace('v', 'u');
    new RegExp(pattern, f); // must compile without `v`
    changed.push({ from: src, to: pattern, flags: f });
    return `new RegExp(${JSON.stringify(pattern)},${JSON.stringify(f)})`;
  });
  return { code: next, changed };
}

/**
 * Every `v` regex still in `code`: constructor calls with a v flag string, and regex literals ending `/…v`.
 * The literal scan is textual (no JS parser), so it looks for the shape `/<body>/<flags with v>` followed by
 * something that ends an expression — enough to catch an esbuild target that keeps literals.
 */
export function findVFlagRegExps(code) {
  const hits = [];
  for (const m of code.matchAll(new RegExp(String.raw`new RegExp\(\s*(?:${LIT})\s*,\s*(["'\x60])${FLAGS_V}\1\s*\)`, 'g'))) hits.push(m[0].slice(0, 160));
  for (const m of code.matchAll(/(?<![\w$)\]])\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuy]*v[dgimsuy]*(?=\s*[,;:)\]}.]|\s*$)/gm)) hits.push(m[0].slice(0, 160));
  return hits;
}
