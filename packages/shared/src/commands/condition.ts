/**
 * World-command condition expressions — the ONE parser + ONE evaluator (03 §2–§6).
 *
 * Three profiles share this implementation (03 §2.3 / §4.4):
 *   `expect`  — `roll_dice.expect`            (roots: none, implicit subject `result`)
 *   `when`    — `on.<hook>[].when` + `status` (roots: `status`, bare names allowed)
 *   `command` — `command/<id>.yaml` `do[].when` (full algebra, predicates enabled)
 *
 * Design invariants (03 §4.3):
 *   - `parseCondition` is pure, synchronous, zero I/O. It never touches the world.
 *   - `evaluateCondition` is pure, synchronous, deterministic. Same AST + same
 *     scope ⇒ same result, always (replayable; hard gate 1).
 *   - Missing values are NOT silently `false`: unless guarded by
 *     `defined()` / `missing()`, an absent reference is `unresolved_ref`.
 *
 * Zero runtime dependencies on purpose — mirroring `rules/dice.ts`, so the web
 * layer and the tool shell can import it without pulling in zod/yaml.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Types (03 §3.4 / §4.4 / §6.1)
 * ──────────────────────────────────────────────────────────────────────────── */

/** The scalar lattice every operand collapses to before comparison (03 §2.4). */
export type Scalar = string | number | boolean | null;

export type ConditionProfileName = 'expect' | 'when' | 'command';

export type ConditionOperator = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in';

/** A reference (`status.lid`), a literal (`50`, `"open"`), or the implicit subject. */
export type Operand =
  | { kind: 'ref'; path: string }
  | { kind: 'literal'; value: Scalar }
  | { kind: 'implicit' };

/** Right-hand side of `in`: an inclusive numeric range (03 §2.4). */
export interface RangeOperand {
  kind: 'range';
  min: number;
  max: number;
}

/**
 * One atom. Shape mirrors `dice.ts`'s `DiceAtom` so `EXPECT_PROFILE` parses are
 * losslessly projectable back to `DiceAtom[][]` (03 §9.2) — that projection is
 * why `expect` forbids `in`, predicates, and named roots.
 */
export type ConditionAtom =
  | { kind: 'compare'; op: ConditionOperator; left: Operand; right: Operand | RangeOperand }
  | { kind: 'range'; subject: Operand; min: number; max: number }
  | { kind: 'predicate'; fn: 'defined' | 'missing'; ref: string }
  | { kind: 'predicate'; fn: 'has'; path: string };

/** Top-level OR; each inner array is an AND group (03 §6.1). */
export interface ConditionAst {
  anyOf: ConditionAtom[][];
}

/** Errors are plain strings: `01` splices them straight into a positioned message. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** The only three runtime condition errors (03 §3.3). */
export type ConditionEvalErrorCode = 'unresolved_ref' | 'type_mismatch' | 'io_failed';

export interface ConditionEvalError {
  code: ConditionEvalErrorCode;
  /** The offending reference, verbatim (e.g. `status.lid`). */
  ref?: string;
  /** One English sentence, byte-identical to 03 §3.3's table. */
  message: string;
}

/** Three-valued, not boolean — "missing" is not the same as "false" (03 §3.4). */
export type ConditionResult = { ok: true; value: boolean } | { ok: false; error: ConditionEvalError };

/** Pre-resolved `has()` answers; the ONE place I/O results enter the evaluator. */
export interface ConditionScope {
  values: ReadonlyMap<string, Scalar>;
  paths: ReadonlyMap<string, 'file' | 'dir' | 'missing'>;
}

