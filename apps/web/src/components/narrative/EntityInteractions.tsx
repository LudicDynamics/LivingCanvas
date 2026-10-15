import { useLocale } from '../../lib/i18n.js';
import React from 'react';
import './declared-actions.css';
import type { FocusCoordinator } from '../../lib/focus-coordinator.js';
import type { ActionFeedback } from '../../lib/action-feedback.js';
import { renderFrontmatterWidgets } from '../../lib/fm.js';
import { useLayoutMode } from '../../lib/layout-mode.js';
import { DeclaredChoiceHost, projectionForPath, useDeclaredChoice } from '../../lib/use-declared-choice.js';
import { isNpcCard, requestNpcTalk } from '../../lib/npc-dialogue.js';
import { createPortal } from 'react-dom';
import { cardPrimaryActions, type CardActionId } from '../../lib/card-actions.js';
import { CardActionBar, type CardActionButton } from '../canvas/CardActionBar.js';

interface Props {
  item: { path: string; filename?: string; body?: string; frontmatter: Record<string, any> | null };
  active?: boolean;
  focus?: FocusCoordinator;
  onChoice?: (prompt: string) => void;
  onSelectChoice?: (path: string, choice: string) => void;
  onDiceRolled?: (result: number, passed: boolean) => void;
  onEnterGate?: (path: string) => void;
  onOpenCharacter?: (characterId: string) => void;
  onActionResult?: (result: ActionFeedback) => void;
  actionProjection?: string;
  /** A choice picked in the canvas reader; run here, then acknowledged. */
  pendingChoice?: string | null;
  onPendingChoiceHandled?: () => void;
  /**
   * The owner already placed this panel (the map's floating card panel): skip
   * the canvas side-placement, which measures `.object` cards on the canvas
   * surface, and render in flow, always visible.
   */
  anchored?: boolean;
  /**
   * Canvas only: the big action pill shows (the
   * pointer rested on the card, or keyboard focus is on it).
   */
  pillVisible?: boolean;
  /** The focus view's footer: while set, the big buttons render there instead of floating. */
  pillHost?: HTMLElement | null;
  /** 「打开」: open the card's focus view. Only offered where the owner can. */
  onOpen?: () => void;
  /** The pointer entered / left the floating pill (the owner's hover grace). */
  onPillPointer?: (inside: boolean) => void;
  /** The place asks for something the player does not carry (tutorial reads it from the button). */
  locked?: boolean;
  /** While the card's own reader is open, the side panel steps aside (the reader shows the widgets). */
  sideHidden?: boolean;
}

