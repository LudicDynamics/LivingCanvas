import React, { useRef } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { useLocale } from '../../lib/i18n.js';
import { joinDraft, useVoiceInput } from '../../lib/voice-input.js';

/**
 * Microphone toggle for the writer bar and the character dialogue. One press
 * starts live transcription, the next stops it. Spoken text streams into the
 * host's draft after whatever was already typed; nothing is sent.
 */
export function VoiceInputButton({
  getDraft,
  onDraft,
  disabled = false,
}: {
  /** The host's current draft, read when recording starts. */
  getDraft: () => string;
  /** Receives the whole draft (typed text + live transcript) on every update. */
  onDraft: (text: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const baseRef = useRef('');
  const { state, error, toggle } = useVoiceInput({
    onTranscript: (spoken) => onDraft(joinDraft(baseRef.current, spoken)),
  });
  const label = state === 'recording'
    ? t('Stop recording')
    : state === 'connecting'
      ? t('Connecting…')
      : state === 'finishing'
        ? t('Transcribing…')
        : t('Voice input');
  const errorText = error === 'mic_denied'
    ? t('Microphone access was refused. Allow it, then try again.')
    : error === 'mic_unsupported'
      ? t('This browser cannot record from a microphone.')
      : error === 'unavailable'
        ? t('Voice input is not configured on this server.')
        : error === 'failed'
          ? t('Could not transcribe the recording. Please try again.')
          : '';
  const busy = state === 'connecting' || state === 'finishing';

  return (
    <>
      <button
        type="button"
        className="voice-input-button"
        data-state={state}
        aria-pressed={state === 'recording'}
        aria-label={label}
        title={label}
        // A recording in progress can always be stopped, even if the host locks.
        disabled={busy || (disabled && state === 'idle')}
        onClick={() => {
          if (state === 'idle') baseRef.current = getDraft();
          toggle();
        }}
      >
        {state === 'recording'
          ? <Square size={13} aria-hidden="true" />
          : busy
            ? <Loader2 size={15} className="voice-input-button__spin" aria-hidden="true" />
            : <Mic size={15} aria-hidden="true" />}
      </button>
      {errorText && <span className="voice-input-error" role="alert">{errorText}</span>}
    </>
  );
}
