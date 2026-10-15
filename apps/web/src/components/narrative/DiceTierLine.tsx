/**
 * The tier badge + consequence chip —
 * one look for the ceremony, the roller and the resolved dice card.
 */
import React from 'react';
import { useLocale } from '../../lib/i18n.js';
import { type ConsequenceChip, type OutcomeTier } from '../../lib/dice-tier.js';

export function chipText(chip: ConsequenceChip | null, t: (key: string, vars?: Record<string, string | number>) => string): string | null {
  if (!chip) return null;
  // Literal keys on purpose: check:i18n follows only t('…') literals.
  if (chip.status === 'pending') return chip.direction === 'bonus' ? t('A reward is owed — the story will grant it') : t('Cost due — the story will exact it');
  if (!chip.line) return null;
  return chip.direction === 'bonus' ? t('Extra: {what}', { what: chip.line }) : t('Cost: {what}', { what: chip.line });
}

export function outcomeText(outcome: OutcomeTier, t: (key: string) => string): string {
  switch (outcome) {
    case 'crit_success': return t('Critical success');
    case 'success': return t('Success');
    case 'fail': return t('Failure');
    case 'crit_fail': return t('Critical failure');
  }
}

export const DiceTierLine: React.FC<{ outcome: OutcomeTier; chip?: ConsequenceChip | null; compact?: boolean }> = ({ outcome, chip = null, compact = false }) => {
  const { t } = useLocale();
  const text = chipText(chip, t);
  return (
    <span className={`dice-tier-line${compact ? ' dice-tier-line--compact' : ''}`} data-outcome={outcome}>
      <span className="dice-tier-badge" data-testid="dice-tier-badge" data-outcome={outcome}>{outcomeText(outcome, t)}</span>
      {text && (
        <span className="dice-tier-chip" data-testid="dice-tier-chip" data-chip={chip?.status === 'pending' ? 'pending' : chip?.direction ?? 'cost'}>
          {text}
        </span>
      )}
    </span>
  );
};
