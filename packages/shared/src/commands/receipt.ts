/**
 * 10 §3.8 — the same-turn receipt for the effects a world command just landed.
 *
 * WHY THIS CHANNEL. When the WRITER triggers a command (`roll_dice` is on its
 * tool surface, `extensions/tools.ts:55`), the command's events carry
 * `actor.type === 'writer'`. `excludeActor` (hooks/00 §6.1) therefore hides them
 * from the writer's own next injection, AND the turn cursor is advanced to
 * `getMaxSeq()` past them (`cursor.ts`) — with no history-surface tool
 * (hooks/00 §4.2) they never reappear. The triggering action's `text` is the
 * ONLY channel that reaches the writer in the SAME turn (10 §3.9).
 *
 * WHY IT REUSES `renderEvent`. Each effect line is produced by the existing
 * renderer, so the receipt and the next turn's `dynamics` bullet are the SAME
 * sentence — one wording, two places, never two truths (doc-22 mechanism 9).
 *
 * The receipt shape (`WorldCommandReceipt`) is owned by `04` (`effects.ts`);
 * this module consumes it and declares no second truth (contract §R.4).
 *
 * PURE, TOTAL, NEVER THROWS (hooks/00 §11 — the injection side may never fail a
 * turn, and this text rides a tool result that must still be returned). Every
 * malformed input degrades per 10 §7: an unknown `settle` verb falls back to the
 * `ran` wording with one warn, a missing `event` skips that line, an empty
 * `commands` array yields '' so `text + commandReceiptText(commands)` stays
 * byte-identical to the text the action produced before this module existed.
 */

import type { CommandOutcome } from './bindings.js';
import type { WorldCommandReceipt } from './effects.js';
import type { WorldEvent } from '../schemas/events.js';
import { renderEvent } from '../render/events.js';

/** Warn once per distinct message per process — a per-turn warn would spam. */
const warned = new Set<string>();
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  // eslint-disable-next-line no-console
  console.warn(`[world-command receipt] ${message}`);
}

/**
 * `WorldCommandReceipt` plus one OPTIONAL field this module owns: a refusal that
 * never reached an effect (a binding-level `02` refusal — `command_not_found`,
 * `param_invalid`, `when_malformed`) has no effect to describe, and the generic
 * "could not carry out any of its effects" would throw away the one sentence
 * that says why. Additive, so `WorldCommandReceipt[]` still satisfies it.
 */
export type ReceiptInput = WorldCommandReceipt & { note?: string };

/** `05`'s four verbs, translated into model-side English. There is no fifth. */
const HEADLINE: Record<WorldCommandReceipt['settle'], (name: string) => string> = {
  ran: (name) => `The world settled this for you, through "${name}":`,
  resumed: (name) => `The world finished settling this, through "${name}":`,
  failed: (name) => `The world could not settle this for you, through "${name}":`,
  // `reused` carries no effect lines and no closing line (10 §3.8.1): there is
  // nothing to list, and repeating the closing sentence on every revisit is noise.
  reused: (name) => `The world had already settled this, through "${name}": nothing changed again.`,
};

/** The closing line of the `ran` / `resumed` / `failed` shapes (10 §3.8.1). */
const CLOSING = 'Narrate what this means; do not write, grant, or move any of it again.';
const CLOSING_FAILED = 'Nothing was granted. Say what the player can still try.';

/**
 * `layerNames: {}` is safe here and deliberate: of the fifteen templates only
 * `character_moved` consumes `layerPhrase` (`render/events.ts`), and none of
 * `04`'s seven effects can produce it — so the receipt needs no manifest and
 * this function performs no I/O.
 */
const NO_LAYER_NAMES: Record<string, string> = {};

/** One effect line, or null when there is nothing honest to print. */
function effectLine(effect: WorldCommandReceipt['effects'][number]): string | null {
  if (effect.ok) {
    const event = effect.event as WorldEvent | undefined;
    if (event === undefined) {
      // 10 §7: no real event ⇒ SKIP the line. Rendering from the action name
      // would be a second renderer beside `renderEvent` (contract §8 anti-pattern 5).
      warnOnce(`effect "${effect.action}" has no event; its receipt line is omitted.`);
      return null;
    }
    return renderEvent(event, { layerNames: NO_LAYER_NAMES });
  }
  // A failure has no event (nothing landed). `error` is the action layer's own
  // message (`04` §5.4 (c): verbatim, never rewritten).
  if (typeof effect.error === 'string' && effect.error !== '') return effect.error;
  warnOnce(`failed effect "${effect.action}" carries no error message.`);
  return 'The world could not carry this step out.';
}

/** The body lines, indented; `failed` only decides how an EMPTY list reads. */
function bodyLines(command: ReceiptInput, failed: boolean): string[] {
  const effects = Array.isArray(command.effects) ? command.effects : [];
  const lines = effects.map((e) => effectLine(e)).filter((l): l is string => l !== null);
  if (typeof command.note === 'string' && command.note !== '') lines.unshift(command.note);
  if (lines.length === 0 && failed) {
    // Must not become an empty body that reads as success (10 §7).
    return ['  - The world command could not carry out any of its effects.'];
  }
  return lines.map((l) => `  - ${l}`);
}