/** What a profile permits (03 §4.4). */
export interface ConditionProfile {
  name: ConditionProfileName;
  /** Allowed reference roots. `expect` has none; `when` allows only `status`. */
  roots: readonly string[];
  /** Allowed operators. `when` has only `==` / `!=`; `expect` excludes `in`. */
  operators: readonly ConditionOperator[];
  /** Whether `defined()` / `missing()` / `has()` atoms are permitted. */
  predicates: boolean;
  /** Whether a bare name means `status.<name>` (only `when`). */
  bareNames: boolean;
  /**
   * Anonymous subject. `expect` uses `result`; a `command` profile on the
   * `roll_resolved` hook uses `roll.result`; otherwise `null` (a bare scalar or
   * a bare range is then `missing_subject`).
   */
  implicitSubject: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Profiles (03 §2.3 / §4.4)
 * ──────────────────────────────────────────────────────────────────────────── */

const EXPECT_OPERATORS: readonly ConditionOperator[] = ['==', '!=', '>', '>=', '<', '<='];
const ALL_OPERATORS: readonly ConditionOperator[] = ['==', '!=', '>', '>=', '<', '<=', 'in'];

/** `roll_dice.expect` — anonymous subject `result`, no refs, no predicates. */
export const EXPECT_PROFILE: ConditionProfile = Object.freeze({
  name: 'expect',
  roots: [],
  operators: EXPECT_OPERATORS,
  predicates: false,
  bareNames: false,
  implicitSubject: 'result',
});

/** `on.<hook>[].when` — `status` only, `==` / `!=` only, bare names allowed. */
const WHEN_OPERATORS: readonly ConditionOperator[] = ['==', '!='];
export const WHEN_PROFILE: ConditionProfile = Object.freeze({
  name: 'when',
  roots: ['status'],
  operators: WHEN_OPERATORS,
  predicates: false,
  bareNames: true,
  implicitSubject: null,
});

/**
 * `command/<id>.yaml` `do[].when` — the full algebra.
 *
 * `implicitSubject` is `null` here because it is hook-dependent (`roll.result`
 * on `roll_resolved`, nothing elsewhere). Callers build a shallow variant when
 * they need the anonymous subject; `parseCondition` accepts any profile object.
 */
export const COMMAND_PROFILE: ConditionProfile = Object.freeze({
  name: 'command',
  roots: ['params', 'trigger', 'roll', 'choice', 'item', 'status', 'entry'],
  operators: ALL_OPERATORS,
  predicates: true,
  bareNames: false,
  implicitSubject: null,
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Scalar normalisation — the ONE copy (03 §2.4 / §9.1)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Collapse a raw value to the scalar lattice.
 *
 * Moved here verbatim from `rules/interactive.ts:54-66` (03 §9.1). Quoted text
 * is unwrapped, `true`/`false`/`null`/`~` fold to their literals, and a numeric
 * string folds to a number — so a YAML `status: 1` and a `"1"` compare equal.
 */
export function normalizeScalar(value: unknown): Scalar {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  let s = String(value).trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    s = s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (s !== '' && !Number.isNaN(Number(s))) return Number(s);
  return s;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Parser (03 §2 / §4 / §6)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Guards against Number precision loss silently changing a comparison (§2.2.3). */
const INT_DIGITS_MAX = 15;

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

/** Longest-first so `>=` never parses as `>` followed by `=`. `=` is an alias for `==`. */
const OPERATOR_TOKENS = ['>=', '<=', '!=', '==', '>', '<', '='] as const;
/** `=` is accepted as an alias for `==` at every call site. */


class ConditionParser {
  private i = 0;

  constructor(
    private readonly src: string,
    private readonly profile: ConditionProfile
  ) {}

  parse(): ParseResult<ConditionAst> {
    const anyOf: ConditionAtom[][] = [];
    for (;;) {
      const group = this.andExpr();
      if (typeof group === 'string') return { ok: false, error: group };
      anyOf.push(group);
      this.ws();
      if (this.eat('||')) continue;
      break;
    }
    this.ws();
    if (this.i !== this.src.length) {
      return { ok: false, error: `unexpected ${JSON.stringify(this.src.slice(this.i))}` };
    }
    if (anyOf.length === 0 || anyOf.some((g) => g.length === 0)) {
      return { ok: false, error: 'empty condition' };
    }
    return { ok: true, value: { anyOf } };
  }

  /** Returns an error string, or the AND group (possibly empty on failure). */
  private andExpr(): ConditionAtom[] | string {
    const first = this.atom();
    if (typeof first === 'string') return first;
    const group = [first];
    for (;;) {
      this.ws();
      if (!this.eat('&&')) break;
      const next = this.atom();
      if (typeof next === 'string') return next; // dangling AND
      group.push(next);
    }
    return group;
  }

  private atom(): ConditionAtom | string {
    this.ws();
    if (this.i >= this.src.length) return 'unexpected end of expression';

    // Predicates first: `defined(...)` would otherwise lex as a bare name.
    if (this.profile.predicates) {
      for (const fn of ['defined', 'missing'] as const) {
        if (this.tryKeyword(fn)) {
          this.ws();
          if (!this.eat('(')) return `"${fn}" must be followed by "("`;
          this.ws();
          const ref = this.dottedRef();
          if (ref === null) return `"${fn}" needs a reference argument`;
          this.ws();
          if (!this.eat(')')) return `"${fn}" is missing its ")"`;
          this.checkRefRoot(ref);
          return { kind: 'predicate', fn, ref };
        }
      }
      if (this.tryKeyword('has')) {
        this.ws();
        if (!this.eat('(')) return '"has" must be followed by "("';
        this.ws();
        const path = this.quotedString();
        if (path === null) return '"has" needs a quoted path argument';
        this.ws();
        if (!this.eat(')')) return '"has" is missing its ")"';
        if (path === '' || path.startsWith('/') || path.includes('..')) {
          return `has("${path}") is not a valid world-relative path`;
        }
        return { kind: 'predicate', fn: 'has', path };
      }
    }

    // Prefix form: `>= 11`, `41..60`, `50` (expect's anonymous subject).
    if (this.profile.implicitSubject !== null) {
      const prefixed = this.prefixAtom();
      if (typeof prefixed !== 'string') return prefixed;
      if (prefixed !== NOT_AN_ATOM) return prefixed;
    }

    // Infix form: `left op right`.
    return this.infixAtom();
  }

  /** `expect` shapes. Returns `NOT_AN_ATOM` when the next token is not one. */
  private prefixAtom(): ConditionAtom | string {
    const save = this.i;
    for (const token of OPERATOR_TOKENS) {
      if (!this.eat(token)) continue;
      const op = (token === '=' ? '==' : token) as ConditionOperator;
      if (!this.profile.operators.includes(op)) {
        this.i = save;
        return `the "${token}" operator is not allowed here`;
      }
      this.ws();
      const n = this.integer();
      if (n === null) return `"${token}" must be followed by an integer`;
      return { kind: 'compare', op, left: { kind: 'implicit' }, right: lit(n) };
    }
    const n = this.integer();
    if (n === null) {
      this.i = save;
      return NOT_AN_ATOM;
    }
    this.ws();
    if (this.eat('..')) {
      this.ws();
      const hi = this.integer();
      if (hi === null) return 'a range needs an upper bound';
      if (n > hi) return 'inverted range';
      return { kind: 'range', subject: { kind: 'implicit' }, min: n, max: hi };
    }
    return { kind: 'compare', op: '==', left: { kind: 'implicit' }, right: lit(n) };
  }

  private infixAtom(): ConditionAtom | string {
    const left = this.operand('left');
    if (typeof left === 'string') return left;
    this.ws();
    const op = this.operator();
    if (op === null) return 'expected an operator';
    if (!this.profile.operators.includes(op)) return `the "${op}" operator is not allowed here`;
    this.ws();
    if (op === 'in') {
      const range = this.rangeOperand();
      if (typeof range === 'string') return range;
      return { kind: 'compare', op, left, right: range };
    }
    const right = this.operand('right');
    if (typeof right === 'string') return right;
    return { kind: 'compare', op, left, right };
  }

  private rangeOperand(): RangeOperand | string {
    const lo = this.integer();
    if (lo === null) return '"in" needs a numeric range on the right';
    this.ws();
    if (!this.eat('..')) return '"in" needs a ".." range on the right';
    this.ws();
    const hi = this.integer();
    if (hi === null) return 'a range needs an upper bound';
    if (lo > hi) return 'inverted range';
    return { kind: 'range', min: lo, max: hi };
  }

  /** `side` decides how a bare word is read (03 §4.4: bare names are subject-side only). */
  private operand(side: 'left' | 'right'): Operand | string {
    this.ws();
    const q = this.quotedString();
    if (q !== null) {
      // Legacy spelling: under `bareNames` a QUOTED left side is still a
      // `status.data` key (`"lid" == "open"`), because the pre-existing grammar
      // stripped quotes on both sides. Reading it as a literal would silently
      // flip every such clause to false (03 §9.2 must preserve this verbatim).
      if (side === 'left' && this.profile.bareNames) return { kind: 'ref', path: `status.${q}` };
      return { kind: 'literal', value: q };
    }
    const n = this.integer();
    if (n !== null) return lit(n);
    const ref = this.dottedRef();
    if (ref !== null) {
      this.checkRefRoot(ref);
      return { kind: 'ref', path: ref };
    }
    const word = this.bareWord();
    if (word === null) return 'expected a reference or a value';
    // A profile with an anonymous subject (`expect`) compares THAT subject only:
    // `k == 1` is a typo, not `result == "k"`. Accepting it as a literal would
    // silently make the expectation unconditionally false.
    if (this.profile.implicitSubject !== null) {
      return 'the left-hand side must be a number, a range, or a comparison operator';
    }
    if (word === 'true') return { kind: 'literal', value: true };
    if (word === 'false') return { kind: 'literal', value: false };
    if (word === 'null' || word === '~') return { kind: 'literal', value: null };
    // Bare names are subject-side only: `lid == open` means `status.lid == "open"`,
    // NOT `status.lid == status.open`. Reading the right-hand side as a reference
    // would turn almost every `when` clause into `unresolved_ref` (03 §4.4).
    if (side === 'left' && this.profile.bareNames) return { kind: 'ref', path: `status.${word}` };
    return { kind: 'literal', value: word };
  }

  /** Validates an already-parsed reference against the profile's root whitelist. */
  private checkRefRoot(ref: string): void {
    // An empty whitelist means "no references at all" — that is how `expect`
    // keeps the anonymous subject and stays projectable back to `DiceAtom[][]`.
    if (this.profile.roots.length === 0) {
      throw new ParseAbort(
        `"${ref}" is not a reference here; this expression compares an anonymous result.`
      );
    }
    const root = ref.split('.')[0]!;
    if (!this.profile.roots.includes(root)) {
      throw new ParseAbort(
        `"${ref}" is not a readable reference here; allowed roots: ${this.profile.roots.join(', ')}`
      );
    }
  }

  private tryKeyword(word: string): boolean {
    const save = this.i;
    if (this.src.startsWith(word, this.i)) {
      const after = this.src[this.i + word.length];
      if (after === undefined || (!IDENT_PART.test(after) && after !== '.')) {
        this.i += word.length;
        return true;
      }
    }
    this.i = save;
    return false;
  }

  /** `a.b.c` — dotted identifier. Returns null without consuming on failure. */
  private dottedRef(): string | null {
    const save = this.i;
    const parts: string[] = [];
    const first = this.bareWord();
    if (first === null) {
      this.i = save;
      return null;
    }
    parts.push(first);
    while (this.src[this.i] === '.') {
      this.i++;
      const next = this.bareWord();
      if (next === null) {
        this.i = save;
        return null;
      }
      parts.push(next);
    }
    if (parts.length === 1) {
      // A single bare word is a literal, not a reference.
      this.i = save;
      return null;
    }
    return parts.join('.');
  }

  private bareWord(): string | null {
    const start = this.i;
    if (this.i >= this.src.length || !IDENT_START.test(this.src[this.i]!)) return null;
    this.i++;
    while (this.i < this.src.length && IDENT_PART.test(this.src[this.i]!)) this.i++;
    return this.src.slice(start, this.i);
  }

  private quotedString(): string | null {
    const quote = this.src[this.i];
    if (quote !== '"' && quote !== "'") return null;
    const end = this.src.indexOf(quote, this.i + 1);
    if (end === -1) return null;
    const body = this.src.slice(this.i + 1, end);
    this.i = end + 1;
    return body;
  }

  private operator(): ConditionOperator | null {
    // `in` is a word-operator, so it needs the identifier-boundary check that the
    // symbolic tokens get for free (otherwise `index` would lex as `in` + `dex`).
    if (this.tryKeyword('in')) return 'in';
    for (const token of OPERATOR_TOKENS) {
      if (!this.eat(token)) continue;
      return token === '=' ? '==' : token;
    }
    return null;
  }

  /** `[ "-" ] digit { digit }`, capped at 15 digits. Null without consuming. */
  private integer(): number | null {
    const start = this.i;
    if (this.src[this.i] === '-') this.i++;
    const digitsStart = this.i;
    while (this.i < this.src.length && this.src[this.i]! >= '0' && this.src[this.i]! <= '9') this.i++;
    const digits = this.src.slice(digitsStart, this.i);
    if (digits.length === 0 || digits.length > INT_DIGITS_MAX) {
      this.i = start;
      return null;
    }
    return Number(this.src.slice(start, this.i));
  }

  private ws(): void {
    while (this.src[this.i] === ' ' || this.src[this.i] === '\t') this.i++;
  }

  private eat(token: string): boolean {
    if (this.src.startsWith(token, this.i)) {
      this.i += token.length;
      return true;
    }
    return false;
  }
}

const NOT_AN_ATOM = '\u0000not-an-atom';

/** Internal control-flow signal so `checkRefRoot` can abort from a nested call. */
class ParseAbort {
  constructor(readonly message: string) {}
}

function lit(value: Scalar): Operand {
  return { kind: 'literal', value };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Parse entry points (03 §4.4)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Parse a condition under a profile. Pure, synchronous, zero I/O.
 *
 * Errors are plain strings — `01` owns positioning and splices them into a
 * `line N, column M` message (§4.5).
 */
export function parseCondition(src: string, profile: ConditionProfile): ParseResult<ConditionAst> {
  if (typeof src !== 'string' || src.trim() === '') {
    return { ok: false, error: 'the condition is empty' };
  }
  try {
    return new ConditionParser(src, profile).parse();
  } catch (err) {
    if (err instanceof ParseAbort) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * The thin wrapper `01` uses for `do[].when` (03 §4.5 seam 1).
 *
 * The signature is frozen at `(expr: string) => ParseResult<ConditionAst>`:
 * `02` and `01` both import it and MUST NOT declare their own.
 */
export function parseCommandWhen(expr: string): ParseResult<ConditionAst> {
  return parseCondition(expr, COMMAND_PROFILE);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Static analysis helpers (03 §4.3 / §6)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Every `has()` path in the AST, de-duplicated. Drives the ONE pre-resolution pass. */
export function collectHasPaths(ast: ConditionAst): string[] {
  const out = new Set<string>();
  for (const group of ast.anyOf) {
    for (const atom of group) {
      if (atom.kind === 'predicate' && atom.fn === 'has') out.add(atom.path);
    }
  }
  return [...out];
}

/**
 * Root names referenced by the AST (`status`, `roll`, `params`, …).
 *
 * `01` uses this for `unknown_param` / `hook_ref_mismatch` static checks (§4.5).
 * Predicate arguments count: an unresolvable `defined()` argument is still a
 * reference the author must have declared.
 */
export function collectRefs(ast: ConditionAst): string[] {
  const out = new Set<string>();
  const add = (path: string | undefined): void => {
    if (path === undefined) return;
    const root = path.split('.')[0];
    if (root !== undefined && root !== '') out.add(root);
  };
  for (const group of ast.anyOf) {
    for (const atom of group) {
      if (atom.kind === 'predicate') {
        add(atom.fn === 'has' ? undefined : atom.ref);
        continue;
      }
      if (atom.kind === 'range') {
        if (atom.subject.kind === 'ref') add(atom.subject.path);
        continue;
      }
      if (atom.left.kind === 'ref') add(atom.left.path);
      if (atom.right.kind === 'ref') add(atom.right.path);
    }
  }
  return [...out];
}

/* ────────────────────────────────────────────────────────────────────────────
 * 7. Evaluator (03 §2.4 / §3.3 — pure, synchronous, deterministic)
 * ──────────────────────────────────────────────────────────────────────────── */

export function evaluateCondition(ast: ConditionAst, scope: ConditionScope): ConditionResult {
  // OR: the first decidable `true` wins. A group that is decidably `false` is
  // remembered but not returned, because a later group may still succeed. Only
  // when EVERY group is false-or-undecidable does an error surface — that is
  // what keeps `undefined_ref || status.lid == "open"` from failing on a world
  // where the first alternative simply does not apply (03 §3.4).
  let undecided: ConditionEvalError | null = null;

  for (const group of ast.anyOf) {
    let groupTrue = true;
    for (const atom of group) {
      const r = evalAtom(atom, scope);
      if (typeof r !== 'boolean') {
        undecided ??= r;
        groupTrue = false;
        break;
      }
      if (!r) {
        groupTrue = false;
        break; // short-circuit — this is what makes `defined(x) && x == 1` work
      }
    }
    if (groupTrue) return { ok: true, value: true };
  }

  return undecided === null ? { ok: true, value: false } : { ok: false, error: undecided };
}

/** `true` / `false`, or a `ConditionEvalError` that must abort the evaluation. */
type AtomResult = boolean | ConditionEvalError;

function evalAtom(atom: ConditionAtom, scope: ConditionScope): AtomResult {
  if (atom.kind === 'predicate') {
    if (atom.fn === 'has') {
      const kind = scope.paths.get(atom.path);
      if (kind === undefined) {
        // Not pre-resolved: the caller forgot collectHasPaths. Fail loudly rather
        // than guess — a silent `false` would silently hide content.
        return {
          code: 'io_failed',
          message: `has("${atom.path}") was not pre-resolved; pass collectHasPaths(ast) into the scope.`,
        };
      }
      return kind !== 'missing';
    }
    // `defined()` / `missing()` are the ONLY atoms for which absence is a normal
    // input rather than an error — that is their entire purpose.
    const resolved = scope.values.get(atom.ref);
    if (resolved === undefined) return atom.fn === 'missing';
    return atom.fn === 'defined' ? normalizeScalar(resolved) !== null : normalizeScalar(resolved) === null;
  }

  if (atom.kind === 'range') {
    const v = operandValue(atom.subject, scope);
    if (isErr(v)) return v;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return {
        code: 'type_mismatch',
        ref: refText(atom.subject),
        message: `a numbered range needs a finite number; ${describe(atom.subject, v)} is not one.`,
      };
    }
    return v >= atom.min && v <= atom.max;
  }

  // compare
  const left = operandValue(atom.left, scope);
  if (isErr(left)) return left;

  if (atom.right.kind === 'range') {
    if (typeof left !== 'number' || !Number.isFinite(left)) {
      return {
        code: 'type_mismatch',
        ref: refText(atom.left),
        message: `"in" needs a finite number on the left; ${describe(atom.left, left)} is not one.`,
      };
    }
    return left >= atom.right.min && left <= atom.right.max;
  }

  const right = operandValue(atom.right, scope);
  if (isErr(right)) return right;

  switch (atom.op) {
    case '==':
      // Type mismatches are NOT errors here: `1 == "1"` is true by normalisation,
      // and anything still unequal is simply false (03 §2.4).
      return normalizeScalar(left) === normalizeScalar(right);
    case '!=':
      return normalizeScalar(left) !== normalizeScalar(right);
    default: {
      if (!isFiniteNumber(left) || !isFiniteNumber(right)) {
        return {
          code: 'type_mismatch',
          ref: refText(atom.left),
          message: `ordered comparison needs numbers; ${describe(
            isFiniteNumber(left) ? atom.right : atom.left,
            isFiniteNumber(left) ? right : left
          )} is not one.`,
        };
      }
      switch (atom.op) {
        case '>':
          return left > right;
        case '>=':
          return left >= right;
        case '<':
          return left < right;
        case '<=':
          return left <= right;
        case 'in':
          return false; // handled above; kept for exhaustiveness
        default:
          return false;
      }
    }
  }
}

function isErr(v: unknown): v is ConditionEvalError {
  return typeof v === 'object' && v !== null && 'code' in v && 'message' in v;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Resolve an `Operand` to a raw value. */
function operandValue(op: Operand, scope: ConditionScope): Scalar | ConditionEvalError {
  if (op.kind === 'literal') return op.value;
  if (op.kind === 'implicit') {
    const v = scope.values.get('result');
    return v === undefined ? null : v;
  }
  return resolveRef(op.path, scope);
}

function resolveRef(path: string, scope: ConditionScope): Scalar | ConditionEvalError {
  const v = scope.values.get(path);
  if (v === undefined) {
    return {
      code: 'unresolved_ref',
      ref: path,
      message: `"${path}" does not exist. Guard it with defined(${path}) if absence is normal.`,
    };
  }
  return v;
}

function refText(op: Operand): string | undefined {
  return op.kind === 'ref' ? op.path : undefined;
}

function describe(op: Operand, v: unknown): string {
  if (op.kind === 'ref') return `"${op.path}"`;
  return JSON.stringify(v) ?? String(v);
}


/* ────────────────────────────────────────────────────────────────────────────
 * 8. `evalWhen` — the legacy `status.data` predicate (03 §9.2)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The tiny pre-existing `status.data` grammar, kept verbatim.
 *
 * Hot path for choice visibility (`interactive.ts:263`). Sharing the general
 * parser here would widen the accepted set and shift option numbering (03 §2.5
 * candidate B) — so the behaviour is frozen and `parseCondition(when,
 * WHEN_PROFILE)` is the *new* entry point, not a replacement.
 */
/** Every full reference path in the AST (`['status.lid']`), de-duplicated. */
export function collectRefPaths(ast: ConditionAst): string[] {
  const out = new Set<string>();
  const take = (op: Operand): void => {
    if (op.kind === 'ref') out.add(op.path);
  };
  for (const group of ast.anyOf) {
    for (const atom of group) {
      if (atom.kind === 'predicate') {
        if (atom.fn !== 'has') out.add(atom.ref);
      } else if (atom.kind === 'range') {
        take(atom.subject);
      } else {
        take(atom.left);
        if (atom.right.kind !== 'range') take(atom.right);
      }
    }
  }
  return [...out];
}

/**
 * Build the scope for `when` evaluation.
 *
 * T17 requires that `WHEN_PROFILE` evaluation NEVER returns `Err`: a missing
 * `status.data` key is a normal world state ("this option is not available
 * yet"), not an authoring error. Pre-seeding every referenced path with `null`
 * is what turns absence into `Ok(false)` instead of `unresolved_ref` — the
 * inversion of the command path, where absence IS an error (03 §3.4/§9.2).
 */
export function conditionScopeOf(ast: ConditionAst, statusData: Record<string, unknown> | null): ConditionScope {
  const values = new Map<string, Scalar>();
  for (const path of collectRefPaths(ast)) {
    values.set(path, normalizeScalar(statusData ? statusData[path.slice('status.'.length)] : undefined));
  }
  return { values, paths: new Map() };
}

/**
 * Single-condition predicate (03 §3.5 / §9.2). Reads only this entity's own
 * `status.data`, through the SAME parser and evaluator as everything else.
 *
 * Behaviour is frozen: a malformed expression is always `false` (fail-closed),
 * and `Err` — unreachable under `WHEN_PROFILE`, which forbids every predicate
 * and `has()` — is mapped to `false` rather than thrown.
 */
export function evalWhen(when: string, statusData: Record<string, unknown> | null): boolean {
  const parsed = parseCondition(when, WHEN_PROFILE);
  if (!parsed.ok) return false; // malformed ⇒ fail-closed (doc-tools/06 §3.5)
  const result = evaluateCondition(parsed.value, conditionScopeOf(parsed.value, statusData));
  // WHEN_PROFILE admits no predicates and no has(), so `Err` is unreachable here.
  // If that profile is ever widened this line MUST be re-decided, not defaulted.
  return result.ok ? result.value : false;
}

