import { track } from '../../lib/analytics.js';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isRevealHeld, subscribeCeremony } from '../../lib/dice-ceremony.js';
import { useLocale } from '../../lib/i18n.js';
import { usePerformanceInProgress } from '../../lib/stage-performance.js';
import {
  INITIAL_PACING,
  INITIAL_TUTORIAL,
  TUTORIAL_WRITER_PROMPT,
  advanceTutorial,
  continueTutorial,
  finishTutorial,
  pacingStep,
  pacingWakeAt,
  tutorialPacingKey,
  tutorialPhase,
  tutorialAllowed,
  tutorialCaption,
  TUTORIAL_WAIT_CAPTIONS,
  tutorialTargets,
  writeTutorialDone,
  type TutorialPacing,
  type TutorialSnapshot,
  type TutorialState,
  type TutorialStep,
} from '../../lib/forced-tutorial.js';
import { placeGuideBubble } from '../../lib/guide-placement.js';
import { avoidRects, NARROW_LAYOUT_QUERY, requestDrawer, requestDrawerDown } from '../../lib/drawer-layout.js';
import './forced-tutorial.css';

/**
 * The forced first-run tutorial. A dim mask over the whole
 * screen with a cut-out on the one thing to do; presses anywhere else are
 * swallowed at the window's capture phase, so the app never sees them. A step
 * whose target is not on screen shows its caption centred and lets presses
 * through instead — the player is never locked out.
 *
 * It never talks over the stage: while a performance plays
 * (lib/stage-performance — the writer, the dice, an item / new-scene card, a
 * CG, a character answering) and for a short quiet window after it, there is
 * no mask, no caption and nothing is swallowed; only a small "skip" pill
 * stays. The next step's guidance shows once the stage is still
 * (`pacingStep` / `tutorialPhase` in lib/forced-tutorial.ts).
 *
 * Entering a world, the world comes first: while it is still
 * arriving (`arriving` — the opening scene card, the greeting not yet
 * delivered) and through the greeting's answer / voice and the quiet beat
 * after, nothing of the tutorial renders at all; the first guidance is the
 * first thing it ever shows.
 */
export interface ForcedTutorialProps {
  snapshot: TutorialSnapshot;
  /** Put the tutorial's writer prompt in the writer's box. */
  onPrefillWriter(text: string): void;
  /** A prompt went to the writer and its first frame is not back yet: already a performance. */
  writerSubmitPending?: boolean;
  /**
   * The world's arrival is still playing (`tutorialArrivalPending`: loading,
   * the opening scene card, the greeting not yet delivered). Nothing of the
   * tutorial shows — not even the skip pill — and its first look waits for the
   * stage to go still after it.
   */
  arriving?: boolean;
  /**
   * The step now showing; null until the first guidance has shown. The app
   * pre-fills the reply box with the world's first line while it is `speak`
   * — never during the arrival, where focusing the box would
   * also raise a phone's keyboard over the first look.
   */
  onStep?(step: TutorialStep | null): void;
  /**
   * Finished, skipped this time, or turned off. Only "Don't show again" is
   * persisted (already written when this runs); the others show it again on
   * the next world entry.
   */
  onEnd(): void;
}

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 6;
/** Never swallowed: notices the player must be able to read and close mid-tutorial. */
const TUTORIAL_ALWAYS_ALLOWED = '.tts-notice, .world-toast-region';
const BUBBLE_W = 280;
/**
 * Presses guarded outside the highlight. Releases (pointerup / mouseup /
 * touchend / pointercancel) are NEVER swallowed: swallowing them left a drag
 * begun on the canvas stuck forever, following the mouse
 * Wheel is not guarded either, so
 * the player can still zoom to a target that sits off-screen.
 */
const SWALLOWED = ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'touchstart'] as const;
/**
 * What a guarded press may NOT reach outside the highlight: controls and cards.
 * A press on empty stage passes, so the player can pan the canvas / map to
 * bring the highlighted thing into view (「我不能拖拽屏幕，它有时候挡在下面看不到」).
 */
const INTERACTIVE = 'button, a[href], input, textarea, select, summary, label, [role="button"], [role="menuitem"], [role="tab"], [contenteditable="true"], [data-path], .object, .map-pin';

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5
    && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

