/**
 * The player's clue board chrome: the small
 * toolbar (便签 / 线索板), the "new note" composer, the line-label popover and
 * the mark popover. Canvas reports gestures (`boardMode`, `onBoardLink`,
 * `onBoardPick`); this module decides what they open.
 *
 * Right-click / long-press on blank canvas always opens the radial
 * (components/god/RadialMenu.tsx, lib/radial-items.ts); its 便签 / 线索板
 * satellites call `openNoteAt` / `toggleBoard` here. The toolbar and board mode
 * are play-only (`enabled`); the note composer also opens while authoring
 * (`notesEnabled`), where the radial offers 便签 beside the creators.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { useCamera } from '../../state/useCamera.js';
import { useLocale } from '../../lib/i18n.js';
import type { PlayerBoardApi } from '../../state/usePlayerBoard.js';
import type { PlayerTagValue } from '../../lib/airp-gateway.js';
import { BOARD_KEY, NOTE_KEY, isTypingTarget } from '../../lib/player-board-gestures.js';
import { StickyNoteEditor } from './StickyNote.js';
import './player-board.css';

type Pop =
  | { kind: 'note'; x: number; y: number; worldX: number; worldY: number }
  | { kind: 'link'; x: number; y: number; from: string; to: string }
  | { kind: 'pick'; x: number; y: number; path: string };

const TAGS: readonly PlayerTagValue[] = ['suspect', 'confirmed', 'irrelevant'];
const LABEL_MAX = 24;

interface Options {
  api: PlayerBoardApi;
  layer: string | null;
  /** False in a nook / while authoring / with no world: no toolbar, no board mode. */
  enabled: boolean;
  /** The note composer may open (the world canvas, play or authoring). Defaults to `enabled`. */
  notesEnabled?: boolean;
  /** A card or character's display name for the popovers. */
  nameOf(path: string): string;
}

export interface ClueBoard {
  boardMode: boolean;
  openNoteAt(x: number, y: number, worldX: number, worldY: number): void;
  toggleBoard(): void;
  canvasProps: {
    boardMode: boolean;
    onBoardLink(from: string, to: string, x: number, y: number): void;
    onBoardPick(endpoint: string, x: number, y: number): void;
  };
  chrome: React.ReactNode;
}

function clampPop(x: number, y: number): React.CSSProperties {
  const w = Math.min(280, window.innerWidth - 32);
  return {
    left: Math.max(16, Math.min(x, window.innerWidth - w - 16)),
    top: Math.max(16, Math.min(y, window.innerHeight - 300)),
  };
}

