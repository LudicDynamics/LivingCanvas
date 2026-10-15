/**
 * The player's own sticky note on the canvas.
 *
 * Cut from the canvas cards' own paper (texture, hairline, shadow, card face
 * font) so it belongs to the world, yet reads as the player's: a strip of tape,
 * a slight tilt, a faint ruled memo and a small 「你的便签」 foot line. The four
 * stored colours render as paper tones (parchment / rose / mist / sage). Editing is inline
 * (double-click or the pencil): text, colour, size, delete. Every change goes
 * through `/api/player-note` as the player; the `entity_*` event then refreshes
 * the layer like any other world change.
 */
import React from 'react';
import { airpGateway, type PlayerNoteColor, type PlayerNoteSize } from '../../lib/airp-gateway.js';
import { useLocale } from '../../lib/i18n.js';
import './player-board.css';

export const NOTE_COLORS: readonly PlayerNoteColor[] = ['yellow', 'pink', 'blue', 'green'];
export const NOTE_SIZES: readonly PlayerNoteSize[] = ['s', 'm', 'l'];
export const NOTE_TEXT_MAX = 500;

const colorOf = (v: unknown): PlayerNoteColor => (NOTE_COLORS as readonly unknown[]).includes(v) ? (v as PlayerNoteColor) : 'yellow';
const sizeOf = (v: unknown): PlayerNoteSize => (NOTE_SIZES as readonly unknown[]).includes(v) ? (v as PlayerNoteSize) : 'm';

/** True when this card is a player note (type AND the owned file name — the server's rule). */
export function isPlayerNoteItem(item: { filename: string; frontmatter: Record<string, any> | null }): boolean {
  return item.frontmatter?.type === 'player-note' && /^player-note-\d{1,6}\.md$/.test(item.filename);
}

interface EditorProps {
  initialText: string;
  initialColor: PlayerNoteColor;
  initialSize: PlayerNoteSize;
  busy?: boolean;
  error?: string | null;
  onSave(text: string, color: PlayerNoteColor, size: PlayerNoteSize): void;
  onCancel(): void;
  onDelete?(): void;
}

/** The shared editor: used inline on a note and in the "new note" composer. */
export const StickyNoteEditor: React.FC<EditorProps> = ({ initialText, initialColor, initialSize, busy, error, onSave, onCancel, onDelete }) => {
  const { t } = useLocale();
  const [text, setText] = React.useState(initialText);
  const [color, setColor] = React.useState(initialColor);
  const [size, setSize] = React.useState(initialSize);
  const save = () => { if (text.trim() && !busy) onSave(text.trim(), color, size); };
  const sizeLabel: Record<PlayerNoteSize, string> = { s: t('Small'), m: t('Medium'), l: t('Large') };
  const colorLabel: Record<PlayerNoteColor, string> = { yellow: t('Parchment'), pink: t('Rose paper'), blue: t('Mist paper'), green: t('Sage paper') };
  return (
    <div
      className="sticky-editor"
      data-no-drag
      data-sticky-color={color}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
      }}
    >
      <textarea
        className="sticky-editor__text"
        aria-label={t('Note text')}
        placeholder={t('Write what you think…')}
        value={text}
        maxLength={NOTE_TEXT_MAX}
        autoFocus
        onChange={(e) => setText(e.target.value)}
      />
      <div className="sticky-editor__row" role="group" aria-label={t('Note colour')}>
        {NOTE_COLORS.map((c) => (
          <button key={c} type="button" className={`sticky-swatch sticky-swatch--${c}`} aria-label={colorLabel[c]} aria-pressed={c === color} onClick={() => setColor(c)} />
        ))}
        <span className="sticky-editor__gap" />
        {NOTE_SIZES.map((s) => (
          <button key={s} type="button" className="sticky-size" aria-label={sizeLabel[s]} aria-pressed={s === size} onClick={() => setSize(s)}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>
      {error && <div className="sticky-editor__error" role="alert">{error}</div>}
      <div className="sticky-editor__row">
        {onDelete && <button type="button" className="sticky-btn sticky-btn--danger" onClick={onDelete} disabled={busy}>{t('Delete')}</button>}
        <span className="sticky-editor__gap" />
        <button type="button" className="sticky-btn" onClick={onCancel} disabled={busy}>{t('Cancel')}</button>
        <button type="button" className="sticky-btn sticky-btn--primary" onClick={save} disabled={busy || !text.trim()}>{t('Save')}</button>
      </div>
    </div>
  );
};

interface Props {
  item: { path: string; filename: string; frontmatter: Record<string, any> | null; body: string };
}

export const StickyNote: React.FC<Props> = ({ item }) => {
  const { t } = useLocale();
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const color = colorOf(item.frontmatter?.color);
  const size = sizeOf(item.frontmatter?.size);
  const text = item.body.trim();

  const run = async (body: Parameters<typeof airpGateway.playerNote>[0]) => {
    setBusy(true);
    setError(null);
    try {
      await airpGateway.playerNote(body);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^POST \S+ -> \d+ /, '') : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`sticky sticky--${color} sticky--size-${size}${editing ? ' sticky--editing' : ''}`}
      data-sticky-note={item.path}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
    >
      <span className="sticky__tape" aria-hidden="true" />
      <span className="sticky__stamp">{t('Your note')}</span>
      {editing ? (
        <StickyNoteEditor
          initialText={text}
          initialColor={color}
          initialSize={size}
          busy={busy}
          error={error}
          onCancel={() => { setEditing(false); setError(null); }}
          onSave={(next, c, s) => void run({ op: 'update', path: item.path, text: next, color: c, size: s })}
          onDelete={() => { if (window.confirm(t('Take this note down?'))) void run({ op: 'delete', path: item.path }); }}
        />
      ) : (
        <>
          <div className="sticky__text">{text}</div>
          <button
            type="button"
            className="sticky__edit"
            data-no-drag
            aria-label={t('Edit note')}
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          >
            ✎
          </button>
        </>
      )}
    </div>
  );
};
