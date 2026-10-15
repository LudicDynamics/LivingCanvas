import React, { useSyncExternalStore } from 'react';
import { chalkStyleOf } from '@airp/shared/forms';
import { isRevealHeld, subscribeCeremony } from '../../lib/dice-ceremony.js';
import { renderFrontmatterWidgets } from '../../lib/fm.js';
import { MarkdownText } from '../../lib/md.js';
import { DiceTierLine } from './DiceTierLine.js';
import { cardTierOf } from '../../lib/dice-tier.js';
import { useLocale } from '../../lib/i18n.js';
import type { AppearanceView } from '../../lib/appearance-view.js';

interface ChalkCardProps {
  item: {
    path: string;
    filename: string;
    frontmatter: Record<string, unknown> | null;
    body: string;
  };
  /**
   * The verified view CanvasObject already injected into `.object` (04 §:101). When an
   * appearance axis is present it wins over the legacy class, which is why the `hand` /
   * tone / `card` classes below are skipped whenever the resolution chose that axis.
   */
  appearance?: AppearanceView | null;
  /** Target-drop handlers are presentation wiring; action authority stays in CanvasObject. */
  puzzleClasses?: string;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  /** When supplied, the card renders its own status/choice/dice widgets. */
  onSelectChoice?: (choiceText: string) => void;
  onDiceRolled?: (result: number, passed: boolean) => void;
}

/**
 * Chalk narration — ink on the canvas, not a card. The default form is `.chalk--bare`:
 * transparent surface, no border/shadow/radius, straight from the v2 prototype
 * (canvas-stack-mingyue.html `.chalk`). Legacy style variants are opt-in frontmatter and
 * resolved by the shared `chalkStyleOf` table (§10.2); the `appearance` namespace, when the
 * resolver chose an axis, supersedes the equivalent legacy class (00 §4 rule 7, 04 §:101).
 *
 * Canvas entities delegate widgets to EntityInteractions. Standalone readers
 * may explicitly pass handlers to render those widgets here.
 */
export const ChalkCard: React.FC<ChalkCardProps> = ({
  item,
  appearance,
  puzzleClasses = '',
  onDragOver,
  onDragLeave,
  onDrop,
  onSelectChoice,
  onDiceRolled,
}) => {
  const { frontmatter, body, path } = item;
  const { locale } = useLocale();
  // The roll is written before its ceremony plays: stay unresolved until it has.
  const held = useSyncExternalStore(subscribeCeremony, () => isRevealHeld(path));
  const resolved = held ? null : /<!--\s*resolved-dice:\s*(\d+)\s*-->/.exec(body);
  const narrative = frontmatter?.dice_outcomes
    ? (resolved ? body.slice(resolved.index + resolved[0].length) : String(frontmatter.dice_scene_text ?? (locale === 'ja' ? 'まだ、確かめられる手掛かりがある。' : locale === 'zh-CN' ? '这里还有值得查证的线索。' : locale === 'ko' ? '아직 확인해 볼 단서가 있다.' : 'There are still clues here to examine.')))
    : body;
  const style = chalkStyleOf(frontmatter);
  const roll = frontmatter?.roll_dice as { type?: string; result?: number; passed?: boolean } | undefined;
  // The resolved card's tier badge + consequence chip.
  const tier = !held && typeof roll?.result === 'number' ? cardTierOf(frontmatter as Record<string, unknown>) : null;

  // Only a var the adapter actually emitted means the resolution chose that axis; an
  // unset axis leaves the class in charge, preserving legacy paint exactly.
  const styled = appearance?.style;
  const fontChosen = Boolean(styled?.['--appearance-font-family']);
  const inkChosen = Boolean(styled?.['--appearance-ink']);
  const surfaceChosen = styled?.['--appearance-surface'] !== undefined && styled?.['--appearance-surface'] !== 'transparent';

  const widgets = onSelectChoice || onDiceRolled
    ? renderFrontmatterWidgets(frontmatter, {
        filePath: path,
        reveal: true,
        onChoice: onSelectChoice,
        onDiceRolled,
      })
    : null;

  const classes = ['chalk', 'chalk--bare'];
  if (style.hand && !fontChosen) classes.push('chalk--hand');
  if (style.big) classes.push('chalk--big');
  if (style.tone !== 'ink' && !inkChosen) classes.push(`chalk--${style.tone}`);
  if (style.card && !surfaceChosen) classes.push('chalk--card');
  if (style.collapsed) classes.push('chalk--collapsed');
  if (style.aged) classes.push('chalk--aged');
  // A die is a thing to read closely and act on, not narration written on the
  // scene: it gets a plate.
  if (roll) classes.push('chalk--dice');

  const size = Number(frontmatter?.size);
  const sizeStyle: React.CSSProperties & { '--chalk-size': string } = {
    '--chalk-size': `${Number.isFinite(size) && size > 0 ? size : style.big ? 29 : 26}px`,
  };

  return (
    <div
      className={[...classes, puzzleClasses].filter(Boolean).join(' ')}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      {...appearance?.attrs}
      {...(tier ? { 'data-outcome': tier.outcome } : {})}
      style={{ ...(appearance?.style ?? {}), ...sizeStyle }}
    >
      {/* Chalk narration body — transparent ink, pre-wrap preserved. */}
      {resolved ? <details className="dice-outcome-letter" data-no-drag onClick={e => e.stopPropagation()}><summary>✉ {locale === 'ja' ? '結果の記録を開く' : locale === 'zh-CN' ? '展开结果记录' : locale === 'ko' ? '결과 기록 열기' : 'Open outcome record'}</summary><MarkdownText text={narrative} className="chalk__body" /></details> : <MarkdownText text={narrative} className="chalk__body" />}
      {!held && typeof roll?.result === 'number' && typeof roll.passed === 'boolean' && (
        <output className="chalk__dice-result" aria-live="polite" style={{ display: 'block', font: '600 16px/1.6 monospace', marginTop: 12 }}>
          {roll.type} → {roll.result}{' '}
          {tier ? <DiceTierLine outcome={tier.outcome} chip={tier.chip} compact /> : null}
        </output>
      )}
      {widgets}
    </div>
  );
};
