/**
 * Dice rules — the ONE expect-expression parser (doc-tools/07 §2.2).
 *
 * Zero dependencies on purpose: no zod, no yaml, no schemas/, no actions/.
 * Any consumer may import this safely — unit tests (node --test, no build),
 * the web layer (to mark a bad declaration red early), the tool shell (error
 * copy). The private copy of this logic inside routes/world.ts is retired.
 */

import { EXPECT_PROFILE, evaluateCondition, parseCondition } from '../commands/condition.js';
import type { ConditionAst, ConditionAtom, ConditionOperator, Scalar } from '../commands/condition.js';

/** Parsed `roll_dice.type`: how many dice, how many faces, what modifier. */
export interface DiceSpec {
  /** 1..20 */
  count: number;
  /** 2..1000 */
  faces: number;
  /** -10000..10000 */
  modifier: number;
}

/** One comparison / range atom. `anyOf` groups OR; each group ANDs its atoms. */
export interface DiceAtom {
  op: '>' | '>=' | '<' | '<=' | '=' | '!=' | 'range';
  /** Threshold for every op except 'range'. */
  value?: number;
  /** Range only. */
  min?: number;
  /** Range only. */
  max?: number;
}

export interface ExpectAst {
  /** Top-level OR; each inner array is an AND group. `anyOf[0]` is never empty. */
  anyOf: DiceAtom[][];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const COUNT_MAX = 20;
const FACES_MAX = 1000;
const MODIFIER_ABS_MAX = 10000;
/** Guards against Number precision loss silently changing a comparison (§2.2.3). */
const INT_DIGITS_MAX = 15;

const DICE_RE = /^(\d{0,2})d(\d{1,4})(?:([+-])(\d{1,5}))?$/i;

/**
 * Parse `roll_dice.type` (§2.2.1). `d` is case-insensitive; leading/trailing
 * whitespace is trimmed (`String.trim()` also eats NBSP — §11 conflict 5,
 * accepted by design); inner whitespace is NOT legal (`1d100 + 5` is a bad
 * declaration, not a lenient input).
 */
export function parseDiceType(raw: string): ParseResult<DiceSpec> {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    return { ok: false, error: 'roll_dice.type is empty' };
  }
  const m = DICE_RE.exec(text);
  if (!m) {
    return {
      ok: false,
      error: `roll_dice.type "${text}" is not a valid NdM[\u00b1K] expression`,
    };
  }
  const count = m[1] === '' ? 1 : Number(m[1]);
  const faces = Number(m[2]);
  const modifier = m[3] ? (m[3] === '-' ? -1 : 1) * Number(m[4]) : 0;
  if (count < 1 || count > COUNT_MAX || faces < 2 || faces > FACES_MAX || Math.abs(modifier) > MODIFIER_ABS_MAX) {
    return {
      ok: false,
      error:
        `roll_dice.type "${text}" is out of range ` +
        '(count 1..20, faces 2..1000, modifier \u00b110000)',
    };
  }
  return { ok: true, value: { count, faces, modifier } };
}

// ---------------------------------------------------------------------------
// expect expression
// ---------------------------------------------------------------------------

const INT = String.raw`-?\d+`;
const W = String.raw`[ \t]*`;
const ATOM_SRC = `(?:${INT}${W}\\.\\.${W}${INT}|(?:>=|<=|!=|==|=|>|<)${W}${INT}|${INT})`;
const AND_SRC = `${ATOM_SRC}(?:${W}&&${W}${ATOM_SRC})*`;

/**
 * Necessary condition pre-check: `parseExpect(raw).ok` implies this matches.
 * NOT sufficient — a pure regex cannot express "range min <= max", so
 * `"60..41"` passes the regex and must still be rejected by `parseExpect`.
 * Never use this as the final verdict.
 */
export const EXPECT_RE = new RegExp(`^${W}${AND_SRC}(?:${W}\\|\\|${W}${AND_SRC})*${W}$`);

const EXPECT_EXAMPLES =
  'expected e.g. ">50", ">=60", "<30", "=50", "41..60", ">=40 && <=60", ">80 || <20"';

function expectError(raw: string): { ok: false; error: string } {
  return {
    ok: false,
    error: `roll_dice.expect ${JSON.stringify(raw)} is not evaluable; ${EXPECT_EXAMPLES}`,
  };
}

