/**
 * The forced first-run tutorial's step machine
 * Pure: the component feeds it a snapshot of what the app
 * can observe and renders whatever step comes back. Every step advances only on
 * the player's own real act, never on a "Next" button.
 *
 *   speak       → the player sent a character a message since the tutorial armed
 *                 (the reply box comes pre-filled with `tutorialFirstLine`)
 *   follow      → the greeter is following (skipped only when the world has no
 *                 greeter at all; without an invitation the dock offers its own
 *                 「跟我来」 control)
 *   writer      → the writer is open (classic layout: always, so it passes through)
 *   writer-send → the writer started working on the prefilled prompt
 *   new-item    → waits for the writer's answer: a card that was not in the
 *                 layer before the prompt appeared. A plain card is highlighted
 *                 and the player clicking it (or "Continue") moves on to `take` /
 *                 `enter`; a SEARCH dice chalk (`search-*.md`) leads on to:
 *   chalk       → open the search chalk the writer set up
 *   roll        → roll its dice; done once its `roll_dice.result` is written
 *                 and the dice ceremony has released it
 *   found       → the card the roll paid out (`dice_reward.source` = chalk);
 *                 or, when the band made nothing, "Continue" once the writer settles
 *   take        → only when every place here is locked: the unlocking item (or
 *                 any portable one) is now carried
 *   enter       → the current layer changed; that ends the tutorial
 *
 * Searching comes BEFORE moving to another place
 * a place locked behind an item the search turns
 * up now flows search → take it → go in, instead of asking for a move first.
 */

export type TutorialStep = 'speak' | 'follow' | 'take' | 'enter' | 'writer' | 'writer-send' | 'new-item' | 'chalk' | 'roll' | 'found' | 'done';

export const TUTORIAL_STEPS: readonly TutorialStep[] = ['speak', 'follow', 'writer', 'writer-send', 'new-item', 'chalk', 'roll', 'found', 'take', 'enter', 'done'];

/**
 * World-agnostic "don't show again"
 * The tutorial runs on EVERY world entry until the player
 * presses "Don't show again"; finishing it or "Skip this time" writes nothing.
 *
 * A NEW key on purpose: the first version wrote `airp:tutorial:done` from its
 * "Skip tutorial" button, so anyone who skipped once never saw the tutorial
 * again
 * Only the explicit "Don't show again" writes this one.
 */
export const TUTORIAL_STORAGE_KEY = 'airp:tutorial:hidden';

/** The writer prompt the `writer-send` step puts in the box (an i18n key). */
export const TUTORIAL_WRITER_PROMPT = 'Search what else is here';

export interface TutorialSnapshot {
  /** Messages the player sent to any character since the tutorial armed. */
  playerSentCount: number;
  /** There is a greeter who can be asked to follow (every world with a cast). */
  followAvailable: boolean;
  /** The authored invitation is on its way / on screen (vs. the dock's own control). */
  followInvitePending?: boolean;
  /** The greeter is following the player right now. */
  greeterFollowing: boolean;
  layer: string;
  writerOpen: boolean;
  writerWriting: boolean;
  itemPaths: readonly string[];
  /** At least one place on this layer can be entered with what is carried. */
  unlockedPlaceAvailable: boolean;
  /** Every place here is locked: the layer item to take first, else null. */
  lockItemPath: string | null;
  /** `lockItemPath` is one a lock names — only then does `take` chain to the next. */
  lockItemIsKey?: boolean;
  /** What the player carries, by path (`player/...`). */
  carriedPaths: readonly string[];
  /** Cards in the layer that are search dice chalks (see `isSearchChalk`). */
  searchChalks?: readonly string[];
  /** Chalks whose `roll_dice.result` is written (or whose `roll_resolved` landed). */
  rolledPaths?: readonly string[];
  /** Cards a roll paid out: `dice_reward.source` → the card's path. */
  rewards?: readonly { path: string; source: string }[];
  /** Chalks whose result the dice ceremony is still holding back. */
  heldPaths?: readonly string[];
  /** The chalk's roll button is on screen (the chalk / its dialog is open). */
  rollControlShown?: boolean;
  /**
   * The world routes AUTHORED options into the writer's tray (world.json `ui.replyChips`, the design notes): the
   * writer step points at those slips — no free-text prompt goes in the box — and picking one counts as sent.
   */
  designedOptions?: boolean;
}

