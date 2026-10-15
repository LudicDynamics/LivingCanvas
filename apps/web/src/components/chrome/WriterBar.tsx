/**
 * WriterBar.tsx — the single prompt surface for the writer.
 *
 * The text value is controlled when the host supplies `value`/`onChange`
 * (App's main dock), while the legacy uncontrolled call shape remains valid
 * for the Nook empty-state fallback. Writer lifecycle and public status always
 * come from writer-state; this component never mirrors websocket frames.
 */
import React, { useRef, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { guardImeKey } from '../../lib/ime.js';
import { useWriterState } from '../../lib/writer-state.js';
import { SendButton } from './SendButton.js';
import { VoiceInputButton } from './VoiceInputButton.js';

export interface WriterBarProps {
  /** Receives the trimmed prompt text. Return false to keep an unaccepted draft. */
  onSend: (text: string) => void | boolean;
  /** Locks the bar (no input, no submit) when true. */
  disabled?: boolean;
  placeholder?: string;
  /** Copy swapped in while the writer is mid-turn. */
  writingPlaceholder?: string;
  sendLabel?: string;
  /** Controlled value seam for the App-owned prompt draft. */
  value?: string;
  onChange?: (text: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  inputAriaLabel?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  /** Optional stop adapter for hosts that want the button inside this bar. */
  onStop?: () => void;
  stopLabel?: string;
  embedded?: boolean;
}

export const WriterBar: React.FC<WriterBarProps> = ({
  onSend,
  disabled = false,
  placeholder = 'Ask the writer…',
  writingPlaceholder = 'The writer is writing…',
  sendLabel = 'Send',
  value,
  onChange,
  inputRef,
  inputAriaLabel,
  onKeyDown,
  onStop,
  stopLabel = 'Stop writing',
  embedded = false,
}) => {
  const { t } = useLocale();
  const writer = useWriterState();
  const [uncontrolledText, setUncontrolledText] = useState('');
  const text = value ?? uncontrolledText;
  const textRef = useRef(text);
  textRef.current = text;
  const writing = writer.phase === 'writing';
  const locked = disabled || writing;
  const publicState = writer.error
    ? 'error'
    : writing
      ? writer.stopRequested
        ? 'stopped'
        : writer.stage
          ? 'streaming'
          : 'waiting'
      : 'idle';
  const statusText = writer.error
    ? writer.error.message
    : publicState === 'stopped'
      ? t('Stop requested')
      : publicState === 'streaming'
        ? writer.stage ?? t('The writer is working…')
        : publicState === 'waiting'
          ? t('Waiting for the writer…')
          : writer.stage ?? t('Ready for your next action');

  const updateText = (next: string): void => {
    if (onChange) onChange(next);
    else setUncontrolledText(next);
  };
  const submit = (): void => {
    const trimmed = text.trim();
    if (!trimmed || locked) return;
    if (onSend(trimmed) !== false) updateText('');
  };

  return (
    <div
      className={`writer-bar${embedded ? ' writer-bar--embedded' : ''}`}
      data-disabled={disabled ? 'true' : undefined}
      data-writing={writing ? 'true' : undefined}
      data-writer-state={publicState}
      style={embedded ? { position: 'relative', left: 'auto', bottom: 'auto', width: '100%', transform: 'none', zIndex: 'auto' } : undefined}
    >
      <input
        ref={inputRef}
        aria-label={inputAriaLabel}
        className={writing ? 'writer-bar__input busy' : 'writer-bar__input'}
        type="text"
        value={text}
        placeholder={writing ? writingPlaceholder : placeholder}
        autoComplete="off"
        disabled={locked}
        onChange={(e) => updateText(e.target.value)}
        onKeyDown={(e) => {
          if (guardImeKey(e)) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!e.nativeEvent.isComposing) submit();
            return;
          }
          onKeyDown?.(e);
        }}
      />
      <VoiceInputButton
        disabled={locked}
        getDraft={() => textRef.current}
        onDraft={updateText}
      />
      <SendButton
        tutorialTarget="writer-send"
        label={t('Send')}
        disabled={locked}
        onSend={submit}
      >
        {sendLabel}
      </SendButton>
      {onStop && writing && (
        <button
          className="writer-bar__stop"
          type="button"
          data-writer-stop
          disabled={writer.stopRequested}
          onClick={onStop}
        >
          {writer.stopRequested ? t('Stop requested') : stopLabel}
        </button>
      )}
    </div>
  );
};
