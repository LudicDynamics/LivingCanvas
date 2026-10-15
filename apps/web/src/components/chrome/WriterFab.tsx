import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { useWriterState } from '../../lib/writer-state.js';
import { WriterBar, type WriterBarProps } from './WriterBar.js';
import type { FocusCoordinator, FocusSurfaceLease } from '../../lib/focus-coordinator.js';
import { useFloatingPanel, type ObstacleSpec } from '../../lib/use-floating-panel.js';
import { TRAY_PEEK, type WriterSlip } from '../../lib/option-routing.js';
import { withBase } from '../../lib/base-path.js';
import './writer-fab.css';

/**
 * The fixed chrome the writer sheet keeps clear of. Hard: controls that must
 * stay pressable. Soft: the character rail, which scrolls above the sheet when
 * there is no other room (a phone held upright).
 */
export const DEFAULT_OBSTACLES: readonly ObstacleSpec[] = [
  { selector: '.prototype-worldtop:not([hidden])' },
  { selector: '.prototype-edge-controls' },
  { selector: '.view-mode-switch' },
  { selector: '.prototype-immersion-toggle' },
  { selector: '.world-hover' },
  { selector: '.trial-bar' },
  { selector: '.choice-rail' },
  { selector: '.prototype-panel-stop' },
  { selector: '.prototype-tools' },
  { selector: '.prototype-belongings' },
  { selector: '.prototype-player-orb' },
  { selector: '.writer-fab__button' },
  { selector: '.character-dock__stage' },
  { selector: '.workshop-art-panel' },
  // The pulled-up message drawer: the sheet floats beside it, never over the timeline.
  { selector: ".message-drawer[data-open='true'] .message-drawer__panel" },
  { selector: '.prototype-residents', soft: true },
];

/**
 * WriterFab / WriterSheet — the writer's entry in the companion shell
 *.
 *
 * One round button bottom-right; pressing it opens a sheet whose body is the
 * UNCHANGED `WriterBar` — submit, stop, retry, voice input and `writerLocked`
 * all keep their single implementation, so the two shells cannot drift. The
 * FAB only owns "is the writer listening?".
 *
 * Closing: its × button, the FAB's own toggle, Escape (it registers a `writer`
 * surface), sending (the writer starts writing) or using a slip — and a press
 * outside it while the draft is EMPTY
 * A press outside with a
 * draft in progress keeps it open
 * — the player can click cards or read the rail while
 * composing; the draft lives in the App and survives a close anyway.
 *
 * Placement: the sheet — a compact popover, at most
 * 320×360 and scrolling inside — floats in the free slot that
 * covers the least chrome (lib/floating-layout.ts), can be dragged by its head
 * (remembered for this session, ↺ resets) and carries the writer's secondary
 * tools — God Hand, chalk editing — itself, always folded into one ⋯ menu,
 * instead of a second floating row that used to sit on top of it.
 *
 * The sheet never opens itself: the writer finishing a turn flashes the ring,
 * it does not take the player's attention.
 */
export interface WriterFabProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Forwarded verbatim to the embedded `WriterBar`. */
  bar: WriterBarProps;
  /** Stop control for the in-flight turn; rendered only while writing. */
  onStop?(): void;
  /** Retry the last failed prompt; rendered only when one is retryable. */
  onRetry?(): void;
  focus?: FocusCoordinator;
  /** The writer's secondary tools (God Hand, chalk editing), shown inside the sheet. */
  tools?: React.ReactNode;
  /** Chrome the sheet should not cover; soft entries (long rails) shrink above it instead. */
  obstacles?: readonly ObstacleSpec[];
  /** The sheet sits over a soft rail: the height that rail may keep (null = none). */
  onRailLimit?(limit: number | null): void;
  /** So the dock can ignore presses on the FAB. */
  rootRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * The companion stage is open, so the bottom-right corner belongs to its
   * reply box. The FAB steps left of that column rather than sitting on top of
   * it
   *
   */
  clearCompanion?: boolean;
  /**
   * The writer's side of the options: moves as paper slips. At rest the ✎ wears an ink
   * mark with their count, which pulses once when new slips (or a margin note) arrive — the preview never opens by
   * itself; hovering (or focusing) the ✎ previews at most three, one line each; pressing it opens the sheet with
   * the slips above the input.
   */
  slips?: readonly WriterSlip[];
  onSlip?(slip: WriterSlip): void;
  /** Who handed a slip over (`slip.by`): their name and face for the little badge. */
  faces?: Readonly<Record<string, { name: string; avatar?: string | null }>>;
  /** The writer's margin note: a hint with no companion here to say it. */
  note?: { id: string; text: string } | null;
  /** An authoring tool is armed (God Hand, chalk editing): presses on the canvas are its work, not "outside". */
  holdOpen?: boolean;
}

/** How long the ink mark blooms when new slips arrive. */
export const SLIP_BLOOM_MS = 2400;

