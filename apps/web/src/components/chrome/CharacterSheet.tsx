/**
 * The character sheet: skills as the rule
 * system counts them, opened on demand — inside the player's avatar panel, or
 * read-only in a character's modal. Never a HUD.
 *
 * The protagonist can USE a skill from here: one line of intent → the engine
 * frames a regular check card (`POST /api/skill-check`) → the roll button
 * appears right here and the usual dice ceremony plays. The writer narrates
 * after the roll.
 */
import React, { useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { skillScore, type SheetView, type WorldSheets } from '../../lib/sheets.js';
import { DiceRoller } from '../narrative/DiceRoller.js';
import { noteCue } from '../../lib/tutorial-cues.js';

interface PendingCheck {
  path: string;
  desc: string;
  expect: string;
  skill: Record<string, unknown>;
}

export function SheetBody({
  sheet,
  rules,
  canUse = false,
  testId,
}: {
  sheet: SheetView;
  rules: NonNullable<WorldSheets['rules']>;
  /** The protagonist's own sheet: each skill can be used. */
  canUse?: boolean;
  testId?: string;
}): React.ReactElement {
  const { t, locale } = useLocale();
  const [using, setUsing] = useState<string | null>(null);
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCheck | null>(null);

  const submit = async (skillId: string, label: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/skill-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: skillId, intent: intent.trim() }),
      });
      const body = await res.json().catch(() => null) as Record<string, any> | null;
      const d = body && typeof body.details === 'object' && body.details ? body.details : body;
      if (!res.ok || body?.ok !== true || typeof d?.path !== 'string') {
        throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`);
      }
      setPending({
        path: d.path,
        desc: `${label}: ${intent.trim() || label}`,
        expect: typeof d.expect === 'string' ? d.expect : '',
        skill: { system: rules.system, label, value: d.value, difficulty: d.difficulty, ...(d.assist?.name ? { assistName: d.assist.name } : {}) },
      });
      setUsing(null);
      setIntent('');
      noteCue(d.cue, locale);
    } catch (err) {
      setError(t('Could not start the check: {reason}', { reason: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="character-sheet" data-testid={testId ?? 'character-sheet'} data-system={rules.system}>
      <p className="character-sheet__system">{rules.label}</p>
      {sheet.abilities && sheet.abilities.length > 0 && (
        <ul className="character-sheet__abilities" aria-label={t('Abilities')}>
          {sheet.abilities.map((a) => (
            <li key={a.id}><span>{a.label}</span><b>{a.modifier >= 0 ? `+${a.modifier}` : a.modifier}</b></li>
          ))}
        </ul>
      )}
      <ul className="character-sheet__skills" aria-label={t('Skills')}>
        {sheet.skills.map((s) => (
          <li key={s.id} className="character-sheet__skill" data-skill={s.id}>
            <div className="character-sheet__row">
              <span className="character-sheet__name" title={s.desc || undefined}>
                {s.label}
                {s.marked && <span className="character-sheet__mark" title={t('Marked for improvement')} aria-label={t('Marked for improvement')}>✓</span>}
                {(s.proficient || s.expertise) && <span className="character-sheet__prof" title={s.expertise ? t('Expertise') : t('Proficient')}>{s.expertise ? '◆' : '◇'}</span>}
                {s.assist && <span className="character-sheet__assist" data-testid="sheet-assist">{t('Rolls for you')}</span>}
              </span>
              <span className="character-sheet__score">
                <b>{skillScore(rules.system, s)}</b>
                {rules.system === 'coc' && s.half !== undefined && <small>{` ${s.half} / ${s.fifth}`}</small>}
              </span>
              {canUse && (
                <button
                  type="button"
                  className="character-sheet__use"
                  aria-expanded={using === s.id}
                  onClick={() => { setUsing(using === s.id ? null : s.id); setError(null); }}
                >
                  {t('Use')}
                </button>
              )}
            </div>
            {/* What it is for: the sheet's own words, else the catalog's. */}
            {s.desc && <small className="character-sheet__desc">{s.desc}</small>}
            {canUse && using === s.id && (
              <form
                className="character-sheet__intent"
                onSubmit={(e) => { e.preventDefault(); void submit(s.id, s.label); }}
              >
                <input
                  type="text"
                  value={intent}
                  maxLength={200}
                  autoFocus
                  placeholder={t('What do you try?')}
                  aria-label={t('What do you try?')}
                  onChange={(e) => setIntent(e.target.value)}
                />
                <button type="submit" disabled={busy}>{busy ? t('Preparing…') : t('Make the check')}</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {rules.system === 'coc' && <p className="character-sheet__hint">{t('Roll d100 at or under the number. Hard: half · Extreme: a fifth.')}</p>}
      {rules.system === 'dnd' && <p className="character-sheet__hint">{t('Roll d20 + the modifier; meet the difficulty (DC).')}</p>}
      {error && <p role="alert" className="character-sheet__error">{error}</p>}
      {pending && (
        <div className="character-sheet__pending" data-testid="sheet-pending-check">
          <DiceRoller filePath={pending.path} rollDice={{ desc: pending.desc, expect: pending.expect }} skill={pending.skill} />
        </div>
      )}
    </div>
  );
}
