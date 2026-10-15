/**
 * world-command.ts — the FRONT-END view of a world command receipt
 *.
 *
 * NOT the wire type. The element of `ActionResult.details.commands` is owned by
 * the trigger layer (`CommandOutcome`, packages/shared/src/commands/bindings.ts)
 * and by `04` (`WorldCommandReceipt`, packages/shared/src/commands/effects.ts).
 * The shape that actually arrives today is the TRIGGER outcome:
 *
 *   { command, hook, source, binding, status: 'ok'|'skipped'|'error',
 *     code?, skipped?, message?, effects?,            // present when status === 'ok'
 *     settleReport?: { ran, reused, resumed, failed? } }
 *
 * `06` projects THAT into what a player can read. The documented shape (§2.1) and
 * the landed one differ; where they do, the code wins:
 *   - the id is `command`, there is no `id`/`name`;
 *   - the matched slot is `binding`, not `entryIndex`;
 *   - `text`, `params`, `reveal` and `reusedEventId` do not exist on the wire.
 * Everything absent degrades; nothing here throws.
 *
 * Two rules from the doc that this file exists to enforce:
 *   1. The ceremony line reads the WIRE code; the card's `command_error` reads
 *      `ActionErrorCode`. Two name spaces, never translated into one another.
 *   2. `command_error.message` (raw `ActionError.message`, which may contain line
 *      numbers and parser vocabulary) MUST NEVER reach a player string.
 */
import { parseDiceType } from '@airp/shared/dice';

export const WORLD_COMMAND_STATUSES = [
  'applied',
  'reused',
  'resumed',
  'skipped',
  'blocked',
  'failed',
] as const;
export type WorldCommandStatus = (typeof WORLD_COMMAND_STATUSES)[number];

/** One executed step, flattened exactly like `05`'s resume cursor (06 §2.1). */
export interface WorldCommandStepOutcome {
  step: number;
  /** Declaration site, `do[<index>]#<n>`. Tracing only. */
  decl?: string;
  action: string;
  targets: string[];
  ok: boolean;
  /** `link` records no event, so this is absent for that step — NOT a failure. */
  eventIds?: string[];
  error?: { code: string; detail?: string };
}

/** `06`'s player-facing projection of one wire receipt. */
export interface WorldCommandReceiptView {
  /** `on.<hook>[].run` — an ASCII id, never translated (06 §12.2 item 5). */
  id: string;
  status: WorldCommandStatus;
  /** `05`'s verb. `resumed` and `applied` share a player sentence but not a verb. */
  settle: 'ran' | 'reused' | 'resumed' | 'failed';
  /** The English player sentence (an i18n key, per i18n.ts). */
  text: string;
  /** The wire code, when one was reported. Machine-side only. */
  code?: string;
  /** `binding` on the wire: the matched `on.<hook>[i]` slot, opaque to the UI. */
  entryIndex?: number;
  steps: WorldCommandStepOutcome[];
  /**
   * Paths this receipt expects revealed after the ceremony. The landed server does
   * not emit it yet (06 §2.1), so this is `[]` in practice — the gate holds the
   * whole-layer refetch, not a per-path set.
   */
  reveal: string[];
  /** World paths the steps name, in step order. */
  targets: string[];
  /** `failed` only: the step index the run broke at. */
  appliedBeforeFailure?: number;
}
export type WorldCommandReceiptViews = WorldCommandReceiptView[];

/**
 * Shorthands for the two conventions every optional wire field shares: an empty
 * string means "absent" (never a player-visible blank), and a non-finite number
 * is not a number. They exist as functions because dozens of call sites must
 * agree on both rules — inlining them is how the two drift apart.
 */
function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/* ── wire code → UI status (06 §7.1) ────────────────────────────────────── */

/**
 * Effect-layer refusals that mean "the world said no" rather than "the command
 * broke": a missing target, no permission, a limit. Read off
 * `settleReport.failed.code`, which is an `ActionErrorCode`.
 */
const BLOCKED_EFFECT_CODES: Record<string, true> = {
  not_found: true, invalid_path: true, forbidden: true, permission_denied: true,
  unauthorized: true, not_allowed: true, conflict: true, stale: true,
  not_movable: true, no_free_seat: true, already_exists: true,
};