function SlipList({ slips, faces, onSlip, max, onMore, testId }: {
  slips: readonly WriterSlip[];
  faces?: WriterFabProps['faces'];
  onSlip?(slip: WriterSlip): void;
  max: number;
  onMore?(): void;
  testId: string;
}): React.ReactElement {
  const { t } = useLocale();
  const shown = slips.slice(0, max);
  return (
    <div className="writer-slips" role="group" aria-label={t('Moves for the writer')} data-testid={testId}>
      {shown.map((slip) => {
        const face = slip.by ? faces?.[slip.by] : undefined;
        return (
          <button key={slip.key} type="button" className="writer-slip" data-slip={slip.key} data-by={slip.by} data-used={slip.used ? 'true' : undefined} title={slip.label} onClick={() => onSlip?.(slip)}>
            <span className="writer-slip__glyph" aria-hidden="true">{slip.glyph}</span>
            <span className="writer-slip__label">{slip.label}</span>
            {face && (
              <span className="writer-slip__by" title={t('{name} suggested this', { name: face.name })} aria-label={t('{name} suggested this', { name: face.name })}>
                {face.avatar ? <img src={withBase(face.avatar)} alt="" /> : <b aria-hidden="true">{face.name.charAt(0)}</b>}
              </span>
            )}
          </button>
        );
      })}
      {onMore && slips.length > max && (
        <button type="button" className="writer-slip writer-slip--more" onClick={onMore}>{t('All moves · {count}', { count: slips.length })}</button>
      )}
    </div>
  );
}

