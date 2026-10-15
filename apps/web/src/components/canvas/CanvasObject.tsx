import React from 'react';
import type { FocusCoordinator } from '../../lib/focus-coordinator.js';
import { BagItemDialog } from '../BagItemDialog.js';
import { PhotoDetailDialog } from '../photo/PhotoDetailDialog.js';
import { HtmlDetailDialog } from '../html/HtmlDetailDialog.js';
import { CardRenderer } from './CardRenderer.js';
import { highlightLinks } from './LinkLayer.js';
import { chalkStyleOf } from '@airp/shared/forms';
import { appearanceViewOf } from '../../lib/appearance-view.js';
import type { LayerItem } from '../../state/useWorld.js';
import { UserRound } from 'lucide-react';
import { EntityInteractions } from '../narrative/EntityInteractions.js';
import { highlightChalkAnchor } from '../../lib/chalk-anchor.js';
import { movedBeyondCardThreshold } from '../../lib/card-interaction.js';
import { airpGateway, type AssetMediaKind } from '../../lib/airp-gateway.js';
import { placeLocked } from '../../lib/forced-tutorial.js';
import { CARD_DWELL_MS, CARD_GRACE_MS, cardLiftScale } from '../../lib/card-actions.js';
import { useLocale } from '../../lib/i18n.js';
import type { PlayerTagValue } from '../../lib/airp-gateway.js';

const NO_CARRIED: ReadonlySet<string> = new Set();

/**
 * Absolute-positioned card shell inside the world transform layer (v2 `.object`
 * semantics). Renders CardRenderer (whose root width comes from `item.w` via
 * `w-full`), rotates by the server-derived `--target-rot`, and exposes
 * `data-path` for the LinkLayer registry.
 * Pointer movement/drag handling lives ENTIRELY in the viewport (Canvas)
 * dispatcher; this shell owns the read and keyboard seams while card visuals
 * remain presentational. It is deliberately NOT draggable (plan §6.7: HTML5
 * dnd stays exclusive to backpack sources).
 */

/** Session z-lift registry: path → raised zIndex, survives the drop re-render
 *  (the inline style would otherwise snap back to the server item.z). Cleared
 *  by Canvas on refresh/layer switch (plan §6.9: lift is session-only). */
const LIFTED_Z = new Map<string, number>();
let topZ = 10;

export function liftFor(path: string, z: number): number {
  return LIFTED_Z.get(path) ?? z;
}

/** Raise a card above every other card for the current drag session. */
export function raiseObject(path: string, el: HTMLElement, z: number): void {
  topZ = Math.max(topZ + 1, (Number.isFinite(z) ? z : 1) + 1);
  LIFTED_Z.set(path, topZ);
  el.style.zIndex = String(topZ);
}

export function clearAllLifts(): void {
  LIFTED_Z.clear();
}

export function pruneLifts(paths: Set<string>): void {
  for (const key of LIFTED_Z.keys()) {
    if (!paths.has(key)) LIFTED_Z.delete(key);
  }
}

/** Presence figure — the world's people. Ink sketch + a name strip (proto `.sprite`). */
const SpriteFig: React.FC<{ avatar?: string; video?: string; name: string; still: boolean }> = ({ avatar, video, name, still }) => {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [avatar]);
  const src = avatar && (/^(?:https?:|data:|blob:)/.test(avatar) ? avatar : assetUrl(avatar, 'image'));
  return <div className="presence-orb" role="img" aria-label={name}>
    {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : <UserRound size={30} strokeWidth={1.3} aria-hidden="true" />}
  </div>;
};

/** World-root-relative asset path → URL (contract §5.4, same as SceneBackdrop). */
const assetUrl = (p: string, mediaKind: AssetMediaKind): string => {
  if (p.startsWith('/api/asset')) {
    const url = new URL(p, 'http://airp.local');
    const assetPath = url.searchParams.get('path');
    return assetPath ? airpGateway.assetUrl(assetPath, undefined, mediaKind) : '';
  }
  return airpGateway.assetUrl(p.replace(/^\/+/, ''), undefined, mediaKind);
};

interface PortraitProps {
  video?: string;
  poster?: string;
  caption?: string;
  /** Visible end of the fallback chain when nothing decodes. */
  title: string;
  /** true = never mount <video> (L1 cap / L3 reduced motion — nook 03 §③-6). */
  still: boolean;
}

