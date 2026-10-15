import assert from 'node:assert/strict';
import { test } from 'node:test';

// Imported straight from the commands module: `condition.ts` is zero-runtime-
// dependency on purpose, so this suite runs without the rest of the barrel.
import {
  COMMAND_PROFILE,
  EXPECT_PROFILE,
  WHEN_PROFILE,
  collectHasPaths,
  collectRefPaths,
  collectRefs,
  conditionScopeOf,
  evalWhen,
  evaluateCondition,
  normalizeScalar,
  parseCommandWhen,
  parseCondition,
} from '../dist/commands/condition.js';

// The pre-existing dice parser. The `expect` profile is a GENERALISATION of it,
// so the two must agree on every input — that equivalence is the whole reason
// the profile exists (03 §9.2: `dice.ts`'s exported shape is unchanged).
import { evaluateExpect, parseExpect } from '../dist/rules/dice.js';

/* ────────────────────────────────────────────────────────────────────────────
 * helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/** Evaluate a `command`-profile source with explicit values/paths. */
function cmd(src, values = {}, paths = {}) {
  const parsed = parseCommandWhen(src);
  assert.equal(parsed.ok, true, `expected "${src}" to parse: ${parsed.error}`);
  return evaluateCondition(parsed.value, {
    values: new Map(Object.entries(values)),
    paths: new Map(Object.entries(paths)),
  });
}

/** Evaluate a `when`-profile source the way `evalWhen` does. */
function wh(src, data) {
  const parsed = parseCondition(src, WHEN_PROFILE);
  assert.equal(parsed.ok, true, `expected "${src}" to parse: ${parsed.error}`);
  return evaluateCondition(parsed.value, conditionScopeOf(parsed.value, data));
}

/* ────────────────────────────────────────────────────────────────────────────
 * §2.4 scalar lattice
 * ──────────────────────────────────────────────────────────────────────────── */

test('normalizeScalar collapses to the scalar lattice', () => {
  assert.equal(normalizeScalar(null), null);
  assert.equal(normalizeScalar(undefined), null);
  assert.equal(normalizeScalar(1), 1);
  assert.equal(normalizeScalar(true), true);
  assert.equal(normalizeScalar('1'), 1);
  assert.equal(normalizeScalar(' true '), true);
  assert.equal(normalizeScalar('"open"'), 'open');
  assert.equal(normalizeScalar("'open'"), 'open');
  assert.equal(normalizeScalar('null'), null);
  assert.equal(normalizeScalar('~'), null);
  assert.equal(normalizeScalar('open'), 'open');
  assert.equal(normalizeScalar(''), '');
});

/* ────────────────────────────────────────────────────────────────────────────
 * §9.2 the `expect` profile must remain a GENERALISATION of dice.ts
 * ──────────────────────────────────────────────────────────────────────────── */

// Every shape the dice grammar accepts, plus boundary and negative cases.
const EXPECT_CASES = [
  '>50', '>=60', '<30', '<=20', '=50', '==50', '!=0', '41..60',
  '>=40 && <=60', '>80 || <20', '50', '-5', '0', '>11', '41..41',
  '5..1', '60..41', '>abc', '', '   ', 'k == 1', 'status.x == 1',
  '50 && 60', '>50 ||', '&& >50', 'in 1..3', '> 50',
  '>= 10 && <= 20 && != 15', '1 || 2 || 3', '=1 && =2',
];

test('expect profile agrees with dice.ts on every input', () => {
  for (const src of EXPECT_CASES) {
    const reference = parseExpect(src).ok;
    const mine = parseCondition(src, EXPECT_PROFILE).ok;
    assert.equal(mine, reference, `disagreement on ${JSON.stringify(src)}`);
  }
});

test('expect profile evaluation agrees with dice.ts', () => {
  const srcs = ['>50', '>=60', '<30', '=50', '41..60', '>=40 && <=60', '>80 || <20', '50', '!=0', '41..41'];
  const values = [0, 20, 30, 40, 41, 50, 60, 80, 100, -5];
  for (const src of srcs) {
    const reference = parseExpect(src);
    const mine = parseCondition(src, EXPECT_PROFILE);
    assert.equal(mine.ok, true, `expected "${src}" to parse`);
    for (const v of values) {
      const expected = evaluateExpect(reference.value, v);
      const actual = evaluateCondition(mine.value, { values: new Map([['result', v]]), paths: new Map() });
      assert.equal(actual.ok, true, `"${src}" @ ${v} must not error`);
      assert.equal(actual.value, expected, `"${src}" @ ${v}`);
    }
  }
});

