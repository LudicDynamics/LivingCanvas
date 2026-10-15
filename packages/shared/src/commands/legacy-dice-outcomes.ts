/**
 * Route C — the READ-TIME fallback for the legacy `dice_outcomes` table.
 *
 * Lands `the design notes` §10.3 / §10.4 / §10.5 item 2 / §12: the
 * migration's main path (route D) adds a 12-line `on.roll_resolved` block to the
 * live template cards, which is a `git`-visible change and can never reach a
 * player save (`worlds/` is untracked) or the frozen archive. This module is the
 * only thing that covers those two, and it does it without touching a single
 * file: it synthesizes the same `on` block from the table the entity already
 * carries.
 *
 * PURE and synchronous: no I/O, no clock. The caller has already parsed the
 * frontmatter and knows the entity's path; this module only decides.
 *
 * ── The sugar's ceiling, written down (08 §10.3 代价 ②) ──────────────────────
 * The legacy shorthand MUST NOT grow into a second schema, so it accepts ONLY
 * the exact shape the six worlds ship (§2.3's measured "completely uniform" 36
 * files: 4 bands, keys exactly {min,max,text,options,rewards}, 2 options, 1
 * reward, the canonical partition for the declared dice type). Anything else is
 * refused with `legacy_dice_outcomes_unexpandable` rather than silently
 * truncated — refusal is what keeps the ceiling from drifting upward.
 *
 * ── What this module does NOT synthesize, and why ────────────────────────────
 * `08 §4.1`'s sample writes the band's `options` back into the entity as
 * `choice` + `choice_actions`. Two independent blockers are on disk today, so
 * the expansion omits that write-back and says so here instead of emitting an
 * effect that cannot run:
 *   - `edit` has no `choice` argument (`WORLD_COMMAND_EFFECT_ARGS.edit.names`,
 *     `packages/shared/src/commands/effects.ts:157`) — the sample's third `edit`
 *     arg is rejected at parse time with `unknown_arg`;
 *   - the fold that would build it (`options[]` → `{choice, choice_actions}`)
 *     is `fold-args`, which no effect implements yet, and `08 §13.2`'s B-1 shows
 *     it clashes with the entities' own static `choice_actions.back` on 144/144
 *     bands anyway.
 *
 * The two effects that ARE expressible (`give` the band's reward note, `edit`
 * the grade and append the band's short text) land exactly as the team's
 * `runDeclaredRoll` did — 3 events per trigger, matching `08 §13.2` M-9.
 */
import type { OnBinding } from './bindings.js';
import { parseWorldCommand } from './world-command.js';
import type { WorldCommandSpec } from './world-command.js';

/* ────────────────────────────────────────────────────────────────────────────
 * 1. The shared command (`08 §4.1` command side, made executable)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Derived from the filename (`01 §2.1`), so it must equal the file's basename. */
export const INVESTIGATION_OUTCOME_COMMAND_ID = 'investigation-outcome';

