import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';

// Imported straight from the rules module: it is zero-dependency on purpose, so
// this suite runs without the rest of the shared barrel being green.
import {
  EXPECT_RE,
  diceRange,
  evaluateExpect,
  parseDiceType,
  parseExpect,
  patchRollDiceResult,
  rollOnce,
} from '../dist/rules/dice.js';

// --------------------------------------------------------------- §2.2.4 (30)
// [input, ok] — the full type table from doc 07 §2.2.4.

const TYPE_CASES = [
  ['1d100', true],
  ['1d20', true],
  ['2d6', true],
  ['4d6+2', true],
  ['2d10-1', true],
  ['d100', true],
  ['1D100', true],
  [' 1d100 ', true],
  ['20d1000+10000', true],
  ['1d100\u00a0', true],
  ['1d1', false],
  ['0d6', false],
  ['1d0', false],
  ['21d6', false],
  ['1d1001', false],
  ['1d6+10001', false],
  ['100d100', false],
  ['d6+', false],
  ['1d100x', false],
  ['100', false],
  ['1d', false],
  ['dd6', false],
  ['1d100 + 5', false],
  ['1d6*2', false],
  ['3d6+1d4', false],
  ['1d100.5', false],
  ['5d', false],
  ['+1d6', false],
  ['1d100-', false],
  ['', false],
  ['   ', false],
];

test('parseDiceType §2.2.4 table', () => {
  for (const [input, ok] of TYPE_CASES) {
    const r = parseDiceType(input);
    assert.equal(r.ok, ok, `parseDiceType(${JSON.stringify(input)}) ok === ${ok}, got ${r.ok}`);
    if (!ok && r.ok === false) assert.match(r.error, /roll_dice\.type/);
  }
});

test('parseDiceType values', () => {
  assert.deepEqual(parseDiceType('1d100').value, { count: 1, faces: 100, modifier: 0 });
  assert.deepEqual(parseDiceType('d100').value, { count: 1, faces: 100, modifier: 0 });
  assert.deepEqual(parseDiceType('2d10-1').value, { count: 2, faces: 10, modifier: -1 });
  assert.deepEqual(parseDiceType('20d1000+10000').value, { count: 20, faces: 1000, modifier: 10000 });
  assert.equal(parseDiceType('1d1').error, 'roll_dice.type "1d1" is out of range (count 1..20, faces 2..1000, modifier \u00b110000)');
  assert.equal(parseDiceType('').error, 'roll_dice.type is empty');
  assert.equal(parseDiceType('1d100x').error, 'roll_dice.type "1d100x" is not a valid NdM[\u00b1K] expression');
});

// --------------------------------------------------------------- §2.2.5 (35)
// [input, ok]

const EXPECT_CASES = [
  ['>50', true],
  ['>=60', true],
  ['<30', true],
  ['<=5', true],
  ['=50', true],
  ['==50', true],
  ['!=50', true],
  ['50', true],
  ['> 50', true],
  ['41..60', true],
  ['30..30', true],
  ['>=40 && <=60', true],
  ['>80 || <20', true],
  ['>=40&&<=60&&!=45||=1', true],
  ['>50 && <100', true],
  ['>abc', false],
  ['', false],
  ['>', false],
  ['50..', false],
  ['..50', false],
  ['60..41', false],
  ['>=40 &&', false],
  ['||', false],
  ['>50 >60', false],
  ['50 60', false],
  ['>50 # 注释', false],
  ['1..2..3', false],
  ['&&50', false],
  ['>50,<60', false],
  ['$gt', false],
  ['true', false],
  ['1e3', false],
  ['3.5', false],
  ['==', false],
  ['>50 ||', false],
  ['-5', true],
  ['>9007199254740993', false],
];

test('parseExpect §2.2.5 table', () => {
  for (const [input, ok] of EXPECT_CASES) {
    const r = parseExpect(input);
    assert.equal(r.ok, ok, `parseExpect(${JSON.stringify(input)}) ok === ${ok}, got ${r.ok}`);
  }
});

