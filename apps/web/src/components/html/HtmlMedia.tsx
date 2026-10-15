import React, { useEffect, useState } from 'react';
import { airpGateway } from '../../lib/airp-gateway.js';
import './html.css';

/**
 * Whether the iframe has painted yet. `'static'` is the degraded face: no
 * iframe at all, just the panel shell with the title (and the preview when the
 * author wrote one). Its paint MUST be the panel surface, so a late `'ready'`
 * is a same-colour repaint rather than a white flash.
 */
export type HtmlFrameState = 'static' | 'loading' | 'ready';

export interface HtmlMediaProps {
  /** World-root relative POSIX path (`item.path`) → `/api/world-file?path=…`. */
  path: string;
  /** The virtual frontmatter `title`: the iframe `title` AND the fallback heading. */
  title: string;
  /** The virtual frontmatter `preview`. Measured: 6/6 real pages carry `''`. */
  preview: string;
  /** Virtual frontmatter `design` → `HTML_DESIGN_WIDTHS[design]` (1280/834/390). */
  designWidth: number;
  /** The card's painted width (`LayerItem.w`). Ignored by the `detail` variant. */
  cardWidth: number;
  variant: 'card' | 'detail';
  /** The `card` gate (in-viewport ∩ in-budget). Omitted = `true`; `detail` always mounts. */
  active?: boolean;
  onStateChange?: (state: HtmlFrameState) => void;
}

/** The frozen virtual-frontmatter preview key, when the author supplied one. */
function previewOf(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * One page, two readings. `card` is a READ-ONLY thumbnail: the iframe never
 * receives a pointer event, so drag/click/hover/double-click stay the card
 * shell's (`CanvasObject.tsx:277-290`) and no new canvas state is invented.
 * `detail` is the live view: interactions and scrolling are the page's own.
 */
export function HtmlMedia({
  path,
  title,
  preview,
  designWidth,
  cardWidth,
  variant,
  active = true,
  onStateChange,
}: HtmlMediaProps): React.ReactElement {
  const mounted = variant === 'detail' || active;
  const [state, setState] = useState<HtmlFrameState>(mounted ? 'loading' : 'static');

  useEffect(() => {
    setState(mounted ? 'loading' : 'static');
  }, [mounted, path]);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  // The card scales the WHOLE page down to the card's painted width; the detail
  // view renders at the page's own design width and lets the container scroll.
  const frameStyle: React.CSSProperties = variant === 'card'
    ? {
      width: designWidth,
      height: designWidth * 9 / 16,
      transform: `scale(${cardWidth / designWidth})`,
      transformOrigin: 'top left',
    }
    : { width: `min(${designWidth}px, 90vw)` };

  const note = previewOf(preview);

  return (
    <div
      className={`html-media html-media--${variant}`}
      data-html-state={state}
    >
      <div
        className="html-media__viewport"
        style={variant === 'card' ? { aspectRatio: '16 / 9' } : undefined}
      >
        {mounted ? (
          <iframe
            className="html-media__frame"
            style={frameStyle}
            src={airpGateway.worldFileUrl(path)}
            title={title}
            // `allow-scripts` ONLY: without the same-origin token the page runs
            // on an opaque origin, so it reaches neither this document nor the
            // same-origin API (`POST /api/god-action`). This repo ships no CSP
            // header — this attribute IS the isolation (contract §8.1).
            sandbox="allow-scripts"
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={() => setState('ready')}
          />
        ) : (
          <div className="html-media__degraded">
            <span className="html-media__title">{title}</span>
            {note !== '' && <span className="html-media__preview">{note}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