export function useClueBoard({ api, layer, enabled, notesEnabled = enabled, nameOf }: Options): ClueBoard {
  const { t } = useLocale();
  const camera = useCamera();
  const [boardMode, setBoardMode] = React.useState(false);
  const [pop, setPop] = React.useState<Pop | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [label, setLabel] = React.useState('');

  React.useEffect(() => { setBoardMode(false); setPop((p) => (p?.kind === 'note' && notesEnabled ? p : null)); }, [layer, enabled, notesEnabled]);

  const openNoteAt = React.useCallback((x: number, y: number, worldX: number, worldY: number) => {
    if (!notesEnabled || !layer) return;
    setPop({ kind: 'note', x, y, worldX, worldY });
  }, [notesEnabled, layer]);
  const toggleBoard = React.useCallback(() => {
    if (!enabled) return;
    setBoardMode((v) => !v);
    setPop(null);
  }, [enabled]);

  const noteAtCentre = React.useCallback(() => {
    const cam = camera.getCam();
    openNoteAt(window.innerWidth / 2 - 140, window.innerHeight / 2 - 120, cam.x - 104, cam.y - 80);
  }, [camera, openNoteAt]);

  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape always backs out (other layers may have handled it first).
      if (e.key === 'Escape') { if (pop) setPop(null); else setBoardMode(false); return; }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === NOTE_KEY) { e.preventDefault(); noteAtCentre(); }
      else if (key === BOARD_KEY) { e.preventDefault(); setBoardMode((v) => !v); setPop(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, noteAtCentre, pop]);

  const canvasProps = {
    boardMode: enabled && boardMode,
    onBoardLink: (from: string, to: string, x: number, y: number) => { setLabel(''); setPop({ kind: 'link', from, to, x, y }); },
    onBoardPick: (path: string, x: number, y: number) => setPop({ kind: 'pick', path, x, y }),
  };

  const close = () => setPop(null);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); } finally { setBusy(false); }
    close();
  };

  let popEl: React.ReactNode = null;
  if (notesEnabled && pop?.kind === 'note' && layer) {
    popEl = (
      <div className="clue-pop clue-pop--note" style={clampPop(pop.x, pop.y)} role="dialog" aria-label={t('New note')} data-clue-pop="note">
        <h3>{t('New note')}</h3>
        <StickyNoteEditor
          initialText=""
          initialColor="yellow"
          initialSize="m"
          busy={busy}
          onCancel={close}
          onSave={(text, color, size) => void run(() => api.note({ op: 'create', layer, text, color, size, x: Math.round(pop.worldX), y: Math.round(pop.worldY) }))}
        />
      </div>
    );
  } else if (enabled && pop?.kind === 'link') {
    const chips = [t('Contradiction'), t('Same person?'), t('Motive'), t('Alibi')];
    popEl = (
      <div className="clue-pop" style={clampPop(pop.x, pop.y)} role="dialog" aria-label={t('Connect clues')} data-clue-pop="link">
        <h3>{t('Connect “{a}” and “{b}”', { a: nameOf(pop.from), b: nameOf(pop.to) })}</h3>
        <div className="clue-pop__chips">
          {chips.map((chip) => (
            <button key={chip} type="button" aria-pressed={label === chip} onClick={() => setLabel(label === chip ? '' : chip)}>{chip}</button>
          ))}
        </div>
        <input
          aria-label={t('Line label (optional)')}
          placeholder={t('Line label (optional)')}
          value={label}
          maxLength={LABEL_MAX}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run(() => api.link(pop.from, pop.to, label.trim() || undefined)); }}
        />
        <div className="clue-pop__actions">
          <button type="button" onClick={close}>{t('Cancel')}</button>
          <button type="button" className="is-primary" disabled={busy} onClick={() => void run(() => api.link(pop.from, pop.to, label.trim() || undefined))}>{t('Connect')}</button>
        </div>
      </div>
    );
  } else if (enabled && pop?.kind === 'pick') {
    const current = api.tags.get(pop.path) ?? null;
    const lines = api.board.links.filter((l) => l.from === pop.path || l.to === pop.path);
    const tagLabel: Record<PlayerTagValue, string> = { suspect: t('Suspicious'), confirmed: t('Confirmed'), irrelevant: t('Irrelevant') };
    popEl = (
      <div className="clue-pop" style={clampPop(pop.x, pop.y)} role="dialog" aria-label={t('Mark this')} data-clue-pop="pick">
        <h3>{nameOf(pop.path)}</h3>
        <div className="clue-pop__chips" role="group" aria-label={t('Mark this')}>
          {TAGS.map((tag) => (
            <button key={tag} type="button" className={`clue-pop__tag--${tag}`} aria-pressed={current === tag} disabled={busy}
              onClick={() => void run(() => api.tag(pop.path, current === tag ? null : tag))}>
              {tagLabel[tag]}
            </button>
          ))}
          {current && <button type="button" disabled={busy} onClick={() => void run(() => api.tag(pop.path, null))}>{t('Clear mark')}</button>}
        </div>
        {lines.length > 0 && (
          <div className="clue-pop__chips" role="group" aria-label={t('Lines')}>
            {lines.map((l) => {
              const other = l.from === pop.path ? l.to : l.from;
              return (
                <button key={l.id} type="button" disabled={busy} aria-label={t('Erase line to {name}', { name: nameOf(other) })} onClick={() => void run(() => api.unlink(l.id))}>
                  ✕ {nameOf(other)}{l.label ? ` · ${l.label}` : ''}
                </button>
              );
            })}
          </div>
        )}
        <div className="clue-pop__actions"><button type="button" onClick={close}>{t('Close')}</button></div>
      </div>
    );
  }

  const chrome = enabled ? (
    <>
      {/* No standing toolbar:
          both live in the right-click / long-press radial (lib/radial-items.ts) and on the N / B keys. */}
      {boardMode && <div className="clue-hint" role="status">{t('Drag from one card to another to connect them. Tap a card to mark it.')}</div>}
      {popEl && createPortal(<>{popEl}</>, document.body)}
    </>
  ) : notesEnabled && popEl ? createPortal(<>{popEl}</>, document.body) : null;

  return { boardMode: enabled && boardMode, openNoteAt, toggleBoard, canvasProps, chrome };
}