// 03 §9.2: the unified AST must project back to `DiceAtom[][]`. If this ever
// breaks, `dice.ts`'s exported shape would have to change — which the contract
// forbids. The projection is the reason `expect` fixes the left side to the
// anonymous subject and forbids `in` and predicates.
test('expect AST projects losslessly back to the dice atom shape', () => {
  const subjectIsImplicit = (op) => {
    assert.equal(op.kind, 'implicit', `expected the anonymous subject, got ${op.kind}`);
  };
  for (const src of ['>50', '>=60', '<30', '=50', '41..60', '>=40 && <=60', '>80 || <20', '50', '=1 && =2']) {
    const parsed = parseCondition(src, EXPECT_PROFILE);
    assert.equal(parsed.ok, true, `expected "${src}" to parse`);
    for (const group of parsed.value.anyOf) {
      for (const atom of group) {
        if (atom.kind === 'range') {
          subjectIsImplicit(atom.subject);
          continue;
        }
        assert.equal(atom.kind, 'compare', `unexpected atom kind ${atom.kind}`);
        subjectIsImplicit(atom.left);
        if (atom.right.kind === 'range') continue;
        assert.equal(atom.right.kind, 'literal', 'the right side must be a literal in `expect`');
      }
    }
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * §4.4 profiles
 * ──────────────────────────────────────────────────────────────────────────── */

test('expect profile rejects references (roots: [] means NO references)', () => {
  assert.equal(parseCondition('status.lid == open', EXPECT_PROFILE).ok, false);
  assert.equal(parseCondition('k == 1', EXPECT_PROFILE).ok, false);
  assert.equal(parseCondition('in 1..3', EXPECT_PROFILE).ok, false);
});

test('when profile admits only == and != on the status root', () => {
  assert.equal(parseCondition('lid == open', WHEN_PROFILE).ok, true);
  assert.equal(parseCondition('lid != open', WHEN_PROFILE).ok, true);
  assert.equal(parseCondition('"lid" == "open"', WHEN_PROFILE).ok, true);
  assert.equal(parseCondition('lid > 1', WHEN_PROFILE).ok, false);
  assert.equal(parseCondition('roll.result == 1', WHEN_PROFILE).ok, false);
  assert.equal(parseCondition('defined(lid)', WHEN_PROFILE).ok, false);
  assert.equal(parseCondition('has("a/b.md")', WHEN_PROFILE).ok, false);
});

test('command profile admits the full algebra', () => {
  assert.equal(parseCommandWhen('status.a == 1 && status.b >= 2').ok, true);
  assert.equal(parseCommandWhen('params.n in 1..3').ok, true);
  assert.equal(parseCommandWhen('defined(status.x) || missing(status.y)').ok, true);
  assert.equal(parseCommandWhen('has("a/b.md")').ok, true);
  assert.equal(parseCommandWhen('status.lid').ok, false); // bare names are `when`-only
  assert.equal(parseCommandWhen('nope.x == 1').ok, false); // unknown root
});

test('the grammar has no parentheses and no arithmetic (03:75)', () => {
  assert.equal(parseCommandWhen('(status.a == 1)').ok, false);
  assert.equal(parseCommandWhen('roll.result + 5 > 60').ok, false);
});

test('malformed sources are rejected, never half-parsed', () => {
  for (const bad of ['', '   ', 'status.a == 1 &&', 'status.a == ', 'status.a == 1 status.b == 2', '&& status.a == 1']) {
    assert.equal(parseCommandWhen(bad).ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('inverted ranges are rejected at parse time', () => {
  assert.equal(parseCommandWhen('60..41').ok, false);
  assert.equal(parseCommandWhen('status.n in 5..1').ok, false);
  assert.equal(parseCondition('60..41', EXPECT_PROFILE).ok, false);
});

test('has() refuses paths that could escape the world', () => {
  assert.equal(parseCommandWhen('has("/abs")').ok, false);
  assert.equal(parseCommandWhen('has("../up")').ok, false);
  assert.equal(parseCommandWhen('has("a/../b")').ok, false);
  assert.equal(parseCommandWhen('has("")').ok, false);
});

/* ────────────────────────────────────────────────────────────────────────────
 * §3.4 the three-valued result
 * ──────────────────────────────────────────────────────────────────────────── */

// T3 — a missing reference is an ERROR, not a silent false. Silent falseness is
// the failure mode hard gate 4 forbids: the player would just never see the
// content, with nothing anywhere saying why.
test('T3: an absent reference is unresolved_ref, and it names itself', () => {
  const r = cmd('status.lid == open', {});
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'unresolved_ref');
  assert.equal(r.error.ref, 'status.lid');
});

// T4 — `missing()` makes absence legal.
test('T4: missing() short-circuits a group that would otherwise error', () => {
  const r = cmd('missing(status.lid) || status.lid == open', {});
  assert.equal(r.ok, true);
  assert.equal(r.value, true);
});

// T5 — `defined()` on an absent key yields false, NOT an error. This is what
// lets authors write `defined(x) && x == 1` without a lookup fault.
test('T5: defined() on an absent key is false, not an error', () => {
  const r = cmd('defined(status.lid) && status.lid == open', {});
  assert.equal(r.ok, true);
  assert.equal(r.value, false);
});

test('ordered comparison on a non-number is type_mismatch', () => {
  const r = cmd('status.n > 3', { 'status.n': 'closed' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'type_mismatch');
});

test('equality never type-errors: unequal types are simply false', () => {
  const r = cmd('status.a == status.b', { 'status.a': 1, 'status.b': 'open' });
  assert.equal(r.ok, true);
  assert.equal(r.value, false);
});

test('has() reports io_failed when the caller forgot to pre-resolve', () => {
  const r = cmd('has("a/b.md")', {});
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'io_failed');
});

test('has() reads the pre-resolved path map', () => {
  assert.equal(cmd('has("a/b.md")', {}, { 'a/b.md': 'file' }).value, true);
  assert.equal(cmd('has("a/b.md")', {}, { 'a/b.md': 'dir' }).value, true);
  assert.equal(cmd('has("a/b.md")', {}, { 'a/b.md': 'missing' }).value, false);
});

/* ────────────────────────────────────────────────────────────────────────────
 * T17 — when-profile evaluation NEVER returns an error
 * ──────────────────────────────────────────────────────────────────────────── */

test('T17: a missing status key is Ok(false), never Err', () => {
  const absent = wh('lid == open', {});
  assert.equal(absent.ok, true, 'a missing key must not error in the `when` profile');
  assert.equal(absent.value, false);

  const present = wh('lid == open', { lid: 'open' });
  assert.equal(present.ok, true);
  assert.equal(present.value, true);

  const neq = wh('lid != open', {});
  assert.equal(neq.ok, true);
  assert.equal(neq.value, true);
});

/* ────────────────────────────────────────────────────────────────────────────
 * T18 — determinism (hard gate 1: replayable)
 * ──────────────────────────────────────────────────────────────────────────── */

test('T18: the same AST and scope always give the same result', () => {
  const src = 'status.a == 1 || status.b >= 2 || has("x/y.md")';
  const parsed = parseCommandWhen(src);
  const scope = { values: new Map([['status.a', 1]]), paths: new Map([['x/y.md', 'file']]) };
  const first = JSON.stringify(evaluateCondition(parsed.value, scope));
  for (let i = 0; i < 50; i += 1) {
    assert.equal(JSON.stringify(evaluateCondition(parsed.value, scope)), first);
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * static analysis helpers
 * ──────────────────────────────────────────────────────────────────────────── */

test('collectHasPaths de-duplicates and preserves order', () => {
  const ast = parseCommandWhen('has("p/q") && has("x/y.md") || has("p/q")').value;
  assert.deepEqual(collectHasPaths(ast), ['p/q', 'x/y.md']);
  assert.deepEqual(collectHasPaths(parseCommandWhen('status.a == 1').value), []);
});

test('collectRefs reports roots; collectRefPaths reports full paths', () => {
  const ast = parseCommandWhen('status.a == 1 && params.n > 2').value;
  assert.deepEqual(collectRefs(ast).sort(), ['params', 'status']);
  assert.deepEqual(collectRefPaths(ast).sort(), ['params.n', 'status.a']);
});

/* ────────────────────────────────────────────────────────────────────────────
 * §9.2 `evalWhen` — frozen behaviour the existing suite depends on
 * ──────────────────────────────────────────────────────────────────────────── */

test('evalWhen keeps its documented behaviour verbatim', () => {
  // Equality, including the numeric normalisation that makes `status: 1` and
  // `"1"` compare equal.
  assert.equal(evalWhen('k == 1', { k: 1 }), true);
  assert.equal(evalWhen('k == 1', { k: 2 }), false);
  assert.equal(evalWhen('k == 1', { k: '1' }), true);
  assert.equal(evalWhen('k == true', { k: true }), true);
  assert.equal(evalWhen('k == open', { k: 'open' }), true);
  // A missing key is not an error here: `==` is false, `!=` is true.
  assert.equal(evalWhen('k == 1', {}), false);
  assert.equal(evalWhen('k != 1', {}), true);
  assert.equal(evalWhen('k != 1', { k: 2 }), true);
  // Quotes are stripped from BOTH sides, so `"k"` is still the key.
  assert.equal(evalWhen('"k" == "1"', { k: 1 }), true);
});

test('evalWhen fails closed on malformed expressions', () => {
  for (const bad of ['k === 1', 'k > 1', '', '   ', 'k', '== 1', 'a and b']) {
    assert.equal(evalWhen(bad, { k: 1 }), false, `${JSON.stringify(bad)} must be false`);
  }
  assert.equal(evalWhen('k == 1', null), false);
});
