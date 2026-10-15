/**
 * The ending chrome for worlds with endings (the design notes;
 * `semi` worlds have endings without a clock):
 *   - while playing: a small clock badge (label + steps left), closed worlds only;
 *   - when the ending arrives, in this order
 *
 * 1. the ending — the finale (the design notes：
 *          「结算页面现在已经很酷了，但可以做得再酷一点」): a staged reveal over the
 *          ending CG, full-bleed — title card → the picture with a slow push and
 *          the epilogue → the summary → what remains undiscovered (silhouettes,
 *          no spoilers) → the actions (lib/finale.ts holds the beats);
 * 2. the 复盘 / debrief, optional and
 *          reopenable: one question per step; answers never change the ending;
 *       3. the results — secrets unlocked (surface vs hidden) with the clue that
 *          proved each, the epilogues and hidden-ending cards they unlock, beside
 *          the settlement (time, moves, clock, dice, places, clues, endings;
 *          unseen things show as ？？？ silhouettes);
 *   - after closing it: an epilogue strip, because only conversation remains
 *     and the player should know why nothing else responds.
 * Reduced motion or effects off = the same page, static, at its final beat.
 * The sequence is a stage performance (lib/stage-performance.ts `ending`), so
 * the forced tutorial waits for it. Renders nothing for an open world.
 */
import { asWord, track } from '../../lib/analytics.js';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { airpGateway } from '../../lib/airp-gateway.js';
import { useLocale } from '../../lib/i18n.js';
import { useStill } from '../../lib/motion.js';
import { usePerformanceSettings } from '../../lib/performance-settings.js';
import { playFoley } from '../../lib/audio.js';
import { performingSources, setPerforming, subscribePerforming } from '../../lib/stage-performance.js';
import {
  hasEndingChrome,
  minutesBetween,
  readEndingCollection,
  recordEnding,
  spanParts,
  submitDebrief,
  unansweredIds,
  verdictMark,
} from '../../lib/closed-run.js';
import { diceTally } from '../../lib/dice-tier.js';
import { DiceTierLine } from '../narrative/DiceTierLine.js';
import type { ClosedRunDebrief, ClosedRunState, ClosedRunSummary, DebriefResult } from '../../lib/closed-run.js';
import {
  BEAT_HOLD_MS,
  FINALE_BEATS,
  FINALE_LAST,
  SILHOUETTE_CAP,
  anythingRemains,
  beatShown,
  decodeBeforeReveal,
  finaleAnimated,
  finalePerforming,
  finaleWaitsFor,
  nextBeat,
  openingBeat,
  proofLabel,
  remainsOf,
  type FinaleBeat,
} from '../../lib/finale.js';
import { buildResultCard, cardBlob, resultShareText, type ResultCardInput } from '../../lib/result-share.js';
import { loadResultCardRenderer } from '../../lib/share-card-loader.js';
import { HoverPanel } from './StatePanels.js';
import { CG_SHOWN_DOM, cgReplayDetail } from '../../lib/cg-reveal.js';
import { accountData } from '../../lib/account-data.js';
import { askGuestToSignIn, GUEST_ENDING_PROMPT_MS } from '../../lib/guest-trial.js';
import { ShareResultButton } from './ShareResultButton.js';
import './closed-run.css';

/** The companion's last words on this save (App reads them from the dialogue scrollback). */
export interface FinaleCompanion {
  name: string;
  avatar: string | null;
  line: string | null;
}

export interface ClosedRunProps {
  run: ClosedRunState;
  /** The world (template) id: the ending collection is kept per world. */
  worldId: string;
  /** The world's display name, for the title card's kicker and the share card. */
  worldName?: string;
  /** Start a fresh save of the same world. */
  onPlayAgain(): void;
  /** Back to the world launcher (回大厅). Absent: the button is not shown. */
  onLobby?(): void;
  /** Whose closing line the summary quotes; null / absent: none. */
  companion?: FinaleCompanion | null;
  /**
   * Something covers the page (the world launcher, a world loading): the finale
   * holds on its title, silent, and starts its sequence once uncovered.
   */
  held?: boolean;
  /**
   * The world hover panel, given the clock's
   * own line. When set, the clock badge becomes its hover/focus/tap anchor.
   */
  worldPanel?: (clockLine: string) => React.ReactNode;
  /**
   * The first-run prologue's ending: instead of play again / debrief / back to the lobby,
   * a recap of what the player just did and two choices — the full 末班车 (no sign-in needed) or every world. No
   * sign-in prompt is stacked on top of it (§1.2).
   */
  prologue?: {
    recap: string | null;
    /** The first choice's world name and its one line (time, what it is). */
    next: { name: string; line: string };
    onNext(): void;
    onAllWorlds(): void;
  } | null;
}