export interface TutorialState {
  step: TutorialStep;
  /** The layer the `enter` step started on. */
  startLayer: string | null;
  /** The item the `take` step asks for; set once, so the step never loops. */
  takeItem: string | null;
  /** Items this tutorial has already had the player take for a lock (a lock may want several). */
  takenCount: number;
  /** Card paths in the layer when the writer prompt was offered. */
  baselineItems: readonly string[] | null;
  /** What the player carried then (an authored option may be a take). */
  baselineCarried?: readonly string[] | null;
  /** The writer step points at the tray's authored options, not at a typed prompt (`designedOptions`). */
  pickOption?: boolean;
  /** The writer took the prompt; `new-item` waits for it to settle. */
  writerStarted: boolean;
  /** The writer finished without a new card appearing. */
  writerSettled: boolean;
  newItem: string | null;
  /** The search dice chalk the writer set up for the prompt. */
  chalk: string | null;
}

export const INITIAL_TUTORIAL: TutorialState = {
  step: 'speak',
  startLayer: null,
  takeItem: null,
  takenCount: 0,
  baselineItems: null,
  writerStarted: false,
  writerSettled: false,
  newItem: null,
  chalk: null,
};

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** Taken: carried under the same file name, or gone from the layer. */
function itemTaken(item: string, snap: TutorialSnapshot): boolean {
  const name = baseName(item);
  if (snap.carriedPaths.some(path => path === item || baseName(path) === name)) return true;
  return !snap.itemPaths.includes(item);
}

/** Into `enter`, or first into `take` when every place here is locked. */
function towardEnter(state: TutorialState, snap: TutorialSnapshot): TutorialState {
  if (state.takeItem === null && !snap.unlockedPlaceAvailable && snap.lockItemPath) {
    return { ...state, step: 'take', startLayer: snap.layer, takeItem: snap.lockItemPath };
  }
  return { ...state, step: 'enter', startLayer: state.startLayer ?? snap.layer };
}