/**
 * The ONE command every expanded card binds to (`08 §4.2`: 1 file per world).
 *
 * Deviates from `08 §4.1`'s verbatim sample in five ways, each forced by code
 * that is already frozen on disk — a sample that does not parse executes
 * nothing, so copying it verbatim would ship the exact silent failure this
 * module exists to remove:
 *
 *  1. `frontmatter: { dice_grade: "{{ params.grade }}" }` — `{{ grade }}` is
 *     ACCEPTED at write time (`checkRef` returns early for a name that is a
 *     declared parameter, `world-command.ts:903`) but is UNREADABLE at run time:
 *     the evaluator's variable map is keyed `params.<name>` only
 *     (`execute.ts:528-533`), so `{{ grade }}` fails every trigger with
 *     `"grade" is not a readable reference here.` Reported as a code/doc split.
 *  2. `append_body` is a sibling of `frontmatter`, not a key inside it
 *     (`04 §3.5`, `effects.ts:157`).
 *  3. Three scalar refs (`reward_path` / `reward_title` / `reward_body`) instead
 *     of `rewards: "{{ trigger.entry.rewards }}"`. The whole-array form needs
 *     `list-args` over maps, and `readPath` only ever returns a scalar or a
 *     SCALAR array (`trigger.ts:485-496`) — an array of mappings resolves to
 *     `undefined`, so the bucket form fails on every band (measured).
 *  4. No `choice` fold — see the module header.
 *  5. The reward note is stamped with `dice_reward` (`08 §14 冲突 8`). This is
 *     the projection that makes stage 3 (`08 §D.1` step 3, wiring this expansion
 *     into the trigger path) POSSIBLE AT ALL: `runDeclaredRoll`'s reward loop
 *     reads `dice_reward.source` / `.result` off a reward file that already
 *     exists and fails with `invalid_argument: "A different item occupies the
 *     reward path"` when it is absent (`declared-actions.ts:461-464`). Measured
 *     A/B: with this key the wiring lands (`outcomeGrade = 'success'`), without
 *     it every `/api/dice` call 400s — which is exactly the C19 regression. The
 *     value is built from three scalars the evaluator already exposes
 *     (`trigger.path`, `roll.result`, `params.grade`), so no effect, no arg
 *     form and no frozen type changes.
 *     NOT here: `choice` + `choice_actions` (`collect-reward-N`), which IS a
 *     player-visible regression while absent. It is blocked by the frozen
 *     `InterpolatedValue = Scalar | Scalar[]` (`limits.ts:129`) because
 *     `{{ trigger.entry.options }}` is an array of MAPPINGS — it needs a design
 *     gate, not a smaller edit (`08 §14 冲突 8`).
 *
 * Every band in the stock 36 files has exactly one reward, so (3) loses
 * nothing today; the expansion REFUSES a band with a second reward rather than
 * dropping it (the `08 §4.5` 缺口 3 failure shape).
 *
 * `08 §4.1`'s binding also carries `band: 0`, and this expansion does NOT.
 * `02 §15.1` — the `on` shape's owner — drops it too: the binding's INDEX
 * already selects the row (`02 §R.19`), so a second selector would be a second
 * source of truth for "which band is this". Declaring it and never reading it
 * would also make `01`'s write-time `unused_param` warning fire on every parse
 * of this command for no benefit. Reported as a `08`-vs-`02` conflict.
 */