const UNKNOWN = '？？？';

type Phase = 'ending' | 'debrief' | 'results';

type Reveal = { 'data-beat': FinaleBeat; 'data-shown'?: 'true'; inert?: boolean };

/** `data-shown` for one beat's section: the CSS reveals it with opacity / transform only. */
function shownAttr(beat: number, section: FinaleBeat): Reveal {
  return beatShown(beat, section) ? { 'data-beat': section, 'data-shown': 'true' } : { 'data-beat': section, inert: true };
}

export function ClosedRun({ run, worldId, worldName = '', onPlayAgain, onLobby, companion, held = false, worldPanel, prologue = null }: ClosedRunProps): React.ReactElement | null {
  const { t, locale } = useLocale();
  const reducedMotion = useStill();
  const settings = usePerformanceSettings();
  const animated = finaleAnimated(reducedMotion, settings.effectsEnabled);
  const endingId = run.ending?.id ?? null;
  const [cardOpen, setCardOpen] = useState(true);
  const [phase, setPhase] = useState<Phase>('ending');
  const [beat, setBeat] = useState(() => openingBeat(animated));
  const [pictureReady, setPictureReady] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // The debrief's answer comes back in the POST response; kept here until the
  // next read of the run catches up (App owns the run state).
  const [answered, setAnswered] = useState<ClosedRunDebrief | null>(null);
  const [collection, setCollection] = useState<Record<string, string>>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stungRef = useRef<string | null>(null);
  const prologueRef = useRef(prologue);
  prologueRef.current = prologue;
  const bg = run.ending?.bg ? airpGateway.assetUrl(run.ending.bg, undefined, 'image') : null;
  // A newly reached ending always shows its card from the first beat, and joins the collection.
  useEffect(() => {
    setCardOpen(true);
    setPhase('ending');
    setAnswered(null);
    setShareOpen(false);
    setBeat(openingBeat(animated));
    setPictureReady(false);
    if (!worldId) return;
    setCollection(run.ending ? recordEnding(worldId, run.ending.id, run.ending.title) : readEndingCollection(worldId));
    // 邀请好友: a first ending → billing (the inviter's reward once the play is real). Best effort, signed in only.
    if (run.ending) void accountData()?.reportMilestone('first_clear', { world: worldId, ending: run.ending.id });
    if (run.ending) track('ending_reached', { ending: asWord(run.ending.id) }, worldId);
    // The guest trial: an ending reached as a guest → sign in to keep the run (once, after the card has had its moment).
    if (!run.ending) return;
    // The prologue's ending card IS the choice: no account panel over it.
    if (prologueRef.current) return;
    const ask = window.setTimeout(() => { askGuestToSignIn('ending'); }, GUEST_ENDING_PROMPT_MS);
    return () => window.clearTimeout(ask);
  }, [endingId, worldId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effects switched off (or reduced motion turned on) mid-sequence: land on the final beat.
  useEffect(() => { if (!animated) setBeat(FINALE_LAST); }, [animated]);

  // Decode the CG before the veil lifts, so it never pops in half-drawn.
  useEffect(() => {
    if (!endingId) return;
    let live = true;
    void decodeBeforeReveal(bg).then(() => { if (live) setPictureReady(true); });
    return () => { live = false; };
  }, [endingId, bg]);

  // Another presentation on stage (a scene card, a CG) plays out first, and a
  // covered page (the launcher) waits to be seen: the finale holds on its title,
  // silent, until the stage is quiet.
  const stageBusy = useSyncExternalStore(subscribePerforming, () => finaleWaitsFor(performingSources()), () => false) || held;

  // The sting: once per ending reached, as the title lands. The world theme keeps
  // playing under it (continuity); playFoley is silent when muted or hidden.
  useEffect(() => {
    if (!endingId || !cardOpen || stageBusy || stungRef.current === endingId) return;
    stungRef.current = endingId;
    playFoley('scene-sting', 0.9);
  }, [endingId, cardOpen, stageBusy]);

  // The beats. The title holds until its time, the CG's decode and the stage are all done.
  const sequencing = Boolean(endingId) && cardOpen && phase === 'ending' && animated && beat < FINALE_LAST;
  useEffect(() => {
    if (!sequencing) return;
    if (beat === 0 && (!pictureReady || stageBusy)) return;
    const timer = setTimeout(() => setBeat((b) => nextBeat(b)), BEAT_HOLD_MS[FINALE_BEATS[beat]]);
    return () => clearTimeout(timer);
  }, [sequencing, beat, pictureReady, stageBusy]);

  // The sequence is a performance: the forced tutorial (and anything else that must not talk over it) waits.
  const performing = Boolean(endingId) && animated && finalePerforming(cardOpen && phase === 'ending', beat);
  useEffect(() => { setPerforming('ending', performing); }, [performing]);
  useEffect(() => () => setPerforming('ending', false), []);

  // Focus moves into the finale when it opens, so Esc / Enter / Space reach it.
  useEffect(() => {
    if (cardOpen && endingId) rootRef.current?.focus({ preventScroll: true });
  }, [cardOpen, endingId]);

  const skip = useCallback(() => setBeat(FINALE_LAST), []);

  const shareCard = useMemo<ResultCardInput | null>(
    () => buildResultCard(run, { locale, worldId, worldName, picture: bg ? new URL(bg, window.location.href).href : null, collection }),
    [run, locale, worldId, worldName, bg, collection],
  );

  if (!hasEndingChrome(run.mode)) return null;

  if (run.ending) {
    const debrief = run.debrief?.result ? run.debrief : answered ?? run.debrief ?? null;
    const pending = Boolean(debrief && !debrief.result);
    const reopen = () => { setCardOpen(true); setBeat(FINALE_LAST); setPhase(pending ? 'ending' : 'results'); };
    const settled = Boolean(run.summary) && (phase === 'results' || !pending);
    const stillPlaying = phase === 'ending' && beat < FINALE_LAST;
    const at = phase === 'ending' ? beat : FINALE_LAST;
    const close = () => { setShareOpen(false); setCardOpen(false); };
    return (
      <>
        {cardOpen && (
          <div
            ref={rootRef}
            className="closed-ending"
            role="dialog"
            aria-modal="true"
            aria-labelledby="closed-ending-title"
            tabIndex={-1}
            data-animated={animated ? 'true' : 'false'}
            data-beat={FINALE_BEATS[at]}
            data-phase={phase}
            data-picture={bg ? (pictureReady ? 'ready' : 'loading') : 'none'}
            data-grain={settings.effectsEnabled && settings.canvasGrain ? 'true' : undefined}
            onClick={stillPlaying ? skip : undefined}
            onKeyDown={(e) => {
              if (!stillPlaying) return;
              if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); skip(); }
            }}
          >
            {/* The stage: the ending CG full-bleed, the title veil, vignette and grain — static layers;
                only the picture's transform and the veil's opacity ever animate. */}
            <div className="closed-ending__stage" aria-hidden="true">
              {bg && <img className="closed-ending__picture" src={bg} alt="" decoding="async" draggable={false} />}
              <div className="closed-ending__scrim" />
              <div className="closed-ending__veil" />
              <div className="closed-ending__vignette" />
            </div>
            <div className="closed-ending__scroll">
              {phase === 'debrief' && debrief ? (
                <div className="closed-ending__card closed-ending__card--quiz">
                  <DebriefQuiz
                    debrief={debrief}
                    onCancel={() => setPhase('ending')}
                    onDone={(next) => { setAnswered(next); setPhase('results'); }}
                  />
                </div>
              ) : (
                <div className="closed-ending__card">
                  <header className="closed-ending__hero" {...shownAttr(at, 'title')}>
                    <p className="closed-ending__kicker">
                      {t('Ending')}{worldName && <span className="closed-ending__world"> · {worldName}</span>}
                    </p>
                    <h2 id="closed-ending-title" className="closed-ending__title">{run.ending.title}</h2>
                  </header>
                  <div className="closed-ending__columns" data-phase={phase} data-settled={settled ? 'true' : undefined}>
                    <div className="closed-ending__text closed-ending__panel" {...shownAttr(at, 'picture')}>
                      {phase === 'ending'
                        ? run.ending.body.split(/\n\s*\n/).map((para, i) => <p key={i} className="closed-ending__body">{para}</p>)
                        : debrief?.result && <DebriefEpilogues result={debrief.result} />}
                      {settled && companion?.line && <CompanionLine companion={companion} />}
                    </div>
                    {/* The settlement follows the debrief; with no debrief (or once done) it sits beside the ending. */}
                    {run.summary && (phase === 'results' || !pending) && (
                      <Settlement
                        summary={run.summary}
                        collection={collection}
                        clockLabel={run.clock?.label ?? null}
                        debrief={debrief}
                        cgs={run.cgs ?? []}
                        reveal={shownAttr(at, 'summary')}
                      />
                    )}
                    {run.summary && settled && (
                      <Remains summary={run.summary} collection={collection} debrief={debrief} reveal={shownAttr(at, 'remains')} />
                    )}
                  </div>
                  {prologue ? (
                    <div className="closed-ending__actions closed-ending__actions--prologue" data-testid="prologue-ending" {...shownAttr(at, 'actions')}>
                      {prologue.recap && <p className="closed-ending__recap">{prologue.recap}</p>}
                      <button type="button" className="closed-ending__primary closed-ending__next" data-testid="prologue-next" onClick={prologue.onNext}>
                        <span className="closed-ending__next-title">{t('Stay on this train: the full {name}', { name: prologue.next.name })} ▶</span>
                        <small className="closed-ending__next-line">{prologue.next.line}</small>
                      </button>
                      <button type="button" className="closed-ending__link" data-testid="prologue-all-worlds" onClick={prologue.onAllWorlds}>{t('See all worlds')}</button>
                    </div>
                  ) : (
                  <div className="closed-ending__actions" {...shownAttr(at, 'actions')}>
                    <button type="button" className="closed-ending__secondary" onClick={close}>{t('Talk with them')}</button>
                    {pending && phase === 'ending' && (
                      <button type="button" className="closed-ending__secondary" onClick={() => setPhase('results')}>{t('Skip debrief')}</button>
                    )}
                    {pending && (
                      <button type="button" className="closed-ending__primary" onClick={() => setPhase('debrief')}>{t('Debrief')}</button>
                    )}
                    {!pending && phase === 'ending' && debrief?.result && (
                      <button type="button" className="closed-ending__secondary" onClick={() => setPhase('results')}>{t('Debrief')}</button>
                    )}
                    {!pending && phase === 'results' && (
                      <button type="button" className="closed-ending__secondary" onClick={() => setPhase('ending')}>{t('Read the ending')}</button>
                    )}
                    {(!pending || phase === 'results') && <ShareResultButton run={run} className="closed-ending__secondary" />}
                    {onLobby && (!pending || phase === 'results') && (
                      <button type="button" className="closed-ending__secondary" data-action="lobby" onClick={() => { close(); onLobby(); }}>{t('Back to lobby')}</button>
                    )}
                    {(!pending || phase === 'results') && (
                      <button type="button" className="closed-ending__primary" onClick={onPlayAgain}>{t('Play again')}</button>
                    )}
                  </div>
                  )}
                </div>
              )}
            </div>
            {stillPlaying && <p className="closed-ending__skip" aria-hidden="true">{t('Tap to skip')}</p>}
            {shareOpen && shareCard && <ShareSheet card={shareCard} onClose={() => setShareOpen(false)} />}
          </div>
        )}
        {!cardOpen && (
          <div className="closed-strip" role="status">
            <span>{t('Epilogue · only conversation remains')}</span>
            <button type="button" onClick={reopen}>{t('Read the ending')}</button>
            {pending && <button type="button" onClick={() => { setCardOpen(true); setBeat(FINALE_LAST); setPhase('debrief'); }}>{t('Debrief')}</button>}
            <ShareResultButton run={run} />
            <button type="button" onClick={onPlayAgain}>{t('Play again')}</button>
          </div>
        )}
      </>
    );
  }

  if (!run.clock) return null;
  const urgent = run.clock.left <= Math.max(1, Math.floor(run.clock.start / 4));
  // Story time when the world gives one:
  // "01:35 · 距离发车 3 小时 25 分". A world without it keeps the step count.
  const time = run.clock.now && run.clock.remainingMinutes !== undefined ? run.clock : null;
  const leftText = time ? t('{span} left', { span: spanText(t, time.remainingMinutes ?? 0) }) : t('{left} steps left', { left: run.clock.left });
  const badge = (
    <div className="closed-clock" data-urgent={urgent ? 'true' : undefined} role="status" aria-live="polite">
      {time && <span className="closed-clock__now">{time.now}</span>}
      <span className="closed-clock__label">{run.clock.label}</span>
      <span className="closed-clock__left">{leftText}</span>
    </div>
  );
  if (!worldPanel) return badge;
  const clockLine = [time?.now, run.clock.label, leftText].filter(Boolean).join(' · ');
  return (
    <HoverPanel className="closed-clock-hover" label={t('World panel')} panel={worldPanel(clockLine)}>
      {badge}
    </HoverPanel>
  );
}

