/**
 * DiceCeremony.tsx — the agent-driven dice ceremony (`dice_result`, the design notes).
 *
 * The player's own path (DiceRoller.tsx) charges → tumbles → settles. The frame
 * path has no hand, so it skips the charge phase and replays tumble → settle
 * with the same timings, face styling, sounds and result layout (the design notes
 * §3.3) — one visual language, two entry points. It changes no state, calls no
 * camera, and posts nothing (§4, §6.4).
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { playFoley, playStinger } from '../../lib/audio.js';
import { ROLL_MS, SETTLE_MS } from '../narrative/DiceRoller.js';
import {
  toDiceCeremonyInput,
  rollingFace,
  type DiceCeremonyInput,
  type DiceFrameVerdict,
} from '../../lib/dice-ceremony.js';
import { diceStageDisplay } from '../../lib/d10-display.js';
import { D10Stage } from './D10Stage.js';
import { useStill } from '../../lib/motion.js';
import { releaseReveal } from '../../lib/reveal-gate.js';
import { useLocale } from '../../lib/i18n.js';
import { skillTierText } from '../../lib/sheets.js';
import { declaredDiceFaces, parseCommandReceipts, receiptLine } from '../../lib/world-command.js';
import type { PerformanceSettings } from '../../lib/performance-settings.js';
import { consequenceChipOf, outcomeOfPayload, TIER_SOUND } from '../../lib/dice-tier.js';
import { DiceTierLine } from '../narrative/DiceTierLine.js';

/** Reduced motion still rolls, just briefly: less movement, same information. */
const STILL_ROLL_MS = 180;
/** Face swap cadence while tumbling. */
const FACE_SPIN_MS = 90;
/** Highlight duration once settled. */
const HIGHLIGHT_MS = 800;
/** The 3D stage lingers after the dice land. */
const STAGE_HOLD_MS = 4_000;
interface DiceCeremonyProps {
  /** Canonical input, or the legacy App verdict alias during the mount migration. */
  verdict: DiceCeremonyInput | DiceFrameVerdict;
  diceRendering: PerformanceSettings['diceRendering'];
  /** End the ceremony (played out, dismissed, or interrupted by a layer switch). */
  onDone: () => void;
}

/** The frame path has no charge phase. */
type CeremonyPhase = 'rolling' | 'settled';

/** The player-visible receipt, projected once per render from the raw payload. */
function CommandReceiptLine({ commands }: { commands: unknown }): React.ReactElement | null {
  const { t } = useLocale();
  const receipts = parseCommandReceipts(commands);
  const line = receiptLine(receipts, t);
  if (line === null) return null;
  return (
    <p
      className={`dice-stage__commands dice-stage__commands--${line.tone}`}
      data-command-status={receipts[0]?.status ?? 'applied'}
      // The wire code is machine vocabulary: kept
      // inspectable as data, never rendered as player text.
      {...(line.detail === undefined ? {} : { 'data-command-code': line.detail })}
    >
      {line.text}
    </p>
  );
}
/** "Spot Hidden · target 60" / "Arcana +5 · DC 15" — the skill a check tested. */
function SkillCaption({ skill }: { skill: NonNullable<DiceCeremonyInput['skill']> }): React.ReactElement {
  const { t } = useLocale();
  const mod = skill.value >= 0 ? `+${skill.value}` : String(skill.value);
  return (
    <span className="dice-stage__skill" data-testid="dice-skill">
      {skill.system === 'coc'
        ? t('{skill} · target {target}', { skill: skill.label, target: skill.target })
        : t('{skill} {mod} · DC {dc}', { skill: skill.label, mod, dc: skill.target })}
    </span>
  );
}

