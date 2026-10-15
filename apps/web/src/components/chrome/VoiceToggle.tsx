/**
 * VoiceToggle.tsx — one tap turns character voice (TTS) off or on during play
 *
 *
 *
 * It is the SAME switch as Settings → 「在此浏览器启用角色语音」 (`airp-tts-enabled`,
 * persisted on this browser and synced with the account prefs), only reachable
 * without opening a panel: it sits in the edge controls, which stay on screen
 * when the header is closed. Turning it off also cuts the line that is
 * sounding now; `fetchVoiceUrl` already refuses new requests while it is off.
 * Music and sound effects are untouched (that is MuteButton).
 */
import React, { useEffect, useState } from 'react';
import { AudioLines, AudioLinesOff } from 'lucide-react';
import { useLocale } from '../../lib/i18n.js';
import { setTtsEnabled, ttsEnabled } from '../../lib/tts-readiness.js';
import { stopVoice } from '../../lib/audio.js';

const PREFS_CHANGED = 'airp:prefs-changed';

function readEnabled(): boolean {
  try { return ttsEnabled(); } catch { return true; }
}

/** Flip character voice; switching it off silences the current line at once. */
export function toggleCharacterVoice(next: boolean): void {
  try { setTtsEnabled(next); } catch { /* storage blocked: still stop below */ }
  if (!next) stopVoice();
}

export const VoiceToggle: React.FC = () => {
  const { t } = useLocale();
  const [on, setOn] = useState(readEnabled);
  // Settings, the account sync or another control may flip the same switch.
  useEffect(() => {
    const sync = (): void => setOn(readEnabled());
    window.addEventListener(PREFS_CHANGED, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PREFS_CHANGED, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const label = on ? t('Character voice on (tap to turn off)') : t('Character voice off (tap to turn on)');
  return (
    <button
      type="button"
      className="voice-toggle"
      data-voice-on={on ? 'true' : 'false'}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => { const next = !on; toggleCharacterVoice(next); setOn(next); }}
    >
      {on ? <AudioLines size={17} /> : <AudioLinesOff size={17} />}
    </button>
  );
};
