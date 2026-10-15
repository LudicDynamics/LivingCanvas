/**
 * WorldIntroDialog — the first-entry popup of a world made in the workshop
 *. A few sentences on how this world works (its
 * type, dice and ending — generated deterministically from the shared theme
 * registry by the server), then three setup answers with a one-click fill
 * each, and 「开始」, which saves them into player/README.md and marks the
 * save. Shown once per save; the forced tutorial waits until it closes.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AirpRequestError, airpGateway, type WorldIntroFields, type WorldIntroState } from '../lib/airp-gateway.js';
import { useLocale } from '../lib/i18n.js';
import type { FocusCoordinator } from '../lib/focus-coordinator.js';
import { applyIntroSuggestion, introSuggestRequest } from '../lib/world-theme.js';
import './world-intro.css';

const FIELDS: readonly (keyof WorldIntroFields)[] = ['identity', 'goal', 'first'];

export function WorldIntroDialog({ state, onDone, focus }: {
  state: WorldIntroState;
  /** Saved (or the save failed and the player chose to go on): close and let the tutorial run. */
  onDone: () => void;
  focus?: FocusCoordinator;
}) {
  const { t } = useLocale();
  const [fields, setFields] = useState<WorldIntroFields>(state.fields);
  const [filling, setFilling] = useState<keyof WorldIntroFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const label: Record<keyof WorldIntroFields, string> = {
    identity: t('Who are you here?'),
    goal: t('What do you want here?'),
    first: t('What do you look for first?'),
  };

  useEffect(() => {
    if (!focus) return;
    const lease = focus.registerSurface({ key: 'world-intro', owner: 'workspace', priority: 405, root: root.current, close: () => {} });
    return () => lease.unregister();
  }, [focus]);

  const detailOf = (caught: unknown) =>
    caught instanceof AirpRequestError && typeof caught.payload?.error === 'string' ? caught.payload.error : caught instanceof Error ? caught.message : String(caught);

  const fill = async (field: keyof WorldIntroFields) => {
    if (filling || saving) return;
    setFilling(field);
    setError(null);
    try {
      const suggested = await airpGateway.suggestWorldIntro(introSuggestRequest(fields, field));
      setFields(current => applyIntroSuggestion(current, suggested, field));
    } catch (caught) {
      setError(`${t('Could not fill this in.')} (${detailOf(caught)})`);
    } finally {
      setFilling(null);
    }
  };

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await airpGateway.saveWorldIntro(fields);
      onDone();
    } catch (caught) {
      setError(`${t('Could not save your answers.')} (${detailOf(caught)})`);
      setSaving(false);
    }
  };

  return (
    <div ref={root} className="world-intro" role="dialog" aria-modal="true" aria-labelledby="world-intro-title">
      <form className="world-intro__panel" onSubmit={start} aria-busy={saving}>
        <p className="world-intro__kicker">{state.intro.kicker}</p>
        <h2 id="world-intro-title">{state.intro.title}</h2>
        <div className="world-intro__lines">
          {state.intro.lines.map((line, index) => <p key={index}>{line}</p>)}
        </div>
        <p className="world-intro__ask">{t('Before you start, decide who you are here. Leave any line blank to decide as you play.')}</p>
        {FIELDS.map(field => (
          <label key={field} className="world-intro__field">
            <span>{label[field]}</span>
            <span className="world-intro__row">
              <input value={fields[field]} maxLength={300} disabled={saving} onChange={event => setFields(current => ({ ...current, [field]: event.target.value }))} />
              {state.canSuggest && (
                <button type="button" disabled={saving || filling !== null} onClick={() => void fill(field)}>
                  {filling === field ? t('Filling in…') : t('✦ Fill in')}
                </button>
              )}
            </span>
          </label>
        ))}
        {error && <p className="world-intro__error" role="alert">{error}</p>}
        <footer className="world-intro__actions">
          <button type="submit" className="world-intro__go" disabled={saving}>{saving ? t('Saving…') : t('Start')}</button>
        </footer>
      </form>
    </div>
  );
}