test('parseExpect error copy is verbatim and names the raw expression', () => {
  const r = parseExpect('>abc');
  assert.equal(r.ok, false);
  assert.equal(
    r.error,
    'roll_dice.expect ">abc" is not evaluable; expected e.g. ">50", ">=60", "<30", "=50", "41..60", ">=40 && <=60", ">80 || <20"'
  );
  assert.ok(parseExpect('60..41').ok === false, 'inverted range must be rejected by the parser');
});

// --------------------------------------------------------------- §2.2.6 (20)
// [expect, result, passed]

const JUDGE_CASES = [
  ['>50', 50, false],
  ['>50', 51, true],
  ['>=60', 60, true],
  ['<30', 29, true],
  ['<30', 30, false],
  ['<=5', 5, true],
  ['=50', 50, true],
  ['!=50', 49, true],
  ['!=50', 50, false],
  ['50', 50, true],
  ['41..60', 41, true],
  ['41..60', 60, true],
  ['41..60', 61, false],
  ['>=40 && <=60', 40, true],
  ['>=40 && <=60', 61, false],
  ['>80 || <20', 85, true],
  ['>80 || <20', 50, false],
  ['>=40&&<=60&&!=45||=1', 45, false],
  ['>=40&&<=60&&!=45||=1', 1, true],
  ['>=40&&<=60&&!=45||=1', 50, true],
];

test('evaluateExpect §2.2.6 table', () => {
  for (const [expr, result, passed] of JUDGE_CASES) {
    const parsed = parseExpect(expr);
    assert.equal(parsed.ok, true, `table row must parse: ${expr}`);
    assert.equal(
      evaluateExpect(parsed.value, result),
      passed,
      `evaluateExpect(${JSON.stringify(expr)}, ${result}) === ${passed}`
    );
  }
});

// ------------------------------------------------- §2.2.2 regex consistency
// Necessary condition: parseExpect(raw).ok => EXPECT_RE.test(raw).

test('EXPECT_RE is a necessary condition of parseExpect (exhaustive ≤ 4 chars)', () => {
  const alphabet = ['>', '<', '=', '!', '&', '|', '.', '0', '1', '9', '-', '+', ' ', 'a', '\t'];
  const corpus = [''];
  let frontier = [''];
  for (let len = 1; len <= 4; len++) {
    const next = [];
    for (const prefix of frontier) {
      for (const ch of alphabet) next.push(prefix + ch);
    }
    corpus.push(...next);
    frontier = next;
  }
  let violations = 0;
  for (const s of corpus) {
    if (parseExpect(s).ok && !EXPECT_RE.test(s)) violations++;
  }
  assert.equal(violations, 0, `${corpus.length} strings checked; parse accepts imply regex accepts`);
  // The reverse is NOT true — the 6 known regex-pass / parse-reject cases.
  assert.ok(EXPECT_RE.test('60..41') && !parseExpect('60..41').ok);
  assert.ok(EXPECT_RE.test('5..1') && !parseExpect('5..1').ok);
});

// ----------------------------------------------------------------- diceRange

test('diceRange (2.2.3)', () => {
  const spec = (s) => parseDiceType(s).value;
  assert.deepEqual(diceRange(spec('1d100')), { min: 1, max: 100 });
  assert.deepEqual(diceRange(spec('2d6+2')), { min: 4, max: 14 });
  assert.deepEqual(diceRange(spec('2d10-1')), { min: 1, max: 19 });
});

// ------------------------------------------------------------------ rollOnce

test('rollOnce deterministic sequence (§10.1 #6/#7)', () => {
  const seq = [0, 0.5, 0.9999999];
  const rng = () => seq.shift();
  const first = rollOnce(parseDiceType('1d100').value, rng);
  assert.deepEqual(first, { rolls: [1], result: 1, crit: false, fumble: true });
  const second = rollOnce(parseDiceType('1d100').value, rng);
  assert.deepEqual(second, { rolls: [51], result: 51, crit: false, fumble: false });
  const third = rollOnce(parseDiceType('1d100').value, rng);
  assert.deepEqual(third, { rolls: [100], result: 100, crit: true, fumble: false });
});

