// RegExp `v` flag in the tab runtime (chronicle 2026-10-06 / 10-07): pi-rp's TUI width regexes, bundled into
// server.js / pi.js as `new RegExp("…", "v")`, threw at module evaluation on Safari / iOS < 17 and Chrome < 112 —
// "server exited before listen(): SyntaxError: Invalid flags supplied to RegExp constructor 'v'". build.mjs lowers
// them to `u` (regex-v.mjs); the finished bundles must hold none.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { findVFlagRegExps, lowerVFlagRegExps, toUnicodeFlagPattern } from '../regex-v.mjs';

const DIST = new URL('../dist/', import.meta.url);
const built = ['worker.js', 'server.js', 'pi.js'].filter((f) => fs.existsSync(new URL(f, DIST)));

// vendor/pi-rp/packages/tui/src/utils.ts, as of 2026-10-09.
const TUI = [
  String.raw`^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$`,
  String.raw`^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+`,
  String.raw`^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Format}|\p{Mark}|\p{Surrogate})$`,
  String.raw`^\p{Mark}$`,
  String.raw`^(?:[\p{Spacing_Mark}--[᜴〮〯]]|[ٟཿါာေဳ-ဵး်-ှ])+$`,
  String.raw`^\p{RGI_Emoji}$`,
];
const SAMPLES = [
  'a', 'Z', '1', ' ', '中', 'あ', '한', '́', 'ा', 'ั', '᜴', '〮', '〯', 'ः', 'ٟ', 'ါ',
  '​', '‍', '️', '­', '\u0007', '⁠', 'é',
  '😀', '👍', '👍🏽', '❤️', '❤', '©', '©️', '™', '#️⃣', '1️⃣', '🇯🇵', '🇺🇸', '👨‍👩‍👧', '🧑🏽‍💻', '🏳️‍🌈', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '⌚', '☺️', '🫠',
];

test('the TUI patterns lower to u regexes that agree with the v originals on the width-relevant samples', () => {
  for (const src of TUI) {
    const v = new RegExp(src, 'v');
    const u = new RegExp(toUnicodeFlagPattern(src), 'u');
    for (const s of SAMPLES) assert.equal(u.test(s), v.test(s), `/${src}/ on ${JSON.stringify(s)}`);
  }
});

test('only esbuild constructor calls with a v flag are rewritten; flags keep the rest', () => {
  const code = 'const a=new RegExp("^\\\\p{Mark}$","gv"),b=new RegExp("x","g"),c=/[a-z]/u;';
  const { code: out, changed } = lowerVFlagRegExps(code);
  assert.equal(changed.length, 1);
  assert.match(out, /new RegExp\("\^\\\\p\{Mark\}\$","gu"\)/);
  assert.ok(out.includes('new RegExp("x","g")') && out.includes('/[a-z]/u'));
  assert.deepEqual(findVFlagRegExps(out), []);
});

test('v-only syntax it cannot translate fails the build instead of shipping', () => {
  assert.throws(() => toUnicodeFlagPattern(String.raw`[\p{L}&&\p{ASCII}]`), /set operator &&/);
  assert.throws(() => toUnicodeFlagPattern(String.raw`[\q{abc}]`), /\\q/);
  assert.throws(() => toUnicodeFlagPattern(String.raw`\p{RGI_Emoji_Flag_Sequence}`), /property of strings/);
});

test('the scanner sees v regexes both as literals and as constructor calls', () => {
  assert.equal(findVFlagRegExps('x=/[\\p{L}--[a]]/v;').length, 1);
  assert.equal(findVFlagRegExps("y=new RegExp('a','iv')").length, 1);
  assert.equal(findVFlagRegExps('z=a/b/v;w=/abc/giu;').length, 0);
});

test('build.mjs lowers every bundle and targets the supported engines', () => {
  const build = fs.readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
  assert.match(build, /const TARGET = \['es2022', 'safari16\.4', 'chrome98', 'firefox125'\]/);
  assert.equal((build.match(/lowerRegExpFlags\(/g) ?? []).length, 3); // definition + programs + worker
  assert.ok(!/target: 'es2022'/.test(build));
});

test('the built bundles hold no RegExp v flag', { skip: built.length ? false : 'no dist/ (node apps/browser-runtime/build.mjs)' }, () => {
  for (const f of built) assert.deepEqual(findVFlagRegExps(fs.readFileSync(new URL(f, DIST), 'utf8')), [], f);
});

test('the worker fills in Promise.withResolvers / AbortSignal.any for Safari 16.4 – 17.3', () => {
  const early = fs.readFileSync(new URL('../src/platform/inject-early.ts', import.meta.url), 'utf8');
  assert.match(early, /\(Promise as any\)\.withResolvers = function withResolvers/);
  assert.match(early, /\(AbortSignal as any\)\.any = function any/);
});
