import React, { useState, useEffect, useRef } from 'react';
import { DoorOpen, UserPlus, Search, Feather, Sparkles, X, ArrowRight, StickyNote, Waypoints, PenLine, Lightbulb } from 'lucide-react';
import { playFoley } from '../../lib/audio.js';
import { useLocale } from '../../lib/i18n.js';
import { radialAngles, type RadialCreatorType, type RadialToolId } from '../../lib/radial-items.js';

/**
 * The right-click / long-press radial on blank canvas. One
 * menu in every mode; WHICH satellites it shows is decided by
 * `radialItemsFor` (lib/radial-items.ts): the four creators where this player
 * may make world facts, the player's own tools (便签 / 线索板 / …) always.
 */
export type RadialItemType = RadialCreatorType;

export interface RadialMenuProps {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  /** Creator satellites to show (empty in TRPG play). */
  creators: readonly RadialItemType[];
  /** Player-tool satellites, after the creators. */
  tools: readonly RadialToolId[];
  /** True while the clue board is on: its satellite reads as pressed. */
  boardOn?: boolean;
  onClose: () => void;
  onCreate: (type: RadialItemType, title: string, content: string, wx: number, wy: number) => void;
  /** A tool satellite was chosen (the menu closes itself first). */
  onTool: (tool: RadialToolId, x: number, y: number, wx: number, wy: number) => void;
}

type Icon = React.ComponentType<{ className?: string }>;

const CREATOR_OPTIONS: Record<RadialItemType, { label: string; sub: string; icon: Icon; color: string; bgHover: string; placeholder: string }> = {
  gate: {
    label: 'New Scene',
    sub: 'Portal to uncharted space',
    icon: DoorOpen,
    color: 'text-sage',
    bgHover: 'hover:bg-sage/15 hover:border-sage/40',
    placeholder: 'e.g. The Smuggler\'s Cellar beneath the river...',
  },
  character: {
    label: 'Summon NPC',
    sub: 'A living inhabitant of the world',
    icon: UserPlus,
    color: 'text-rust',
    bgHover: 'hover:bg-rust/15 hover:border-rust/40',
    placeholder: 'e.g. A ragged apothecary selling forbidden tinctures...',
  },
  clue: {
    label: 'Place Clue',
    sub: 'A physical item in the scene',
    icon: Search,
    color: 'text-amber-700',
    bgHover: 'hover:bg-amber-100 hover:border-amber-400',
    placeholder: 'e.g. An ivory pocket watch stained with fresh soot...',
  },
  chalk: {
    label: 'Inscribe Chalk',
    sub: 'Direct authorial narration',
    icon: Feather,
    color: 'text-blue',
    bgHover: 'hover:bg-blue/15 hover:border-blue/40',
    placeholder: 'e.g. The floorboards groan as the fog seeps through...',
  },
};

const TOOL_OPTIONS: Record<RadialToolId, { label: string; sub: string; icon: Icon; color: string; bgHover: string }> = {
  note: { label: 'Pin a note', sub: 'A private memo', icon: StickyNote, color: 'text-amber-700', bgHover: 'hover:bg-amber-100 hover:border-amber-400' },
  board: { label: 'Clue board', sub: 'Connect and mark cards', icon: Waypoints, color: 'text-rust', bgHover: 'hover:bg-rust/15 hover:border-rust/40' },
  write: { label: 'Write an action', sub: 'Tell the writer what you do', icon: PenLine, color: 'text-blue', bgHover: 'hover:bg-blue/15 hover:border-blue/40' },
  hint: { label: 'Ask for a hint', sub: 'One small next step', icon: Lightbulb, color: 'text-sage', bgHover: 'hover:bg-sage/15 hover:border-sage/40' },
};

