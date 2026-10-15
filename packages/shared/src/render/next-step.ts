/**
 * The closing imperative of the world-state block (04 §3).
 *
 * Two layers, deliberately disjoint (04 §1):
 *  - this module computes the INSTANCE — what is outstanding THIS turn, from facts;
 *  - the platform STANCE (how to read that line) is a resident constant in
 *    `extensions/instructions.ts` (`NEXT_STEP_RULES` / `CHARACTER_NEXT_STEP_RULES`).
 * They share zero text: a rule that is true every turn belongs in the system prompt,
 * a line that changes every turn belongs in the injection block.
 *
 * `renderState` (01) appends a non-empty result as the UNTITLED last section; ''
 * means the section is absent entirely (00 §4.1). `next_step` is therefore NOT a
 * member of `SectionKey` — it is never addressed by name, only appended.
 */

import type { WorldEventType } from '../schemas/events.js';
import type { EventWindowLine } from './events.js';

export type NextStepRole = 'writer' | 'character';

/**
 * Minimal event view. `EventWindowLine` (owned by 03's `render/events.ts`) is a
 * superset, so we project it rather than declaring a second shape:
 *
 *   NextStepEvent = Pick<EventWindowLine, 'type' | 'layer' | 'name' | 'actor' | 'command'>
 *
 * `actor` is carried so the case-1 tail test can drop writer-authored events
 * (04 §3.1, review A-12). `command` is carried so the tail test can skip past a
 * world command's consequences and recover the act that triggered them (10
 * §3.7). Every `EventWindowLine` satisfies the projection.
 */
export type NextStepEvent = Pick<EventWindowLine, 'type' | 'layer' | 'name' | 'actor' | 'command'>;

export interface NextStepFacts {
  role: NextStepRole;
  /** Chronological, oldest -> newest. Already merged + capped + self-excluded by 01/03. */
  events: NextStepEvent[];
  /** Player's layer (writer) / own layer (character). null = unknown. */
  currentLayer: string | null;
  /** A layer was generated this window and the player has not entered it (04 §2.2 predicate). */
  unseenCreation: boolean;
  /** No events this window (01 owns the predicate: `quiet = events.length === 0`). */
  quiet: boolean;
}

/**
 * Frozen wording, 04 §3.1 / §3.2. Do not paraphrase: every string here is asserted
 * verbatim by `packages/shared/test/next-step.test.mjs`.
 */
const CASE_CHOICE_SELECTED =
  'The player has just made a choice, and nothing has narrated what it led to. Answer that choice this turn before moving on.';
const CASE_USE_ITEM_ON =
  'The player has just used an item on something, and no narration has reported what happened. Resolve it this turn.';
const CASE_ROLL_RESOLVED =
  'A dice check has just resolved, and no narration has reported the result. Report the outcome this turn.';
// 10 §3.7.3 — the "the world already carried this out" arm. Same register as
// CASE_UNSEEN_CREATION below: state the fact, forbid the repeat, leave the
// MEANING to the writer. No file paths, no command ids (10 §3.7.3's three hard
// requirements), and every one of them ends in a "do not do it again"
// imperative — the third line of defence behind 10 §3.8's receipt.
const CASE_CHOICE_SELECTED_SETTLED =
  'The player has just made a choice, and the world has already carried it out: what it owed is on disk now. Say what it means; do not re-describe the mechanics, and do not write the same thing again.';
const CASE_USE_ITEM_ON_SETTLED =
  'The player has just used an item on something, and the world has already carried it out on disk. Say what it means; do not repeat the effect or write a second copy of it.';
const CASE_ROLL_RESOLVED_SETTLED =
  'A dice check has just resolved and the world has already settled what it owed: the result is on disk. Report what it means this turn; do not grant, move, or write any of it again.';
const CASE_ACT_SETTLED =
  'The world has already settled what the player\u2019s last act owed. Whatever landed is on disk; narrate its meaning, and do not repeat it.';
