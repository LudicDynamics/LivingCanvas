import React, { useState, useEffect } from 'react';
import { ChalkCard } from '../narrative/ChalkCard.js';
import { MarkdownText, plainExcerpt, stripLeadingTitle, leadingTitleOf } from '../../lib/md.js';
import { DoorOpen } from 'lucide-react';
import { useLocale } from '../../lib/i18n.js';
import { PropCard } from './PropCard.js';
import { PhotoCard } from './PhotoCard.js';
import { HtmlCard } from '../html/HtmlCard.js';
import { NpcCard } from './NpcCard.js';
import { StickyNote, isPlayerNoteItem } from './StickyNote.js';
import type { AppearanceView } from '../../lib/appearance-view.js';


interface CardRendererProps {
  item: {
    path: string;
    filename: string;
    frontmatter: Record<string, any> | null;
    body: string;
  };
  /** Appearance injected by CanvasObject; readers reuse the same verified view. */
  appearance?: AppearanceView | null;
  /** Ordinal of this gate among the layer's gates (Main computes it). */
  index?: number;
  /** The painted width (`LayerItem.w`). Only the html branch reads it — it is
   *  the scale basis for the page thumbnail, and `item` here has no `w`
   *  (`LayerItem` does; this prop's type narrows it away). */
  w?: number;
  /** `item.z` (seat order) — the page budget ranks by it, never by DOM order. */
  z?: number;
  /** The owning layer; the page budget is isolated per layer. */
  layer?: string;
  onSelectChoice?: (path: string, choice: string) => void;
  onDiceRolled?: (result: number, passed: boolean) => void;
  onOpenCharacterModal?: (charId: string) => void;
  onItemDropOnTarget?: (draggedItemPath: string, targetPath: string) => void;
  gateInspected?: boolean;
}

/** Hand-drawn ordinal seal (prototype `numCircle`, L692-695). */
const GateNum: React.FC<{ n: number | string }> = ({ n }) => (
  <svg className="gate__num" viewBox="0 0 34 34">
    <ellipse
      cx="17"
      cy="17"
      rx="14.6"
      ry="13.2"
      fill="none"
      stroke="#A8362B"
      strokeWidth={1.8}
      transform="rotate(-6 17 17)"
      strokeDasharray="86 4"
    />
    <text
      x="17"
      y="22"
      textAnchor="middle"
      fontSize="15"
      fill="#A8362B"
      fontFamily="KaiTi, STKaiti, serif"
    >
      {n}
    </text>
  </svg>
);

