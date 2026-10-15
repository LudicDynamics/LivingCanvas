import React, { useEffect, useMemo, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { clearCardEmphasis, emphasizeCard } from '../../lib/card-emphasis.js';
import {
  choiceGlyph,
  choiceKind,
  railGroups,
  railPlaces,
  PLACE_GLYPHS,
  type ChoiceRailCard,
  type RailLayer,
} from '../../lib/choice-rail-model.js';
import { DeclaredChoiceHost, useDeclaredChoice, type DeclaredChoiceItem } from '../../lib/use-declared-choice.js';
import type { FocusCoordinator } from '../../lib/focus-coordinator.js';
import { addresseeOf, type NormalizedOption } from '@airp/shared/frontmatter';
import { readFromPrologue } from '../../lib/first-run.js';
import { requestSayLine } from '../../lib/option-routing.js';
import './choice-rail.css';

/**
 * ChoiceRail — everything the player can do on this layer, in one column
 *.
 *
 * Before this, the options lived in each card's hover panel: to see what was
 * available you had to sweep the canvas and hope a panel opened over the card
 * you wanted. The rail makes the layer's moves scannable, and hovering one
 * points at the card it belongs to instead of the other way round.
 *
 * It is a VIEW, not a second authority: every click goes through the same
 * `useDeclaredChoice` as the card panel, so the design notes keeps one
 * implementation. The hook is called ONCE here — the rail lists many cards, and
 * a per-card hook would be a hook in a loop.
 *
 * It parks at the left edge. Pointer hover and keyboard focus reveal it on
 * desktop; a real button grip toggles its pinned state for touch and narrow
 * screens, where hover is not available.
 */

export interface ChoiceRailProps {
  cards: ChoiceRailCard[];
  /** Action-feedback projection for this layer (`layer:<id>` / `nook:<id>`). */
  projection: string;
  onChoice?: (prompt: string) => void;
  onEnterGate?: (path: string) => void;
  onOpenCharacter?: (characterId: string) => void;
  focus?: FocusCoordinator;
  /** Every layer the world declares, for the places list. Omit to hide it. */
  layers?: Readonly<Record<string, RailLayer>>;
  /** Where the player is now; the place list marks it and never links it. */
  currentLayer?: string;
  /** Go to a layer by id. Without it the places list is read-only. */
  onEnterLayer?: (layerId: string) => void;
  /** Is this option done? Done options leave the rail too. */
  isDone?: (card: ChoiceRailCard, option: NormalizedOption) => boolean;
  /**
   * `rail` (default): parked at the left edge. `drawer`: drawn flat inside the
   * bottom message drawer's 「选项」 page — no grip, no parking.
   */
  variant?: 'rail' | 'drawer';
}

export function ChoiceRail({
  cards,
  projection,
  onChoice,
  onEnterGate,
  onOpenCharacter,
  focus,
  layers,
  currentLayer,
  onEnterLayer,
  isDone,
  variant = 'rail',
}: ChoiceRailProps): React.ReactElement {
  const { t } = useLocale();
  const [pinned, setPinned] = useState(false);
  const groups = useMemo(() => railGroups(cards, { fromPrologue: readFromPrologue() !== null, isDone }), [cards, isDone]);
  const places = useMemo(
    () => (onEnterLayer && currentLayer ? railPlaces(layers, currentLayer) : []),
    [layers, currentLayer, onEnterLayer],
  );
  const byPath = useMemo(() => {
    const map = new Map<string, DeclaredChoiceItem>();
    for (const card of cards) map.set(card.path, card);
    return map;
  }, [cards]);

  const declared = useDeclaredChoice({
    resolveItem: path => byPath.get(path) ?? null,
    projection,
    onChoice,
    onEnterGate,
    onOpenCharacter,
  });


  // A layer switch leaves no card lit behind it, and closes a tapped-open rail.
  useEffect(() => clearCardEmphasis, []);
  useEffect(() => { clearCardEmphasis(); setPinned(false); }, [projection]);



  const list = (
    <div className="choice-rail__scroll">
      {groups.length === 0 && (
        <p className="choice-rail__empty">{t('Nothing to choose on this layer — ask a character or the writer.')}</p>
      )}
      {groups.map(group => (
        <section className="choice-rail__group" key={group.path}>
          <h2 className="choice-rail__heading" title={group.title}>{group.title}</h2>
          {group.options.map(option => (
            <button
              key={`${group.path}:${option.id ?? option.index}`}
              type="button"
              className="choice-rail__option"
              // An option that actually leads somewhere is what the guide's
              // third step points at; a layer with none simply skips it.
              data-guide-target={choiceKind(group.frontmatter, option) === 'enter' ? 'enter' : undefined}
              disabled={declared.busy}
              onPointerEnter={() => emphasizeCard(group.path)}
              onPointerLeave={() => clearCardEmphasis()}
              onFocus={() => emphasizeCard(group.path)}
              onBlur={() => clearCardEmphasis()}
              onClick={() => {
                // A line: said to that character, not a move for the writer.
                const to = addresseeOf(group.frontmatter, option);
                if (to.to !== 'writer' && (option.to !== undefined || option.say !== undefined)) { requestSayLine({ to: to.to, say: to.say ?? option.label, key: `${group.path}#${option.id ?? option.index}` }); return; }
                declared.choose(group.path, option.id ?? option.label);
              }}
            >
              <span className="choice-rail__glyph" aria-hidden="true">{choiceGlyph(group.frontmatter, option)}</span>
              <span className="choice-rail__label">
                {option.index}. {option.label}
                {option.hint && <small className="choice-rail__hint">{option.hint}</small>}
              </span>
            </button>
          ))}
        </section>
      ))}
      {/* Everywhere you can go, at the foot of the column
          Below the layer's own moves
          because those are about THIS room; this is about leaving it. The
          room you are in is listed too, marked and unclickable, so the list
          reads as a position rather than a menu of elsewheres. */}
      {places.length > 0 && (
        <section className="choice-rail__group choice-rail__places">
          <h2 className="choice-rail__heading">{t('Places you can go')}</h2>
          {places.map(place => (
            <button
              key={place.id}
              type="button"
              className="choice-rail__option choice-rail__place"
              data-place={place.relation}
              disabled={place.relation === 'here' || declared.busy}
              aria-current={place.relation === 'here' ? 'location' : undefined}
              onClick={() => onEnterLayer?.(place.id)}
            >
              <span className="choice-rail__glyph" aria-hidden="true">{PLACE_GLYPHS[place.relation]}</span>
              <span className="choice-rail__label">{place.name}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );

  const notes = (
    <>
      {declared.feedback && (
        <small className="choice-rail__note" role="status" data-action-status={declared.feedbackStatus ?? 'accepted'}>{declared.feedback}</small>
      )}
      {declared.error && (
        <small className="choice-rail__note choice-rail__note--error" role="alert">{declared.error}</small>
      )}
      <DeclaredChoiceHost declared={declared} focus={focus} />
    </>
  );

  // Inside the message drawer: the same list, flat.
  if (variant === 'drawer') {
    return (
      <div className="choice-rail choice-rail--drawer" aria-label={t('Things you can do')}>
        {list}
        {notes}
      </div>
    );
  }

  return (
    <aside
      className="choice-rail prototype-chrome"
      aria-label={t('Things you can do')}
      data-rail-state={pinned ? 'open' : 'parked'}
      // The guide's second step points at the whole rail — parked, that box IS
      // the grip, so the sentence lands on the thing you press.
      data-guide-target="options"
      // Esc folds a tapped-open rail away (keyboard parity with the tap on the grip).
      onKeyDown={event => {
        if (event.key !== 'Escape' || !pinned) return;
        event.stopPropagation();
        setPinned(false);
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <button
        type="button"
        className="choice-rail__grip"
        aria-expanded={pinned}
        aria-label={t('Things you can do')}
        onClick={event => {
          const next = !pinned;
          setPinned(next);
          if (!next) event.currentTarget.blur();
        }}
      />
      {list}
      {notes}
    </aside>
  );
}