export const DiceCeremony: React.FC<DiceCeremonyProps> = ({ verdict: rawVerdict, onDone, diceRendering }) => {
  const { locale, t } = useLocale();
  const input: DiceCeremonyInput | null =
    'requestKey' in rawVerdict
      ? rawVerdict
      : toDiceCeremonyInput(
          rawVerdict,
          rawVerdict.source === 'character' ? 'character-frame' : 'writer-frame',
        );
  const stageDisplay = input ? diceStageDisplay(input.dice, input.rolls) : null;
  // The 3D stage settles the ceremony when its dice land, however long loading
  // the model and simulating the throw takes; a fixed timer used to settle (and
  // close) the ceremony before the animation had even started.
  const staged = stageDisplay !== null;
  // Faces of the DECLARED die, so the tumble can never show a value the die
  // cannot land on. `null` keeps the legacy guess.
  const faces = input ? declaredDiceFaces(input.dice) : null;
  const still = useStill();
  const [phase, setPhase] = useState<CeremonyPhase>('rolling');
  const [tick, setTick] = useState(0);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!input) {
      onDoneRef.current();
      return;
    }
    if (phase !== 'rolling') return;
    playFoley('dice-roll');
    if (staged) return;
    const spin = still ? null : window.setInterval(() => setTick((t) => t + 1), FACE_SPIN_MS);
    const timer = window.setTimeout(() => setPhase('settled'), still ? STILL_ROLL_MS : ROLL_MS);
    return () => {
      if (spin !== null) window.clearInterval(spin);
      window.clearTimeout(timer);
    };
  }, [phase, still, input, staged]);

  useEffect(() => {
    if (!input || phase !== 'settled') return;
    // Four tiers, four sounds.
    const sound = TIER_SOUND[outcomeOfPayload(input) ?? (input.passed ? 'success' : 'fail')];
    playFoley(sound.foley, sound.intensity);
    if (sound.stinger) playStinger(sound.stinger);

    const el = document.querySelector<HTMLElement>(
      `.object[data-path="${CSS.escape(input.path)}"]`
    );
    el?.classList.add('dice-ceremony-highlight');
    const hi = window.setTimeout(() => el?.classList.remove('dice-ceremony-highlight'), HIGHLIGHT_MS);
    const done = window.setTimeout(() => {
      // Release the held layer refetch BEFORE ending the ceremony: that refetch
      // carries the cards the command just created, and they must land as the
      // mask lifts, not behind it.
      releaseReveal();
      onDoneRef.current();
    }, staged ? STAGE_HOLD_MS : SETTLE_MS);
    return () => {
      window.clearTimeout(hi);
      window.clearTimeout(done);
      // A layer switch forces the ceremony to end early:
      // the gate must open with it, or the canvas never updates again.
      releaseReveal();
      el?.classList.remove('dice-ceremony-highlight');
    };
  }, [phase, input, staged]);

  const badge = (pass: boolean) =>
    pass ? (
      <span className="dice-verdict dice-verdict--pass">
        <CheckCircle2 className="w-3.5 h-3.5" /> Check Passed
      </span>
    ) : (
      <span className="dice-verdict dice-verdict--fail">
        <AlertCircle className="w-3.5 h-3.5" /> Check Failed
      </span>
    );

  if (!input) return null;
  const outcome = outcomeOfPayload(input) ?? (input.passed ? 'success' : 'fail');
  const chip = consequenceChipOf((input as { consequence?: unknown }).consequence);
  const critLook = outcome === 'crit_success';
  const fumbleLook = outcome === 'crit_fail';
  // Portal to <body>: opened from a Chalk, the declared-action dialog is itself
  // a body portal (chrome band) and used to cover the rolling dice rendered
  // inside the shell's stacking context. The registered
  // `--depth-performance-ceremony` token sits above that chrome dialog and just
  // below dialogue.
  return createPortal(
    <div
      style={{ zIndex: 'var(--depth-performance-ceremony)' }}
      className="dice-ceremony-overlay fixed inset-0 flex items-center justify-center"
      data-outcome={phase === 'settled' ? outcome : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Dice result ceremony"
    >
      {phase === 'settled' && fumbleLook && <div className="fumble-crack" />}
      <div className={`dice-stage dice-stage--${phase === 'settled' ? outcome : 'rolling'} ${phase === 'settled' && fumbleLook && !still ? 'dice-shake' : ''}`}>
        {phase === 'settled' && critLook && <div className="crit-glow" />}
        {stageDisplay ? (
          <D10Stage
            dice={input.dice}
            diceRendering={diceRendering}
            rolls={input.rolls}
            settled={phase === 'settled'}
            onLanded={() => setPhase('settled')}
            integrated
          />
        ) : (
          <div className="dice-stage__faces">
            {input.rolls.map((value, i) => (
              <div key={i} className="dice-face-tile">
                {phase === 'rolling' ? rollingFace(i, tick, value, faces ?? undefined) : value}
              </div>
            ))}
          </div>
        )}
        <div className="dice-stage__caption">
          {input.desc !== '' && <span className="font-semibold">{input.desc}</span>}
          {input.skill ? <SkillCaption skill={input.skill} /> : input.expect !== '' && (
            <span className="dice-stage__requires">{t('Requires: {expect}', { expect: input.expect.replace(/<=/g, '≤').replace(/>=/g, '≥') })}</span>
          )}
          {(input.name !== '' || input.dice !== '') && (
            <span className="dice-stage__meta">
              {input.name}
              {input.name !== '' && input.dice !== '' ? ' · ' : ''}
              {input.dice}
            </span>
          )}
        </div>
        {phase === 'rolling' && (
          <span className="dice-stage__rolling animate-pulse">
            {t('The dice are rolling…')}
          </span>
        )}
        {phase === 'settled' && (
          <div className="flex flex-col items-center gap-4">
            <div
              className={`dice-result-number ${
                critLook
                  ? 'dice-result-crit'
                  : fumbleLook
                    ? 'dice-result-fumble'
                    : 'dice-result-plain'
              }`}
              data-outcome={outcome}
            >
              {input.result}
            </div>
            {badge(input.passed)}
            {/* The tier and what it cost / gave — the four outcomes never look alike. */}
            <DiceTierLine outcome={outcome} chip={chip} />
            {input.skill && <span className="dice-stage__tier" data-testid="dice-stage-tier" data-grade={input.skill.grade}>{skillTierText(input.skill, locale)}</span>}
            {/* The command receipt appears at the SETTLE mark, never during the
                tumble: showing it earlier would tell the player the outcome
                before the dice land. One silent
                line — `give` handing over three cards reads as "three cards are
                on the table", not three operations. */}
            <CommandReceiptLine commands={input.commands} />
            <button
              onClick={onDone}
              className="dice-stage__done"
            >
              DONE
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
