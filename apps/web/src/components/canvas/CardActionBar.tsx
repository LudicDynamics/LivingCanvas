/**
 * CardActionBar — a card's big action buttons (打开 / 收入随身 / 进入地点 / 对话),
 * the design notes §卡片行动按钮.
 *
 * Two placements, one look:
 *   - `float`: a pill that hangs above (or below) the card on screen while the
 *     pointer rests on it / keyboard focus is on it. Ported to <body> so the
 *     camera's zoom and the map projection never shrink or skew it; it follows
 *     the card with one rect read per frame, only while it is showing.
 *   - `inline`: the same buttons in flow, under a focus view or in the map's
 *     card panel.
 *
 * It only renders buttons; the owner hands in what each one does, so a button
 * here always runs the same handler the card used before.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { pillPosition, type CardActionId } from '../../lib/card-actions.js';
import './card-actions.css';

export interface CardActionButton {
  id: CardActionId;
  label: string;
  onSelect(): void;
  /** A place that asks for something the player does not carry (tutorial reads it). */
  locked?: boolean;
  disabled?: boolean;
}

interface Props {
  path: string;
  actions: readonly CardActionButton[];
  placement: 'float' | 'inline';
  /** float: the card shell the pill hangs from. */
  anchor?: HTMLElement | null;
  visible?: boolean;
  prefer?: 'above' | 'below';
  ariaLabel: string;
  /** Busy / feedback / error lines from the action that ran. */
  status?: React.ReactNode;
  onPointerEnter?(): void;
  onPointerLeave?(): void;
}

export function CardActionBar({ path, actions, placement, anchor, visible = true, prefer = 'above', ariaLabel, status, onPointerEnter, onPointerLeave }: Props): React.ReactElement | null {
  const ref = React.useRef<HTMLDivElement>(null);
  const floating = placement === 'float';
  const shown = visible && actions.length > 0;

  // Follow the card while showing: the camera may pan or zoom under it.
  React.useLayoutEffect(() => {
    if (!floating || !shown || !anchor) return;
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let last = '';
    const place = () => {
      // The lifted face grows past the shell: hang the pill off whichever is larger.
      const shell = anchor.getBoundingClientRect();
      const face = anchor.firstElementChild?.getBoundingClientRect() ?? shell;
      const left = Math.min(shell.left, face.left);
      const top = Math.min(shell.top, face.top);
      const right = Math.max(shell.right, face.right);
      const bottom = Math.max(shell.bottom, face.bottom);
      const at = pillPosition(
        { left, top, width: right - left, height: bottom - top },
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        prefer,
      );
      const key = `${at.left},${at.top},${at.side}`;
      if (key !== last) {
        last = key;
        el.style.transform = `translate3d(${at.left}px, ${at.top}px, 0)`;
        el.dataset.side = at.side;
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [floating, shown, anchor, prefer]);

  if (actions.length === 0 && !status) return null;
  if (floating && !shown && !status) return null;

  const bar = (
    <div
      ref={ref}
      className={`card-actions card-actions--${placement}`}
      role="group"
      aria-label={ariaLabel}
      data-card-actions={path}
      data-no-drag
      hidden={floating && !shown ? true : undefined}
      // A press here is never a canvas pan or a card drag / read.
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {actions.length > 0 && (
        <div className="card-actions__row">
          {actions.map(action => (
            <button
              key={action.id}
              type="button"
              className={`card-actions__btn card-actions__btn--${action.id}`}
              data-card-action={action.id}
              data-card-path={path}
              data-tutorial-locked={action.locked ? 'true' : undefined}
              disabled={action.disabled}
              onClick={() => action.onSelect()}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      {status}
    </div>
  );
  return floating ? createPortal(bar, document.body) : bar;
}
