/**
 * OnboardingGuide — one sentence, on the thing it is about, until the player
 * does it.
 *
 * The whole overlay is `pointer-events: none`, including the dim: the player
 * can click the reply box, the rail, the gate and the writer exactly as if the
 * guide were not there, and the guide has no way to trap anyone. The only
 * clickable thing is 下次不要再显示 inside the bubble, which turns its own
 * pointer events back on.
 *
 * The "hole" is a single element sized to the target with an enormous spread
 * shadow: everything outside the target darkens, the target itself is untouched
 * paint. One box, no mask, no four-band arithmetic, and nothing between the
 * pointer and the button being pointed at.
 *
 * Targets MOVE — the rail slides open on hover, the dock is a full column, the
 * writer sits bottom-right — so the box is re-measured every frame while a step
 * is pending and React is only told when it actually changed. A step whose
 * target is not on screen is not drawn at all; `currentGuideStep` then passes
 * over it (see onboarding.ts).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import {
  GUIDE_LINES,
  GUIDE_TARGET_OF,
  currentGuideStep,
  guideSelector,
  markStep,
  readGuideState,
  resetGuide,
  silenceGuide,
  stepsFor,
  writeGuideState,
  type AnyGuideStep,
  type GuideMode,
  type GuideState,
} from '../../lib/onboarding.js';
import { placeGuideBubble } from '../../lib/guide-placement.js';
import { avoidRects, DRAWER_HOSTED_TARGETS, requestDrawer } from '../../lib/drawer-layout.js';
import './onboarding-guide.css';

export interface GuideBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface OnboardingGuideHandle {
  /** The step to draw, or `null` when the guide has nothing to say. */
  step: AnyGuideStep | null;
  /** Where that step's target is, in viewport coordinates. */
  box: GuideBox | null;
  /** The player performed this move; the step clears itself. */
  mark(step: AnyGuideStep): void;
  /** 下次不要再显示 — silence the guide in every save. */
  silence(): void;
  /** "Replay the tutorial" in settings brings all four back. */
  reset(): void;
}

/** How far the bubble sits from the edge of the thing it points at. */
const BUBBLE_GAP = 16;
/** How wide the bubble is allowed to get; also the room it needs on a side. */
const BUBBLE_WIDTH = 248;
/** Kept free along every viewport edge (phones, short windows). */
const BUBBLE_MARGIN = 12;
/** The bubble's height before it has been measured once. */
const BUBBLE_ESTIMATED_HEIGHT = 110;
/** Sub-pixel jitter from a CSS transition must not re-render the overlay. */
const EPSILON = 0.5;
/** Frames between sweeps while no step is drawn and nothing can be moving. */
const IDLE_FRAMES = 10;
/** A drawer request that did not take (the drawer is still down) is repeated after this long. */
const DRAWER_RETRY_MS = 1500;

/**
 * The target's box, clipped to the viewport — or `null` when none of it is on
 * screen.
 *
 * Clipping is not cosmetic. The rail PARKS by sliding itself off the left edge
 * (`translateX(calc(-100% + 14px))`), so its options keep a perfectly good
 * rectangle at x ≈ -250 while being invisible. Pointing at that would dim the
 * scene around a hole nobody can see and put the sentence off screen; clipping
 * turns it into "no visible target", which `currentGuideStep` passes over until
 * the rail is open and the option really is there.
 */
function measure(step: AnyGuideStep): GuideBox | null {
  const own = clip(document.querySelector(guideSelector(step)));
  if (own) return own;
  // A target inside the closed drawer: the step is still on — the drawer's own line stands
  // in for it until the drawer is up (the loop asks for that, `requestDrawer`), then the real target is measured.
  // On a narrow screen a dialogue stage may hold the bottom (the line steps aside, `data-crowded`): the drawer
  // still comes up — it takes the bottom from the stage — so the step is not passed over.
  if (DRAWER_HOSTED_TARGETS[GUIDE_TARGET_OF[step]] && document.querySelector('.message-drawer')) {
    return clip(document.querySelector('.message-drawer__peek')) ?? clip(document.querySelector('.character-dock__stage'));
  }
  return null;
}

function clip(element: Element | null): GuideBox | null {
  if (!(element instanceof HTMLElement)) return null;
  const rect = element.getBoundingClientRect();
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const width = Math.min(rect.right, window.innerWidth) - left;
  const height = Math.min(rect.bottom, window.innerHeight) - top;
  if (width < 1 || height < 1) return null;
  return { top, left, width, height };
}

function same(a: GuideBox | null, b: GuideBox | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a.top - b.top) < EPSILON
    && Math.abs(a.left - b.left) < EPSILON
    && Math.abs(a.width - b.width) < EPSILON
    && Math.abs(a.height - b.height) < EPSILON;
}

/**
 * The guide's state, and the live box of whichever step is pending.
 *
 * `enabled` is the layout: `classic` has no rail, no dock and no writer FAB to
 * point at, so it passes `false` and nothing here ever runs.
 */