/** Push pin (prototype `pinSVG`, L696-698). */
const GatePin: React.FC = () => (
  <svg className="gate__pin" width="18" height="24" viewBox="0 0 18 24">
    <circle cx="9" cy="7" r="6.5" fill="#A8362B" />
    <path d="M9 12 L9 22" stroke="#5F5142" strokeWidth={1.6} />
    <circle cx="9" cy="7" r="2.4" fill="#FFFEF6" />
  </svg>
);
export const CardRenderer: React.FC<CardRendererProps> = ({
  item,
  index = 1,
  w,
  z = 0,
  layer = '',
  appearance,
  onSelectChoice,
  onDiceRolled,
  onOpenCharacterModal,
  onItemDropOnTarget,
  gateInspected = false,
}) => {
  const { frontmatter, body, filename, path } = item;
  const { t } = useLocale();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isItemDragging, setIsItemDragging] = useState(false);

  useEffect(() => {
    const onDragStart = () => setIsItemDragging(true);
    const onDragEnd = () => {
      setIsItemDragging(false);
      setIsDragOver(false);
    };
    window.addEventListener('airp:item-drag-start', onDragStart);
    window.addEventListener('airp:item-drag-end', onDragEnd);
    return () => {
      window.removeEventListener('airp:item-drag-start', onDragStart);
      window.removeEventListener('airp:item-drag-end', onDragEnd);
    };
  }, []);


  const handleTargetDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const draggedPath = e.dataTransfer.getData('text/plain');
    if (draggedPath) onItemDropOnTarget?.(draggedPath, path);
  };

  const puzzleClasses = `${isItemDragging ? 'puzzle-target-ready' : ''} ${isDragOver ? 'puzzle-target-hover' : ''}`.trim();

  // Dice rewards are persisted world entities. The card only reveals the
  // authored outcome snapshot; taking it remains EntityInteractions' move
  // action, never a second dice or reward authority.
  if (frontmatter?.dice_reward) {
    return (
      <details className="dice-outcome-letter" data-no-drag onClick={event => event.stopPropagation()}>
        <summary>{frontmatter.title || filename}</summary>
        <div><MarkdownText text={body} /></div>
      </details>
    );
  }

  if (frontmatter?.visual === 'envelope' || frontmatter?.visual === 'phone' || frontmatter?.visual === 'door') {
    return <PropCard visual={frontmatter.visual} path={path} filename={filename} title={frontmatter.title || filename} body={body}
      frontmatter={frontmatter}
      image={typeof frontmatter.image === 'string' ? frontmatter.image : undefined}
      inspected={gateInspected}
      appearance={appearance} />;
  }

  // The player's own sticky note.
  if (isPlayerNoteItem(item)) {
    return <StickyNote item={item} />;
  }

  // NPC cards: a portrait or silhouette and a name;
  // the 「对话」 action lives with the other card actions (EntityInteractions).
  if (frontmatter?.type === 'npc') {
    return <NpcCard path={path} filename={filename} frontmatter={frontmatter} body={body} />;
  }

  if (frontmatter?.type === 'chalk') {
    // Widgets (choice/status/dice) are owned by EntityInteractions on canvas
    // (CanvasObject), so the inline ChalkCard must not also render them — that
    // double-renders. Keep the canvas entity as the single interaction owner.
    return <ChalkCard
      item={item}
      appearance={appearance}
      puzzleClasses={puzzleClasses}
      onDragOver={event => { event.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleTargetDrop}
    />;
  }


  // 2. Gate Card (sub-scene portal) — a sub-directory's README, the door that
  //    walks into that scene. The current layer's own README is never a card
  //    (see cardsOfLayer), so every gate here genuinely navigates somewhere.
  if (frontmatter?.type === 'gate' || filename === 'README.md') {
    const isStub = frontmatter?.stub || false;
    // Title: frontmatter title, else the scene name, else the parent directory
    // name — never the literal filename "README".
    const title =
      frontmatter?.title ||
      frontmatter?.name ||
      (path.includes('/')
        ? path.slice(0, -'/README.md'.length).split('/').pop()
        : filename.replace('.md', ''));
    // index. Formatted to two digits ("01") like the prototype's seal — numeric
    // orders pad, but a non-numeric label (e.g. "A") passes through untouched.
    const rawOrder = frontmatter?.order ?? frontmatter?.n;
    const orderNum = rawOrder != null && rawOrder !== '' ? rawOrder : index;
    const order = /^\d+$/.test(String(orderNum))
      ? String(orderNum).padStart(2, '0')
      : orderNum;
    // A `stub` door promises nothing about walking in: this batch implements no
    // sub-scene initialisation (`airp_init` can only target a character root), so
    // the old copy named an event the code cannot deliver. Statement of fact plus
    // the one move that IS real (inspect it from outside).
    // `stub` means "this directory layer has nothing readable" — NOT "empty room"
    // (a directory holding only grandchild folders is also a stub), so the copy
    // never claims emptiness.
    const meta = isStub
      ? t('UNWRITTEN · you can still look at the door from outside')
      : t('SCENE · ENTRANCE');
    // The card face shows a clean one-line excerpt; the raw README markdown
    // (# heading, line breaks) stays in the hover sheet. Never spill source.
    const excerpt = plainExcerpt(body);
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleTargetDrop}
        className={`gate${isStub ? ' gate--stub' : ''}${gateInspected ? ' gate--inspected' : ''} ${puzzleClasses}`}
      >
        <GateNum n={order} />
        <GatePin />
        <div className="gate__cover">
          <DoorOpen size={36} strokeWidth={1.2} aria-hidden="true" />
        </div>
        {/* The card face keeps a two-line teaser; the full README is read in
            the card's focus view (click / tap / the 「打开」 button), not in a
            hover sheet. */}
        <div className="gate__body">
          <div className="gate__title">{title}</div>
          <div className="gate__desc">{excerpt}</div>
          <div className="gate__meta">{meta}</div>
        </div>
      </div>
    );
  }

  // 3. Letter component — the card face is presentation; CanvasObject owns reading.
  if (frontmatter?.type === 'component' && frontmatter?.component === 'letter') {
    return (
      <div
        className={`letter ${puzzleClasses}`}
        onDragOver={event => { event.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleTargetDrop}
      >
        <div className="letter__head">
          <span className="letter__seal" />
          {frontmatter.title || t('Letter')}
        </div>
        <div className="letter__preview">
          {/* frontmatter.preview is authored copy; the body fallback is raw
              markdown, so flatten it — a card face never shows source. */}
          {frontmatter.preview || plainExcerpt(body)}
        </div>
        <div className="letter__meta">
          <span>{frontmatter.sign || t('Click to open and read')}</span>
        </div>
      </div>
    );
  }
  // 4. Photo component — the image is the card's visual focus. Reading is
  //    owned by CanvasObject; this branch only paints and wires target drops.
  if (frontmatter?.type === 'component' && frontmatter?.component === 'photo') {
    return (
      <PhotoCard
        item={item}
        appearance={appearance}
        puzzleClasses={puzzleClasses}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleTargetDrop}
      />
    );
  }

  // 5. Page card (H1). LAST on purpose: the virtual frontmatter for a `.html`
  //    file is ALWAYS `{type:'html', …}` (contract §5.1), so the six branches
  //    above it are unconditionally false for this input and there is no
  //    priority contest. Reading it as the default note would paint the page's
  //    whole source through `MarkdownText` — the exact failure H1 removes.
  if (frontmatter?.type === 'html') {
    return (
      <HtmlCard
        item={item}
        w={w}
        layer={layer}
        z={z}
        appearance={appearance}
        puzzleClasses={puzzleClasses}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleTargetDrop}
      />
    );
  }
  const noteTitle =
    frontmatter?.title || leadingTitleOf(body) || filename.replace('.md', '');

  // 4. Note / clue (default) — a sticky sheet, no white rounded card.
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleTargetDrop}
      className={`note ${puzzleClasses}`}
    >
      <span className="note__clip" />
      <div className="note__title">{noteTitle}</div>
      <MarkdownText text={stripLeadingTitle(body)} className="note__body" />
    </div>
  );
};