/**
 * A living portrait: a looping silent alpha clip with a still fallback.
 * `failedSrc` is a string, not a boolean, so a changed `video:`/`poster:` value
 * resets the fallback automatically (SceneBackdrop.tsx:29-33, same paradigm).
 * The `<video>` / `<img>` are mutually exclusive branches of ONE ternary:
 * `document.hidden` unmounts the element entirely, so a poster `<img>` must be
 * re-created there rather than relying on the vanished `<video poster=>`.
 */
const PortraitFig: React.FC<PortraitProps> = ({ video, poster, caption, title, still }) => {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const [visible, setVisible] = React.useState(() => !document.hidden);

  React.useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const videoOk = !!video && !still && failedSrc !== video;
  const posterOk = !!poster && failedSrc !== poster;

  return (
    <div className="portrait" data-title={title}>
      <div className="portrait__media">
        {videoOk ? (
          visible ? (
            <video
              className="portrait__video"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              poster={posterOk ? assetUrl(poster!, 'image') : undefined}
              src={assetUrl(video!, 'video')}
              onError={() => setFailedSrc(video!)}
            />
          ) : posterOk ? (
            <img
              className="portrait__still"
              src={assetUrl(poster!, 'image')}
              alt=""
              onError={() => setFailedSrc(poster!)}
            />
          ) : null
        ) : posterOk ? (
          <img
            className="portrait__still"
            src={assetUrl(poster!, 'image')}
            alt=""
            onError={() => setFailedSrc(poster!)}
          />
        ) : (
          <div className="portrait__missing" role="img" aria-label={title}>
            <span>{title}</span>
          </div>
        )}
      </div>
      {caption && <div className="portrait__caption">{caption}</div>}
    </div>
  );
};
export interface CanvasObjectProps {
  item: LayerItem;
  /** The layer this object is seated in. Forwarded to the page-card budget,
   *  which is isolated per layer — an explicit prop, never a DOM attribute read
   *  (the canvas and nook paths spell their ancestor markers differently). */
  layer: string;
  /** true = this card never mounts <video> (L1 cap / L3 reduced motion, nook 03 §③-6). */
  still?: boolean;
  index?: number;
  focus?: FocusCoordinator;
  onSelectChoice?: (path: string, choice: string) => void;
  onEntityAction?: (prompt: string) => void;
  onDiceRolled?: (result: number, passed: boolean) => void;
  onEnterGate?: (targetLayer: string) => void;
  onOpenCharacterModal?: (charId: string) => void;
  onItemDropOnTarget?: (itemPath: string, targetPath: string) => void;
  onTakeItem?: (path: string) => void;
  /** What the player carries; a gate asking for something else is marked locked for the tutorial. */
  carried?: ReadonlySet<string>;
  /** The player's clue-board mark on this card. */
  playerTag?: PlayerTagValue;
  /** An older chalk on its way into the message drawer: it fades, then leaves the canvas. */
  retiring?: boolean;
  /** A chalk's 「在消息里看」: open the drawer on this entry. */
  onShowInStream?: (path: string) => void;
}

/** The small badge a player's mark paints on a card. */
export const PlayerTagBadge: React.FC<{ tag: PlayerTagValue }> = ({ tag }) => {
  const { t } = useLocale();
  const label = tag === 'suspect' ? t('Suspicious') : tag === 'confirmed' ? t('Confirmed') : t('Irrelevant');
  return <span className={`player-tag player-tag--${tag}`} data-player-tag={tag}>{label}</span>;
};

/** `--target-rot` is a CSS custom property, which `CSSProperties` cannot name. */
type ShellStyle = React.CSSProperties & { '--target-rot': string };

/**
 * The shell owns position, declared width and rotation. Height is left to the
 * content so the painted box IS the real box (chalk overruns `form.h`).
 * Rotation belongs to the shell alone: narration (chalk) and the presence
 * figure stay level, every paper form keeps its hand tilt (AGENTS §7.5③).
 */