/** The receipt for ONE command, ending in its own closing line. */
function receiptFor(command: ReceiptInput): string {
  const name = typeof command.name === 'string' && command.name !== '' ? command.name : command.id;
  const headline = HEADLINE[command.settle];
  if (headline === undefined) {
    // 10 §7: a fifth verb means `05` grew and this table did not follow. Falling
    // back to `ran` is the conservative direction — better "the world settled
    // this" than an implication that nothing happened.
    warnOnce(`unknown settle verb "${String(command.settle)}"; rendered as "ran".`);
    return [HEADLINE.ran(name), ...bodyLines(command, false), CLOSING].join('\n');
  }
  if (command.settle === 'reused') return headline(name);
  const failed = command.settle === 'failed';
  return [
    headline(name),
    ...bodyLines(command, failed),
    failed ? CLOSING_FAILED : CLOSING,
  ].join('\n');
}

/**
 * 10 §2.7. The receipt appended to the TRIGGERING action's `text`.
 *
 * Several commands are concatenated in array order, each with its own headline
 * (10 §3.8.1). Returns '' for an empty input, so the caller's
 * `text + commandReceiptText(commands)` is byte-identical to today's text when
 * no command matched.
 */
export function commandReceiptText(commands: readonly ReceiptInput[]): string {
  if (!Array.isArray(commands) || commands.length === 0) return '';
  const parts: string[] = [];
  for (const command of commands) {
    if (command === null || typeof command !== 'object') {
      warnOnce('a commands entry was not an object; skipped.');
      continue;
    }
    parts.push(receiptFor(command));
  }
  if (parts.length === 0) return '';
  // A blank line separates the action's own sentence (which stays FIRST, per
  // 10 §8.2 item 3) from the receipt block.
  return `\n\n${parts.join('\n\n')}`;
}

/**
 * The §8.2 SEAM. `commandReceiptText` is specified over `04`'s
 * `WorldCommandReceipt`, but the landed `runTriggeredCommands` returns `02`'s
 * `CommandOutcome` (`bindings.ts`), which carries NO `WorldEvent` — only
 * `settleReport.<verb>[].effects[].seq`. Two consequences, both reported:
 *
 *  - `name` is not in the outcome, so it degrades to the id (10 §2.7's own
 *    degradation column; the human name lives in `command/<id>.yaml` and is
 *    never exported by the trigger).
 *  - success effects therefore have no event and render NO line (10 §7). The
 *    headline and closing line still reach the writer, which is what makes
 *    "the world already did this" visible in the same turn; the per-effect
 *    sentences need `04`'s `event` on the outcome.
 *
 * A binding-level refusal is reported as `failed` with its own `message` as the
 * `note`; a `when` that did not match is NOT a receipt at all (nothing happened,
 * and saying "the world settled this" would be false).
 */
export function commandReceipts(
  outcomes: readonly CommandOutcome[] | undefined
): ReceiptInput[] {
  if (!Array.isArray(outcomes)) return [];
  const receipts: ReceiptInput[] = [];
  for (const o of outcomes) {
    if (o === null || typeof o !== 'object') continue;
    const report = o.settleReport;
    const effects = (
      summary:
        | { effects: readonly { settle?: string; action: string; event?: WorldEvent; error?: { message: string } }[] }
        | undefined
    ) =>
      (summary?.effects ?? []).map((e) => ({
        action: e.action as WorldCommandReceipt['effects'][number]['action'],
        ok: e.settle !== 'failed',
        // The event OBJECT, not just its seq: `renderEvent` is the one renderer
        // (contract §8 anti-pattern 5). A reused/replayed step carries none, and
        // `effectLine` skips it rather than inventing a line.
        ...(e.event === undefined ? {} : { event: e.event }),
        ...(e.settle === 'failed' && e.error ? { error: e.error.message } : {}),
      }));
    if (report?.failed !== undefined) {
      receipts.push({
        id: o.command,
        name: o.command,
        settle: 'failed',
        effects: [],
        note: report.failed.message,
      });
      continue;
    }
    const reused = report?.reused?.[0];
    if (reused !== undefined) {
      receipts.push({ id: o.command, name: o.command, settle: 'reused', effects: effects(reused) });
      continue;
    }
    const resumed = report?.resumed?.[0];
    if (resumed !== undefined) {
      receipts.push({ id: o.command, name: o.command, settle: 'resumed', effects: effects(resumed) });
      continue;
    }
    const ran = report?.ran?.[0];
    if (ran !== undefined) {
      receipts.push({ id: o.command, name: o.command, settle: 'ran', effects: effects(ran) });
      continue;
    }
    if (o.status === 'error') {
      receipts.push({
        id: o.command,
        name: o.command,
        settle: 'failed',
        effects: [],
        note: o.message ?? 'the world command could not run',
      });
    }
    // `when_false` / `short_circuit`: nothing was settled and nothing changed, so
    // there is no receipt to print.
  }
  return receipts;
}