const CASE_UNSEEN_CREATION =
  'A new layer has been generated and the player has not entered it yet. Its opening is already on disk, so do not write it again; deal with the player where they are now.';
const CASE_QUIET =
  'Nothing in the world has changed this turn and no action is owed. Respond to the player, but do not manufacture an event, a clue, or a stranger just to give the turn something to say.';

const CHARACTER_C1 =
  'Something the player did here is still unanswered. You were present for it, so react to it as yourself and in your own voice.';
const CHARACTER_C2 =
  'Things in this place changed while you were closed. You need not bring them up; you must not contradict them.';
const CHARACTER_C3 =
  'Nothing here is owed an answer right now. A short line, or saying nothing, is a real answer; do not invent a past that did not happen to fill the silence.';

/**
 * WHITELIST, not blacklist (04 §6.1): a future event type must not accidentally
 * start firing an imperative — someone has to add it here on purpose.
 * These three are the player's interactive acts (00 §8 case 1).
 */
const INTERACTIVE_TAIL: Partial<Record<WorldEventType, string>> = {
  choice_selected: CASE_CHOICE_SELECTED,
  use_item_on: CASE_USE_ITEM_ON,
  roll_resolved: CASE_ROLL_RESOLVED,
};

/** 10 §3.7.2's order-1′ arm: the same three acts, said in the settled register. */
const SETTLED_TAIL: Partial<Record<WorldEventType, string>> = {
  choice_selected: CASE_CHOICE_SELECTED_SETTLED,
  use_item_on: CASE_USE_ITEM_ON_SETTLED,
  roll_resolved: CASE_ROLL_RESOLVED_SETTLED,
};

/**
 * The newest event that was NOT produced by a world command (10 §3.7). Scans
 * backwards at most `events.length` times (the window is already ≤ 12 by cap).
 *
 * Rationale: a command's consequences are appended AFTER the act that triggered
 * them, so they displace the act from the tail. `computeNextStep` decides from
 * the tail by design (04 §3.1), so the act must be recovered here instead of
 * widening the whitelist — widening it would make a world-caused event look like
 * a player act, which is exactly the A-12 bug in a new coat.
 */
function actTail(events: readonly NextStepEvent[]): NextStepEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e !== undefined && e.command === undefined) return e;
  }
  return null;
}

/**
 * True when at least one event in the window carries a `command` (10 §3.7).
 * Deliberately NOT "any event after the act": a command whose condition did not
 * match lands nothing, and must leave the plain wording untouched.
 */
function hasSettledCommand(events: readonly NextStepEvent[]): boolean {
  return events.some((e) => e.command !== undefined);
}

/**
 * Pure. Returns the closing imperative for this turn; '' = nothing is owed.
 *
 * Invariants (04 §2.1, each covered by the unit suite):
 *  - Pure: no I/O, no clock, no randomness, no store. Same `facts` -> same string.
 *  - Reads only the TAIL event and the type SET; never decodes `detail` (the
 *    specifics live in 03's bullets — this line only states that something is owed).
 *  - Non-empty means "append to the block"; '' means the section is absent.
 *  - One function serves both roles: it branches on `facts.role`, never on anything else.
 *  - Never inserts a player/character name (04 §6.1): the output is fixed prose, so a
 *    character can never be told to speak words it did not write.
 *  - Never throws and never validates `facts` (00 §11): a corrupt fact degrades to the
 *    "nothing to state" branch.
 *
 * Decision order (04 §3.1, extended by 10 §3.7.2) — fixed, first hit wins:
 *  1.  interactive act (type in the whitelist) AND `act.actor.type !== 'writer'`
 *  1′. that same act, but the world already settled what it owed (`settled`)
 *  1″. no interactive act recoverable, yet something WAS settled (`CASE_ACT_SETTLED`)
 *  2.  `unseenCreation` (before quiet, per 00 §8's enumeration order)
 *  3.  `quiet`
 *  4.  otherwise ''
 *
 * Order 1/1′ reads `actTail(events)` rather than the literal last event: a
 * command's consequences land AFTER the act that triggered them and push it off
 * the tail, so reading the tail verbatim loses the imperative entirely (10
 * §3.7.1 — "the more effective the command, the more surely the line vanishes").
 *
 * The `actor.type !== 'writer'` guard is the SECOND line of defence (review A-12):
 * 01's read layer already excludes writer-authored events, but the writer can trigger
 * all three types itself (`roll_dice` is on the writer's tool surface: extensions/tools.ts:55),
 * and a writer that reads its own act as "the player did this" would answer itself.
 *
 * `unseenCreation` is additionally gated on `currentLayer !== null`: the predicate is
 * `L !== currentLayer`, so a null layer would make it vacuously true for every layer
 * (00 §11 cascade when the viewpoint TTL expires). Silence beats a wrong imperative.
 */
