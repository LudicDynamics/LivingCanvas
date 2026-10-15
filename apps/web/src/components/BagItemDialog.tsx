import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MarkdownText } from '../lib/md.js';
import { useLocale } from '../lib/i18n.js';
import { renderFrontmatterWidgets } from '../lib/fm.js';
import { airpGateway } from '../lib/airp-gateway.js';
import { playFoley } from '../lib/audio.js';
import { ItemArtwork } from './ItemArtwork.js';
import { PhotoMedia } from './photo/PhotoMedia.js';
import type { AppearanceView } from '../lib/appearance-view.js';
import type { FocusCoordinator, FocusSurfaceLease } from '../lib/focus-coordinator.js';
export function BagItemDialog({ item, onClose, onChoose, onPlace, onUse, useDisabled = false, inline = false, focusView = false, footer, appearance, focus }: {
  item: { path: string; filename: string; body: string; frontmatter: Record<string, any> | null };
  onClose: () => void;
  /** Hand a choice to the owner instead of posting it here (declared actions need the canvas flow). */
  onChoose?: (choice: string) => void;
  onPlace?: (path: string) => Promise<boolean>;
  /** Add this item to the local Writer draft; this callback must not execute an action. */
  onUse?: (path: string) => void;
  useDisabled?: boolean;
  inline?: boolean;
  /**
   * The canvas card's focus view: the same paper,
   * centred on screen above the canvas (ported out of the camera transform so
   * the zoom never shrinks it), with the card's big action buttons in `footer`.
   */
  focusView?: boolean;
  /** Rendered inside the paper after the content (the card's action buttons). */
  footer?: ReactNode;
  /** The verified view inherited from `.object` (04 §:86): the reading layer consumes the
   * same resolution and never re-resolves. Optional so an old/absent resolution keeps the
   * default paper-reading paint. */
  appearance?: AppearanceView | null;
  focus?: FocusCoordinator;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const paper = useRef<HTMLElement>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  const requestClose = () => {
    const lease = leaseRef.current;
    if (lease && !lease.markClosing()) return;
    closeHandler.current();
  };
  useEffect(() => {
    if (!focus) return;
    const lease = focus.registerSurface({
      key: `belongings:${focusView ? 'focus:' : inline ? 'inline:' : ''}${item.path}`,
      owner: 'belongings',
      // The focus view is the card the player just opened, centred over the
      // dock: Escape closes it before the character dialogue (500).
      priority: focusView ? 505 : 340,
      root: paper.current,
      close: () => closeHandler.current(),
    });
    leaseRef.current = lease;
    return () => {
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.unregister();
    };
  }, [focus, inline, focusView, item.path]);
  useEffect(() => { playFoley('page-turn'); }, [item.path]);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!paper.current?.contains(e.target as Node)) requestClose(); };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, []);
  const choose = (choice: string) => {
    if (!onChoose) {
      setError('Review this choice in the writer before sending it.');
      return;
    }
    onChoose(choice);
  };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const isPhoto = item.frontmatter?.component === 'photo';
  const image = typeof item.frontmatter?.image === 'string' ? item.frontmatter.image : item.frontmatter?.cover;
  // Carried photos use the same explicit missing/error states as canvas photos;
  // ordinary carried items retain ItemArtwork and inline legacy image behavior.
  const variant = focusView ? ' paper-reading--focus' : inline ? ' paper-reading--inline' : ' paper-reading--carried';
  const sheet = <section ref={paper} data-reading data-no-drag {...appearance?.attrs} style={appearance?.style} className={`paper-reading${variant}`} role={focusView ? 'dialog' : 'region'} aria-label={String(item.frontmatter?.title || item.filename)} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    <header>
      <h2><button onClick={requestClose} title={t('Close')}>{item.frontmatter?.title || item.filename}</button></h2>
      <button autoFocus className="paper-reading__fold" aria-label={t('Close')} onClick={requestClose}>↙</button>
    </header>
    <div className="paper-reading__content">
      {isPhoto ? (
        <>
          <PhotoMedia
            image={typeof item.frontmatter?.image === 'string' ? item.frontmatter.image : undefined}
            alt={String(item.frontmatter?.title || item.filename)}
            variant="carried"
          />
          {typeof item.frontmatter?.caption === 'string' && item.frontmatter.caption.trim() && (
            <p className="photo-detail__caption">{item.frontmatter.caption}</p>
          )}
        </>
      ) : (
        <>
          {!inline && !focusView && <div className="carried-item-artwork"><ItemArtwork item={item} /></div>}
          {(inline || focusView) && typeof image === 'string' && <img src={airpGateway.assetUrl(image, undefined, 'image')} alt="" style={{ maxHeight: 200, maxWidth: '100%', objectFit: 'contain' }} />}
          <MarkdownText text={item.body} />
          <fieldset disabled={busy} aria-busy={busy}>
            {renderFrontmatterWidgets(item.frontmatter, { filePath: item.path, reveal: true, onChoice: onChoose ?? choose })}
            {onUse && <button type="button" disabled={useDisabled} onClick={() => onUse(item.path)}>{t('Use this item')}</button>}
            {onPlace && <button type="button" onClick={() => void run(async () => { if (await onPlace(item.path)) requestClose(); else setError(t('Could not move item')); })}>{t('Place in current scene')}</button>}
          </fieldset>
        </>
      )}
      {busy && <small role="status">{t('Working…')}</small>}
      {error && <p role="alert">{error}</p>}
    </div>
    {footer}
  </section>;
  return focusView ? createPortal(<div className="card-focus">{sheet}</div>, document.body) : sheet;
}