export function WriterFab({
  open,
  onOpenChange,
  bar,
  onStop,
  onRetry,
  focus,
  tools,
  obstacles = DEFAULT_OBSTACLES,
  onRailLimit,
  rootRef,
  clearCompanion,
  slips = [],
  onSlip,
  faces,
  note = null,
  holdOpen = false,
}: WriterFabProps): React.ReactElement {
  const { t } = useLocale();
  const writer = useWriterState();
  const fallbackRef = useRef<HTMLDivElement>(null);
  const root = rootRef ?? fallbackRef;
  const sheetRef = useRef<HTMLDivElement>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  const writing = writer.phase === 'writing';

  const openChangeRef = useRef(onOpenChange);
  openChangeRef.current = onOpenChange;
  const requestClose = useCallback(() => {
    leaseRef.current?.markClosing();
    openChangeRef.current(false);
  }, []);

  useEffect(() => {
    if (!open || !focus) return;
    const lease = focus.registerSurface({
      key: 'writer-sheet',
      owner: 'writer',
      // Below every dialog (bag item 340, declared action 350, …): the sheet now
      // stays open while the player opens other things, so Escape must reach
      // whatever was opened on top of it first.
      priority: 290,
      root: sheetRef.current,
      close: () => openChangeRef.current(false),
    });
    leaseRef.current = lease;
    return () => {
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.unregister();
    };
  }, [open, focus]);

  // The software keyboard shrinks the visual viewport: the FAB rides above it
  // (writer-fab.css --writer-visual-*), and the sheet's placement measures the
  // same visual viewport (lib/use-floating-panel.ts).
  useEffect(() => {
    if (!open) return;
    const node = root.current;
    const viewport = window.visualViewport;
    const updateViewport = (): void => {
      if (!node) return;
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      node.style.setProperty('--writer-visual-height', `${height}px`);
      node.style.setProperty('--writer-visual-bottom', `${Math.max(0, window.innerHeight - offsetTop - height)}px`);
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    return () => {
      window.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      node?.style.removeProperty('--writer-visual-height');
      node?.style.removeProperty('--writer-visual-bottom');
    };
  }, [open, root]);

  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => { if (!open) setToolsOpen(false); }, [open]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const floating = useFloatingPanel({
    open,
    panelRef: sheetRef,
    anchorRef: buttonRef,
    obstacles,
    storageKey: 'airp.writer-sheet.position',
    layoutKey: toolsOpen,
  });
  const railLimitRef = useRef(onRailLimit);
  railLimitRef.current = onRailLimit;
  useEffect(() => { railLimitRef.current?.(open ? floating.railLimit : null); }, [open, floating.railLimit]);
  const showTools = Boolean(tools) && toolsOpen;

  // Sending closes the sheet: the turn is underway, the ring on the ✎ shows it.
  const wasWriting = useRef(writing);
  useEffect(() => {
    if (writing && !wasWriting.current && open) requestClose();
    wasWriting.current = writing;
  }, [writing, open, requestClose]);

  // A press outside closes it — unless a draft is in progress (that one stays, see above). Presses inside another
  // surface (a dialog, a menu, the declared-choice host) are theirs, not "outside".
  const draftRef = useRef(bar.value ?? '');
  draftRef.current = bar.value ?? '';
  useEffect(() => {
    if (!open || holdOpen) return;
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Element | null;
      if (!target || !(target instanceof Element)) return;
      if (sheetRef.current?.contains(target) || root.current?.contains(target)) return;
      if (target.closest('[role="dialog"], [role="menu"], [data-radial-menu]')) return;
      // The message drawer rises and falls WITH the sheet: reading it is not leaving the writer.
      if (target.closest('[data-message-drawer]')) return;
      if (draftRef.current.trim() !== '') return;
      requestClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, holdOpen, root, requestClose]);

  const takeSlip = (slip: WriterSlip): void => {
    onSlip?.(slip);
    if (open) requestClose();
  };

  // New slips (a key not seen before) or a new margin note make the ink mark pulse once — never on the ones already
  // there, and never by opening anything.
  const seenSlips = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState(false);
  // The ink counts only moves not made yet: a door walked through or a talk had stays on the
  // tray, but it is not new.
  const unused = slips.filter((s) => !s.used);
  const slipKeys = [...unused.map((s) => s.key), ...(note ? [`note:${note.id}`] : [])].join('\u0000');
  useEffect(() => {
    const keys = slipKeys ? slipKeys.split('\u0000') : [];
    const added = keys.some((k) => !seenSlips.current.has(k));
    for (const k of keys) seenSlips.current.add(k);
    if (!added) return;
    setFresh(true);
    const timer = window.setTimeout(() => setFresh(false), SLIP_BLOOM_MS);
    return () => window.clearTimeout(timer);
  }, [slipKeys]);
  const hasTray = slips.length > 0 || note !== null;

  return (
    <div
      ref={root}
      className="writer-fab"
      data-writer-open={open ? 'true' : undefined}
      data-clear-companion={clearCompanion ? 'true' : undefined}
      data-has-slips={slips.length > 0 ? 'true' : undefined}
    >
      {open && (
        <div
          ref={sheetRef}
          className="writer-fab__sheet"
          role="group"
          aria-label={t('✧ SPEAK TO THE WRITER')}
          data-testid="writer-sheet"
          data-slot={floating.placement?.slot}
          data-compact={floating.compact ? 'true' : undefined}
          style={floating.style}
        >
          <div className="writer-fab__sheet-head" {...floating.handleProps} title={t('Drag to move')}>
            <span className="writer-fab__grip" aria-hidden="true">⠿</span>
            <b>{t('✧ SPEAK TO THE WRITER')}</b>
            <span className="writer-fab__status" aria-live="polite">
              {writing ? t('The writer is writing…') : t('The writer is listening')}
            </span>
            <span className="writer-fab__head-actions">
              {tools && (
                <button type="button" className="writer-fab__icon" data-testid="writer-tools-toggle" aria-expanded={toolsOpen} aria-label={t('More tools')} title={t('More tools')} onClick={() => setToolsOpen(v => !v)}>⋯</button>
              )}
              {floating.moved && (
                <button type="button" className="writer-fab__icon" data-testid="writer-sheet-reset" aria-label={t('Reset position')} title={t('Reset position')} onClick={floating.reset}>↺</button>
              )}
              <button type="button" className="writer-fab__icon" data-testid="writer-sheet-close" aria-label={t('Close')} title={t('Close')} onClick={requestClose}>×</button>
            </span>
          </div>
          {slips.length > 0 && <SlipList slips={slips} faces={faces} onSlip={takeSlip} max={slips.length} testId="writer-sheet-slips" />}
          <WriterBar {...bar} embedded />
          {showTools && <div className="writer-fab__tools" data-testid="writer-tools">{tools}</div>}
          {onStop && writing && (
            <button
              type="button"
              className="writer-fab__stop"
              data-writer-stop
              disabled={writer.stopRequested}
              onClick={onStop}
            >
              {writer.stopRequested ? t('Stop requested') : t('Stop writing')}
            </button>
          )}
          {onRetry && writer.error?.retryable && (
            <button type="button" className="writer-fab__retry" data-writer-retry onClick={onRetry}>
              {t('Retry writing')}
            </button>
          )}
        </div>
      )}

      {/* The preview tray: always in the DOM while there is something to show, revealed by
          CSS on hover / focus-within only — a press inside it never moves the layout under the cursor. A margin note
          takes one of the three lines. */}
      {!open && hasTray && (
        <div className="writer-tray" data-testid="writer-tray">
          {note && (
            <p className="writer-tray__note" data-testid="writer-note" data-hint={note.id} title={note.text}>
              <span className="writer-tray__note-mark" aria-hidden="true">✎</span>{note.text}
            </p>
          )}
          {slips.length > 0 && <SlipList slips={slips} faces={faces} onSlip={onSlip} max={note ? TRAY_PEEK - 1 : TRAY_PEEK} onMore={() => onOpenChange(true)} testId="writer-tray-slips" />}
        </div>
      )}

      <button
        ref={buttonRef}
        type="button"
        className={`writer-fab__button${writing ? ' writer-fab__button--writing' : ''}`}
        data-fresh={fresh ? 'true' : undefined}
        // The guide's fourth step points here.
        data-guide-target="writer"
        data-tutorial="writer"
        aria-expanded={open}
        aria-label={t('Speak to the writer')}
        onClick={() => onOpenChange(!open)}
      >
        <span aria-hidden="true">✎</span>
        {unused.length > 0 && <span className="writer-fab__count" data-testid="writer-count" aria-label={t('{count} moves for the writer', { count: unused.length })}>{unused.length}</span>}
        {writing && <span className="writer-fab__ring" aria-hidden="true" />}
      </button>
    </div>
  );
}