function stepOnce(state: TutorialState, snap: TutorialSnapshot): TutorialState {
  switch (state.step) {
    case 'speak':
      return snap.playerSentCount > 0 ? { ...state, step: 'follow' } : state;
    case 'follow':
      if (snap.greeterFollowing || !snap.followAvailable) return { ...state, step: 'writer' };
      return state;
    case 'take':
      // Walked somewhere else anyway: that IS the enter step done.
      if (state.startLayer !== null && snap.layer !== state.startLayer) return { ...state, step: 'done' };
      if (state.takeItem === null || snap.unlockedPlaceAvailable) return { ...state, step: 'enter' };
      if (!itemTaken(state.takeItem, snap)) return state;
      // A lock may ask for several things (wuwu: the commission letter AND the
      // badge —): point at the next one.
      if (snap.lockItemIsKey && snap.lockItemPath && snap.lockItemPath !== state.takeItem && !itemTaken(snap.lockItemPath, snap)) {
        return { ...state, takeItem: snap.lockItemPath, takenCount: state.takenCount + 1 };
      }
      return { ...state, step: 'enter', takenCount: state.takenCount + 1 };
    case 'enter':
      if (state.startLayer === null) return { ...state, startLayer: snap.layer };
      if (snap.layer !== state.startLayer) return { ...state, step: 'done' };
      // Places resolved after the step began (the layer loaded late): all locked.
      if (!snap.unlockedPlaceAvailable && snap.lockItemPath && !itemTaken(snap.lockItemPath, snap)
        && (state.takeItem === null || (snap.lockItemIsKey && snap.lockItemPath !== state.takeItem))) {
        return { ...state, step: 'take', takeItem: snap.lockItemPath };
      }
      return state;
    case 'writer':
      return snap.writerOpen
        ? { ...state, step: 'writer-send', baselineItems: [...snap.itemPaths], baselineCarried: [...snap.carriedPaths], ...(snap.designedOptions ? { pickOption: true } : {}) }
        : state;
    case 'writer-send':
      if (state.baselineItems === null) return { ...state, baselineItems: [...snap.itemPaths], baselineCarried: [...snap.carriedPaths] };
      if (snap.writerWriting) return { ...state, step: 'new-item', writerStarted: true };
      // An authored option needs no writer: it took something, or set up a search, and that is the answer.
      if (snap.designedOptions && optionPicked(state, snap)) return { ...state, step: 'new-item', writerStarted: true };
      return state;
    case 'new-item': {
      if (state.newItem !== null) return state;
      const before = new Set(state.baselineItems ?? []);
      const freshCards = snap.itemPaths.filter(path => !before.has(path));
      // The search the writer set up comes first: the item only exists after the roll.
      const chalks = new Set(snap.searchChalks ?? []);
      const chalk = freshCards.find(path => chalks.has(path)) ?? null;
      if (chalk) return { ...state, step: 'chalk', chalk, writerSettled: false };
      const fresh = freshCards[0] ?? null;
      if (fresh) return { ...state, newItem: fresh, writerSettled: false };
      return settle(state, snap);
    }
    case 'chalk':
      if (state.chalk !== null && rolled(state.chalk, snap)) return { ...state, step: 'roll' };
      return snap.rollControlShown ? { ...state, step: 'roll' } : state;
    case 'roll':
      if (state.chalk === null || !rolled(state.chalk, snap)) return state;
      if ((snap.heldPaths ?? []).includes(state.chalk)) return state;
      return { ...state, step: 'found', newItem: null, writerSettled: false };
    case 'found': {
      if (state.newItem !== null) return state;
      const reward = (snap.rewards ?? []).find(entry => entry.source === state.chalk);
      if (reward) return { ...state, newItem: reward.path, writerSettled: false };
      return settle(state, snap);
    }
    default:
      return state;
  }
}

/** Since the writer step began, a card appeared or left the layer, or the bag changed. */
function optionPicked(state: TutorialState, snap: TutorialSnapshot): boolean {
  const same = (a: readonly string[], b: readonly string[] | null | undefined) => !!b && a.length === b.length && a.every((p) => b.includes(p));
  return !same(snap.itemPaths, state.baselineItems) || (state.baselineCarried != null && !same(snap.carriedPaths, state.baselineCarried));
}

function rolled(chalk: string, snap: TutorialSnapshot): boolean {
  return (snap.rolledPaths ?? []).includes(chalk);
}

/** No card (yet): "settled" once the writer stops, unsettled if it starts again. */
function settle(state: TutorialState, snap: TutorialSnapshot): TutorialState {
  if (!snap.writerWriting && !state.writerSettled) return { ...state, writerSettled: true };
  if (snap.writerWriting && state.writerSettled) return { ...state, writerSettled: false };
  return state;
}

/**
 * A search dice chalk: the writer's answer to 「搜索这里还有什么」. Declared spots
 * are `<layer>/search-<spot>.md`, improvised ones `<layer>/search-<n>.md`;
 * either way the card carries `search_source`.
 */
export function isSearchChalk(path: string, frontmatter?: Record<string, unknown> | null): boolean {
  return /\/search-[^/]+\.md$/.test(path) || (frontmatter?.search_source !== undefined && frontmatter?.search_source !== null);
}

/** Whether a card's dice have been rolled: its `roll_dice.result` is written. */
export function diceRolled(frontmatter?: Record<string, unknown> | null): boolean {
  const roll = frontmatter?.roll_dice as { result?: unknown } | undefined;
  return typeof roll?.result === 'number';
}

