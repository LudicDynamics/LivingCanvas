import { PLAYER_ACT_EVENT } from '../../lib/tick/beat.js';
import { characterName } from '../../lib/character-names.js';
import React, { useState, useSyncExternalStore } from 'react';
import { Dices, CheckCircle2, AlertCircle } from 'lucide-react';
import { actionKey } from '../../lib/action-feedback.js';
import { useLocale } from '../../lib/i18n.js';
import { skillCardLine, skillTierText } from '../../lib/sheets.js';
import { cocTierRows, consequenceChipOf, outcomeOfPayload, type ConsequenceChip, type OutcomeTier } from '../../lib/dice-tier.js';
import { DiceTierLine, outcomeText } from './DiceTierLine.js';
/** Shared ceremony timings. DiceCeremony is the only renderer; these remain a
 * stable import seam for the two components. */
export const ROLL_MS = 1200;
export const SETTLE_MS = 1300;
export const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
import {
  holdReveal,
  ingestPlayerRoll,
  isRevealHeld,
  parsePlayerDiceResponse,
  settleReveal,
  subscribeCeremony,
  type DiceCeremonyInput,
} from '../../lib/dice-ceremony.js';

interface DiceVerdict {
  dice: string;
  rolls: number[];
  result: number;
  passed: boolean;
  crit: boolean;
  fumble: boolean;
  outcomeGrade?: string;
}
export function parseDiceVerdict(raw: unknown): DiceVerdict | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.result !== 'number' || !Number.isFinite(o.result) || typeof o.passed !== 'boolean'
    || typeof o.dice !== 'string' || !Array.isArray(o.rolls) || !o.rolls.length
    || !o.rolls.every(r => typeof r === 'number' && Number.isFinite(r))) return null;
  return { dice: o.dice, rolls: o.rolls, result: o.result, passed: o.passed, crit: o.crit === true, fumble: o.fumble === true, ...(typeof o.outcomeGrade === 'string' ? { outcomeGrade: o.outcomeGrade } : {}) };
}
interface DiceRollerProps {
  filePath: string;
  rollDice: {
    desc: string;
    expect: string;
    result?: number;
    passed?: boolean;
  };
  /** Retained for the existing card projection; called after an accepted verdict. */
  onRollComplete?: (result: number, passed: boolean) => void;
  /**
   * The card's `skill_check` block: the card
   * says "Spot Hidden 60%" instead of "Requires: <=60", and the tier after the roll.
   */
  skill?: unknown;
}

interface RolledSummary {
  result: number;
  passed: boolean;
  crit?: boolean;
  fumble?: boolean;
  tier?: string | null;
  outcome?: OutcomeTier;
  chip?: ConsequenceChip | null;
}

function playerRequestKey(path: string): string {
  return actionKey('dice', path);
}

