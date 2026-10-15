/**
 * onboarding.ts — the four things a player has to discover, and when each one
 * has been discovered.
 *
 * This is NOT the four-step spotlight tour that was deleted on 2026-09-20. That
 * one ran BEFORE play: a dim sheet, a 下一步 button, four screens of explanation,
 * and only then the greeter. It turned the first scene into a manual, which is
 * the one thing the first scene must never be.
 *
 * This one never runs ahead of the player. Each step waits for the player to do
 * the real thing and then clears itself — no 下一步, no step counter, nothing to
 * click through. The sentence is on screen only while its move is still
 * undiscovered, and the move that clears it is the move itself:
 *
 *   speak   — the companion's answer lands
 *   options — a choice on the left rail resolves
 *   enter   — the player reaches a layer that is not the world's entry
 *   writer  — a writer turn is accepted
 *
 * So a player who already knows the game never sees a sentence: they speak,
 * choose, enter and write, and each step is marked done by the doing.
 *
 * Pure on purpose — no DOM, no React. The component owns measuring and drawing,
 * this module owns "which step, if any" so the rules are testable as rules
 * (`apps/web/test/onboarding-guide.test.mjs`).
 */

/** The four moves, in the order a first-time player meets them. */
export const GUIDE_STEPS = ['speak', 'options', 'enter', 'writer'] as const;
export type GuideStep = (typeof GUIDE_STEPS)[number];

/**
 * The author's three moves inside a world they made.
 * Same rules as the player's four — one sentence on the control, cleared by
 * doing — but a different list, because a blank world has nobody to speak to
 * and no options yet, and its first move is to tell the writer what it is:
 *
 *   build   — a writer turn is accepted in the author's own world
 *   god     — God Hand is switched on (moving and editing what the writer wrote)
 *   home    — the author goes back to the launcher, where Publish lives
 */
export const CREATOR_STEPS = ['build', 'god', 'home'] as const;
export type CreatorStep = (typeof CREATOR_STEPS)[number];
/**
 * The hand-over from the first-run prologue: a player who finished 末班车 · 序章 already spoke,
 * chose, rolled and walked through a door there — the one thing it never taught is the writer. In the full 末班车
 * opened from the prologue's ending (lib/first-run.ts isHandoffWorld) the guide says only that, once, on the writer button:
 *
 *   beyond  — a writer turn is accepted
 */
export const HANDOFF_STEPS = ['beyond'] as const;
export type HandoffStep = (typeof HANDOFF_STEPS)[number];
export type AnyGuideStep = GuideStep | CreatorStep | HandoffStep;
export type GuideMode = 'player' | 'creator' | 'handoff';
export const stepsFor = (mode: GuideMode): readonly AnyGuideStep[] => (mode === 'creator' ? CREATOR_STEPS : mode === 'handoff' ? HANDOFF_STEPS : GUIDE_STEPS);

/**
 * What each step points at. The attribute is the contract: a component marks
 * the element it wants pointed at and this module never learns its class names,
 * so restyling the rail or the dock cannot silently aim the guide at nothing.
 */
export const GUIDE_TARGET_ATTR = 'data-guide-target';

/**
 * Which marked element each step points at. Almost always the step's own name;
 * the author's `build` points at the SAME writer button the player's `writer`
 * does, so the FAB carries one attribute and the two lists share the target.
 */
export const GUIDE_TARGET_OF: Record<AnyGuideStep, string> = {
  speak: 'speak', options: 'options', enter: 'enter', writer: 'writer',
  build: 'writer', god: 'god', home: 'home',
  beyond: 'writer',
};

export function guideSelector(step: AnyGuideStep): string {
  return `[${GUIDE_TARGET_ATTR}="${GUIDE_TARGET_OF[step]}"]`;
}

/** The one sentence each step says. i18n keys, resolved with `t()` at render. */
export const GUIDE_LINES: Record<AnyGuideStep, string> = {
  speak: 'Say something back — that is how it starts.',
  options: 'Everything you can do here is in this column.',
  enter: 'This one opens the next scene.',
  writer: 'To change the scene itself, ask the writer.',
  build: 'This world is blank. Tell the writer what it is — its places, its people — and it will build them.',
  god: 'God Hand lets you move and edit anything the writer wrote.',
  home: 'When it feels ready, go back to the hall: Publish lives on your world’s brick.',
  beyond: 'Want to do something the options don’t offer? Tell the writer.',
};