export const INVESTIGATION_OUTCOME_COMMAND_YAML = [
  'name: Investigation outcome',
  'desc: Materialise the matched dice_outcomes band and record its outcome on the source card.',
  'params:',
  '  grade: { type: string }',
  '  reward_path: { type: string }',
  '  reward_title: { type: string }',
  '  reward_body: { type: string }',
  '  outcome_text: { type: string }',
  'do:',
  '  - action: give',
  '    with:',
  '      path: "{{ params.reward_path }}"',
  '      title: "{{ params.reward_title }}"',
  '      body: "{{ params.reward_body }}"',
  '      frontmatter:',
  '        type: note',
  '        portable: true',
  '        dice_reward:',
  '          source: "{{ trigger.path }}"',
  '          result: "{{ roll.result }}"',
  '          grade: "{{ params.grade }}"',
  '  - action: edit',
  '    with:',
  '      path: "{{ trigger.path }}"',
  '      frontmatter: { dice_grade: "{{ params.grade }}" }',
  '  - action: edit',
  '    with:',
  '      path: "{{ trigger.path }}"',
  '      append_body: "{{ params.outcome_text }}"',
  '',
].join('\n');

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Shapes (`08 §13.1`'s frozen signature)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The `on` mapping (`02 §2.4`). `02` names this shape but never declares a type
 * for it in code — `bindings.ts:183` exports `OnBinding` alone, so the block is
 * typed here as the only hook this fallback can produce.
 */
export interface OnBlock {
  roll_resolved: OnBinding[];
}

/**
 * The migration error codes (`08 §11.3`). NOT members of
 * `WorldCommandErrorCode` (`world-command.ts:113`): that union is `01`'s closed
 * set of 46 command-FILE diagnostics, and §11.3 puts these on the expansion's
 * own error set.
 */
export const LEGACY_DICE_OUTCOMES_CODES = Object.freeze([
  'legacy_dice_outcomes_unexpandable',
  'legacy_and_modern_conflict',
  'legacy_band_mismatch',
] as const);
export type LegacyDiceOutcomeErrorCode = (typeof LEGACY_DICE_OUTCOMES_CODES)[number];

/** One refusal. `path` is the entity path, so the message reads as a location. */
export interface WorldCommandError {
  code: LegacyDiceOutcomeErrorCode;
  message: string;
  path: string;
}

export type DiceOutcomeExpansion =
  | { on: OnBlock; commands: WorldCommandSpec[] }
  | { errors: WorldCommandError[] };

/**
 * The routing verdict (`08 §10.5` item 2: an entity with `on.roll_resolved`
 * goes through D, one without is expanded). `modern` carries NO synthesized
 * bindings on purpose: an entity that declares `on.roll_resolved` is
 * authoritative, and handing the caller an empty block instead would suppress
 * the block that is supposed to run.
 */
export type DiceOutcomeResolution =
  | { kind: 'modern' }
  | { kind: 'legacy'; on: OnBlock; commands: WorldCommandSpec[] }
  | { errors: WorldCommandError[] };

/* ────────────────────────────────────────────────────────────────────────────
 * 3. The two entry points
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Expand a legacy `dice_outcomes` table into the modern `on` block plus the
 * shared command spec.
 *
 * Returns `{ errors }` — never throws — for any table outside the sugar's
 * ceiling. The caller MUST treat a non-empty `errors` as "no consequence runs",
 * never as "expand what you can": a half-expanded table would award a subset of
 * the bands and look healthy (`08 §3.1`, hard gate 4).
 */
export function expandDiceOutcomes(
  frontmatter: Record<string, unknown>,
  entityPath: string
): DiceOutcomeExpansion {
  const table = readLegacyTable(frontmatter, entityPath);
  if ('errors' in table) return table;

  const parsed = parseWorldCommand(INVESTIGATION_OUTCOME_COMMAND_ID, INVESTIGATION_OUTCOME_COMMAND_YAML);
  if (!parsed.ok) {
    // Unreachable by construction (the constant above is parsed by `01`'s own
    // validators in the test suite); kept as a refusal rather than a throw so a
    // future edit to the constant cannot turn the fallback into an exception.
    return {
      errors: [
        {
          code: 'legacy_dice_outcomes_unexpandable',
          path: entityPath,
          message:
            `${entityPath}: the shared "${INVESTIGATION_OUTCOME_COMMAND_ID}" command failed its own schema check, ` +
            `so the legacy table cannot be expanded into a runnable declaration.`,
        },
      ],
    };
  }

  const grades = gradesFor(table.dice, table.bands.length);
  return {
    on: {
      roll_resolved: table.bands.map((band, index) => legacyBinding(band, grades[index] as string)),
    },
    commands: [parsed.command],
  };
}

/**
 * The router `08 §10.5` describes, in one total function.
 *
 * `expandDiceOutcomes` alone cannot express the routing rule, because "both
 * present" is an ERROR while "modern only" is not — a caller that switched on
 * `on.roll_resolved` before calling the expansion would never see the conflict
 * `08 §13.2` M-3 requires, and a caller that always expanded would never run a
 * migrated card's own block.
 *
 * `legacy_band_mismatch` (`08 §11.3`) is deliberately NOT produced here. It
 * checks that a handwritten `on`'s `when` ranges cover the table's bands, but
 * the conflict arm fires whenever both are present, so the check would be
 * unreachable; `08 §16.2` assigns that invariant to `01`'s write-time
 * validators, where it can stop a bad file from being saved.
 */
export function resolveDiceOutcomes(
  frontmatter: Record<string, unknown>,
  entityPath: string
): DiceOutcomeResolution {
  const modern = declaredModernBindings(frontmatter);
  const hasLegacy = Array.isArray(frontmatter['dice_outcomes']);
  if (modern !== null && hasLegacy) {
    return {
      errors: [
        {
          code: 'legacy_and_modern_conflict',
          path: entityPath,
          message:
            `${entityPath} declares both "dice_outcomes" and an "on.roll_resolved" block. ` +
            `An on.roll_resolved block supersedes the legacy table, so the table would never run. ` +
            `Delete "dice_outcomes" — or delete "on.roll_resolved" to fall back to it.`,
        },
      ],
    };
  }
  if (modern !== null) return { kind: 'modern' };
  if (!hasLegacy) return { kind: 'modern' };
  const expanded = expandDiceOutcomes(frontmatter, entityPath);
  if ('errors' in expanded) return expanded;
  return { kind: 'legacy', on: expanded.on, commands: expanded.commands };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. The legacy table's shape and ceiling
 * ──────────────────────────────────────────────────────────────────────────── */

/** `08 §2.2` A/D vs E/F: the live worlds roll `1d100 ≤60`, the archive `2d10 ≥11`. */
type DiceFlavour = 'percentile' | 'standard';

interface LegacyBand {
  min: number;
  max: number;
  text: string;
  rewards: ReadonlyArray<{ path: string; title: string; body: string }>;
}

interface LegacyTable {
  dice: DiceFlavour;
  bands: LegacyBand[];
}

/**
 * The two canonical partitions. Measured on all 36 template files: every card
 * is one of these, in this order, with no exceptions (`08 §2.3`). A card whose
 * bands do not match its dice flavour's partition is refused — an overlap would
 * be silently swallowed at run time (`08 §16.2`).
 */
const PARTITIONS: Readonly<Record<DiceFlavour, ReadonlyArray<readonly [number, number]>>> = Object.freeze({
  percentile: Object.freeze([
    [1, 12],
    [13, 60],
    [61, 95],
    [96, 100],
  ] as const),
  standard: Object.freeze([
    [2, 4],
    [5, 10],
    [11, 17],
    [18, 20],
  ] as const),
});

/**
 * The grade label per band, derived the SAME way the team derived it
 * (`declared-actions.ts:179`) so the migration changes no player-visible text
 * and no grading:
 *   - `1d100 ≤60`: band ORDER is the grade order (low roll = best);
 *   - `2d10 ≥11`: the order inverts (low roll = worst), which is why the label
 *     cannot come from the band index alone.
 * This is the ONE place `08 §9.2`'s "the engine must not know whether low is
 * good or bad" is still spelled out, because the legacy table never said it —
 * the modern form carries `grade` as a literal per band instead.
 */
function gradesFor(dice: DiceFlavour, count: number): string[] {
  const ladder =
    dice === 'percentile'
      ? ['great-success', 'success', 'setback', 'failure']
      : ['failure', 'setback', 'success', 'great-success'];
  // The partition check already pinned `count` to 4; the fallback keeps this
  // total for a hand-built frontmatter passed straight to `readLegacyTable`.
  return Array.from({ length: count }, (_unused, index) => ladder[index] ?? `band-${index}`);
}

/**
 * Read and validate the legacy table.
 *
 * Every refusal names the exact band and key, so the repairing agent does not
 * have to guess which of 36 cards it is looking at — `08 §11.3`'s copy is the
 * template and the failing detail is spliced into it.
 */
function readLegacyTable(
  frontmatter: Record<string, unknown>,
  entityPath: string
): LegacyTable | { errors: WorldCommandError[] } {
  const refuse = (detail: string): { errors: WorldCommandError[] } => ({
    errors: [
      {
        code: 'legacy_dice_outcomes_unexpandable',
        path: entityPath,
        message:
          `${entityPath}: ${detail} The legacy shorthand only supports the exact shape shipped in the six worlds ` +
          `(min, max, text, options, rewards × 4 bands). Rewrite this chalk with "on: roll_resolved: …" instead — ` +
          `the new syntax has no such restriction.`,
      },
    ],
  });

  const raw = frontmatter['dice_outcomes'];
  if (raw === undefined) return refuse(`there is no "dice_outcomes" key to expand.`);
  if (!Array.isArray(raw)) {
    return refuse(`"dice_outcomes" must be a list of bands, got ${Array.isArray(raw) ? 'a list' : typeof raw}.`);
  }

  const dice = diceFlavourOf(frontmatter);
  if (dice === null) {
    return refuse(
      `"roll_dice" is neither "1d100" with "expect: <=60" nor "2d10" with "expect: >=11", so the legacy table's ` +
        `bands cannot be matched against a dice range.`
    );
  }
  const partition = PARTITIONS[dice];
  if (raw.length !== partition.length) {
    return refuse(`"dice_outcomes" has ${raw.length} bands; the legacy shorthand declares exactly ${partition.length}.`);
  }

  const bands: LegacyBand[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry: unknown = raw[index];
    if (!isPlainObject(entry)) {
      return refuse(`dice_outcomes band ${index} is ${Array.isArray(entry) ? 'a list' : typeof entry}, not a mapping.`);
    }
    for (const key of ['min', 'max', 'text', 'options', 'rewards']) {
      if (!(key in entry)) return refuse(`dice_outcomes band ${index} has no "${key}" key.`);
    }
    for (const key of Object.keys(entry)) {
      if (!['min', 'max', 'text', 'options', 'rewards'].includes(key)) {
        return refuse(`dice_outcomes band ${index} has an extra "${key}" key.`);
      }
    }

    const min: unknown = entry['min'];
    const max: unknown = entry['max'];
    const text: unknown = entry['text'];
    const options: unknown = entry['options'];
    const rewards: unknown = entry['rewards'];
    if (typeof min !== 'number' || typeof max !== 'number' || !Number.isInteger(min) || !Number.isInteger(max)) {
      return refuse(`dice_outcomes band ${index}: "min" and "max" must be integers.`);
    }
    const expected = partition[index] as readonly [number, number];
    if (min !== expected[0] || max !== expected[1]) {
      return refuse(
        `dice_outcomes band ${index} covers ${min}..${max}, but this dice flavour partitions as ` +
          `${expected[0]}..${expected[1]}.`
      );
    }
    if (typeof text !== 'string' || text.length === 0) {
      return refuse(`dice_outcomes band ${index}: "text" must be a non-empty string.`);
    }
    if (!Array.isArray(options) || options.length !== 2) {
      return refuse(`dice_outcomes band ${index}: "options" must be a list of exactly 2 options.`);
    }
    if (!Array.isArray(rewards) || rewards.length === 0) {
      return refuse(`dice_outcomes band ${index} has no "rewards" key with at least one entry.`);
    }
    if (rewards.length > 1) {
      // The expansion emits one `give` per band (`give`'s scalar `path` form), so
      // a second reward would be silently dropped — exactly the failure `08 §4.5`
      // 缺口 3 exists to prevent. Refuse rather than lose it.
      return refuse(
        `dice_outcomes band ${index} declares ${rewards.length} rewards; the expanded command carries exactly one ` +
          `(the "give" effect takes a single "path").`
      );
    }

    const reward: unknown = rewards[0];
    if (!isPlainObject(reward)) {
      return refuse(`dice_outcomes band ${index}: rewards[0] is ${Array.isArray(reward) ? 'a list' : typeof reward}.`);
    }
    for (const key of ['path', 'title', 'body']) {
      if (typeof reward[key] !== 'string' || (reward[key] as string).length === 0) {
        return refuse(`dice_outcomes band ${index}: rewards[0].${key} must be a non-empty string.`);
      }
    }

    bands.push({
      min,
      max,
      text,
      rewards: [
        { path: reward['path'] as string, title: reward['title'] as string, body: reward['body'] as string },
      ],
    });
  }

  return { dice, bands };
}

/**
 * The flavour of the card's own dice declaration.
 *
 * `expect` is compared as a whitespace-stripped string because the frontmatter
 * writes it two ways in the same batch (`expect: <=60` unquoted on the 1d100
 * cards, `expect: ">=11"` quoted on the 2d10 ones).
 */
function diceFlavourOf(frontmatter: Record<string, unknown>): DiceFlavour | null {
  const roll = frontmatter['roll_dice'];
  if (!isPlainObject(roll)) return null;
  const expect =
    typeof roll['expect'] === 'number'
      ? `<=${roll['expect']}`
      : typeof roll['expect'] === 'string'
        ? roll['expect'].replace(/\s+/g, '')
        : null;
  if (roll['type'] === '1d100' && expect === '<=60') return 'percentile';
  if (roll['type'] === '2d10' && expect === '>=11') return 'standard';
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Emitting the modern declaration
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One band as a modern binding (`02 §2.4`).
 *
 * `from: dice_outcomes` is what makes the command generic: it names the array
 * this binding selects from, and binding `i` takes entry `i` by INDEX
 * (`02 §R.19`) — `when` decides whether the binding runs, `from` decides which
 * row it reads. The `when` spelling is `roll.result in a..b`, NOT the bare
 * `a..b` of `08 §4.1`: the command profile has no implicit subject
 * (`condition.ts:143`), so a bare range is `malformed when ... expected an
 * operator` (measured). `03 §8.2` uses the explicit spelling too.
 */
function legacyBinding(band: LegacyBand, grade: string): OnBinding {
  return {
    when: `roll.result in ${band.min}..${band.max}`,
    run: INVESTIGATION_OUTCOME_COMMAND_ID,
    from: 'dice_outcomes',
    with: {
      grade,
      // No `band` index is carried. `02 §15.1` — the `on` shape's owner — omits
      // it too: the binding's POSITION already selects the row (`02 §R.19`), so
      // a second selector would be a second source of truth for "which band is
      // this", and every effect would ignore it anyway.
      reward_path: '{{ trigger.entry.rewards[0].path }}',
      reward_title: '{{ trigger.entry.rewards[0].title }}',
      reward_body: '{{ trigger.entry.rewards[0].body }}',
      outcome_text: '{{ trigger.entry.text }}',
    },
    onError: 'stop',
  };
}

/**
 * The `on.roll_resolved` block an entity already declares, or `null`.
 *
 * Only the group's PRESENCE matters here: a malformed modern block still counts
 * as declared, so the routing decision does not flip back to the legacy table
 * just because the modern block has a typo. Fail-closed on the CONTENT is the
 * write gate's job (`07`) and `02`'s `parseOnBindings`, not the router's.
 */
function declaredModernBindings(frontmatter: Record<string, unknown>): OnBinding[] | null {
  const raw = frontmatter['on'];
  if (!isPlainObject(raw)) return null;
  const group = raw['roll_resolved'];
  if (group === undefined || group === null) return null;
  return Array.isArray(group) ? (group as OnBinding[]) : null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Small helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/** A YAML mapping (not an array, not `null`). Narrows, so callers index safely. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