/** The card is a trigger and result summary; DiceCeremony owns all animation. */
export const DiceRoller: React.FC<DiceRollerProps> = ({ filePath, rollDice, onRollComplete, skill }) => {
  const { locale, t } = useLocale();
  // A companion lent the number: say whose it is.
  // The sheet's own check carries the name (`assistName`); a card the engine rolled carries the id (`assist`).
  const assistField = skill && typeof skill === 'object' ? skill as { assistName?: unknown; assist?: unknown } : null;
  const assistName = typeof assistField?.assistName === 'string' ? assistField.assistName
    : typeof assistField?.assist === 'string' && assistField.assist !== 'player' ? characterName(assistField.assist) : null;
  const baseLine = skillCardLine(skill, locale);
  // Whose number it is comes first: 「夏澄替你掷 · 聆听 70」.
  const skillLine = baseLine && assistName ? `${t('{name} rolls for you', { name: assistName })} · ${baseLine}` : baseLine;
  // The four tiers, before the roll and lit after (shown in the first-run prologue: first-run.css).
  const tiers = cocTierRows(skill);
  const [rolled, setRolled] = useState<RolledSummary | null>(() => {
    const r = rollDice.result;
    const p = rollDice.passed;
    return r !== undefined && p !== undefined ? { result: r, passed: p } : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The result stays hidden until the ceremony has shown it.
  const held = useSyncExternalStore(subscribeCeremony, () => filePath !== '' && isRevealHeld(filePath));

  const roll = async () => {
    if (busy || rolled) return;
    setError(null);
    if (filePath === '') {
      setError(t('Could not roll: this card has no world-relative path.'));
      return;
    }
    setBusy(true);
    holdReveal(filePath);
    let staged = false;
    try {
      const res = await fetch('/api/dice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      });
      const raw: unknown = await res.json().catch(() => null);
      const rawObj = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : null;
      // The action envelope is authoritative: a 2xx response without ok:true is
      // not a domain success and must never enter the ceremony.
      // A roll is the player's move: one signal toward the character tick's beat (lib/tick/beat.ts).
      if (res.ok && rawObj?.ok === true) window.dispatchEvent(new CustomEvent(PLAYER_ACT_EVENT, { detail: { route: '/api/dice' } }));
      if (!res.ok || rawObj?.ok !== true) {
        const code = typeof rawObj?.code === 'string' ? rawObj.code : `HTTP ${res.status}`;
        const message = typeof rawObj?.error === 'string' ? rawObj.error : code;
        throw new Error(message);
      }
      const details = parsePlayerDiceResponse(raw, res.ok);
      if (!details) throw new Error(`/api/dice → ${res.status} (missing authoritative roll details)`);
      // Domain facts are parsed before the sole ceremony is staged. A duplicate
      // request is not replayed and is not reported as a fresh roll.
      const input: DiceCeremonyInput | null = ingestPlayerRoll(details, playerRequestKey(filePath));
      if (!input) throw new Error('This roll result was already presented or was incomplete.');
      staged = true;
      const lent = (details as { skill?: { assist?: { name?: unknown } } }).skill?.assist?.name;
      const tierText = skillTierText(input.skill, locale);
      setRolled({ result: input.result, passed: input.passed, crit: input.crit, fumble: input.fumble, tier: tierText && typeof lent === 'string' ? `${tierText} · ${lent}` : tierText, outcome: outcomeOfPayload(input) ?? undefined, chip: consequenceChipOf(input.consequence) });
      onRollComplete?.(input.result, input.passed);
    } catch (err) {
      setError(t('Could not roll: {reason}', { reason: err instanceof Error ? err.message : String(err) }));
    } finally {
      // A failed roll shows its error at once; a staged one is released by its ceremony.
      settleReveal(filePath, staged ? undefined : 0);
      setBusy(false);
    }
  };

  const badge = (pass: boolean) =>
    pass ? (
      <span className="dice-verdict dice-verdict--pass">
        <CheckCircle2 className="w-3.5 h-3.5" /> {t('Check passed')}
      </span>
    ) : (
      <span className="dice-verdict dice-verdict--fail">
        <AlertCircle className="w-3.5 h-3.5" /> {t('Check failed')}
      </span>
    );

  return (
    // `data-dice-roller` / `data-dice-roll`: stable hooks (the tutorial highlights a
    // search's dice by the chalk path; the design notes).
    <div className="dice-roller mt-4" data-dice-roller={filePath}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Dices className="dice-roller__icon w-5 h-5" />
          <span className="dice-roller__title">{rollDice.desc}</span>
        </div>
        <span className="dice-roller__requires" {...(skillLine ? { 'data-skill-line': 'true' } : {})}>
          {skillLine ?? t('Requires: {expect}', { expect: rollDice.expect })}
        </span>
      </div>

      {tiers && (
        <div className="dice-tier-table" data-testid="dice-tier-table" data-rolled={rolled && !held ? 'true' : undefined}>
          {tiers.map((row) => (
            <div key={row.tier} className="dice-tier-table__row" data-outcome={row.tier} data-lit={rolled && !held && rolled.outcome === row.tier ? 'true' : undefined}>
              <span className="dice-tier-table__range">{row.from}–{row.to}</span>
              <span>{outcomeText(row.tier, t)}</span>
            </div>
          ))}
        </div>
      )}
      {held ? (
        <span role="status" className="dice-roller__note animate-pulse">{t('The dice are rolling…')}</span>
      ) : rolled ? (
        <div className="flex items-center gap-4">
          <div className="dice-cube dice-cube-compact" aria-hidden="true"><Dices className="w-7 h-7" /></div>
          <div className="flex items-center gap-3">
            <span className="dice-roller__result">{rolled.result}</span>
            {badge(rolled.passed)}
            {rolled.tier && <span className="dice-roller__tier" data-testid="dice-tier">{rolled.tier}</span>}
            {rolled.outcome && <DiceTierLine outcome={rolled.outcome} chip={rolled.chip ?? null} compact />}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void roll()}
            disabled={busy}
            data-dice-roll={filePath}
            className="dice-roller__roll self-start"
          >
            {busy ? t('Resolving…') : t('Roll the dice')}
          </button>
          <span className="dice-roller__note">{t('The result will be shown in the dice ceremony.')}</span>
          {error && <p role="alert" className="dice-roller__error">{error}</p>}
        </div>
      )}
    </div>
  );
};