export interface GuideState {
  /** Steps the player has already performed, in no particular order. */
  done: AnyGuideStep[];
  /** 下次不要再显示 — the player asked for silence, in every save. */
  off: boolean;
}

/**
 * Where the guide is remembered.
 *
 * **Not the save.** The greeting IS the save's (`.airpworld/opening.json`, one
 * key, written by the server): whoever opens that save has met the greeter, and
 * someone starting a fresh save on the same machine has not. Learning the three
 * columns is the opposite — it belongs to the PERSON at the keyboard. A player
 * who ticked 下次不要再显示 means every save, including the ones they have not
 * made yet, so this is `localStorage` and deliberately not the opening marker.
 */
export const GUIDE_STORAGE_KEY = 'airp.guide';

export const EMPTY_GUIDE_STATE: GuideState = { done: [], off: false };

export function isGuideStep(value: unknown): value is GuideStep {
  return typeof value === 'string' && (GUIDE_STEPS as readonly string[]).includes(value);
}

export function isCreatorStep(value: unknown): value is CreatorStep {
  return typeof value === 'string' && (CREATOR_STEPS as readonly string[]).includes(value);
}

export const isHandoffStep = (value: unknown): value is HandoffStep => typeof value === 'string' && (HANDOFF_STEPS as readonly string[]).includes(value);
export const isAnyGuideStep = (value: unknown): value is AnyGuideStep => isGuideStep(value) || isCreatorStep(value) || isHandoffStep(value);

/** Pure: the state a stored payload means, with anything unrecognised dropped. */
export function parseGuideState(raw: unknown): GuideState {
  if (typeof raw !== 'object' || raw === null) return EMPTY_GUIDE_STATE;
  const source = raw as { done?: unknown; off?: unknown };
  const done = Array.isArray(source.done) ? source.done.filter(isAnyGuideStep) : [];
  return { done: [...new Set(done)], off: source.off === true };
}

/** Never throws: private mode denies storage and the guide simply starts over. */
export function readGuideState(): GuideState {
  try {
    const stored = localStorage.getItem(GUIDE_STORAGE_KEY);
    return stored === null ? EMPTY_GUIDE_STATE : parseGuideState(JSON.parse(stored));
  } catch {
    return EMPTY_GUIDE_STATE;
  }
}

/** Failure is survivable: the session still applies the state it is holding. */
export function writeGuideState(state: GuideState): void {
  try {
    localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode: the guide lives for this session only */
  }
}

/** Pure: this step has now been performed. Idempotent. */
export function markStep(state: GuideState, step: AnyGuideStep): GuideState {
  if (state.done.includes(step)) return state;
  return { ...state, done: [...state.done, step] };
}

/**
 * Pure: 下次不要再显示.
 *
 * Every step is marked done as well as the flag being set, so clearing the flag
 * alone can never resurrect a half-finished guide — only `resetGuide` does.
 */
export function silenceGuide(): GuideState {
  return { done: [...GUIDE_STEPS, ...CREATOR_STEPS, ...HANDOFF_STEPS], off: true };
}

/** Pure: what "Replay the tutorial" means for the guide. */
export function resetGuide(): GuideState {
  return { done: [], off: false };
}

/**
 * Pure: the step to show right now, or `null` for no overlay at all.
 *
 * `present` answers "is this step's target on screen"; a step whose target is
 * missing is passed over rather than pointed at — a world with no gate on this
 * layer has nothing to say about gates, and a guide stuck on an absent target
 * would sit there dimming the scene forever. Passing over does NOT mark it
 * done: if the target turns up later and the step is still the first undone one
 * with a target, it gets its turn then.
 */
export function currentGuideStep<S extends AnyGuideStep = GuideStep>(
  state: GuideState,
  present: (step: S) => boolean,
  steps: readonly S[] = GUIDE_STEPS as unknown as readonly S[],
): S | null {
  if (state.off) return null;
  for (const step of steps) {
    if (state.done.includes(step)) continue;
    if (present(step)) return step;
  }
  return null;
}
