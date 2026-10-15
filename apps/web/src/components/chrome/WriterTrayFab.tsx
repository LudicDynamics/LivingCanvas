/**
 * The writer's FAB with its tray of moves: `WriterFab` plus the ONE
 * declared-choice path a slip travels (the same `/api/choice` coordinator the card panel and the left rail use),
 * mounted inside the action-feedback provider. A slip is a card option (`choose`), a place (`onEnterGate`) or a
 * line for the writer (`onWriterLine`).
 */
import React, { useMemo } from 'react';
import { WriterFab, type WriterFabProps } from './WriterFab.js';
import { DeclaredChoiceHost, useDeclaredChoice, type DeclaredChoiceItem } from '../../lib/use-declared-choice.js';
import type { WriterSlip } from '../../lib/option-routing.js';

export interface WriterTrayFabProps extends Omit<WriterFabProps, 'onSlip'> {
  /** The cards on this layer (README first), for the option's label and a pending roll. */
  cards: readonly DeclaredChoiceItem[];
  projection: string;
  onChoice?(prompt: string): void;
  onEnterGate(target: string): void;
  onOpenCharacter?(id: string): void;
  /** An opening reply `to: writer`: said to the writer as the player's instruction. */
  onWriterLine(text: string): void;
  /** A slip was used (the tray's pin lets go). */
  onSlipUsed?(slip: WriterSlip): void;
}

export function WriterTrayFab({ cards, projection, onChoice, onEnterGate, onOpenCharacter, onWriterLine, onSlipUsed, focus, ...fab }: WriterTrayFabProps): React.ReactElement {
  const byPath = useMemo(() => new Map(cards.map((c) => [c.path, c])), [cards]);
  const declared = useDeclaredChoice({ resolveItem: (path) => byPath.get(path) ?? null, projection, onChoice, onEnterGate, onOpenCharacter });
  const onSlip = (slip: WriterSlip) => {
    if (declared.busy) return;
    if (slip.enter) onEnterGate(slip.enter);
    else if (slip.text) onWriterLine(slip.text);
    else if (slip.path && slip.option) declared.choose(slip.path, slip.option);
    onSlipUsed?.(slip);
  };
  return (
    <>
      <WriterFab {...fab} focus={focus} onSlip={onSlip} />
      <DeclaredChoiceHost declared={declared} focus={focus} />
    </>
  );
}
