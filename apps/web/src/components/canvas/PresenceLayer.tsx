/**
 * Canvas presence layer.
 *
 * The ONE renderer of "same-scene" characters: it draws the `in-scene` rows of the
 * single projection at their `presence.x/y` CENTRE point, and expresses "they came
 * along" with CSS transitions (`transform` / `opacity`) rather than a state machine.
 *
 * A node is deliberately NOT a card: no `.object` class, no `data-path`, so it never
 * enters card drag, soft-collision, footprint measurement or camera framing
 * (contract §4.3). Props-driven and self-contained; it writes no world fact.
 */
import React from 'react';
import { Footprints } from 'lucide-react';
import { useLocale } from '../../lib/i18n.js';
import { useStill } from '../../lib/motion.js';
import type { AssetMediaKind } from '../../lib/airp-gateway.js';
import type { CharacterPresenceView } from '../../lib/presence.js';
import {
  PRESENCE_EXIT_MS,
  PRESENCE_NODE_ATTR,
  PRESENCE_NODE_CLASS,
  presenceEntryDescriptor,
  presenceMotionAllowed,
  presenceRenderOrder,
  presenceRootTransform,
} from '../../lib/presence-node.js';
import type { PresenceMotionPrefs } from '../../lib/presence-node.js';
import './presence-layer.css';

export interface PresenceLayerProps {
  /** Contract §4.1's single projection, handed down by App. This layer only
   *  FILTERS (`state === 'in-scene'` + a position) and renders — it MUST NOT
   *  re-derive membership from `state.presence` / `characters`. */
  presence: CharacterPresenceView[];
  /** Player's current layer: keys nodes, so switching layers REMOUNTS (an entry)
   *  instead of sliding a node across a coordinate space it never shared. */
  layerId: string;
  /** Click on the avatar = open the direct conversation.
   *  When omitted the node degrades to a static, non-interactive marker. */
  onOpenCharacterModal?: (charId: string) => void;
  /** World-root-relative asset path → URL. The two existing helpers of this shape
   *  are module-private (contract P-18), so App injects its own copy; without it the
   *  raw `avatar` value is used as the src. */
  assetUrl?: (path: string, kind: AssetMediaKind) => string | undefined;
}

/** Page visibility is the second (and last) degradation input — contract §4.2. */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = React.useState(() => !document.hidden);
  React.useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  return visible;
}

/** One avatar node. `order` is the index inside `presenceRenderOrder` (contract §4.2). */
const PresenceAvatar: React.FC<{
  view: CharacterPresenceView;
  order: number;
  prefs: PresenceMotionPrefs;
  assetUrl?: (path: string, kind: AssetMediaKind) => string | undefined;
  onOpenCharacterModal?: (charId: string) => void;
  /** A leaving node: frozen at its old world coordinate, fading, non-interactive. */
  exiting?: boolean;
}> = ({ view, order, prefs, assetUrl, onOpenCharacterModal, exiting = false }) => {
  const { t } = useLocale();
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const entry = presenceEntryDescriptor(order, view, prefs);

  const avatar = view.avatar;
  const src = avatar
    ? /^(?:https?:|data:|blob:)/.test(avatar)
      ? avatar
      : assetUrl?.(avatar, 'image') ?? avatar
    : undefined;
  const talkLabel = t('Talk to {name}', { name: view.name || view.id });
  // `aria-label` REPLACES descendant text, so the "following" state must live in the
  // name itself — a visually-hidden span inside a labelled button is never announced.
  const label = view.following ? `${talkLabel} · ${t('Following you')}` : talkLabel;

  const face = (
    <>
      {src && failedSrc !== src ? (
        <img className="presence-avatar__image" src={src} alt="" onError={() => setFailedSrc(src)} />
      ) : (
        <span className="presence-avatar__initial" aria-hidden="true">
          {view.id.charAt(0).toUpperCase()}
        </span>
      )}
      {view.following && (
        <span className="presence-avatar__follow">
          <Footprints size={13} strokeWidth={1.6} aria-hidden="true" />
        </span>
      )}
    </>
  );

  // An exiting snapshot is a div, never a button: "not interactive" must not be a
  // verbal promise while focus can still reach it (contract §4.2).
  const body =
    !exiting && onOpenCharacterModal ? (
      <button
        type="button"
        className="presence-avatar__body"
        aria-label={label}
        onClick={() => onOpenCharacterModal(view.id)}
      >
        {face}
      </button>
    ) : (
      <div className="presence-avatar__body" role="img" aria-label={exiting ? undefined : label}>
        {face}
      </div>
    );

  const nodeAttrs = { [PRESENCE_NODE_ATTR]: '' } as React.HTMLAttributes<HTMLDivElement>;
  const style = {
    transform: presenceRootTransform(view),
    '--presence-delay': `${entry.delayMs}ms`,
    '--presence-offset': `${entry.offsetPx}px`,
    '--presence-enter-ms': `${entry.durationMs}ms`,
  } as React.CSSProperties;

  return (
    <div
      {...nodeAttrs}
      // Clue-board lines find a character by this (LinkLayer, `characters/<id>`).
      data-presence-id={exiting ? undefined : view.id}
      className={`${PRESENCE_NODE_CLASS}${exiting ? ` ${PRESENCE_NODE_CLASS}--exiting` : ''}`}
      data-still={presenceMotionAllowed(prefs) ? 'false' : 'true'}
      aria-hidden={exiting || undefined}
      style={style}
    >
      <div className="presence-avatar__anchor">{body}</div>
    </div>
  );
};

