/**
 * SpeakerControls.tsx — what the character dialogues share about a voice:
 *
 *   - `NarratedText` shows a line with its narration (（低下头）/ *looks away* /
 *     an unmarked third-person action sentence) set as a quiet stage note. The
 *     split is the SAME one the voice uses (`splitNarration` /
 *     `sanitiseTtsText` in @airp/shared/tts-text), so what looks like narration
 *     is exactly what is not spoken. The text itself is never changed.
 *   - `StopVoiceButton` + `useStopVoiceOnEscape`: the player's interrupt while
 * a character is speaking.
 *     Escape inside the dialogue stops the voice without closing it; once the
 *     voice is quiet, Escape closes the dialogue as before.
 */
import React, { useEffect, useMemo } from 'react';
import { Square } from 'lucide-react';
import { splitNarration } from '@airp/shared/tts-text';

export function NarratedText({ text, names }: { text: string; names?: readonly (string | null | undefined)[] }): React.ReactElement {
  const segments = useMemo(() => splitNarration(text, { names }), [text, names]);
  if (segments.every(segment => segment.kind !== 'narration')) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) => (segment.kind === 'narration'
        ? <span key={index} className="dialogue-narration">{segment.text}</span>
        : <React.Fragment key={index}>{segment.text}</React.Fragment>))}
    </>
  );
}

export function StopVoiceButton({ onStop, label }: { onStop: () => void; label: string }): React.ReactElement {
  return (
    <button
      type="button"
      className="character-dock__call character-dock__stop-voice"
      onClick={onStop}
      aria-label={label}
      title={label}
    >
      <Square aria-hidden="true" />
    </button>
  );
}

/**
 * Escape stops the voice first. Window capture runs before the App's document
 * capture handler (which would close the dialogue), and only while a line is
 * speaking and focus is inside this dialogue.
 */
export function useStopVoiceOnEscape(
  root: React.RefObject<HTMLElement | null>,
  speaking: boolean,
  stop: () => void,
): void {
  useEffect(() => {
    if (!speaking) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
      const active = document.activeElement;
      if (!active || !root.current?.contains(active)) return;
      event.preventDefault();
      event.stopPropagation();
      stop();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [root, speaking, stop]);
}