/** The 复盘: one question per step, options as buttons, back / next, confirm. */
function DebriefQuiz({
  debrief,
  onCancel,
  onDone,
}: {
  debrief: ClosedRunDebrief;
  onCancel(): void;
  onDone(next: ClosedRunDebrief): void;
}): React.ReactElement {
  const { t } = useLocale();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = debrief.mysteries.length;
  const confirming = step >= total;
  const mystery = confirming ? null : debrief.mysteries[step];
  const open = unansweredIds(debrief.mysteries, answers);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await submitDebrief(answers);
      if (next.debrief) onDone(next.debrief);
    } catch {
      setError(t('Could not submit the debrief. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="closed-debrief" aria-labelledby="closed-debrief-title">
      <p className="closed-ending__kicker">{t('Debrief')}</p>
      {mystery ? (
        <>
          <p className="closed-debrief__step">{t('Question {n} / {total}', { n: step + 1, total })}</p>
          <h2 id="closed-debrief-title" className="closed-debrief__question">{mystery.question}</h2>
          {mystery.hint && <p className="closed-debrief__hint">{mystery.hint}</p>}
          <div className="closed-debrief__options" role="radiogroup" aria-labelledby="closed-debrief-title">
            {mystery.options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={answers[mystery.id] === o.id}
                data-chosen={answers[mystery.id] === o.id ? 'true' : undefined}
                onClick={() => setAnswers({ ...answers, [mystery.id]: o.id })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <h2 id="closed-debrief-title" className="closed-debrief__question">{t('Confirm answers')}</h2>
          <p className="closed-debrief__hint">{t('Answers don’t change the ending — they show how much you uncovered.')}</p>
          {open.length > 0 && <p className="closed-debrief__hint">{t('{n} left unanswered.', { n: open.length })}</p>}
          {error && <p className="closed-debrief__error" role="alert">{error}</p>}
        </>
      )}
      <div className="closed-ending__actions">
        <button type="button" className="closed-ending__secondary" onClick={step === 0 ? onCancel : () => setStep(step - 1)} disabled={busy}>
          {step === 0 ? t('Close') : t('Previous')}
        </button>
        {confirming ? (
          <button type="button" className="closed-ending__primary" onClick={() => void confirm()} disabled={busy}>{t('Confirm answers')}</button>
        ) : (
          <button type="button" className="closed-ending__primary" onClick={() => setStep(step + 1)}>
            {mystery && answers[mystery.id] ? t('Next') : t('Skip')}
          </button>
        )}
      </div>
    </section>
  );
}

/** What the debrief unlocked: the tiered epilogue, each secret's line, and hidden-ending cards. */
function DebriefEpilogues({ result }: { result: DebriefResult }): React.ReactElement {
  const { t } = useLocale();
  const hidden = result.mysteries.filter((m) => m.verdict === 'hidden');
  const lines = result.mysteries.filter((m) => m.verdict === 'surface' && m.epilogue);
  return (
    <div className="closed-debrief__epilogues">
      <p className="closed-ending__kicker">{t('Epilogue')}</p>
      {result.epilogue && result.epilogue.split(/\n\s*\n/).map((para, i) => <p key={i} className="closed-ending__body">{para}</p>)}
      {lines.map((m) => <p key={m.id} className="closed-ending__body">{m.epilogue}</p>)}
      {hidden.map((m) => (
        <article key={m.id} className="closed-debrief__hidden">
          <p className="closed-ending__kicker">{t('Hidden ending')}</p>
          {m.title && <h3 className="closed-debrief__hidden-title">{m.title}</h3>}
          {m.epilogue && <p className="closed-ending__body">{m.epilogue}</p>}
        </article>
      ))}
    </div>
  );
}

/** "3 小时 25 分" / "40 分" / "2 小时". */
function spanText(t: ReturnType<typeof useLocale>['t'], minutes: number): string {
  const { h, m } = spanParts(minutes);
  if (h === 0) return t('{m} min', { m });
  if (m === 0) return t('{h} h', { h });
  return t('{h} h {m} min', { h, m });
}

/** What this run was, read back from the server; nothing here is computed from the story text. */
function Settlement({
  summary,
  collection,
  clockLabel,
  debrief,
  cgs = [],
  reveal,
}: {
  summary: ClosedRunSummary;
  collection: Record<string, string>;
  clockLabel: string | null;
  debrief: ClosedRunDebrief | null;
  /** CGs this save has shown; a thumbnail shows it again. */
  cgs?: { path: string; caption?: string }[];
  /** The finale beat this panel belongs to (`summary`). */
  reveal?: Reveal;
}): React.ReactElement {
  const { t } = useLocale();
  const minutes = minutesBetween(summary.startedAt, summary.endedAt);
  const passed = summary.rolls.filter((r) => r.passed === true).length;
  // The four tiers and what the crits cost / gave.
  const tally = diceTally(summary.rolls);
  const visited = summary.places.filter((p) => p.visited).length;
  const seen = summary.endings.filter((e) => e.reached || collection[e.id]).length;
  const result = debrief?.result ?? null;
  return (
    <aside className="closed-settle closed-ending__panel" aria-label={t('Settlement')} {...reveal}>
      <p className="closed-ending__kicker">{t('Settlement')}</p>
      <dl className="closed-settle__stats">
        {minutes !== null && (
          <div><dt>{t('Time played')}</dt><dd>{t('{n} min', { n: minutes })}</dd></div>
        )}
        {typeof summary.turns === 'number' && (
          <div><dt>{t('Your moves')}</dt><dd>{summary.turns}</dd></div>
        )}
        <div><dt>{t('Items found')}</dt><dd>{summary.clues.length}</dd></div>
        {summary.deductions && summary.deductions.notes + summary.deductions.lines + summary.deductions.marks > 0 && (
          <div data-closed-deductions>
            <dt>{t('Your deductions')}</dt>
            <dd>{t('{notes} notes · {lines} lines · {marks} marks', summary.deductions)}</dd>
          </div>
        )}
        {summary.steps && (
          <div>
            <dt>{clockLabel ?? t('Clock')}</dt>
            <dd>
              {typeof summary.minutesPassed === 'number'
                ? t('{span} passed', { span: spanText(t, summary.minutesPassed) })
                : t('{used} / {start} steps used', { used: summary.steps.used, start: summary.steps.start })}
            </dd>
          </div>
        )}
        <div><dt>{t('Dice')}</dt><dd>{t('{n} rolls, {passed} succeeded', { n: summary.rolls.length, passed })}</dd></div>
        {tally.rolls > 0 && (
          <div data-dice-tally>
            <dt>{t('Dice tiers')}</dt>
            <dd>{t('{cs} critical · {s} success · {f} failure · {cf} critical failure', { cs: tally.byTier.crit_success, s: tally.byTier.success, f: tally.byTier.fail, cf: tally.byTier.crit_fail })}</dd>
          </div>
        )}
      </dl>
      {tally.crits.length > 0 && (
        <ul className="closed-settle__crits" data-dice-crits>
          {tally.crits.map((c, i) => (
            <li key={i} data-outcome={c.outcome}>
              <DiceTierLine outcome={c.outcome} chip={c.what ? { status: 'applied', direction: c.outcome === 'crit_fail' ? 'cost' : 'bonus', line: c.what } : null} compact />
              <span className="closed-settle__crit-name">{c.name}</span>
            </li>
          ))}
        </ul>
      )}

      {debrief && (
        <>
          <h3 className="closed-settle__heading">
            {t('Secrets solved {n} / {total}', { n: result ? result.unlocked : '？', total: debrief.mysteries.length })}
            {result && result.unlocked > 0 && <> · {t('{surface} plain, {hidden} hidden', { surface: result.surface, hidden: result.hidden })}</>}
          </h3>
          <ul className="closed-settle__secrets">
            {(result?.mysteries ?? debrief.mysteries.map((m) => ({ id: m.id, question: m.question, verdict: 'unanswered' as const, label: null }))).map((m) => {
              const shown = m.verdict !== 'unanswered';
              const proof = 'proof' in m ? proofLabel(m, summary.clues) : null;
              return (
                <li key={m.id} data-verdict={m.verdict} title={m.verdict === 'guessed' ? t('Right, but you never found the evidence') : undefined}>
                  <span className="closed-settle__mark" aria-hidden="true">{verdictMark(m.verdict)}</span>
                  <span className="closed-settle__secret">
                    <span>{shown ? m.question : UNKNOWN}</span>
                    {proof && <span className="closed-settle__proof">{t('Proved by {clue}', { clue: proof })}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {summary.clues.length > 0 && (
        <>
          <h3 className="closed-settle__heading">{t('Brought back {n}', { n: summary.clues.length })}</h3>
          <ul className="closed-settle__chips">
            {summary.clues.map((c) => <li key={c.path} data-state="seen">{c.name}</li>)}
          </ul>
        </>
      )}

      {cgs.length > 0 && (
        <>
          <h3 className="closed-settle__heading">{t('Scenes seen {n}', { n: cgs.length })}</h3>
          <ul className="closed-settle__cgs">
            {cgs.map((cg) => (
              <li key={cg.path}>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent(CG_SHOWN_DOM, { detail: cgReplayDetail(cg.path, cg.caption) }))}
                  aria-label={cg.caption ?? t('Scene')}
                  title={cg.caption}
                >
                  <img src={airpGateway.assetUrl(cg.path, undefined, 'image')} alt="" loading="lazy" decoding="async" draggable={false} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="closed-settle__heading">{t('Places explored {visited} / {total}', { visited, total: summary.places.length })}</h3>
      <ul className="closed-settle__chips">
        {summary.places.map((p) => (
          <li key={p.layer} data-state={p.visited ? 'seen' : 'unknown'}>{p.visited ? p.name : UNKNOWN}</li>
        ))}
      </ul>

      <h3 className="closed-settle__heading">{t('Endings {seen} / {total}', { seen, total: summary.endings.length })}</h3>
      <ul className="closed-settle__chips">
        {summary.endings.map((e) => {
          const title = e.title ?? collection[e.id] ?? null;
          return (
            <li key={e.id} data-state={e.reached ? 'now' : title ? 'seen' : 'unknown'}>
              {title ?? UNKNOWN}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/** The companion's closing line: their last finished words on this save, quoted under the epilogue. */
function CompanionLine({ companion }: { companion: FinaleCompanion }): React.ReactElement {
  const { t } = useLocale();
  const [failed, setFailed] = useState(false);
  return (
    <figure className="closed-ending__companion">
      {companion.avatar && !failed && (
        <img className="closed-ending__companion-face" src={companion.avatar} alt="" decoding="async" onError={() => setFailed(true)} />
      )}
      <div>
        <figcaption className="closed-ending__kicker">{t('Last words from {name}', { name: companion.name })}</figcaption>
        <blockquote className="closed-ending__companion-line">{companion.line}</blockquote>
      </div>
    </figure>
  );
}

/**
 * What this run left undiscovered, as silhouettes and counts: never a name, a
 * title or an answer (the server does not send them; this only counts).
 */
function Remains({
  summary,
  collection,
  debrief,
  reveal,
}: {
  summary: ClosedRunSummary;
  collection: Record<string, string>;
  debrief: ClosedRunDebrief | null;
  reveal?: Reveal;
}): React.ReactElement {
  const { t } = useLocale();
  const r = remainsOf(summary, collection, debrief);
  const rows: { key: string; n: number; text: string; shape: 'place' | 'ending' | 'secret' }[] = [];
  if (r.places > 0) rows.push({ key: 'places', n: r.places, text: t('{n} places never visited', { n: r.places }), shape: 'place' });
  if (r.endings > 0) rows.push({ key: 'endings', n: r.endings, text: t('{n} endings unseen', { n: r.endings }), shape: 'ending' });
  if ((r.secrets ?? 0) > 0) rows.push({ key: 'secrets', n: r.secrets ?? 0, text: t('{n} secrets still hidden', { n: r.secrets ?? 0 }), shape: 'secret' });
  return (
    <section className="closed-remains closed-ending__panel" aria-label={t('Still undiscovered')} {...reveal}>
      <p className="closed-ending__kicker">{t('Still undiscovered')}</p>
      {anythingRemains(r) ? (
        <ul className="closed-remains__rows">
          {rows.map((row) => (
            <li key={row.key} data-shape={row.shape}>
              <span className="closed-remains__silhouettes" aria-hidden="true">
                {Array.from({ length: Math.min(row.n, SILHOUETTE_CAP) }, (_, i) => <span key={i} className="closed-remains__silhouette" />)}
                {row.n > SILHOUETTE_CAP && <span className="closed-remains__more">+{row.n - SILHOUETTE_CAP}</span>}
              </span>
              <span className="closed-remains__text">{row.text}</span>
            </li>
          ))}
          {r.guessed > 0 && <li className="closed-remains__hint">{t('{n} right guesses still need proof', { n: r.guessed })}</li>}
        </ul>
      ) : (
        <p className="closed-remains__done">{t('Nothing left undiscovered')}</p>
      )}
    </section>
  );
}

/**
 * 「分享结果」: the result card, drawn by the shared share-card renderer when this
 * build has it (lib/share-card-loader.ts); otherwise a text card with the same
 * facts. Share (Web Share, with the image when the browser takes files), save
 * the image, or copy the line.
 */
function ShareSheet({ card, onClose }: { card: ResultCardInput; onClose(): void }): React.ReactElement {
  const { t } = useLocale();
  const [state, setState] = useState<'loading' | 'image' | 'text'>('loading');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const text = resultShareText(card, t);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    void (async () => {
      const render = await loadResultCardRenderer();
      const out = render ? await cardBlob(await Promise.resolve(render(card)).catch(() => null)).catch(() => null) : null;
      if (!live) return;
      if (out) {
        objectUrl = URL.createObjectURL(out);
        setBlob(out);
        setUrl(objectUrl);
        setState('image');
      } else {
        setState('text');
      }
    })();
    panelRef.current?.focus({ preventScroll: true });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [card]);

  const file = blob ? new File([blob], `${card.worldId}-${card.endingId}.png`, { type: blob.type || 'image/png' }) : null;
  const canShareFile = Boolean(file && typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] }));
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const share = async () => {
    try {
      await navigator.share(canShareFile && file ? { files: [file], text } : { text });
    } catch { /* dismissed */ }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch { /* clipboard blocked: the text stays visible to select */ }
  };

  return (
    <div
      className="closed-share"
      role="dialog"
      aria-modal="true"
      aria-labelledby="closed-share-title"
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      <div className="closed-share__panel closed-ending__panel" ref={panelRef} tabIndex={-1}>
        <p id="closed-share-title" className="closed-ending__kicker">{t('Result card')}</p>
        {state === 'loading' && <p className="closed-share__status" role="status">{t('Preparing the card…')}</p>}
        {state === 'image' && url && <img className="closed-share__image" src={url} alt={text} />}
        {state === 'text' && (
          <div className="closed-share__card" data-has-picture={card.picture ? 'true' : undefined} style={card.picture ? ({ '--share-picture': `url("${card.picture}")` } as React.CSSProperties) : undefined}>
            <p className="closed-share__world">{card.worldName}</p>
            <p className="closed-share__ending">{card.endingTitle}</p>
            <p className="closed-share__facts">{text}</p>
          </div>
        )}
        <div className="closed-ending__actions closed-share__actions">
          <button type="button" className="closed-ending__secondary" onClick={onClose}>{t('Close')}</button>
          <button type="button" className="closed-ending__secondary" onClick={() => void copy()}>{copied ? t('Copied') : t('Copy text')}</button>
          {url && (
            <a className="closed-ending__secondary closed-share__save" href={url} download={file?.name}>{t('Save image')}</a>
          )}
          {canShare && (
            <button type="button" className="closed-ending__primary" onClick={() => void share()}>{t('Share')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