/** The first element, by selector preference, that is actually visible inside the viewport. */
function findTarget(selectors: readonly string[]): HTMLElement | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (const selector of selectors) {
    let nodes: NodeListOf<HTMLElement>;
    try { nodes = document.querySelectorAll<HTMLElement>(selector); } catch { continue; }
    for (const node of nodes) {
      const r = node.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
      return node;
    }
  }
  return null;
}

export function ForcedTutorial({ snapshot, onPrefillWriter, writerSubmitPending = false, arriving = false, onStep, onEnd }: ForcedTutorialProps): React.ReactElement | null {
  const { t } = useLocale();
  const [state, setState] = useState<TutorialState>(() => advanceTutorial(INITIAL_TUTORIAL, snapshot));
  const [rect, setRect] = useState<Rect | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // What only the screen knows, merged into the app's snapshot: whether the
  // dice ceremony still holds the search chalk's result back, and whether its
  // roll button is showing (the chalk / its dialog is open).
  const chalk = state.chalk;
  const held = useSyncExternalStore(subscribeCeremony, () => chalk !== null && isRevealHeld(chalk));
  const [rollShown, setRollShown] = useState(false);
  const merged = useMemo<TutorialSnapshot>(() => ({
    ...snapshot,
    heldPaths: held && chalk ? [chalk] : [],
    rollControlShown: rollShown,
  }), [snapshot, held, chalk, rollShown]);
  const mergedRef = useRef(merged);
  mergedRef.current = merged;
  useEffect(() => {
    setState(current => advanceTutorial(current, merged));
  }, [merged]);

  // Pacing: hold the guidance while the stage performs, and a beat after.
  // A roll the player just asked for is already the dice's: its result is held
  // back until the ceremony (which then performs) — no caption over the wait.
  // The world's arrival counts as one more performance: its end starts the quiet beat.
  const stagePerforming = usePerformanceInProgress(writerSubmitPending);
  const performing = stagePerforming || arriving || (held && state.step === 'roll');
  const pacingKey = tutorialPacingKey(state);
  const [pacing, setPacing] = useState<TutorialPacing>(INITIAL_PACING);
  const stateForPacing = useRef(state);
  stateForPacing.current = state;
  useEffect(() => {
    setPacing(current => pacingStep(current, { state: stateForPacing.current, performing, now: Date.now() }));
  }, [pacingKey, performing]);
  // The clock: wake when the quiet window (or the hang cap) runs out.
  const [, setClock] = useState(0);
  useEffect(() => {
    const at = pacingWakeAt(pacing, Date.now());
    if (at === null) return;
    const timer = window.setTimeout(() => setClock(n => n + 1), Math.max(0, at - Date.now()) + 16);
    return () => window.clearTimeout(timer);
  }, [pacing]);
  // Before the first pacing pass lands: never guidance (the first look waits its quiet beat).
  const phase = pacing.key === '' ? (performing ? 'performing' : 'settling') : tutorialPhase(pacing, Date.now());
  const guiding = phase === 'waiting' && !arriving;
  // Until the first guidance has shown, the tutorial is invisible: the first
  // look belongs to the world (no mask, no caption, no skip pill).
  const [firstLook, setFirstLook] = useState(true);
  useEffect(() => { if (guiding) setFirstLook(false); }, [guiding]);
  const hidden = firstLook && !guiding;

  // "Skip this time": ends it now and writes nothing — the next world
  // entry shows it again. Only "Don't show again" is remembered.
  const ended = useRef(false);
  const end = useCallback(() => {
    if (!ended.current) skipping.current = true;
    ended.current = true;
    setState(current => finishTutorial(current));
    onEnd();
  }, [onEnd]);
  const neverAgain = useCallback(() => {
    writeTutorialDone(typeof window === 'undefined' ? null : window.localStorage, true);
    end();
  }, [end]);
  // 改进产品 (lib/analytics.ts): each step shown, and how it ended (done, or skipped with 「Skip this time」 / 「Don't show again」).
  const skipping = useRef(false);
  const shownStep = useRef<string | null>(null);
  useEffect(() => {
    const prev = shownStep.current;
    if (prev === state.step) return;
    if (prev && prev !== 'done') track('tutorial_step', { step: prev, action: skipping.current ? 'skipped' : 'done' });
    if (state.step !== 'done') track('tutorial_step', { step: state.step, action: 'shown' });
    shownStep.current = state.step;
  }, [state.step]);
  // The search is over: on to moving somewhere else (search comes before the move).
  const next = useCallback(() => {
    setState(current => continueTutorial(current, mergedRef.current));
  }, []);

  // Tell the app which step is showing; entering a new place is the last
  // step, and walking in ends the tutorial the same way "Done" used to.
  useEffect(() => {
    onStep?.(firstLook ? null : state.step);
    if (state.step === 'done' && !ended.current) {
      ended.current = true;
      onEnd();
    }
  }, [state.step, firstLook, onStep, onEnd]);

  // The writer step's prompt goes in once, as the send step begins.
  const prefilled = useRef(false);
  useEffect(() => {
    if (state.step !== 'writer-send' || prefilled.current) return;
    prefilled.current = true;
    // Authored options: the tutorial points at them; nothing is typed for the player.
    if (snapshot.designedOptions) return;
    onPrefillWriter(t(TUTORIAL_WRITER_PROMPT));
  }, [state.step, onPrefillWriter, t, snapshot.designedOptions]);

  // Track the target every frame: cards animate, sheets slide, the camera pans.
  const selectorKey = tutorialTargets(state).join('\n');
  useLayoutEffect(() => {
    let frame = 0;
    const selectors = selectorKey ? selectorKey.split('\n') : [];
    const rollSelector = chalk ? `[data-dice-roll="${chalk.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]` : null;
    const tick = () => {
      if (rollSelector) {
        const shown = findTarget([rollSelector]) !== null;
        setRollShown(current => (current === shown ? current : shown));
      }
      const el = findTarget(selectors);
      targetRef.current = el;
      const r = el?.getBoundingClientRect();
      const next = r ? { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 } : null;
      setRect(current => (sameRect(current, next) ? current : next));
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [selectorKey, chalk]);

  // The last step can fall back to a place listed in the drawer's 「选项」 page: with no
  // gate on screen, pull the drawer up on that page once, then point at the place there.
  const drawerAsked = useRef<string | null>(null);
  useEffect(() => {
    if (state.step !== 'enter' || rect !== null || drawerAsked.current === state.step) return;
    // A short grace: the gate is usually found on the next frames (cards land, the camera settles).
    const timer = window.setTimeout(() => {
      if (targetRef.current || !document.querySelector('.message-drawer')) return;
      drawerAsked.current = state.step;
      requestDrawer('options');
    }, 900);
    return () => window.clearTimeout(timer);
  }, [state.step, rect]);

  // The steps that point at the dialogue stage (speak, follow): on a narrow screen the drawer may be up in its
  // place — lower it, so the stage comes back and the step points at the real reply box.
  useEffect(() => {
    if ((state.step !== 'speak' && state.step !== 'follow') || rect !== null) return;
    if (!document.querySelector(".message-drawer[data-open='true']")) return;
    // Only where the two share the bottom; on a wide screen the stage has its own column.
    if (!window.matchMedia?.(NARROW_LAYOUT_QUERY).matches) return;
    requestDrawerDown();
  }, [state.step, rect]);

  // The bubble's real height, for the shared placement (lib/guide-placement.ts).
  const [bubbleHeight, setBubbleHeight] = useState(120);
  // Its NATURAL height (scrollHeight), never the capped one: measuring the capped box feeds the cap back into
  // the placement and the two can chase each other every frame.
  useLayoutEffect(() => {
    const h = bubbleRef.current?.scrollHeight ?? 0;
    if (h > 0 && Math.abs(h - bubbleHeight) >= 1) setBubbleHeight(h);
  });

  // Swallow presses outside the highlight (and the bubble) while a target is
  // highlighted. Never while the stage performs or settles: the performance is
  // the point, and its own controls (skip a card, the dice) must work.
  const hasTarget = rect !== null;
  useEffect(() => {
    if (state.step === 'done' || !guiding || !hasTarget) return;
    const allowed = tutorialAllowed(state.step);
    const guard = (event: Event) => {
      const node = event.target instanceof Node ? event.target : null;
      if (!node) return;
      if (bubbleRef.current?.contains(node)) return;
      // System notices (voice unavailable, toasts) always stay dismissable.
      if (node instanceof Element && node.closest(TUTORIAL_ALWAYS_ALLOWED)) return;
      const target = targetRef.current;
      if (target?.contains(node)) {
        const { step: current, newItem } = stateRef.current;
        if (event.type === 'click' && (current === 'new-item' || current === 'found') && newItem) {
          window.setTimeout(next, 0);
        }
        return;
      }
      if (allowed && node instanceof Element && node.closest(allowed)) return;
      // Empty stage: let pan / drag through; only controls and cards are held.
      if (node instanceof Element && !node.closest(INTERACTIVE)) return;
      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
    };
    for (const type of SWALLOWED) window.addEventListener(type, guard, { capture: true, passive: false });
    return () => {
      for (const type of SWALLOWED) window.removeEventListener(type, guard, { capture: true });
    };
  }, [state.step, guiding, hasTarget, next]);

  if (state.step === 'done') return null;
  // The arrival and its quiet beat: the first look is the world's alone.
  if (hidden) return null;

  // Performing / settling: the stage is the player's; only the way out stays.
  if (!guiding) {
    return (
      <div className="forced-tutorial forced-tutorial--paused" data-tutorial-step={state.step} data-tutorial-phase={phase} data-tutorial-locked="false">
        <div ref={bubbleRef} className="forced-tutorial__pause">
          <button type="button" className="forced-tutorial__skip" onClick={end}>{t('Skip this time')}</button>
          <button type="button" className="forced-tutorial__skip forced-tutorial__never" onClick={neverAgain}>{t("Don't show again")}</button>
        </div>
      </div>
    );
  }

  const caption = tutorialCaption(state, hasTarget, snapshot.followInvitePending ?? false, snapshot.designedOptions ?? false);
  // Something PLAYING outlived the cap (or the invitation is late): a plain status line, no dim.
  const status = !hasTarget && TUTORIAL_WAIT_CAPTIONS.has(caption);
  const showContinue = (state.step === 'new-item' || state.step === 'found') && (state.newItem !== null || state.writerSettled);
  // The last step with no place on screen to go into: the player can still close it.
  const showDone = state.step === 'enter' && !hasTarget;

  let bubbleStyle: React.CSSProperties;
  if (rect) {
    // One placement for every pointer: the guide's rule — beside, else above / below, inside
    // the viewport — and clear of the drawer, the writer sheet and a dialogue stage unless the target is in it.
    const place = placeGuideBubble({
      box: rect,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      bubble: { width: BUBBLE_W, height: bubbleHeight },
      gap: 12,
      margin: 16,
      avoid: avoidRects(targetRef.current),
    });
    bubbleStyle = { left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight, overflowY: 'auto' };
  } else {
    bubbleStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: BUBBLE_W };
  }

  return (
    <div className="forced-tutorial" data-tutorial-step={state.step} data-tutorial-phase={phase} data-tutorial-locked={hasTarget ? 'true' : 'false'}>
      {rect ? (
        <div
          className="forced-tutorial__hole"
          aria-hidden="true"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      ) : status ? null : (
        <div className="forced-tutorial__veil" aria-hidden="true" />
      )}
      <div ref={bubbleRef} className="forced-tutorial__bubble" role="status" aria-live="polite" style={bubbleStyle}>
        <p className="forced-tutorial__caption">{t(caption)}</p>
        {state.step === 'writer-send' && !snapshot.designedOptions && (
          <p className="forced-tutorial__quote">「{t(TUTORIAL_WRITER_PROMPT)}」</p>
        )}
        <div className="forced-tutorial__actions">
          <button type="button" className="forced-tutorial__skip" onClick={end}>{t('Skip this time')}</button>
          <button type="button" className="forced-tutorial__skip forced-tutorial__never" onClick={neverAgain}>{t("Don't show again")}</button>
          {showContinue && (
            <button type="button" className="forced-tutorial__done" onClick={next}>{t('Continue')}</button>
          )}
          {showDone && (
            <button type="button" className="forced-tutorial__done" onClick={end}>{t('Done')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