/** The chalk a card was paid out by (`dice_reward.source`), if any. */
export function diceRewardSource(frontmatter?: Record<string, unknown> | null): string | null {
  const reward = frontmatter?.dice_reward as { source?: unknown } | undefined;
  return typeof reward?.source === 'string' && reward.source ? reward.source : null;
}

/** Advance as far as the snapshot allows (several steps may already be true). */
export function advanceTutorial(state: TutorialState, snap: TutorialSnapshot): TutorialState {
  let current = state;
  for (let i = 0; i < TUTORIAL_STEPS.length + 2; i += 1) {
    const next = stepOnce(current, snap);
    if (next === current) return current;
    current = next;
  }
  return current;
}

/**
 * The search is over (the player clicked what it turned up, or pressed "Continue"
 * on a search that found nothing): on to moving somewhere else — through
 * `take` first when every place here is locked. Any other step is left alone.
 */
export function continueTutorial(state: TutorialState, snap: TutorialSnapshot): TutorialState {
  if (state.step !== 'new-item' && state.step !== 'found') return state;
  return advanceTutorial(towardEnter({ ...state, startLayer: snap.layer }, snap), snap);
}

export function finishTutorial(state: TutorialState): TutorialState {
  return { ...state, step: 'done' };
}

// ── Pacing: guidance waits for the performance ─────────────
//
// 「玩家一点，引导马上跳到下一句，不等作家 / 演出跑完」「作家执行时整个屏幕是黑的」:
// the step machine above follows the world; the PACING below decides when the
// guidance (mask, highlight, caption) may show. Three states:
//
//   waiting     guidance up: mask + highlight + caption, presses held outside it
//   performing  something the player should WATCH is playing (lib/stage-performance:
//               the writer, the dice, an item / new-scene presentation, a CG, a
//               character answering) — no mask, no caption, presses pass
//   settling    the stage just went still (or the player just acted): a short
//               quiet window so the next card can land, the next presentation
//               can start — still no mask
//
// and back to `waiting` on the NEXT step. A performance that never reports its
// end stops holding the guidance after `TUTORIAL_PERFORM_MAX_MS`, so an aborted
// turn or a lost frame cannot hang the tutorial.

/** After the stage goes still, before guidance comes back (cards land, a presentation starts). */
export const TUTORIAL_QUIET_MS = 1200;
/** After the player's act, how long a performance has to begin before guidance comes back. */
export const TUTORIAL_ACT_GRACE_MS = 1200;
/** A performance longer than this stops holding the guidance (it shows, unmasked). */
export const TUTORIAL_PERFORM_MAX_MS = 90_000;

/**
 * Steps the player arrives at through a UI move (opening something), not through
 * an act that the world answers: no grace window, the guidance follows at once.
 */
const NO_GRACE_STEPS: ReadonlySet<TutorialStep> = new Set(['speak', 'writer', 'writer-send', 'roll']);

export interface TutorialPacing {
  /** What the guidance last showed: the step, and what it points at. */
  key: string;
  /** Guidance stays down until this time (ms epoch). */
  holdUntil: number;
  /** When the current performance began; null while nothing performs. */
  performingSince: number | null;
}

export const INITIAL_PACING: TutorialPacing = { key: '', holdUntil: 0, performingSince: null };

/** What the guidance shows: the step and what it points at (a change is a new thing to show). */
export function tutorialPacingKey(state: TutorialState): string {
  return [state.step, state.takeItem ?? '', state.takenCount, state.newItem ?? '', state.chalk ?? '', state.writerSettled ? 1 : 0].join('|');
}

/**
 * Pure: fold one observation into the pacing. Call on every change of the
 * step key or of `performing` (and on a timer at `pacingWakeAt`).
 */
