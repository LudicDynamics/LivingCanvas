/**
 * Two small pieces the character sheet hosts — never on the canvas:
 *
 *   - `CompanionSkills`: who walks with you now and what they roll for you (`assist` skills), so the
 *     player can see why a check card shows a companion's number;
 *   - `InspirationRoll`: the inspiration roll — one button, the tier, the line. The engine rolls at once
 *     (`POST /api/inspiration`), no card lands on the canvas, no model is asked.
 *
 * Self-contained on purpose: the canvas / message-stream rework (feat/canvas-stream) can move them
 * into its own drawer without touching the sheet.
 */
import React, { useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { lendersOf, skillScore, type InspirationView, type WorldSheets } from '../../lib/sheets.js';
import { noteCue } from '../../lib/tutorial-cues.js';

export function CompanionSkills({ sheets }: { sheets: WorldSheets }): React.ReactElement | null {
  const { t } = useLocale();
  const rules = sheets.rules;
  const lenders = lendersOf(sheets).filter((l) => l.lends.length > 0);
  if (!rules || lenders.length === 0) return null;
  return (
    <div className="sheet-extras__companions" data-testid="sheet-companions">
      <p className="state-panel__kicker">{t('With you')}</p>
      <ul>
        {lenders.map((l) => (
          <li key={l.id} data-character={l.id}>
            <b>{l.name}</b>
            <span>
              {l.lends.map((s) => `${s.label} ${skillScore(rules.system, s)}`).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      <p className="character-sheet__hint">{t('When a companion is better at a skill, they roll it for you.')}</p>
    </div>
  );
}

interface Rolled {
  result: number;
  outcome: string;
  say: string;
  suggest: string[];
  cost?: string;
}

const OUTCOME_KEYS: Record<string, string> = {
  crit_success: 'Critical success',
  success: 'Success',
  fail: 'Failure',
  crit_fail: 'Critical failure',
};

export function InspirationRoll({ inspiration, system }: { inspiration: InspirationView | null; system: 'coc' | 'dnd' }): React.ReactElement | null {
  const { t, locale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [rolled, setRolled] = useState<Rolled | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!inspiration) return null;
  const number = system === 'coc' ? `${inspiration.value}%` : inspiration.value >= 0 ? `+${inspiration.value}` : String(inspiration.value);

  const roll = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/inspiration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const body = (await res.json().catch(() => null)) as Record<string, any> | null;
      const d = body && typeof body.details === 'object' && body.details ? body.details : body;
      if (!res.ok || body?.ok !== true || typeof d?.say !== 'string') throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`);
      setRolled({
        result: Number(d.result),
        outcome: String(d.outcome),
        say: d.say,
        suggest: Array.isArray(d.suggest) ? d.suggest.flatMap((s: any) => (typeof s?.label === 'string' ? [s.label] : [])) : [],
        ...(d.cost && typeof d.cost.what === 'string' ? { cost: d.cost.what } : {}),
      });
      noteCue(d.cue, locale);
    } catch (err) {
      setError(t('Could not roll: {reason}', { reason: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const waitText = inspiration.wait
    ? inspiration.wait.unit === 'clock'
      ? t('Again after {n} more hour(s) of the story', { n: inspiration.wait.n })
      : t('Again after {n} more action(s)', { n: inspiration.wait.n })
    : inspiration.left === 0 ? t('No inspiration left this time round') : null;

  return (
    <div className="sheet-extras__inspiration" data-testid="inspiration-roll" data-outcome={rolled?.outcome}>
      <div className="character-sheet__row">
        <span className="character-sheet__name">{inspiration.label}</span>
        <span className="character-sheet__score"><b>{number}</b></span>
        <button type="button" className="character-sheet__use" data-testid="inspiration-roll-button" disabled={busy || !inspiration.ready} onClick={() => { void roll(); }}>
          {busy ? t('Thinking…') : t('Roll for inspiration')}
        </button>
      </div>
      <p className="character-sheet__hint">{t('Stuck? The better the roll, the clearer the hint. A fumble costs a little.')}</p>
      {waitText && !rolled && <p className="character-sheet__hint">{waitText}</p>}
      {rolled && (
        <div className="sheet-extras__result" role="status">
          <p><b>{rolled.result}</b> · {t(OUTCOME_KEYS[rolled.outcome] ?? 'Success')}</p>
          <p>{rolled.say}</p>
          {rolled.suggest.length > 0 && <p className="character-sheet__hint">→ {rolled.suggest.join(' / ')}</p>}
          {rolled.cost && <p className="character-sheet__hint">{t('Cost: {what}', { what: rolled.cost })}</p>}
        </div>
      )}
      {error && <p role="alert" className="character-sheet__error">{error}</p>}
    </div>
  );
}
