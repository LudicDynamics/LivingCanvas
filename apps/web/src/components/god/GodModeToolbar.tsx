import React from 'react';
import { Eye, EyeOff, Pencil } from 'lucide-react';

interface GodModeToolbarProps {
  frozen: boolean;
  onToggleFreeze: () => void;
  allowChalkDrag: boolean;
  onToggleChalkDrag: () => void;
  labels?: {
    active: string;
    frozen: string;
    pauseTitle: string;
    thawTitle: string;
    enableChalk: string;
    disableChalk: string;
  };
}

export const GodModeToolbar: React.FC<GodModeToolbarProps> = ({
  frozen,
  onToggleFreeze,
  allowChalkDrag,
  onToggleChalkDrag,
  labels = {
    active: 'God Hand',
    frozen: 'World Frozen',
    pauseTitle: 'Pause world agents',
    thawTitle: 'World is paused. Click to thaw',
    enableChalk: 'Enable Chalk editing',
    disableChalk: 'Disable Chalk editing',
  },
}) => {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-paper-card border border-ink/10 shadow-soft">
      <button
        type="button"
        onClick={onToggleFreeze}
        className={`flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold tracking-wide transition-all cursor-pointer ${
          frozen
            ? 'bg-rust text-white shadow-sm animate-pulse'
            : 'bg-paper-wall text-ink/70 hover:text-ink'
        }`}
        title={frozen ? labels.thawTitle : labels.pauseTitle}
      >
        {frozen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        <span>{frozen ? labels.frozen : labels.active}</span>
      </button>
      <button
        type="button"
        data-guide-target="god"
        onClick={onToggleChalkDrag}
        aria-pressed={allowChalkDrag}
        aria-label={allowChalkDrag ? labels.disableChalk : labels.enableChalk}
        title={allowChalkDrag ? labels.disableChalk : labels.enableChalk}
        className={`flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold tracking-wide transition-all cursor-pointer ${
          allowChalkDrag
            ? 'bg-ink text-paper-card shadow-sm'
            : 'bg-paper-wall text-ink/70 hover:text-ink'
        }`}
      >
        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{allowChalkDrag ? labels.disableChalk : labels.enableChalk}</span>
      </button>
    </div>
  );
};
