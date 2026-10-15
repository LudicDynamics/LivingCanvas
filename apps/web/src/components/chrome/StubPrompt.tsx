/**
 * StubPrompt — the "what is this place?" line for an unwritten space
 *.
 *
 * It is deliberately NOT a `WriterBar`: that bar's `onSend` drops empty input
 * (`if (!trimmed || disabled) return`), but here an EMPTY submit is a valid
 * meaning — "leave it blank and it takes its own shape", i.e. the default brief.
 * Enter and Skip are the same exit; only the text differs.
 *
 * Kept presentational (no I/O): `onResolve` is the single way out. It MUST NOT
 * become a full-screen overlay — a screen-fixed repaint every frame is half the
 * frame budget (AGENTS §7.6①); this is an ordinary DOM row that only captures
 * pointer events over itself.
 */
import React, { useState } from 'react';

export interface StubPromptProps {
  kind: 'scene' | 'nook';
  copy: { label: string; placeholder: string; skip: string };
  /** Submit (may be '') and Skip share this exit. `''` means "leave it blank". */
  onResolve: (request: string) => void;
}

export const StubPrompt: React.FC<StubPromptProps> = ({ kind, copy, onResolve }) => {
  const [text, setText] = useState('');

  return (
    <div className="stub-prompt" data-kind={kind}>
      <label className="stub-prompt__label" htmlFor={`stub-prompt-${kind}`}>
        {copy.label}
      </label>
      <div className="stub-prompt__row">
        <input
          id={`stub-prompt-${kind}`}
          className="stub-prompt__input"
          type="text"
          value={text}
          placeholder={copy.placeholder}
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onResolve(text.trim());
            }
          }}
        />
        <button type="button" className="stub-prompt__skip" onClick={() => onResolve('')}>
          {copy.skip}
        </button>
      </div>
    </div>
  );
};