function shellStyle(item: CanvasObjectProps['item'], kind: string, reading: boolean): ShellStyle {
  return {
    left: item.x,
    top: item.y,
    // Declared width only — the reading panel floats (prop-card.css) so it never
    // grows the shell. Mutating width here was a 4th collision authority
    //.
    width: item.w,
    zIndex: reading ? 'var(--depth-entity-reading)' : liftFor(item.path, item.z),
    '--target-rot': kind === 'chalk' || kind === 'sprite' ? '0deg' : `${item.rot}deg`,
  };
}
export const CanvasObject: React.FC<CanvasObjectProps> = ({
  item,
  layer,
  still = false,
  index,
  focus,
  onSelectChoice,
  onEntityAction,
  onDiceRolled,
  onEnterGate,
  onOpenCharacterModal,
  onItemDropOnTarget,
  onTakeItem,
  carried,
  playerTag,
  retiring = false,
  onShowInStream,
}) => {
  const { t } = useLocale();
  const kind = item.kind;
  const isChalk = item.frontmatter?.type === 'chalk';
  // A player's sticky note edits in place; it has no reading view of its own.
  const isSticky = kind === 'sticky';
  const [reading, setReading] = React.useState(false);
  // A choice picked in the reader, run by EntityInteractions once it is back:
  // declared actions (take / read / dialogs) are only handled there.
  const [pendingChoice, setPendingChoice] = React.useState<string | null>(null);
  const pointerStart = React.useRef({ x: 0, y: 0 });
  const objectRef = React.useRef<HTMLDivElement>(null);
  // Verified resolution → trusted attrs/vars. Memoised in the
  // adapter, so re-renders cost nothing; a missing resolution simply means legacy defaults.
  const appearance = item.appearance ? appearanceViewOf(item.appearance) : null;
  const isGate = kind === 'gate' || item.frontmatter?.type === 'gate' || item.path.endsWith('/README.md');
  const isDoor = item.frontmatter?.visual === 'door';
  const readable = kind !== 'sprite' && !isGate && !isDoor && !isSticky;
  const isPhoto = kind === 'photo' && item.frontmatter?.component === 'photo';
  const photoDialogId = `photo-detail-${item.path.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  // The SECOND reading layer for a page card. Same criterion as CardRenderer's
  // branch — one field read in both places, so "the face is a page but the
  // reader is not" cannot happen.
  const isHtml = item.frontmatter?.type === 'html';
  const htmlDialogId = `html-detail-${item.path.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const [isDragOver, setIsDragOver] = React.useState(false);
  const readerBody = item.frontmatter?.component === 'letter' && typeof item.frontmatter.body === 'string'
    ? item.frontmatter.body
    : item.body;
  const [isItemDragging, setIsItemDragging] = React.useState(false);
  const anchorCleanup = React.useRef<(() => void) | undefined>(undefined);
  const enterPendingKey = React.useRef<string | null>(null);
  const enterPendingTimer = React.useRef<number | null>(null);
  const [hovered, setHovered] = React.useState(false);
  const [inspected, setInspected] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  // The big action pill: shown after the pointer
  // rests on the card for CARD_DWELL_MS, or at once on keyboard focus; kept for
  // CARD_GRACE_MS after leaving so the pointer can travel to the pill.
  const [lifted, setLifted] = React.useState(false);
  const [lift, setLift] = React.useState(1);
  const dwellTimer = React.useRef<number | undefined>(undefined);
  const graceTimer = React.useRef<number | undefined>(undefined);
  const insidePill = React.useRef(false);
  // The focus view's footer, where the card's big buttons go while it is open.
  const [focusSlot, setFocusSlot] = React.useState<HTMLElement | null>(null);
  const gateOpenTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => {
    window.clearTimeout(dwellTimer.current);
    window.clearTimeout(graceTimer.current);
    window.clearTimeout(gateOpenTimer.current);
  }, []);
  const raise = () => {
    window.clearTimeout(graceTimer.current);
    const object = objectRef.current;
    // One rect read when the lift starts — never per pointer move.
    if (object) setLift(cardLiftScale(object.getBoundingClientRect().width));
    setLifted(true);
  };
  const lower = () => {
    window.clearTimeout(dwellTimer.current);
    window.clearTimeout(graceTimer.current);
    graceTimer.current = window.setTimeout(() => {
      if (!insidePill.current) setLifted(false);
    }, CARD_GRACE_MS);
  };
  const dropLift = () => {
    window.clearTimeout(dwellTimer.current);
    window.clearTimeout(graceTimer.current);
    insidePill.current = false;
    setLifted(false);
  };
  React.useEffect(() => () => {
    anchorCleanup.current?.();
    clearTimeout(enterPendingTimer.current ?? undefined);
    enterPendingTimer.current = null;
    enterPendingKey.current = null;
  }, [item.path, item.frontmatter?.anchor]);
  const highlight = (element: HTMLElement, active: boolean) => {
    highlightLinks(item.path, active);
    anchorCleanup.current?.();
    anchorCleanup.current = undefined;
    if (active && item.frontmatter?.type === 'chalk') {
      anchorCleanup.current = highlightChalkAnchor(element, item.path, item.frontmatter.anchor);
    }
  };
  const gateTarget = typeof item.frontmatter?.target === 'string' && item.frontmatter.target.trim()
    ? item.frontmatter.target
    : item.path.replace(/\/README\.md$/, '');
  const requestEnter = (target: string) => {
    if (enterPendingKey.current === target) return;
    clearTimeout(enterPendingTimer.current ?? undefined);
    enterPendingKey.current = target;
    enterPendingTimer.current = window.setTimeout(() => {
      enterPendingKey.current = null;
      enterPendingTimer.current = null;
    }, 500);
    onEnterGate?.(target);
  };
  // Every card that is not a person opens a focus view: the paper, centred and
  // readable, with the same big buttons under it.
  const openable = kind !== 'sprite' && !isSticky;
  const openFocus = () => {
    dropLift();
    if (isGate || isDoor) setInspected(true);
    setReading(true);
  };
  // Back (browser / phone gesture) closes the focus view like Esc does. One
  // history entry marks "a card is open"; closing another way leaves it in
  // place (a later open reuses it) rather than racing a history.back().
  React.useEffect(() => {
    if (!reading || isPhoto || isHtml) return;
    const state = window.history.state as { airpCardFocus?: boolean } | null;
    if (state?.airpCardFocus !== true) window.history.pushState({ ...(state ?? {}), airpCardFocus: true }, '');
    const onPop = () => setReading(false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [reading, isPhoto, isHtml]);
  // Entering from the card's buttons closes the focus view first (the threshold opens above the canvas).
  const enterFromCard = (target: string) => { setReading(false); dropLift(); requestEnter(target); };
  React.useEffect(() => {
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
  const handleSpriteDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const draggedPath = e.dataTransfer.getData('text/plain');
    if (draggedPath) onItemDropOnTarget?.(draggedPath, item.path);
  };
  const spritePuzzleClasses = `${isItemDragging ? 'puzzle-target-ready' : ''} ${isDragOver ? 'puzzle-target-hover' : ''}`.trim();

  return (
    <div
      ref={objectRef}
      data-path={item.path}
      data-tutorial={isGate || isDoor ? 'gate' : undefined}
      data-tutorial-locked={(isGate || isDoor) && placeLocked(item, carried ?? NO_CARRIED) ? 'true' : undefined}
      tabIndex={0}
      aria-label={isPhoto || isHtml ? String(item.frontmatter?.title || item.filename) : undefined}
      aria-expanded={isPhoto || isHtml ? reading : undefined}
      aria-controls={isPhoto && reading ? photoDialogId : isHtml && reading ? htmlDialogId : undefined}
      onPointerDownCapture={event => {
        pointerStart.current = { x: event.clientX, y: event.clientY };
        // A press on the card itself (a drag, or a click that opens it) puts the
        // pill away; presses inside the pill bubble here through the portal.
        if (objectRef.current?.contains(event.target as Node)) {
          window.clearTimeout(dwellTimer.current);
          if (lifted) dropLift();
        }
      }}
      onClick={event => {
        const target = event.target as HTMLElement;
        if (target.closest('button,a,input,textarea,select,.entity-interactions,[role="dialog"]')) return;
        if (movedBeyondCardThreshold(pointerStart.current.x, pointerStart.current.y, event.clientX, event.clientY)) return;
        if (!objectRef.current?.contains(target)) return;
        if (isGate || isDoor) {
          setInspected(true);
          // Wait out a desktop double-click (which enters) before opening the focus view.
          window.clearTimeout(gateOpenTimer.current);
          if (event.detail < 2) gateOpenTimer.current = window.setTimeout(openFocus, 240);
          return;
        }
        if (readable) setReading(value => !value);
      }}
      onDoubleClick={event => {
        if (!isGate && !isDoor) return;
        event.preventDefault();
        event.stopPropagation();
        window.clearTimeout(gateOpenTimer.current);
        requestEnter(gateTarget);
      }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          if (isGate || isDoor) {
            requestEnter(gateTarget);
          } else if (readable) {
            setReading(value => !value);
          }
        } else if (event.key === 'Escape' && lifted) {
          dropLift();
        }
      }}
      onPointerEnter={event => {
        setHovered(true);
        highlight(event.currentTarget, true);
        // Touch has no hover: a tap opens the focus view instead.
        if (event.pointerType === 'touch' || reading) return;
        window.clearTimeout(graceTimer.current);
        if (lifted) return;
        window.clearTimeout(dwellTimer.current);
        dwellTimer.current = window.setTimeout(raise, CARD_DWELL_MS);
      }}
      onPointerLeave={event => { setHovered(false); highlight(event.currentTarget, false); lower(); }}
      onFocus={event => {
        setFocused(true);
        highlight(event.currentTarget, true);
        // Keyboard focus on the card shows the pill at once.
        if (event.target === event.currentTarget && !reading && event.currentTarget.matches(':focus-visible')) raise();
      }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { setFocused(false); highlight(event.currentTarget, false); if (!insidePill.current) dropLift(); } }}
      className={`object ink-form${reading ? ' object--reading' : ''}`}
      data-reading={reading ? '' : undefined}
      data-chalk-retiring={retiring ? 'true' : undefined}
      aria-hidden={retiring || undefined}
      data-card-lifted={lifted ? '' : undefined}
      // Appearance attrs/vars are additive: `shellStyle` still owns position/width/
      // zIndex/rotation alone. Siblings inherit the vars.
      {...appearance?.attrs}
      style={{ ...appearance?.style, ...shellStyle(item, kind, reading), ...(lifted ? { '--card-lift': String(lift) } : null) } as React.CSSProperties}
    >
      {/* The chalk's place in the message drawer: one small tab, never the card itself — a press
          on the card stays a drag / a read. */}
      {isChalk && onShowInStream && !retiring && (
        <button
          type="button"
          className="chalk-stream-link"
          data-testid="chalk-stream-link"
          title={t('Find this in the messages')}
          aria-label={t('Find this in the messages')}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); onShowInStream(item.path); }}
        >
          <span aria-hidden="true">≡</span>
        </button>
      )}
      {reading && isPhoto ? (
        <PhotoDetailDialog
          item={item}
          appearance={appearance}
          dialogId={photoDialogId}
          onClose={() => setReading(false)}
          returnFocusRef={objectRef}
          focus={focus}
        />
      ) : reading && isHtml ? (
        <HtmlDetailDialog
          item={item}
          appearance={appearance}
          dialogId={htmlDialogId}
          onClose={() => setReading(false)}
          returnFocusRef={objectRef}
          focus={focus}
        />
      ) : kind === 'portrait' ? (
          <PortraitFig
            video={item.frontmatter?.video}
            poster={item.frontmatter?.poster}
            caption={item.frontmatter?.caption}
            title={item.frontmatter?.title || item.filename.replace('.md', '')}
            still={still}
          />
        ) : kind === 'sprite' ? (
          <div
            onClick={() => {
              const charId = item.frontmatter?.characterId || item.frontmatter?.id || item.filename.replace('.md', '');
              onOpenCharacterModal?.(charId);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleSpriteDrop}
            className={`sprite cursor-pointer transition-transform duration-200 ${chalkStyleOf(item.frontmatter).aged ? ' chalk--aged' : ''} ${spritePuzzleClasses}`}
          >
            <SpriteFig avatar={item.frontmatter?.avatar} video={item.frontmatter?.avatarVideo} still={still} name={item.frontmatter?.title || item.filename.replace('.md', '')} />
            <div className="sprite__name">
              {item.frontmatter?.title || item.filename.replace('.md', '')}
            </div>
          </div>
        ) : (
          <CardRenderer
            item={item}
            w={item.w}
            z={item.z}
            layer={layer}
            appearance={appearance}
            index={index}
            gateInspected={inspected}
            onSelectChoice={onSelectChoice}
            onDiceRolled={onDiceRolled}
            onOpenCharacterModal={onOpenCharacterModal}
            onItemDropOnTarget={onItemDropOnTarget}
          />
        )}
        {/* The focus view: the card face stays on the
            canvas; the paper opens centred above it, the big buttons below. */}
        {reading && !isPhoto && !isHtml && (
          <BagItemDialog
            focusView
            item={{ ...item, body: readerBody }}
            onClose={() => setReading(false)}
            onChoose={choice => { setReading(false); setPendingChoice(choice); }}
            focus={focus}
            footer={<div ref={setFocusSlot} className="card-focus__actions" />}
          />
        )}
        {playerTag && <PlayerTagBadge tag={playerTag} />}
        {!(reading && (isPhoto || isHtml)) && <EntityInteractions item={item} active={!reading && (hovered || focused || inspected)} focus={focus} onChoice={onEntityAction} onDiceRolled={onDiceRolled} onEnterGate={onEnterGate ? enterFromCard : undefined} onOpenCharacter={onOpenCharacterModal} pendingChoice={pendingChoice} onPendingChoiceHandled={() => setPendingChoice(null)}
          pillVisible={lifted && !reading}
          pillHost={reading ? focusSlot : null}
          onOpen={openable && !reading ? openFocus : undefined}
          onPillPointer={inside => { insidePill.current = inside; if (inside) window.clearTimeout(graceTimer.current); else lower(); }}
          locked={(isGate || isDoor) && placeLocked(item, carried ?? NO_CARRIED)}
          sideHidden={reading} />}
    </div>
  );
};