/** Wire codes naming a refusal by world state rather than a broken rule. */
const BLOCKED_WIRE_CODES: Record<string, true> = {
  limit_exceeded: true, command_limit_exceeded: true, command_target_missing: true,
  command_not_allowed: true, command_resume_drifted: true,
};

/** Wire codes naming a broken RULE that therefore never ran (06 §7.1 ③). */
const SKIPPED_WIRE_CODES: Record<string, true> = {
  command_not_found: true, command_malformed: true, command_invalid: true,
  on_malformed: true, param_invalid: true, when_malformed: true,
  facts_unavailable: true, on_from_missing_key: true, on_from_not_a_list: true,
  on_from_empty_list: true, on_entry_unavailable: true, on_entry_not_bound: true,
  choice_actions_conflict: true,
};

/** Wire codes naming a run that changed the world but could not finish. */
const FAILED_WIRE_CODES: Record<string, true> = {
  effect_failed: true, command_effect_failed: true, command_write_failed: true,
};

function statusFromWireError(code: string | undefined, effectCode: string | undefined): WorldCommandStatus {
  if (code === 'command_reused') return 'reused';
  if (effectCode !== undefined && BLOCKED_EFFECT_CODES[effectCode] === true) return 'blocked';
  if (code !== undefined) {
    if (BLOCKED_WIRE_CODES[code] === true) return 'blocked';
    if (SKIPPED_WIRE_CODES[code] === true) return 'skipped';
    if (FAILED_WIRE_CODES[code] === true) return 'failed';
  }
  // An unrecognised refusal is still a refusal: showing it beats hiding it.
  return 'failed';
}

/* ── steps ──────────────────────────────────────────────────────────────── */

function projectSteps(raw: unknown): WorldCommandStepOutcome[] {
  if (!Array.isArray(raw)) return [];
  const out: WorldCommandStepOutcome[] = [];
  for (const item of raw) {
    const effect = record(item);
    if (effect === null) continue;
    const step = numberOf(effect.step);
    if (step === undefined) continue;
    const settle = stringOf(effect.settle);
    const seq = numberOf(effect.seq);
    const path = stringOf(effect.path);
    const decl = stringOf(effect.at);
    const error = record(effect.error);
    const errorCode = stringOf(error?.code);
    const errorDetail = stringOf(error?.message);
    out.push({
      step,
      ...(decl === undefined ? {} : { decl }),
      action: stringOf(effect.action) ?? 'step',
      targets: path === undefined ? [] : [path],
      // `settle: 'failed'` is the only failure signal that does not lie: a null
      // `seq` on a reused effect is explicitly NOT a failure (execute.ts).
      ok: settle !== 'failed' && errorCode === undefined,
      ...(seq === undefined ? {} : { eventIds: [`evt-${seq}`] }),
      ...(errorCode === undefined
        ? {}
        : { error: { code: errorCode, ...(errorDetail === undefined ? {} : { detail: errorDetail }) } }),
    });
  }
  return out;
}

function firstOf(list: unknown): Record<string, unknown> | null {
  return Array.isArray(list) ? record(list[0]) : null;
}

/* ── the projection ─────────────────────────────────────────────────────── */

/** i18n keys (en strings) for each terminal status. */
function textKeyOf(status: WorldCommandStatus, hasReveal: boolean): string {
  switch (status) {
    case 'applied':
    case 'resumed':
      return hasReveal
        ? 'The outcome of your check is on the table.'
        : 'The outcome of your check is written into the world.';
    case 'reused':
      return 'This check was already resolved. The result stands — nothing was given twice.';
    case 'skipped':
      return 'The world is missing a rule this check refers to. Your check still counts — the story goes on.';
    case 'blocked':
      return 'The automatic outcome did not run — nothing was taken from you.';
    case 'failed':
      return 'Only part of the automatic outcome could be written. The part that was written stays.';
  }
}

/**
 * Lenient guard + projection of `details.commands` (06 §2.3): malformed entries
 * never throw and never hide a receipt that carries an id.
 */
