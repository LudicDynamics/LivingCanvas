import { useLocale } from '../../lib/i18n.js';
/**
 * MuteButton.tsx — self-contained 36px round sound toggle for the header
 * (Main inserts it next to the God Mode controls). Ink-reverse hover per v2.
 */
import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useAudio } from '../../state/useAudio.js';

export const MuteButton: React.FC = () => {
  const { t } = useLocale();
  const { muted, toggleMuted } = useAudio();

  return (
    <button
      onClick={toggleMuted}
      title={t(muted ? 'Unmute sound' : 'Mute sound')}
      aria-label={t(muted ? 'Unmute sound' : 'Mute sound')}
      className="w-9 h-9 rounded-full flex items-center justify-center bg-paper-card/80 border border-ink/10 text-ink/70 hover:bg-ink hover:text-white shadow-soft transition-colors"
    >
      {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
    </button>
  );
};