export function pacingStep(pacing: TutorialPacing, input: { state: TutorialState; performing: boolean; now: number }): TutorialPacing {
  const { state, performing, now } = input;
  let next = pacing;
  const key = tutorialPacingKey(state);
  if (key !== pacing.key) {
    // UI-only moves show at once; an act waits a beat for the performance it set
    // off to begin. The very first look is the world's, not the tutorial's: it
    // too waits the quiet beat after the arrival (opening card, greeting and its
    // voice — `tutorialArrivalPending`) before any guidance shows
    //
    const grace = pacing.key === ''
      ? now + TUTORIAL_QUIET_MS
      : !NO_GRACE_STEPS.has(state.step) ? now + TUTORIAL_ACT_GRACE_MS : 0;
    next = { ...next, key, holdUntil: Math.max(next.holdUntil, grace) };
  }
  if (performing && next.performingSince === null) {
    next = { ...next, performingSince: now };
  } else if (!performing && next.performingSince !== null) {
    // The stage went still: a quiet window before guidance returns.
    next = { ...next, performingSince: null, holdUntil: Math.max(next.holdUntil, now + TUTORIAL_QUIET_MS) };
  }
  return next;
}

export type TutorialPhase = 'waiting' | 'performing' | 'settling';

/** Pure: which state the tutorial is in at `now`. */
export function tutorialPhase(pacing: TutorialPacing, now: number): TutorialPhase {
  if (pacing.performingSince !== null) {
    return now - pacing.performingSince >= TUTORIAL_PERFORM_MAX_MS ? 'waiting' : 'performing';
  }
  return now < pacing.holdUntil ? 'settling' : 'waiting';
}

/** When the phase can next change by the clock alone (ms epoch), or null. */
export function pacingWakeAt(pacing: TutorialPacing, now: number): number | null {
  if (pacing.performingSince !== null) {
    const cap = pacing.performingSince + TUTORIAL_PERFORM_MAX_MS;
    return cap > now ? cap : null;
  }
  return pacing.holdUntil > now ? pacing.holdUntil : null;
}

// ── Arrival: the world's first look comes before any guidance ──
//
// 「canvas 现在一点进去，tutorial 会出来，就是先说一句话的 tutorial 会出来，这个不对」
// /「第一眼看过去不能有 HUD」. Entering a world, the world plays first — its
// opening scene card (with sound), a CG if one shows, the companion's greeting
// line and its voice — and the tutorial stays fully out of sight (not even the
// skip pill) until all of that is over, plus the quiet beat. The step machine
// above is untouched; this only decides when the FIRST look may come.
//
// The performances themselves (scene card, CG, the character answering, the
// voice) already report to lib/stage-performance. What they cannot report is a
// greeting that has not STARTED yet — the gap between the card ending and the
// greeting arriving, or a return visit's line still being asked for — so the
// app tells the tutorial where the greeting is:
//
//   waiting   the world just opened and its greeting has not been delivered
//   sent      the greeting is on screen (authored) or was asked for (a return):
//             from here the `character` / `voice` performances hold the tutorial
//   none      no greeting is coming this entry (no companion, a save resumed
//             inside a place, an unreadable marker, a world with no greeter),
//             or the wait outlived `TUTORIAL_ARRIVAL_MAX_MS`

export type ArrivalGreeting = 'waiting' | 'sent' | 'none';

/** A greeting that has not been delivered by now stops holding the tutorial back. */
export const TUTORIAL_ARRIVAL_MAX_MS = 20_000;

export interface TutorialArrival {
  /** The world is on screen: the launcher is closed and the load has finished. */
  worldReady: boolean;
  /** The opening scene card has played (or this save has none to play). */
  openingDone: boolean;
  /** Where the arrival greeting is (see above). */
  greeting: ArrivalGreeting;
}

/** Pure: the world's arrival is still playing — no tutorial at all, not even the skip pill. */
export function tutorialArrivalPending(arrival: TutorialArrival): boolean {
  return !arrival.worldReady || !arrival.openingDone || arrival.greeting === 'waiting';
}

/** Pure: settle a waiting greeting (only a waiting one: `sent` / `none` are final for the entry). */
export function settleArrivalGreeting(current: ArrivalGreeting, next: Exclude<ArrivalGreeting, 'waiting'>): ArrivalGreeting {
  return current === 'waiting' ? next : current;
}

function escapeAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const UNLOCKED = ':not([data-tutorial-locked="true"])';

/**
 * The card's big action button while it is on
 * screen: the hover pill, the focus view's footer, or the map's popover / card
 * panel. The tutorial points at the button itself once it shows, and at the
 * card (or pin) until then.
 */
export function cardActionTarget(action: 'take' | 'enter', path?: string | null): string {
  return path
    ? `[data-card-action="${action}"][data-card-path="${escapeAttr(path)}"]`
    : `[data-card-action="${action}"]`;
}

/**
 * What the step points at, in order of preference: the first selector with a
 * visible match wins. `enter` prefers a place the player can actually go into
 * and only falls back to a locked one (whose popup says what it needs); the
 * big 「进入地点」 / 「收入随身」 button wins over its card once it shows.
 */
export function tutorialTargets(state: TutorialState): string[] {
  switch (state.step) {
    // A world with tappable first replies (`opening.replies`): the chips and the reply box together.
    case 'speak': return ['[data-tutorial="speak-replies"]', tutorialTarget(state) as string];
    case 'enter': return [
      `${cardActionTarget('enter')}${UNLOCKED}`,
      `[data-tutorial="gate"]${UNLOCKED}, [data-guide-target="enter"]${UNLOCKED}`,
      cardActionTarget('enter'),
      '[data-tutorial="gate"], [data-guide-target="enter"]',
    ];
    case 'take': {
      const one = tutorialTarget(state);
      return one ? [cardActionTarget('take', state.takeItem), one] : [];
    }
    // The roll button once the chalk (or its dialog) shows it; else the chalk.
    case 'chalk':
    case 'roll': {
      if (!state.chalk) return [];
      const chalk = escapeAttr(state.chalk);
      return [`[data-dice-roll="${chalk}"]`, `.object[data-path="${chalk}"], [data-path="${chalk}"], [data-pin="${chalk}"] .map-pin__icon`];
    }
    default: {
      const one = tutorialTarget(state);
      return one ? [one] : [];
    }
  }
}

function cardOrPin(path: string): string {
  const value = escapeAttr(path);
  return `[data-path="${value}"], [data-pin="${value}"] .map-pin__icon`;
}

/** The CSS selector of what the step points at; null when nothing (centered caption). */
export function tutorialTarget(state: TutorialState): string | null {
  switch (state.step) {
    case 'speak': return '[data-tutorial="speak"], [data-guide-target="speak"]';
    case 'follow': return '[data-tutorial="follow"]';
    // The card on the canvas, or its pin on the picture map.
    case 'take': return state.takeItem
      ? `[data-path="${escapeAttr(state.takeItem)}"], [data-pin="${escapeAttr(state.takeItem)}"] .map-pin__icon`
      : null;
    case 'enter': return '[data-tutorial="gate"], [data-guide-target="enter"]';
    case 'writer': return '[data-tutorial="writer"], [data-guide-target="writer"]';
    case 'writer-send': return state.pickOption ? '.writer-slips' : '[data-tutorial="writer-send"]';
    // The card on the canvas, or its pin on the picture map (map-first worlds have no `[data-path]` cards).
    case 'new-item':
    case 'found': return state.newItem ? cardOrPin(state.newItem) : null;
    case 'chalk': return state.chalk ? cardOrPin(state.chalk) : null;
    case 'roll': return state.chalk ? `[data-dice-roll="${escapeAttr(state.chalk)}"]` : null;
    default: return null;
  }
}

/**
 * Elements outside the highlight that stay clickable in a step: entering a gate
 * goes through its own inspection popup / threshold dialog.
 */
export function tutorialAllowed(step: TutorialStep): string | null {
  if (step === 'enter') return '.entity-interactions, .card-actions, [role="dialog"], .gate-threshold, .map-pin__panel';
  // Taking goes through the item's big buttons, its focus view or the map card panel.
  if (step === 'take') return '.entity-interactions, .card-actions, [role="dialog"]';
  // Opening a chalk and rolling go through its popup / declared-action dialog.
  if (step === 'chalk' || step === 'roll') return '.entity-interactions, .card-actions, [role="dialog"], .declared-action-dialog';
  return null;
}

