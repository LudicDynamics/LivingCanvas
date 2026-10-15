/**
 * SendButton.tsx — the one send pill shared by every prompt box.
 *
 * The writer's bar introduced it (`.writer-bar__send`, an ink pill with `↑`);
 * the character reply boxes (CharacterModal, CharacterDock, NpcDialogue) reuse
 * it so "send" looks and behaves the same wherever the player types. Enter in
 * the input stays the keyboard path; this button is the pointer / touch / Tab
 * path and calls the SAME submit function, so busy, empty and IME guards live
 * in one place per host.
 *
 * IME: the Enter that confirms a composition never reaches submit (the hosts'
 * `guardImeKey`). Pressing this button is allowed to take focus on purpose:
 * the blur commits any open composition (compositionend → onChange) BEFORE the
 * click fires, so the button sends the confirmed text, never half a candidate,
 * and the IME cannot re-insert its pending text into the box just cleared.
 */
import React from 'react';

export interface SendButtonProps {
  onSend: () => void;
  disabled?: boolean;
  /** Accessible name (already localized by the host). */
  label: string;
  /** Extra class next to `writer-bar__send` (e.g. the touch-size modifier). */
  className?: string;
  /** Forced-tutorial anchor, when a step points at this button. */
  tutorialTarget?: string;
  /** Visible glyph; defaults to the writer's arrow. */
  children?: React.ReactNode;
}

export const SendButton: React.FC<SendButtonProps> = ({
  onSend,
  disabled = false,
  label,
  className,
  tutorialTarget,
  children = '↑',
}) => (
  <button
    type="button"
    className={className ? `writer-bar__send ${className}` : 'writer-bar__send'}
    data-tutorial={tutorialTarget}
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onSend}
  >
    {children}
  </button>
);