export function parseCommandReceipts(raw: unknown): WorldCommandReceiptViews {
  if (!Array.isArray(raw)) return [];
  const views: WorldCommandReceiptViews = [];
  for (const item of raw) {
    const receipt = record(item);
    if (receipt === null) continue;
    const id = stringOf(receipt.command);
    // No identity ⇒ nothing a player could be shown; drop rather than invent one.
    if (id === undefined) continue;

    const report = record(receipt.settleReport);
    const failed = record(report?.failed);
    const resumed = firstOf(report?.resumed) !== null;
    const effectCode = stringOf(failed?.code);
    const wireCode = stringOf(receipt.code);

    const wireStatus = stringOf(receipt.status);
    let status: WorldCommandStatus;
    if (wireStatus === 'ok') status = resumed ? 'resumed' : 'applied';
    else if (wireStatus === 'skipped') {
      // `already_done` is "the result already stands", not "nothing happened".
      status = stringOf(receipt.skipped) === 'already_done' ? 'reused' : 'skipped';
    } else status = statusFromWireError(wireCode, effectCode);

    const settle: WorldCommandReceiptView['settle'] =
      status === 'reused' ? 'reused'
        : status === 'resumed' ? 'resumed'
          : status === 'failed' ? 'failed'
            : 'ran';

    const steps = projectSteps(Array.isArray(receipt.effects) ? receipt.effects : firstOf(report?.ran)?.effects);
    const reveal = Array.isArray(receipt.reveal)
      ? receipt.reveal.filter((p): p is string => typeof p === 'string' && p !== '')
      : [];
    const entryIndex = numberOf(receipt.binding) ?? numberOf(receipt.entryIndex);
    const failedStep = numberOf(failed?.step);

    views.push({
      id,
      status,
      settle,
      text: textKeyOf(status, reveal.length > 0),
      ...(wireCode === undefined ? {} : { code: wireCode }),
      ...(entryIndex === undefined ? {} : { entryIndex }),
      steps,
      reveal,
      targets: steps.flatMap((s) => s.targets),
      ...(status === 'failed' && failedStep !== undefined ? { appliedBeforeFailure: failedStep } : {}),
    });
  }
  return views;
}

/* ── one line, for the ceremony (06 §7.4) ───────────────────────────────── */

/**
 * Aggregated player line. `null` when nothing was declared — the world promised
 * no consequence, so the UI owes none (06 §7.0's total rule).
 */
export function receiptLine(
  receipts: WorldCommandReceiptViews,
  t: (key: string, values?: Record<string, string | number>) => string,
): { tone: 'ok' | 'notice' | 'warning'; text: string; detail?: string } | null {
  if (receipts.length === 0) return null;

  const landed = receipts.filter((r) => r.status === 'applied' || r.status === 'resumed');
  if (landed.length > 1) {
    return { tone: 'ok', text: t('{count} outcomes were written into the world.', { count: landed.length }) };
  }
  if (landed.length === 1) {
    const first = landed[0]!;
    return {
      tone: 'ok',
      text: t(first.text),
      ...(first.code === undefined ? {} : { detail: first.code }),
    };
  }

  if (receipts.every((r) => r.status === 'reused')) {
    const first = receipts[0]!;
    return { tone: 'notice', text: t(first.text), ...(first.code === undefined ? {} : { detail: first.code }) };
  }

  // Most severe wins: failed > blocked > skipped (06 §7.4's aggregation rule).
  const rank: Record<WorldCommandStatus, number> = {
    failed: 3, blocked: 2, skipped: 1, reused: 0, applied: 0, resumed: 0,
  };
  const worst = [...receipts].sort((a, b) => rank[b.status] - rank[a.status])[0]!;
  // The wire carries no `target` field yet (06 §11.7), so the only honest source
  // is the failed step's own path. No path ⇒ the unnamed sentence; it MUST NOT
  // fall back to parsing `message`.
  const target = worst.steps.find((s) => !s.ok)?.targets[0];
  const text = worst.status === 'blocked' && target !== undefined
    ? t('Missing: {target}. The automatic outcome did not run — nothing was taken from you.', { target })
    : t(worst.text);
  return {
    tone: worst.status === 'failed' ? 'warning' : 'notice',
    text,
    ...(worst.code === undefined ? {} : { detail: worst.code }),
  };
}