/**
 * Captions about something PLAYING (a character answering, the writer working).
 * They normally never show: the tutorial is `performing` then and hides itself.
 * When one does show — the performance outlived `TUTORIAL_PERFORM_MAX_MS`, or
 * the invitation is late — it is a plain status line: no dim, presses pass
 *
 *
 */
export const TUTORIAL_WAIT_CAPTIONS: ReadonlySet<string> = new Set(['Wait for their answer…', 'The writer is looking…']);

/**
 * The line the `speak` step puts in the reply box (an i18n key), so a first-time
 * player does not have to invent an opening
 * A world may write its own in world.json:
 * `"tutorial": { "firstLine": "…" }` or one per locale,
 * `"tutorial": { "firstLine": { "zh-CN": "…", "ja": "…", "en": "…" } }`.
 */
export const TUTORIAL_FIRST_LINE = 'Hi — I just got here. Where am I?';

export type TutorialLocale = 'en' | 'zh-CN' | 'ja' | 'ko';

const isTutorialLocale = (value: unknown): value is TutorialLocale => value === 'en' || value === 'zh-CN' || value === 'ja' || value === 'ko';

/**
 * Pure: the tutorial's first line for this world. The WORLD's language decides
 * (a Japanese world gets a Japanese line under an English UI); a world that
 * declares no locale follows the UI. The world's own `tutorial.firstLine` wins
 * over the built-in default; a per-locale map without this language falls back
 * to the default rather than to another language.
 */
export function tutorialFirstLine(
  manifest: { locale?: unknown; tutorial?: unknown } | null | undefined,
  uiLocale: TutorialLocale,
  translate: (locale: TutorialLocale, key: string) => string,
): string {
  const locale = isTutorialLocale(manifest?.locale) ? manifest.locale : uiLocale;
  const declared = (manifest?.tutorial as { firstLine?: unknown } | undefined)?.firstLine;
  const own = typeof declared === 'string'
    ? declared
    : typeof declared === 'object' && declared !== null
      ? (declared as Record<string, unknown>)[locale]
      : undefined;
  if (typeof own === 'string' && own.trim()) return own.trim();
  return translate(locale, TUTORIAL_FIRST_LINE);
}

/** The caption's i18n key for the step. */
export function tutorialCaption(state: TutorialState, targetFound: boolean, invitePending = true, designedOptions = false): string {
  switch (state.step) {
    case 'speak': return 'Your first line is ready — send it as it is, or change it.';
    case 'follow':
      if (targetFound) return 'Let them come with you.';
      return invitePending ? 'Wait for their answer…' : 'Open your companion and ask them to come with you.';
    case 'take': return state.takenCount > 0
      ? 'Still locked — take the next item too: press “Take along”.'
      : 'This place is locked — take the item first: press “Take along”.';
    case 'enter': return 'Go into a place: rest on it (or tap it), then press “Enter place”.';
    case 'writer': return 'Open the writer.';
    case 'writer-send': return designedOptions ? 'Pick one of the options here.' : 'Send this to the writer.';
    case 'new-item':
      if (state.newItem) return 'A new item appeared';
      return state.writerSettled ? 'Nothing new this time — keep exploring.' : 'The writer is looking…';
    case 'chalk': return 'The writer set up a search — roll the dice.';
    case 'roll': return 'Roll the dice.';
    case 'found':
      if (state.newItem) return 'You found something.';
      return state.writerSettled ? 'Nothing turned up this time — keep exploring.' : 'The writer is looking…';
    default: return '';
  }
}

