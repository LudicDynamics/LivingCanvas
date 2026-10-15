import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { AppearanceView } from '../../lib/appearance-view.js';
import type { FocusCoordinator, FocusSurfaceLease } from '../../lib/focus-coordinator.js';
import { useLocale } from '../../lib/i18n.js';
import { HtmlMedia } from './HtmlMedia.js';
import { designWidthOf } from './html-design.js';
import './html.css';

export interface HtmlDetailDialogProps {
  item: { path: string; filename: string; frontmatter: Record<string, any> | null; body: string };
  appearance?: AppearanceView | null;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  dialogId?: string;
  focus?: FocusCoordinator;
}

/** Same focusable set as `PhotoDetailDialog.tsx:17-24` — one Tab trap vocabulary. */
const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * The second layer for a page card: the LIVE page. Same family as
 * `PhotoDetailDialog` — portal to `body`, a focus surface lease, focus return,
 * Esc / outside-click close, `role="dialog"`, and a Tab trap. The one
 * difference is the body: an interactive, scrollable iframe instead of an
 * image. The design width is derived here, so a caller needs only `item`.
 */
export function HtmlDetailDialog({
  item,
  appearance,
  onClose,
  returnFocusRef,
  dialogId,
  focus,
}: HtmlDetailDialogProps): React.ReactElement | null {
  const { t } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  const generatedId = useId().replace(/:/g, '');
  const id = dialogId || `html-detail-${generatedId}`;
  const titleId = `${id}-title`;
  const frontmatter = item.frontmatter;
  const title = typeof frontmatter?.title === 'string' && frontmatter.title.trim()
    ? frontmatter.title
    : item.filename;
  const preview = typeof frontmatter?.preview === 'string' ? frontmatter.preview : '';
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;

  // `markClosing()` is the duplicate-close guard: Esc, the button and a canvas
  // click can all arrive for the same closing surface (photo family precedent).
  const requestClose = () => {
    const lease = leaseRef.current;
    if (lease && !lease.markClosing()) return;
    closeHandler.current();
  };

  useEffect(() => {
    if (!focus) return;
    const lease = focus.registerSurface({
      key: `html:${item.path}`,
      owner: 'workspace',
      priority: 340,
      root: panelRef.current,
      close: () => closeHandler.current(),
    });
    leaseRef.current = lease;
    return () => {
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.unregister();
    };
  }, [focus, item.path]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      const target = returnFocusRef?.current;
      if (target && document.contains(target)) target.focus();
      else if (previous && document.contains(previous)) previous.focus();
    };
  }, [returnFocusRef]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="html-detail"
      role="presentation"
      onPointerDown={event => {
        if (event.target === event.currentTarget) requestClose();
        else event.stopPropagation();
      }}
    >
      <div
        ref={panelRef}
        id={id}
        className="html-detail__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        {...appearance?.attrs}
        style={appearance?.style}
        onPointerDown={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key !== 'Tab') return;
          const panel = panelRef.current;
          if (!panel) return;
          const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
            .filter(element => element.getClientRects().length > 0);
          if (focusable.length === 0) {
            event.preventDefault();
            panel.focus();
            return;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          const active = document.activeElement;
          if (!panel.contains(active)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          } else if (event.shiftKey && (active === first || active === panel)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && (active === last || active === panel)) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="html-detail__header">
          <button
            ref={closeRef}
            type="button"
            className="html-detail__close"
            aria-label={t('Close')}
            onPointerDown={event => {
              event.preventDefault();
              event.stopPropagation();
              requestClose();
            }}
            onClick={requestClose}
          >
            {t('Close')}
          </button>
          <h2 id={titleId}>{title}</h2>
        </header>
        <div className="html-detail__scroll">
          {/* Live: the page's own links, forms and scrolling work here. The
              second layer is modal and singular, so it never takes a budget
              slot — `active` is irrelevant to the `detail` variant. */}
          <HtmlMedia
            path={item.path}
            title={title}
            preview={preview}
            designWidth={designWidthOf(frontmatter)}
            cardWidth={0}
            variant="detail"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