/**
 * Payload fingerprint, so a caller can tell "this is the same outcome I already
 * showed" without re-deriving it. `status` participates because it is exactly
 * what the player is shown.
 */
export function receiptsFingerprint(receipts: WorldCommandReceiptViews): string {
  const payload = receipts
    .map((r) => `${r.id}|${r.status}|${r.settle}|${r.code ?? ''}|${r.steps.length}|${r.reveal.join(',')}`)
    .join('\n');
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/* ── the card's persistent receipt (06 §2.2 / §7.5) ─────────────────────── */

/**
 * `command_error` — a SINGULAR mapping written by `05`. Every field is read
 * defensively; `message` is deliberately NOT projected, because that is the one
 * path that leaks `line 7, column 3: unknown top-level key "rewardz"` to a player.
 */
export interface CommandErrorView {
  command: string;
  hook?: string;
  step?: number;
  action?: string;
  /** `ActionErrorCode`, untranslated. Model/debug only — never a player string. */
  code?: string;
  /** A world path, when the record carries one. The only label a player may see. */
  target?: string;
  /** `> 0` means the world is incomplete. Non-integer degrades to "incomplete". */
  pending?: number;
  at?: string;
}

export function parseCommandError(raw: unknown): CommandErrorView | null {
  const value = record(raw);
  if (value === null) return null;
  const command = stringOf(value.command);
  if (command === undefined) return null;
  const hook = stringOf(value.hook);
  const step = numberOf(value.step);
  const action = stringOf(value.action);
  const code = stringOf(value.code);
  const target = stringOf(value.target);
  const pending = numberOf(value.pending);
  const at = stringOf(value.at);
  return {
    command,
    ...(hook === undefined ? {} : { hook }),
    ...(step === undefined ? {} : { step }),
    ...(action === undefined ? {} : { action }),
    ...(code === undefined ? {} : { code }),
    ...(target === undefined ? {} : { target }),
    ...(pending === undefined ? {} : { pending }),
    ...(at === undefined ? {} : { at }),
  };
}

/** One settled run, as persisted on the entity (05 §2.1). */
export interface CommandLogView {
  command: string;
  index?: number;
  status: 'partial' | 'done';
  at: string;
  steps: Array<{ step: number; action?: string; event?: string }>;
}

/**
 * `command_log` — an array of settled runs. A malformed entry is dropped whole
 * (never half-rendered); a missing or non-array value yields `[]`.
 */
export function parseCommandLog(raw: unknown): CommandLogView[] {
  if (!Array.isArray(raw)) return [];
  const out: CommandLogView[] = [];
  for (const item of raw) {
    const entry = record(item);
    if (entry === null) continue;
    const command = stringOf(entry.command);
    const at = stringOf(entry.at);
    if (command === undefined || at === undefined) continue;
    const index = numberOf(entry.index);
    const steps: CommandLogView['steps'] = [];
    if (Array.isArray(entry.steps)) {
      for (const step of entry.steps) {
        const value = record(step);
        if (value === null) continue;
        const stepIndex = numberOf(value.step);
        if (stepIndex === undefined) continue;
        const action = stringOf(value.action);
        const event = stringOf(value.event);
        steps.push({
          step: stepIndex,
          ...(action === undefined ? {} : { action }),
          // Only a real `evt-<seq>` id is a tracing handle; a placeholder renders
          // nothing rather than a fake id.
          ...(event === undefined || !/^evt-\d+$/.test(event) ? {} : { event }),
        });
      }
    }
    out.push({
      command,
      ...(index === undefined ? {} : { index }),
      // Anything outside the enum reads as `done`: never over-report "unfinished".
      status: entry.status === 'partial' ? 'partial' : 'done',
      at,
      steps,
    });
  }
  return out;
}

/**
 * Faces of the declared dice, for the tumbling tiles (06 §11.3). `null` when the
 * expression is not a legal `NdM±K`, so the caller keeps its own fallback.
 */
export function declaredDiceFaces(dice: string): number | null {
  const parsed = parseDiceType(dice);
  return parsed.ok ? parsed.value.faces : null;
}