export function readTutorialDone(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try {
    return storage?.getItem(TUTORIAL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeTutorialDone(storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined, done: boolean): void {
  try {
    if (done) storage?.setItem(TUTORIAL_STORAGE_KEY, '1');
    else storage?.removeItem(TUTORIAL_STORAGE_KEY);
  } catch {
    /* private mode / blocked storage: the tutorial may simply run again */
  }
}

/**
 * Once per world ENTRY: what the app may
 * re-arm the tutorial on. Several paths arm it — the greeting, the return
 * greeting, entering the world by itself — and some of them fire again later in
 * the same visit (the server lost the world and the page reopened the same
 * save, the player walked back onto the entry layer, a resize re-rendered the
 * stage). None of those is a new entry: a tutorial the player skipped or
 * finished stays gone until they go back to the launcher (a page reload lands
 * there too) or pick another world. "Don't show again" wins over everything.
 */
export interface TutorialEntryLatch {
  /** The world this entry is in (null: at the launcher / no world). */
  worldId: string | null;
  /** The tutorial already armed (and maybe ended) during this entry. */
  ran: boolean;
}

export const INITIAL_TUTORIAL_LATCH: TutorialEntryLatch = { worldId: null, ran: false };

/** Pure: may this arm request start the tutorial, and the latch after it. */
export function tutorialArmOnEntry(
  latch: TutorialEntryLatch,
  worldId: string | null | undefined,
  hiddenForever: boolean,
): { latch: TutorialEntryLatch; arm: boolean } {
  if (!worldId) return { latch, arm: false };
  if (latch.worldId === worldId && latch.ran) return { latch, arm: false };
  const next = { worldId, ran: true };
  return { latch: next, arm: !hiddenForever };
}

/** The slice of a layer card the place / lock reading needs. */
export interface TutorialPlaceItem {
  path: string;
  kind?: string;
  frontmatter?: Record<string, unknown> | null;
}

function isPlaceCard(item: TutorialPlaceItem): boolean {
  const fm = item.frontmatter ?? {};
  return item.kind === 'gate' || fm.type === 'gate' || fm.visual === 'door' || item.path.endsWith('/README.md');
}

/** The paths a place asks the player to carry (`requires.items`). */
export function placeRequires(item: TutorialPlaceItem): string[] {
  const requires = item.frontmatter?.requires as { items?: unknown } | undefined;
  const items = requires?.items;
  return Array.isArray(items) ? items.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Locked: it asks for something the player does not carry. */
export function placeLocked(item: TutorialPlaceItem, carried: ReadonlySet<string>): boolean {
  return placeRequires(item).some(path => !carried.has(path));
}

/** Could be picked up: the same rule as the item popup's "take" (EntityInteractions). */
function isTakeable(item: TutorialPlaceItem): boolean {
  const fm = item.frontmatter ?? {};
  if (isPlaceCard(item)) return false;
  if (fm.type === 'character' || fm.type === 'sprite' || fm.type === 'chalk') return false;
  return item.path.startsWith('world/') && fm.portable !== false;
}

/**
 * What the `enter` step can use on this layer: whether any place opens with
 * what is carried, and — when every place is locked — the card to take first:
 * the one a lock names (same file name), else any takeable card, else null.
 */
export function tutorialPlaces(
  items: readonly TutorialPlaceItem[],
  carried: ReadonlySet<string>,
): { unlockedPlaceAvailable: boolean; lockItemPath: string | null; lockItemIsKey: boolean } {
  const places = items.filter(isPlaceCard);
  const locked = places.filter(item => placeLocked(item, carried));
  if (places.length === 0 || locked.length < places.length) {
    return { unlockedPlaceAvailable: places.length > 0, lockItemPath: null, lockItemIsKey: false };
  }
  const wanted = new Set(locked.flatMap(placeRequires).filter(path => !carried.has(path)).map(path => path.split('/').pop() ?? path));
  const takeable = items.filter(isTakeable);
  const key = takeable.find(item => wanted.has(item.path.split('/').pop() ?? item.path));
  return { unlockedPlaceAvailable: false, lockItemPath: (key ?? takeable[0])?.path ?? null, lockItemIsKey: Boolean(key) };
}