/*
 * The `expect` grammar is NOT implemented here any more — it is one of the three
 * profiles of `commands/condition.ts` (`03` §9.1). Keeping a second
 * recursive-descent scanner was the third copy of one grammar (`rules/
 * interactive.ts` held the second; it delegates too now), and three copies drift
 * silently: each accepts a slightly different set and neither complains.
 *
 * This module keeps its OWN contract intact, and that is why the adapter below
 * exists rather than a plain re-export:
 *   - `parseExpect`/`evaluateExpect`/`ExpectAst`/`DiceAtom` are the public shapes
 *     (`roll-dice.ts` and the web layer consume them), and they MUST NOT change;
 *   - the error copy is asserted VERBATIM by `dice.test.mjs` and is phrased for
 *     the `roll_dice.expect` field, not for a generic condition.
 * So we translate at the boundary: `EXPECT_PROFILE` has `roots: []` and no `in`
 * operator, which makes the AST ⇄ `DiceAtom[][]` projection LOSSLESS (`03` §9.2).
 */
function toExpectAst(ast: ConditionAst): ExpectAst {
  const anyOf: DiceAtom[][] = [];
  for (const group of ast.anyOf) {
    const translated: DiceAtom[] = [];
    for (const atom of group) {
      // `EXPECT_PROFILE` declares no roots and no `in`, so only these two
      // shapes are reachable — anything else means the profile changed and this
      // adapter must be revisited, so it fails closed instead of guessing.
      if (atom.kind === 'range') {
        translated.push({ op: 'range', min: atom.min, max: atom.max });
        continue;
      }
      if (atom.kind !== 'compare' || atom.left.kind !== 'implicit') return { anyOf: [] };
      if (atom.op === 'in') {
        const r = atom.right;
        if (r === null || typeof r !== 'object' || !('kind' in r) || r.kind !== 'range') return { anyOf: [] };
        translated.push({ op: 'range', min: r.min, max: r.max });
        continue;
      }
      const rhs = atom.right;
      const value = rhs !== null && typeof rhs === 'object' && 'kind' in rhs && rhs.kind === 'literal' ? rhs.value : undefined;
      if (typeof value !== 'number') return { anyOf: [] };
      // The shared parser spells equality `==`; `DiceAtom` spells it `=`.
      translated.push({ op: atom.op === '==' ? '=' : (atom.op as DiceAtom['op']), value });
    }
    if (translated.length === 0) return { anyOf: [] };
    anyOf.push(translated);
  }
  return { anyOf };
}

/**
 * Parse `roll_dice.expect` (§2.2.1). Deliberately NOT Turing-complete: no
 * parentheses, no variables, no arithmetic — only "did this check pass".
 */
export function parseExpect(raw: string): ParseResult<ExpectAst> {
  if (typeof raw !== 'string' || raw.trim() === '') return expectError(String(raw));
  const parsed = parseCondition(raw.trim(), EXPECT_PROFILE);
  if (!parsed.ok || parsed.value.anyOf.length === 0) return expectError(String(raw));
  const ast = toExpectAst(parsed.value);
  if (ast.anyOf.length === 0) return expectError(String(raw));
  return { ok: true, value: ast };
}

/**
 * Pure, deterministic, no randomness (§2.2.3).
 *
 * The scope seeds the implicit subject (`result`) rather than a named root:
 * `EXPECT_PROFILE` declares no roots, so `compare`/`range` atoms carry
 * `left.kind === 'implicit'` and read exactly this binding. An error is `false`
 * — the same fail-closed reading the old local evaluator had, because a bad
 * declaration must not silently mark every roll as passing.
 */
export function evaluateExpect(ast: ExpectAst, result: number): boolean {
  const evaluated = evaluateCondition(toConditionAst(ast), {
    values: new Map<string, Scalar>([['result', result]]),
    paths: new Map(),
  });
  return evaluated.ok ? evaluated.value : false;
}

/** The inverse projection: `DiceAtom[][]` back into the shared AST. */
function toConditionAst(ast: ExpectAst): ConditionAst {
  return {
    anyOf: ast.anyOf.map((group) =>
      group.map((a): ConditionAtom =>
        a.op === 'range'
          ? { kind: 'range', subject: { kind: 'implicit' }, min: a.min!, max: a.max! }
          : {
              kind: 'compare',
              op: a.op === '=' ? '==' : (a.op as ConditionOperator),
              left: { kind: 'implicit' },
              right: { kind: 'literal', value: a.value! },
            }
      )
    ),
  };
}

function atomPasses(a: DiceAtom, r: number): boolean {
  switch (a.op) {
    case '>':
      return r > a.value!;
    case '>=':
      return r >= a.value!;
    case '<':
      return r < a.value!;
    case '<=':
      return r <= a.value!;
    case '=':
      return r === a.value!;
    case '!=':
      return r !== a.value!;
    case 'range':
      return r >= a.min! && r <= a.max!;
  }
}

/** Theoretical range incl. modifier — legal-forcedResult check + UI display. */
export function diceRange(spec: DiceSpec): { min: number; max: number } {
  return { min: spec.count + spec.modifier, max: spec.count * spec.faces + spec.modifier };
}