export function useOnboardingGuide(enabled: boolean, mode: GuideMode = 'player'): OnboardingGuideHandle {
  const [state, setState] = useState<GuideState>(readGuideState);
  const [step, setStep] = useState<AnyGuideStep | null>(null);
  const [box, setBox] = useState<GuideBox | null>(null);
  const stepRef = useRef<AnyGuideStep | null>(null);
  const boxRef = useRef<GuideBox | null>(null);
  const requestedRef = useRef<{ step: AnyGuideStep; at: number; landed: boolean } | null>(null);

  const persist = useCallback((next: GuideState) => {
    setState(next);
    writeGuideState(next);
  }, []);

  const mark = useCallback((done: AnyGuideStep) => {
    setState(current => {
      const next = markStep(current, done);
      if (next !== current) writeGuideState(next);
      return next;
    });
  }, []);

  const silence = useCallback(() => persist(silenceGuide()), [persist]);
  const reset = useCallback(() => persist(resetGuide()), [persist]);

  // One rAF loop while the guide still has something to say. It resolves the
  // first undone step whose target is actually on screen and measures it; both
  // answers are compared before touching React, so a still target costs nothing
  // but a `querySelector` per frame and a moving one animates smoothly.
  useEffect(() => {
    // `mode` picks the list: the player's four moves, or the author's three
    // inside a world they made.
    const steps = stepsFor(mode);
    if (!enabled || state.off || steps.every(one => state.done.includes(one))) {
      stepRef.current = null;
      boxRef.current = null;
      setStep(null);
      setBox(null);
      return;
    }
    let frame = 0;
    let idle = 0;
    const boxes = new Map<AnyGuideStep, GuideBox | null>();
    const tick = (): void => {
      // While nothing is drawn there is nothing to animate, so waiting for a
      // target to appear costs one sweep every tenth frame instead of every one.
      if (stepRef.current === null && idle++ % IDLE_FRAMES !== 0) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
      boxes.clear();
      const next = currentGuideStep<AnyGuideStep>(state, one => {
        const found = measure(one);
        boxes.set(one, found);
        return found !== null;
      }, steps);
      const nextBox = next === null ? null : boxes.get(next) ?? null;
      // The step's target is inside the closed drawer: pull it up on the right page, once per step.
      const hostTab = next === null ? undefined : DRAWER_HOSTED_TARGETS[GUIDE_TARGET_OF[next]];
      // Asked again if the drawer is still down a moment later (a world was still loading, a dialogue took the bottom).
      // Once the drawer has been up for the step, it is the player's: closing it again is not undone — the
      // sentence then points at the drawer's line instead.
      const now = performance.now();
      const asked = requestedRef.current;
      const shown = next !== null && hostTab ? document.querySelector(guideSelector(next)) !== null : false;
      if (shown && asked?.step === next) asked.landed = true;
      if (next !== null && hostTab && !shown
        && (asked === null || asked.step !== next || (!asked.landed && now - asked.at > DRAWER_RETRY_MS))) {
        requestedRef.current = { step: next, at: now, landed: asked?.step === next ? asked.landed : false };
        requestDrawer(hostTab);
      }
      if (stepRef.current !== next) {
        stepRef.current = next;
        setStep(next);
      }
      if (!same(boxRef.current, nextBox)) {
        boxRef.current = nextBox;
        setBox(nextBox);
      }
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, mode, state]);

  return { step, box, mark, silence, reset };
}

export function OnboardingGuide({ guide }: { guide: OnboardingGuideHandle }) {
  const { t } = useLocale();
  const { step, box } = guide;
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);
  // The bubble's natural height (its sentence unscrolled), measured after each
  // paint; an estimate until then. Only a real change re-renders.
  const [naturalHeight, setNaturalHeight] = useState(BUBBLE_ESTIMATED_HEIGHT);
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    const line = lineRef.current;
    if (!bubble || !line) return;
    const natural = bubble.offsetHeight - line.clientHeight + line.scrollHeight;
    if (natural > 0 && Math.abs(natural - naturalHeight) >= 1) setNaturalHeight(natural);
  });
  if (step === null || box === null) return null;

  // Beside the target when it fits, else above/below (above for anything in
  // the lower half), always fully inside the viewport — see guide-placement.ts.
  const place = placeGuideBubble({
    box,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    bubble: { width: BUBBLE_WIDTH, height: naturalHeight },
    gap: BUBBLE_GAP,
    margin: BUBBLE_MARGIN,
    // The same panels every pointer keeps clear of (lib/drawer-layout.ts), minus the one it points into.
    avoid: avoidRects(document.querySelector(guideSelector(step))),
  });

  return (
    <div className="onboarding-guide" data-guide-step={step} aria-live="polite">
      {/* The dim IS this element's shadow, so the target stays unpainted. */}
      <div
        className="onboarding-guide__hole"
        style={{
          top: `${Math.round(box.top)}px`,
          left: `${Math.round(box.left)}px`,
          width: `${Math.round(box.width)}px`,
          height: `${Math.round(box.height)}px`,
        }}
      />
      <div
        ref={bubbleRef}
        className="onboarding-guide__bubble"
        data-side={place.side}
        style={{
          top: `${Math.round(place.top)}px`,
          left: `${Math.round(place.left)}px`,
          width: `${Math.round(place.width)}px`,
          maxHeight: `${Math.floor(place.maxHeight)}px`,
        }}
      >
        {/* Only the sentence scrolls; 下次不要再显示 stays in view below it. */}
        <div ref={lineRef} className="onboarding-guide__scroll">
          <p className="onboarding-guide__line">{t(GUIDE_LINES[step])}</p>
        </div>
        <button type="button" className="onboarding-guide__off" onClick={guide.silence}>
          {t('Don’t show this again')}
        </button>
      </div>
    </div>
  );
}
