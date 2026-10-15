/**
 * The player panel and the world hover.
 *
 * No HUD: both are closed until asked. The player panel opens from the
 * player's own avatar orb (click; outside press / Esc closes it); the world
 * panel hangs under the world's small top badge — the closed-run clock while
 * it shows, the world title in the header otherwise — and opens on hover,
 * focus or a tap. States are the author's prose only (`mappedStates`, mapped
 * server-side; hidden ones never arrive).
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { endingKind, HOVER_CLOSE_MS, type MappedState, type WorldPanels } from '../../lib/panels.js';
import type { WorldSheets } from '../../lib/sheets.js';
import { SheetBody } from './CharacterSheet.js';
import { CompanionSkills, InspirationRoll } from './SheetExtras.js';
import { openAccountPanel } from '../../lib/account-open.js';
import { useAccountDot } from '../../lib/account-dot.js';
import './state-panels.css';
import '../account/account-dialog.css';

/** Mounted only while the player panel is open: never part of a world's first look. */
function PlayerAccountDot(): React.ReactElement | null {
  const { t } = useLocale();
  return useAccountDot('world-menu') ? <span className="account-dot" data-testid="account-dot" aria-label={t('Rewards to claim')} /> : null;
}

/** One prose line per state, never a raw number of the author's. */
export function StateLines({ states, className }: { states: MappedState[]; className?: string }): React.ReactElement | null {
  if (states.length === 0) return null;
  return (
    <ul className={`state-lines${className ? ` ${className}` : ''}`} data-testid="panel-states">
      {states.map((s) => <li key={s.id} title={s.label || undefined}>{s.text}</li>)}
    </ul>
  );
}

export interface PlayerPanelProps {
  open: boolean;
  onClose(): void;
  name: string;
  avatar?: string | null;
  blurb: string;
  states: MappedState[];
  carried: number;
  onOpenBelongings(): void;
  /** Character skills: the sheet opens from here, never as a HUD. */
  sheets?: WorldSheets;
}

/** The player's own panel, opened from `.prototype-player-orb`. */
export function PlayerPanel({ open, onClose, name, avatar, blurb, states, carried, onOpenBelongings, sheets }: PlayerPanelProps): React.ReactElement | null {
  const { t } = useLocale();
  const rootRef = useRef<HTMLElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => { if (!open) setSheetOpen(false); }, [open]);
  const sheet = sheets?.rules && sheets.player ? sheets.player : null;

  // Esc: App already syncs `profile` into the focus coordinator (syncFocus('profile', …)), so it is not re-registered here.

  // Pressing outside closes it; the orb itself toggles, so it is not "outside".
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      const root = rootRef.current;
      if (!root || !target) return;
      if (root.contains(target)) return;
      if (target instanceof Element && target.closest('.prototype-player-orb')) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <section ref={rootRef} className={`prototype-profile player-panel${sheetOpen && sheet ? ' player-panel--sheet' : ''}`} aria-label={t('Player panel')} data-testid="player-panel">
      <header className="player-panel__head">
        {avatar ? <span className="player-panel__avatar" style={{ backgroundImage: `url("${avatar}")` }} aria-hidden="true" /> : null}
        <span>
          <b>{name}</b>
          <div className="prototype-small">{t('PLAYER CHARACTER')}</div>
        </span>
      </header>
      <p>{blurb}</p>
      {states.length > 0 && (
        <div className="player-panel__section">
          <p className="state-panel__kicker">{t('How you are')}</p>
          <StateLines states={states} />
        </div>
      )}
      <div className="player-panel__actions">
        <button type="button" className="player-panel__bag" data-writer-keep-open onClick={() => { onClose(); onOpenBelongings(); }}>
          {t('Belongings · {n}', { n: carried })}
        </button>
        {/* The account popup: the in-world way in; its dot only shows once this panel is opened. */}
        <button type="button" className="player-panel__bag" data-testid="player-open-account" onClick={() => { onClose(); window.requestAnimationFrame(() => { openAccountPanel(); }); }}>
          {t('Account')}
          <PlayerAccountDot />
        </button>
        {sheet && (
          <button type="button" className="player-panel__bag" data-testid="open-character-sheet" aria-expanded={sheetOpen} onClick={() => setSheetOpen((v) => !v)}>
            {t('Character sheet')}
          </button>
        )}
      </div>
      {sheet && sheetOpen && sheets?.rules && (
        <div className="player-panel__section player-panel__sheet">
          <p className="state-panel__kicker">{t('Skills')}</p>
          <SheetBody sheet={sheet} rules={sheets.rules} canUse testId="player-sheet" />
          <CompanionSkills sheets={sheets} />
          <InspirationRoll inspiration={sheets.inspiration} system={sheets.rules.system} />
        </div>
      )}
    </section>
  );
}