/**
 * Roll once. `rng` MUST be passed explicitly — the only reproducibility seam
 * (§2.2.9). Its value is expected in [0,1); an out-of-range value is a caller
 * bug and raises `RangeError` rather than silently clamping (that would make
 * test cases quietly stop testing anything).
 */
export function rollOnce(
  spec: DiceSpec,
  rng: () => number
): { rolls: number[]; result: number; crit: boolean; fumble: boolean } {
  const rolls: number[] = [];
  for (let i = 0; i < spec.count; i++) {
    const v = rng();
    if (!(v >= 0 && v < 1)) {
      throw new RangeError(`rng() must return a value in [0, 1), got ${v}`);
    }
    // floor, never round: round would give the extremes half a bucket each.
    rolls.push(Math.floor(v * spec.faces) + 1);
  }
  const sum = rolls.reduce((acc, r) => acc + r, 0);
  return {
    rolls,
    result: sum + spec.modifier,
    crit: rolls.every((r) => r === spec.faces),
    fumble: rolls.every((r) => r === 1),
  };
}

// ---------------------------------------------------------------------------
// frontmatter write-back
// ---------------------------------------------------------------------------

function patchError(message: string): never {
  throw new Error(message);
}

/**
 * Rewrite ONLY the `result` / `passed` lines inside the `roll_dice:` block —
 * every other byte of the file is preserved verbatim (§2.2.8). Returns the new
 * content; it does not touch the disk (the caller uses `store.writeFileAtomic`).
 *
 * WHY this exists instead of a full YAML re-serialize: `stringifyChalk` reorders
 * the whole frontmatter, quotes every scalar (`result: "62"` — a string, not a
 * number), and loses nested blocks and inline comments. A line-level surgical
 * edit keeps the author's file recognisable and keeps `result` a number.
 *
 * Throws (never silently gives up) when the file has no frontmatter, no
 * `roll_dice:` block, or uses the inline-map form `roll_dice: {…}`.
 */
export function patchRollDiceResult(raw: string, result: number, passed: boolean): string {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r\n|\n/);

  if (lines[0] !== '---') patchError('Cannot update roll_dice: file has no YAML frontmatter block');
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) patchError('Cannot update roll_dice: frontmatter block is not closed');

  let head = -1;
  for (let i = 1; i < close; i++) {
    if (!/^roll_dice[ \t]*:/.test(lines[i])) continue;
    if (!/^roll_dice[ \t]*:[ \t]*$/.test(lines[i])) {
      patchError(
        'Cannot update roll_dice: the inline form `roll_dice: {…}` is not supported; use the block form'
      );
    }
    head = i;
    break;
  }
  if (head === -1) patchError('Cannot update roll_dice: file declares no roll_dice block');

  // The block runs to the first line that is neither blank nor indented; trailing
  // blank separators stay OUTSIDE it so a fresh line never lands after them (§2.2.8).
  let blockEnd = head + 1;
  while (blockEnd < close && /^[ \t]/.test(lines[blockEnd])) blockEnd++;

  // Sub-key indentation follows the file: first indented sub-key, else 2 spaces.
  let indent = '  ';
  for (let i = head + 1; i < blockEnd; i++) {
    const m = /^([ \t]+)\S/.exec(lines[i]);
    if (m) {
      indent = m[1];
      break;
    }
  }

  let resultLine = -1;
  let passedLine = -1;
  for (let i = head + 1; i < blockEnd; i++) {
    if (resultLine === -1 && /^[ \t]*result[ \t]*:/.test(lines[i])) resultLine = i;
    if (passedLine === -1 && /^[ \t]*passed[ \t]*:/.test(lines[i])) passedLine = i;
  }

  // In-place replacement keeps the sub-key's own indentation (files written by
  // the retired `stringifyChalk` used 4 spaces); a fresh line uses `indent`.
  const patched = lines.slice();
  if (resultLine !== -1) {
    patched[resultLine] = `${/^([ \t]*)/.exec(lines[resultLine])![1]}result: ${result}`;
  }
  if (passedLine !== -1) {
    patched[passedLine] = `${/^([ \t]*)/.exec(lines[passedLine])![1]}passed: ${passed}`;
  }
  if (resultLine === -1) {
    // Keep the canonical order: `result` right before `passed` when the latter
    // already exists, else at the block tail.
    patched.splice(passedLine === -1 ? blockEnd : passedLine, 0, `${indent}result: ${result}`);
  }
  if (passedLine === -1) {
    patched.splice(resultLine === -1 ? blockEnd + 1 : resultLine + 1, 0, `${indent}passed: ${passed}`);
  }

  return patched.join(eol);
}