export const PresenceLayer: React.FC<PresenceLayerProps> = ({
  presence,
  layerId,
  onOpenCharacterModal,
  assetUrl,
}) => {
  const reducedMotion = useStill();
  const pageVisible = useDocumentVisible();
  const prefs = React.useMemo<PresenceMotionPrefs>(
    () => ({ reducedMotion, pageVisible }),
    [reducedMotion, pageVisible]
  );

  const inScene = React.useMemo(
    () => presence.filter((view) => view.state === 'in-scene' && view.position !== null),
    [presence]
  );

  // Leaving nodes are LOCAL display state (contract §4.2): they never enter `items`
  // or `presence`, and they hold no world truth — just the last coordinate to fade at.
  const prevRef = React.useRef<Map<string, CharacterPresenceView>>(new Map());
  const timersRef = React.useRef<number[]>([]);
  const exitSeqRef = React.useRef(0);
  const [exiting, setExiting] = React.useState<{ key: string; view: CharacterPresenceView }[]>([]);

  React.useEffect(() => {
    const current = new Map<string, CharacterPresenceView>();
    for (const view of inScene) current.set(`${layerId}:${view.id}`, view);
    const gone: { key: string; view: CharacterPresenceView }[] = [];
    for (const [key, view] of prevRef.current) {
      if (!current.has(key)) gone.push({ key: `${key}:exit:${exitSeqRef.current++}`, view });
    }
    prevRef.current = current;
    if (gone.length === 0) return;
    setExiting((prev) => [...prev, ...gone]);
    timersRef.current.push(
      window.setTimeout(() => {
        const keys = new Set(gone.map((entry) => entry.key));
        setExiting((prev) => prev.filter((entry) => !keys.has(entry.key)));
      }, PRESENCE_EXIT_MS)
    );
  }, [inScene, layerId]);

  React.useEffect(
    () => () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
    },
    []
  );

  // Sort once: non-followers first, followers last (contract §4.2). `order` is the
  // index in this result, so "who goes last" lives in ONE place.
  const ordered = React.useMemo(() => presenceRenderOrder(inScene), [inScene]);

  if (ordered.length === 0 && exiting.length === 0) return null;

  return (
    <>
      {ordered.map((view, order) => (
        <PresenceAvatar
          key={`${layerId}:${view.id}`}
          view={view}
          order={order}
          prefs={prefs}
          assetUrl={assetUrl}
          onOpenCharacterModal={onOpenCharacterModal}
        />
      ))}
      {exiting.map((entry) => (
        <PresenceAvatar
          key={entry.key}
          view={entry.view}
          order={0}
          prefs={prefs}
          assetUrl={assetUrl}
          exiting
        />
      ))}
    </>
  );
};