export interface HoverPanelProps {
  /** The badge the panel hangs from (clock or world title). */
  children: React.ReactNode;
  panel: React.ReactNode;
  className?: string;
  label: string;
}

/**
 * Hover (mouse), focus (keyboard) or tap (touch) opens the panel; it stays open
 * while the pointer moves from the badge into the panel (both are inside one
 * wrapper) and closes HOVER_CLOSE_MS after the pointer leaves both.
 */
export function HoverPanel({ children, panel, className, label }: HoverPanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const lastPointer = useRef<string>('');
  const panelId = useId();
  const cancel = useCallback(() => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
  }, []);
  const show = useCallback(() => { cancel(); setOpen(true); }, [cancel]);
  const hideSoon = useCallback(() => {
    cancel();
    timer.current = window.setTimeout(() => { timer.current = null; setOpen(false); }, HOVER_CLOSE_MS);
  }, [cancel]);
  useEffect(() => cancel, [cancel]);

  // A tap opened it; a tap anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`world-hover${className ? ` ${className}` : ''}`}
      data-open={open ? 'true' : undefined}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') show(); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') hideSoon(); }}
      onFocus={show}
      onBlur={(e) => { if (!rootRef.current?.contains(e.relatedTarget as Node | null)) hideSoon(); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); cancel(); setOpen(false); } }}
    >
      <button
        type="button"
        className="world-hover__trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onPointerDown={(e) => { lastPointer.current = e.pointerType; }}
        // A mouse already opened it by hovering, so a click keeps it open; a tap toggles it.
        onClick={(e) => { if (e.detail === 0) return; if (lastPointer.current === 'mouse') show(); else setOpen((v) => !v); }}
      >
        {children}
      </button>
      <div id={panelId} className="world-hover__panel" role="region" aria-label={label} hidden={!open}>
        {panel}
      </div>
    </div>
  );
}

/** What the world panel says: name, story time, states as prose, how it ends, places found. */
export function WorldPanelBody({
  panels,
  name,
  time,
  onRestart,
}: {
  panels: WorldPanels;
  name: string;
  /** The closed-run clock line, when the world has one ("01:35 · 3 h 25 min left"). */
  time: string | null;
  /**
   * Start a fresh save of this world (the launcher's "＋ Start a new game"),
   * behind an in-panel confirm. Absent when the world has nothing to restart from.
   */
  onRestart?: () => void;
}): React.ReactElement {
  const { t } = useLocale();
  const [confirming, setConfirming] = useState(false);
  const w = panels.world;
  const ending = endingKind(w.mode, time !== null);
  return (
    <div className="world-panel" data-testid="world-panel">
      <p className="state-panel__kicker">{t('World')}</p>
      <h3 className="world-panel__name">{w.name || name}</h3>
      {time && <p className="world-panel__time">{time}</p>}
      <StateLines states={w.states} />
      {ending && (
        <p className="world-panel__ending">
          {ending === 'clock' ? t('When time runs out, the story ends.') : t('The story will reach its ending at a key moment.')}
        </p>
      )}
      {w.places && <p className="world-panel__places">{t('Places explored {visited} / {total}', { visited: w.places.visited, total: w.places.total })}</p>}
      {!time && w.states.length === 0 && !ending && !w.places && <p className="world-panel__quiet">{t('Nothing here is counting down.')}</p>}
      {onRestart && (confirming ? (
        <div className="world-panel__restart" role="group" aria-label={t('Restart this world')} data-testid="world-restart-confirm">
          <p>{t('Start this world over? Your current save stays on the shelf; a new save starts from the beginning.')}</p>
          <div className="world-panel__restart-actions">
            <button type="button" className="world-panel__restart-go" onClick={() => { setConfirming(false); onRestart(); }}>{t('Start over')}</button>
            <button type="button" onClick={() => setConfirming(false)}>{t('Cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="world-panel__restart-open" data-testid="world-restart" onClick={() => setConfirming(true)}>{t('Restart this world')}</button>
      ))}
    </div>
  );
}