export function EntityInteractions({ item, active = false, focus, onChoice, onDiceRolled, onEnterGate, onOpenCharacter, onActionResult, actionProjection: providedProjection, pendingChoice, onPendingChoiceHandled, anchored = false, pillVisible = false, pillHost = null, onOpen, onPillPointer, locked = false, sideHidden = false }: Props) {

  const { t } = useLocale();
  const [layoutMode] = useLayoutMode();
  // In `companion` the options live in the left rail; the card
  // keeps its information, enter / take affordances and drag targets.
  const showChoices = layoutMode !== 'companion';
  const projection = providedProjection ?? projectionForPath(item.path);
  const ref = React.useRef<HTMLDivElement>(null);
  const [side, setSide] = React.useState('right');
  // The one path a picked option travels — shared with `ChoiceRail`.
  const declared = useDeclaredChoice({
    resolveItem: path => (path === item.path ? item : null),
    projection,
    onChoice,
    onEnterGate,
    onOpenCharacter,
    onActionResult,
  });
  const { busy, feedback, feedbackStatus, error, runAction } = declared;

  React.useLayoutEffect(() => {
    if (anchored || !active || !ref.current) return;
    const el = ref.current;
    const object = el.closest<HTMLElement>('.object');
    // The canvas root carries the world depth marker; the old aria-label hook no
    // longer exists, and the fallback (the camera-transformed world layer) moves
    // with the camera, which shrank max-height and clipped the panel.
    const viewport = object?.closest<HTMLElement>('.depth-surface--world')
      || object?.closest<HTMLElement>('[aria-label="Infinite canvas"]')
      || object?.parentElement?.parentElement;
    if (!object || !viewport) return;
    // Placement is locked for this hover session. Changing side changes the
    // panel's padding/height, so observing it and choosing again feeds back.
    let placement: string | null = null;
    const measure = () => {
      const box = object.getBoundingClientRect();
      const bounds = viewport.getBoundingClientRect();
      const scale = box.width / Math.max(object.offsetWidth, 1);
      const width = el.offsetWidth * scale;
      const height = Math.min(el.scrollHeight * scale, bounds.height - 32);
      const obstacles = Array.from(object.parentElement!.querySelectorAll<HTMLElement>('.object')).filter(node => node !== object).map(node => node.getBoundingClientRect());
      const overlap = (x: number, y: number, r: DOMRect) => Math.max(0, Math.min(x + width, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(y + height, r.bottom) - Math.max(y, r.top));
      const candidates = [
        { side: 'right', x: box.right, y: box.top },
        { side: 'left', x: box.left - width, y: box.top },
        { side: 'below', x: box.left, y: box.bottom },
      ];
      const score = (candidate: typeof candidates[number]) => {
        const outside = width * height - overlap(candidate.x, candidate.y, bounds);
        return outside * 10 + obstacles.reduce((sum, r) => sum + overlap(candidate.x, candidate.y, r), 0);
      };
      const best = candidates.find(candidate => candidate.side === placement)
        ?? candidates.reduce((best, next) => score(next) < score(best) ? next : best);
      placement = best.side;
      setSide(best.side);
      // Keep the bottom player/hand/action chrome out of the reading area.
      el.style.maxHeight = `${Math.max(80, (bounds.bottom - Math.max(bounds.top, best.y) - 110) / scale)}px`;
    };
    measure();
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    viewport.addEventListener('wheel', schedule, { passive: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); viewport.removeEventListener('wheel', schedule); };
  }, [active, anchored]);

  const send = (action: string) => onChoice?.(`Regarding world file ${JSON.stringify(item.path)}, the player requests: ${action}`);
  const actions = Array.isArray(item.frontmatter?.actions)
    ? item.frontmatter.actions.filter((action: unknown): action is string => typeof action === 'string' && !!action.trim())
    : [];
  const fm = item.frontmatter;
  const isGate = fm?.type === 'gate' || item.path.endsWith('/README.md');
  const isDoor = fm?.visual === 'door';
  const isPerson = fm?.type === 'character' || fm?.type === 'sprite';
  // An NPC card is someone to talk to, never something to pocket.
  const isNpc = isNpcCard(fm);
  const collectable = !isGate && !isDoor && !isPerson && !isNpc && fm?.type !== 'chalk' && item.path.startsWith('world/') && fm?.portable !== false;

  const choose = (choice: string) => declared.choose(item.path, choice);

  // The reader posted nothing itself: run the choice through the same path as the panel.
  React.useEffect(() => {
    if (!pendingChoice) return;
    onPendingChoiceHandled?.();
    choose(pendingChoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingChoice]);

  // The card's primary actions — the same handlers the side arrows always ran,
  // now as big buttons.
  const take = () => void runAction(
    'take',
    item.path,
    undefined,
    t('Added to belongings.'),
    { item: item.path, from: item.path, to: `player/${item.path.split('/').pop()}` },
  );
  const enter = () => onEnterGate?.(typeof fm?.target === 'string' ? fm.target : item.path.replace(/\/README\.md$/, ''));
  const talk = () => onOpenCharacter?.(fm?.characterId || fm?.id || item.path.split('/').pop()!.replace(/\.md$/, ''));
  const handlers: Record<CardActionId, () => void> = {
    open: () => onOpen?.(),
    take,
    enter,
    converse: () => requestNpcTalk({ path: item.path, frontmatter: fm }),
    talk,
  };
  // Literal keys, so the i18n gate sees every label.
  const labels: Record<CardActionId, string> = {
    open: t('Open card'),
    take: t('Take along'),
    enter: t('Enter place'),
    converse: t('Converse'),
    talk: t('Talk with this person'),
  };
  const primary = cardPrimaryActions(item, { canOpen: !!onOpen && !pillHost, canEnter: !!onEnterGate, canTalk: !!onOpenCharacter });
  // Belt and braces: the shared rule and this panel's own reading must agree.
  const primaryButtons: CardActionButton[] = primary
    .filter(id => id !== 'take' || collectable)
    .map(id => ({ id, label: labels[id], onSelect: handlers[id], locked: id === 'enter' && locked, disabled: busy && id === 'take' }));

  const status = <>
    {busy && <small role="status">{t('Working…')}</small>}
    {feedback && <small role="status" data-action-status={feedbackStatus ?? 'accepted'}>{feedback}</small>}
    {error && <small className="entity-action-error" role="alert" data-action-status={feedbackStatus ?? 'failed'}>{error}</small>}
  </>;

  const widgets = renderFrontmatterWidgets(item.frontmatter, { filePath: item.path, reveal: active, onChoice: choose, onDiceRolled, hideChoices: !showChoices });
  // The side panel keeps what is not a primary action: choices, dice, status
  // and the card's own declared actions (→ arrows).
  const sideContent = !sideHidden && (widgets || actions.length > 0);
  const actionsPanel = sideContent ? <>
    <fieldset disabled={busy} aria-busy={busy}>
      {widgets}
      {actions.length > 0 && <div className="entity-action-arrows" aria-label={t('Entity actions')}>
        {actions.map((action: string, index: number) => <button type="button" key={`${index}-${action}`} disabled={!onChoice} onClick={() => send(action)}><span aria-hidden="true">→ </span>{action}</button>)}
      </div>}
    </fieldset>
  </> : null;

  // Where the big buttons go: in flow on the map panel, the focus view's footer
  // when it is open, else the floating pill by the card.
  const bar = anchored
    ? <CardActionBar path={item.path} actions={primaryButtons} placement="inline" ariaLabel={t('Card actions')} status={status} />
    : pillHost
      ? createPortal(<CardActionBar path={item.path} actions={primaryButtons} placement="inline" ariaLabel={t('Card actions')} status={status} />, pillHost)
      : <CardActionBar
          path={item.path}
          actions={primaryButtons}
          placement="float"
          anchor={ref.current?.closest<HTMLElement>('.object') ?? null}
          visible={pillVisible || busy}
          prefer={isGate || isDoor ? 'below' : 'above'}
          ariaLabel={t('Card actions')}
          status={pillVisible || busy || error ? status : null}
          onPointerEnter={() => onPillPointer?.(true)}
          onPointerLeave={() => onPillPointer?.(false)}
        />;

  return <>
    <div ref={ref} className={anchored ? 'entity-interactions entity-interactions--anchored' : `entity-interactions entity-interactions--${side}`} data-no-drag onClick={event => event.stopPropagation()}>
      {actionsPanel}
      {anchored && bar}
      <DeclaredChoiceHost declared={declared} focus={focus} />
    </div>
    {!anchored && bar}
  </>;

}