export function computeNextStep(facts: NextStepFacts): string {
  // Total by construction (04 §6.1): a half-built `facts` must degrade, not throw —
  // the injection block can never be allowed to fail a turn (00 §11). Hence the
  // optional reads even though the declared type marks these fields required.
  const events = facts?.events ?? [];
  // 10 §3.7.2 order 0: recover the ACT from behind the command's consequences,
  // and note whether this window contains any command-made change at all.
  const tail = actTail(events);
  const settled = hasSettledCommand(events);
  // An outstanding player act requires BOTH: the act is one of the three
  // interactive types, AND the writer did not author it itself (review A-12).
  const owed = tail && tail.actor?.type !== 'writer' ? INTERACTIVE_TAIL[tail.type] : undefined;

  if (facts?.role === 'character') {
    // C2's test is `events.length > 0`, NOT `unseenCreation` (review A-14): the
    // dynamics window is already layer-filtered and self-excluded, so any surviving
    // line is exactly "this changed here while you were closed, and it was not you".
    // Anything else — including an unknown tail type — falls to C3, the character's
    // default (a character that has been opened always owes an answer).
    if (owed !== undefined) return CHARACTER_C1;
    if (events.length > 0) return CHARACTER_C2;
    return CHARACTER_C3;
  }

  // Order 1 / 1′. When the world already settled this act, the plain wording
  // ("nothing has narrated what it led to") would be a lie — the consequence is
  // on disk. The settled register keeps the act named and forbids the repeat.
  if (owed !== undefined) {
    return (settled ? SETTLED_TAIL[tail!.type] : owed) ?? owed;
  }
  // Order 1″. An act IS recoverable (`tail !== null`) but owes nothing on its own
  // (its type is outside the whitelist, or a writer authored it), while something
  // WAS settled. `CASE_ACT_SETTLED` says exactly that and names no act — it is
  // the honest replacement for `''` (the whole section vanishes) and for
  // `CASE_QUIET` (which would assert "nothing changed", a falsehood).
  //
  // The `tail !== null` gate is 10 §3.7.2's, kept verbatim: when EVERY event is a
  // command's, there is no non-command fact to speak from and the arm falls to
  // 2/3/4. `10`'s §3.7.2 prose argues the opposite for that window; the table row
  // and its dedicated gate paragraph win here (see the delivery notes).
  if (settled && tail !== null) return CASE_ACT_SETTLED;
  // `currentLayer === null` means the viewpoint is unknown (05 owns the TTL; 00 §11's
  // cascade drops `deps.layer` to null), so the unseen-creation predicate cannot be
  // evaluated — treat the case as not hit. Silence beats a wrong imperative.
  if (facts?.unseenCreation === true && facts.currentLayer != null) return CASE_UNSEEN_CREATION;
  if (facts?.quiet === true) return CASE_QUIET;
  return '';
}
