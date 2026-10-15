/**
 * 设定 → 角色卡: the draft's protagonist and
 * character sheets, editable by the author. CoC-like rows are a label and a
 * percentage; D&D-like sheets add six ability modifiers and a proficiency
 * toggle per skill. Skills come from the system's standard list (labels in the
 * world's language), or a custom one with its own label.
 */
import React, { useEffect, useState } from 'react';
import { ABILITIES, catalogOf, type SkillSystem } from '@airp/shared/skills';
import { airpGateway, type DraftSheet, type DraftSheetSkill } from '../../lib/airp-gateway.js';
import { useLocale } from '../../lib/i18n.js';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

function SheetForm({ target, system, sheet, locale, onSaved }: { target: string; system: SkillSystem; sheet: DraftSheet; locale: string; onSaved: (s: DraftSheet) => void }) {
  const { t } = useLocale();
  const [draft, setDraft] = useState<DraftSheet>(sheet);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const lang = (locale === 'zh-CN' || locale === 'ja' || locale === 'ko' ? locale : 'en') as 'en' | 'zh-CN' | 'ja' | 'ko';
  useEffect(() => setDraft(sheet), [sheet]);
  const setSkill = (i: number, patch: Partial<DraftSheetSkill>) => setDraft((d) => ({ ...d, skills: d.skills.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const used = new Set(draft.skills.map((s) => s.id));
  const choices = catalogOf(system).filter((s) => !used.has(s.id) && s.id !== 'sanity');

  const add = () => {
    const known = catalogOf(system).find((s) => s.id === adding);
    if (!known) return;
    const skill: DraftSheetSkill = system === 'coc'
      ? { id: known.id, label: known.label[lang], value: 40 }
      : { id: known.id, label: known.label[lang], ability: known.ability };
    setDraft((d) => ({ ...d, skills: [...d.skills, skill] }));
    setAdding('');
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await airpGateway.saveWorkshopSheet(target, draft);
      onSaved(saved.sheet);
      setMessage(t('Sheet saved.'));
    } catch (error) {
      const payload = (error as { payload?: { error?: unknown } } | null)?.payload;
      setMessage(typeof payload?.error === 'string' ? payload.error : t('That did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-editor__form" data-testid={`sheet-editor-${target}`}>
      {system === 'dnd' && (
        <div className="sheet-editor__abilities">
          {ABILITIES.map((a) => (
            <label key={a}>
              <span>{a.toUpperCase()}</span>
              <input
                type="number"
                min={-5}
                max={10}
                value={draft.abilities?.[a] ?? 0}
                onChange={(e) => setDraft((d) => ({ ...d, abilities: { ...(d.abilities ?? {}), [a]: clamp(Number(e.target.value) || 0, -5, 10) } }))}
              />
            </label>
          ))}
        </div>
      )}
      <ul className="sheet-editor__skills">
        {draft.skills.map((s, i) => (
          <li key={s.id}>
            <input className="sheet-editor__label" value={s.label} maxLength={40} aria-label={t('Skill name')} onChange={(e) => setSkill(i, { label: e.target.value })} />
            {system === 'coc' ? (
              <input type="number" min={1} max={99} value={s.value ?? 1} aria-label={t('Skill value')} onChange={(e) => setSkill(i, { value: clamp(Number(e.target.value) || 1, 1, 99) })} />
            ) : (
              <label className="sheet-editor__prof">
                <input type="checkbox" checked={s.proficient === true} onChange={(e) => setSkill(i, { proficient: e.target.checked || undefined })} />
                {t('Proficient')}
              </label>
            )}
            <button type="button" aria-label={t('Remove')} onClick={() => setDraft((d) => ({ ...d, skills: d.skills.filter((_, j) => j !== i) }))}>×</button>
          </li>
        ))}
      </ul>
      <div className="sheet-editor__add">
        <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={t('Add a skill')}>
          <option value="">{t('Add a skill')}</option>
          {choices.map((c) => <option key={c.id} value={c.id}>{c.label[lang]}</option>)}
        </select>
        <button type="button" disabled={!adding || draft.skills.length >= 16} onClick={add}>+</button>
      </div>
      <div className="workshop-art__actions">
        <button type="button" disabled={busy} onClick={() => void save()}>{busy ? t('Working…') : t('Save sheet')}</button>
      </div>
      {message && <p className="workshop-art__message" role="status">{message}</p>}
    </div>
  );
}

/** Every sheet the draft has; reloads when `version` changes (a saved setup may reset them). */
export function SheetEditor({ version }: { version: number }): React.ReactElement | null {
  const { t } = useLocale();
  const [state, setState] = useState<{ system: SkillSystem; sheets: Record<string, DraftSheet>; locale: string } | null>(null);
  useEffect(() => {
    let alive = true;
    airpGateway.workshopSheets()
      .then((r) => { if (alive) setState(r.rules ? { system: r.rules.system, sheets: r.sheets, locale: r.locale ?? 'en' } : null); })
      .catch(() => { if (alive) setState(null); });
    return () => { alive = false; };
  }, [version]);
  if (!state) return null;
  const targets = Object.keys(state.sheets).sort((a, b) => (a === 'player' ? -1 : b === 'player' ? 1 : a.localeCompare(b)));
  return (
    <section className="sheet-editor" aria-label={t('Character sheets')}>
      <h3>{t('Character sheets')}</h3>
      <p className="workshop-art__when">{t('Skills the protagonist and the characters check with. Every use of a skill is a roll.')}</p>
      {targets.map((target) => (
        <details key={target} className="sheet-editor__entry" open={target === 'player'}>
          <summary>{target === 'player' ? t('Protagonist') : target}</summary>
          <SheetForm
            target={target}
            system={state.system}
            sheet={state.sheets[target]}
            locale={state.locale}
            onSaved={(sheet) => setState((s) => (s ? { ...s, sheets: { ...s.sheets, [target]: sheet } } : s))}
          />
        </details>
      ))}
    </section>
  );
}