test('rollOnce never rounds the extremes away', () => {
  assert.equal(rollOnce(parseDiceType('1d6').value, () => 0.9999999999).rolls[0], 6);
  assert.equal(rollOnce(parseDiceType('1d6').value, () => 0).rolls[0], 1);
});

test('rollOnce rejects an out-of-range rng with RangeError', () => {
  assert.throws(() => rollOnce(parseDiceType('1d6').value, () => 1), RangeError);
  assert.throws(() => rollOnce(parseDiceType('1d6').value, () => -0.1), RangeError);
});

test('crit / fumble are dice-face facts (§2.2.7, 9 cases)', () => {
  const roll = (type, faces) => rollOnce(parseDiceType(type).value, faces);
  const faces = (arr) => {
    let i = 0;
    return () => arr[i++];
  };
  assert.deepEqual(roll('1d100', faces([0.99])).crit, true);
  assert.deepEqual(roll('1d100', faces([0])).fumble, true);
  assert.deepEqual(roll('1d100', faces([0.95])).crit, false);
  assert.deepEqual(roll('1d20', faces([0.99])).crit, true);
  assert.deepEqual(roll('1d20', faces([0.9])).crit, false);
  assert.deepEqual(roll('2d6', faces([0.99, 0.99])).crit, true);
  assert.deepEqual(roll('2d6', faces([0.99, 0.8])).crit, false);
  assert.deepEqual(roll('3d6', faces([0, 0, 0])).fumble, true);
  const big = roll('4d6+2', faces([0.99, 0.99, 0.99, 0.99]));
  assert.equal(big.crit, true);
  assert.equal(big.result, 26);
});

// ----------------------------------------------------- patchRollDiceResult

const EVENING = [
  '---',
  'type: chalk',
  'roll_dice:',
  '  type: 1d100',
  '  desc: Deduction check',
  '  expect: ">50"',
  'choice:',
  '  - "Ask where the photograph came from"',
  '  - "Go to the orchard alone to investigate"',
  'status:',
  '  data:',
  '    photo_source: "The Constable"',
  '---',
  '',
  '(Watson opens a manila envelope, and a photograph slips out.)',
  '',
  'The distant outline of the abandoned orchard.',
  '',
].join('\n');

test('patchRollDiceResult appends two lines, changes nothing else', () => {
  const out = patchRollDiceResult(EVENING, 62, true);
  const added = out.replace('  result: 62\n', '').replace('  passed: true\n', '');
  assert.equal(added, EVENING, 'only result/passed are new; everything else is byte-identical');
  assert.equal(out, EVENING.replace('  expect: ">50"\n', '  expect: ">50"\n  result: 62\n  passed: true\n'));
});

test('patchRollDiceResult is idempotent and repeatable', () => {
  const once = patchRollDiceResult(EVENING, 62, true);
  const twice = patchRollDiceResult(once, 7, false);
  assert.ok(twice.includes('  result: 7\n') && twice.includes('  passed: false\n'));
  assert.equal(twice, patchRollDiceResult(twice, 7, false));
  const stripped = twice.replace('  result: 7\n', '').replace('  passed: false\n', '');
  assert.equal(stripped, EVENING);
});

test('patchRollDiceResult follows the block indentation (4-space heritage)', () => {
  const four = ['---', 'type: chalk', 'roll_dice:', '    type: 1d100', '    desc: X', '    expect: ">50"', '---', ''].join('\n');
  const out = patchRollDiceResult(four, 9, false);
  assert.ok(out.includes('    result: 9\n') && out.includes('    passed: false\n'));
});

