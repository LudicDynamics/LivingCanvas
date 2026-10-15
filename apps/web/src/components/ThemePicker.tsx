/**
 * What a world IS: players, world type, rule pack and
 * structure flags. One picker for the create form and the creation-mode 设定
 * tab, so a draft is edited with exactly the controls it was made with. The
 * type row offers the three world categories (WORLD_CATEGORIES); each presets
 * rules and flags; every part stays editable.
 */
import { useLocale } from '../lib/i18n.js';
import {
  RULE_PACKS,
  STRUCTURE_FLAGS,
  WORLD_CATEGORIES,
  draftUsesDice,
  flagAvailable,
  isSandbox,
  pickerCategoryOf,
  themeDraftFor,
  toggleThemeFlag,
  type ThemeDraft,
} from '../lib/world-theme.js';
import './create-world.css';

export function ThemePicker({ theme, onChange, disabled = false, note }: {
  theme: ThemeDraft;
  onChange: (next: ThemeDraft) => void;
  disabled?: boolean;
  /** One line under the type grid (the create form promises the choice stays editable). */
  note?: string;
}) {
  const { t, locale: uiLocale } = useLocale();
  return (
    <>
      <div className="create-world__field">
        <span>{t('Players')}</span>
        <div className="create-world__langs" role="group" aria-label={t('Players')}>
          <button type="button" aria-pressed={true} disabled={disabled}>{t('Single player')}</button>
          <button type="button" aria-pressed={false} disabled title={t('Coming soon')}>{t('Multiplayer')} · {t('Coming soon')}</button>
        </div>
      </div>

      <div className="create-world__field">
        <span>{t('World type')}</span>
        <div className="create-world__types" role="group" aria-label={t('World type')}>
          {WORLD_CATEGORIES.map(category => (
            <button key={category.id} type="button" aria-pressed={pickerCategoryOf(theme) === category.id} disabled={disabled} onClick={() => onChange(themeDraftFor(category.type))}>
              <strong>{category.label[uiLocale]}</strong>
              <small>{category.line[uiLocale]}</small>
            </button>
          ))}
        </div>
        {note && <small>{note}</small>}
      </div>

      {draftUsesDice(theme) && (
        <div className="create-world__field">
          <span>{t('Rules')}</span>
          <div className="create-world__langs" role="group" aria-label={t('Rules')}>
            {RULE_PACKS.map(pack => (
              <button key={pack.id} type="button" aria-pressed={theme.rules === pack.id} disabled={disabled} onClick={() => onChange({ ...theme, rules: pack.id })}>{pack.label[uiLocale]}</button>
            ))}
          </div>
          <small>{RULE_PACKS.find(pack => pack.id === theme.rules)?.blurb[uiLocale]}</small>
        </div>
      )}

      <div className="create-world__field">
        <span>{t('Structure')}</span>
        <div className="create-world__flags">
          {STRUCTURE_FLAGS.map(flag => (
            <label key={flag.id} className="create-world__flag">
              <input
                type="checkbox"
                checked={theme.structure[flag.id]}
                disabled={disabled || !flagAvailable(theme, flag.id)}
                onChange={event => onChange(toggleThemeFlag(theme, flag.id, event.target.checked))}
              />
              <span><strong>{flag.label[uiLocale]}</strong><small>{flag.blurb[uiLocale]}</small></span>
            </label>
          ))}
        </div>
        {isSandbox(theme) && <small className="create-world__sandbox">{t('Sandbox: no ending, free exploration.')}</small>}
      </div>
    </>
  );
}