export const RadialMenu: React.FC<RadialMenuProps> = ({
  x,
  y,
  worldX,
  worldY,
  creators,
  tools,
  boardOn = false,
  onClose,
  onCreate,
  onTool,
}) => {
  const { t } = useLocale();
  const [selectedType, setSelectedType] = useState<RadialItemType | null>(null);
  const [prompt, setPrompt] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);


  // Focus input on form entry
  useEffect(() => {
    if (selectedType && inputRef.current) {
      inputRef.current.focus();
    }
  }, [selectedType]);

  const activeOption = selectedType ? CREATOR_OPTIONS[selectedType] : null;
  const satellites = [
    ...creators.map((type) => ({ key: type, kind: 'creator' as const, ...CREATOR_OPTIONS[type] })),
    ...tools.map((tool) => ({ key: tool, kind: 'tool' as const, ...TOOL_OPTIONS[tool] })),
  ];
  const angles = radialAngles(satellites.length);
  const radius = satellites.length > 4 ? 108 : 96;
  const studio = creators.length > 0;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = prompt.trim();
    if (!text || !selectedType) return;
    playFoley('pen-scratch');
    const title = text.length > 28 ? text.slice(0, 25) + '...' : text;
    onCreate(selectedType, title, text, worldX, worldY);
    onClose();
  };

  // Keep menu within viewport bounds
  const menuLeft = Math.min(Math.max(x, 170), window.innerWidth - 170);
  const menuTop = Math.min(Math.max(y, 170), window.innerHeight - 170);

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden select-none"
      data-radial-menu={studio ? 'studio' : 'player'}
      onPointerDown={(e) => {
        // Prevent viewport capture from stealing gestures
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        // Click on backdrop closes
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      {/* Background dimmer */}
      <div
        className="absolute inset-0 bg-ink/35 backdrop-blur-[3px] transition-opacity duration-200"
        onClick={onClose}
      />

      {/* Radial Hub Container */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
        style={{ left: menuLeft, top: menuTop }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!selectedType ? (
          /* Wheel mode: satellites around the central seal */
          <div role="menu" aria-label={t(studio ? 'World Studio' : 'Your tools')} className="relative w-64 h-64 flex items-center justify-center animate-in fade-in zoom-in-95 duration-200">
            {/* Center Hub */}
            <div className="w-20 h-20 rounded-full bg-paper-card border-2 border-ink/20 shadow-deep flex flex-col items-center justify-center text-center p-1 cursor-default">
              <Sparkles className="w-5 h-5 text-rust animate-pulse mb-0.5" />
              <span className="font-mono text-[8px] uppercase tracking-wider text-ink/70 font-semibold leading-tight">
                {t(studio ? 'World Studio' : 'Your tools')}
              </span>
            </div>

            {/* Satellites */}
            {satellites.map((opt, i) => {
              const rad = (angles[i] * Math.PI) / 180;
              const sx = Math.cos(rad) * radius;
              const sy = Math.sin(rad) * radius;
              const Icon = opt.icon;
              const pressed = opt.kind === 'tool' && opt.key === 'board' ? boardOn : undefined;

              return (
                <button
                  key={opt.key}
                  type="button"
                  role="menuitem"
                  data-radial-item={opt.key}
                  aria-pressed={pressed}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    playFoley('paper-slide', 0.6);
                    if (opt.kind === 'tool') {
                      onClose();
                      onTool(opt.key, x, y, worldX, worldY);
                      return;
                    }
                    setSelectedType(opt.key);
                  }}
                  className={`absolute w-24 p-2 rounded-2xl border shadow-soft transition-all duration-200 flex flex-col items-center text-center group cursor-pointer hover:scale-105 active:scale-95 ${pressed ? 'bg-rust/15 border-rust/50' : 'bg-paper-card border-ink/15'} ${opt.bgHover}`}
                  style={{
                    left: `calc(50% + ${sx}px - 48px)`,
                    top: `calc(50% + ${sy}px - 32px)`,
                  }}
                >
                  <Icon className={`w-5 h-5 ${opt.color} group-hover:scale-110 transition-transform mb-1`} />
                  <span className="font-sans text-[11px] font-bold text-ink leading-tight">
                    {t(opt.label)}
                  </span>
                  <span className="font-mono text-[8px] text-ink/50 leading-tight truncate w-full mt-0.5">
                    {t(pressed ? 'On — tap to leave' : opt.sub)}
                  </span>
                </button>
              );
            })}

            {/* Quick close hint */}
            <button
              type="button"
              onClick={onClose}
              className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-paper-card border border-ink/20 shadow-sm flex items-center justify-center text-ink/60 hover:text-ink hover:bg-ink/10 text-xs font-mono transition-all"
              title={t('Close (Esc)')}
              aria-label={t('Close (Esc)')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          /* Form mode: Tilted paper prompt bar to describe creation */
          <div className="w-96 p-5 rounded-3xl bg-paper-card border border-ink/15 shadow-deep -rotate-1 animate-in fade-in slide-in-from-bottom-3 duration-200">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {activeOption && <activeOption.icon className={`w-4 h-4 ${activeOption.color}`} />}
                <span className="font-serif text-sm font-bold text-ink">
                  {activeOption ? t(activeOption.label) : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedType(null)}
                className="p-1 rounded-full hover:bg-ink/10 text-ink/60 cursor-pointer"
                title={t('Back to wheel')}
                aria-label={t('Back to wheel')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="font-mono text-[10px] text-ink/50 mb-3">
              {t('Describe it. It appears where you clicked, and the writer weaves it in.')}
            </p>

            <form onSubmit={handleSubmit} className="relative">
              <input
                ref={inputRef}
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={activeOption ? t(activeOption.placeholder) : undefined}
                aria-label={activeOption ? t(activeOption.label) : undefined}
                className="w-full pl-3 pr-10 py-2.5 rounded-xl bg-paper-wall/70 border border-ink/15 text-xs text-ink placeholder:text-ink/40 focus:outline-none focus:border-rust font-sans"
              />
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-rust hover:bg-rust-light text-white disabled:opacity-30 transition-all cursor-pointer"
                title={t('Bring to life')}
                aria-label={t('Bring to life')}
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>

            <div className="mt-2.5 flex items-center justify-between text-[10px] font-mono text-ink/40">
              <span>({Math.round(worldX)}, {Math.round(worldY)})</span>
              <span>{t('Enter ↵ to create')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