test('patchRollDiceResult preserves CRLF and does not double carriage returns', () => {
  const crlf = EVENING.replace(/\n/g, '\r\n');
  const out = patchRollDiceResult(crlf, 62, true);
  assert.ok(!out.includes('\r\r\n'));
  const lf = out.replace(/\r\n/g, '\n');
  assert.equal(lf.replace('  result: 62\n', '').replace('  passed: true\n', ''), EVENING);
});

test('patchRollDiceResult leaves a file without a trailing newline alone', () => {
  const noTail = ['---', 'type: chalk', 'roll_dice:', '  type: 1d100', '  desc: X', '  expect: ">50"', '---', 'body'].join('\n');
  const out = patchRollDiceResult(noTail, 3, false);
  assert.ok(!out.endsWith('\n'));
  assert.match(out, /\n  passed: false\n---\nbody$/);
});

test('patchRollDiceResult keeps result before passed when only one exists', () => {
  const block = ['---', 'type: chalk', 'roll_dice:', '  type: 1d100', '  desc: X', '  expect: ">50"', '---', ''].join('\n');
  const onlyPassed = block.replace('  expect: ">50"', '  expect: ">50"\n  passed: false');
  assert.match(patchRollDiceResult(onlyPassed, 9, true), /  result: 9\n  passed: true\n/);
  const onlyResult = block.replace('  expect: ">50"', '  expect: ">50"\n  result: 3');
  assert.match(patchRollDiceResult(onlyResult, 9, true), /  result: 9\n  passed: true\n/);
});

test('patchRollDiceResult does not swallow a blank separator line before the next key', () => {
  const spaced = ['---', 'type: chalk', 'roll_dice:', '  type: 1d100', '  desc: X', '  expect: ">50"', '', 'choice:', '  - A', '---', ''].join('\n');
  const out = patchRollDiceResult(spaced, 5, true);
  assert.equal(out.replace('  result: 5\n', '').replace('  passed: true\n', ''), spaced);
  assert.ok(out.includes('  passed: true\n\nchoice:'), 'the blank separator stays where it was');
});

test('patchRollDiceResult refuses the cases it cannot do honestly (14)', () => {
  assert.throws(() => patchRollDiceResult('no frontmatter here', 1, true), /no YAML frontmatter/);
  assert.throws(() => patchRollDiceResult('---\ntype: chalk\n---\n', 1, true), /declares no roll_dice block/);
  assert.throws(
    () => patchRollDiceResult('---\ntype: chalk\nroll_dice: { type: 1d100 }\n---\n', 1, true),
    /inline form/
  );
});

test('patchRollDiceResult output keeps result numeric and passed boolean under YAML', async () => {
  const { parse } = await import('yaml');
  const out = patchRollDiceResult(EVENING, 62, true);
  const doc = parse(out.split('---')[1]);
  assert.equal(typeof doc.roll_dice.result, 'number');
  assert.equal(doc.roll_dice.result, 62);
  assert.equal(typeof doc.roll_dice.passed, 'boolean');
  assert.equal(doc.roll_dice.passed, true);
});

// The fixture is an archived template, which the open-source copy does not carry.
const HOLMES_FIXTURE = new URL('../../../archive/templates/pre-bilingual-2026-09-14/holmes-world/world/baker-street/evening.md', import.meta.url);
test('patchRollDiceResult on the shipped template differs by exactly two lines (10.1 #10)', { skip: !existsSync(HOLMES_FIXTURE) && 'archived fixture not present' }, async () => {
  const fs = await import('node:fs/promises');
  const url = new URL('../../../archive/templates/pre-bilingual-2026-09-14/holmes-world/world/baker-street/evening.md', import.meta.url);
  const raw = await fs.readFile(url, 'utf-8');
  const out = patchRollDiceResult(raw, 62, true);
  assert.equal(out.replace('  result: 62\n', '').replace('  passed: true\n', ''), raw);
  assert.ok(out.includes('  expect: ">50"\n  result: 62\n  passed: true\nchoice:'));
});
