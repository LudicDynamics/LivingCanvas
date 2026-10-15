import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { agentActivityStore } from '../../lib/agent-activity-store.js';
import { railEntry } from '../../lib/character-rail.mjs';
import { useLiveCallActions, useLiveCallAvailable, useLiveCallLines, useLiveCallState } from '../../lib/live-call.js';
import { LiveCallStatus } from '../live/LiveCallStatus.js';
import { LiveCallTranscript } from '../live/LiveCallTranscript.js';
import type { CharacterPresenceView } from '../../lib/presence.js';
import type { AssetMediaKind } from '../../lib/airp-gateway.js';
import { withBase } from '../../lib/base-path.js';
import './character-rail.css';

/**
 * Right-hand character rail.
 *
 * Shape: the root reuses the EXISTING `.prototype-residents` container
 * (`scene-shell.css:110` — absolute top-right column) so positioning has a
 * single source of truth; `character-rail` is only a styling hook. The rail
 * lives above the backpack, no left/right tabs (contract §4.2.1).
 *
 * It is props-driven and self-contained: it never reads `useWorld`, never
 * fetches, and never derives membership itself — the ONE projection
 * (`usePresence().views`) is handed in (contract §4.1).
 */
export interface CharacterRailProps {
  /** The single projection result (contract §4.1); never re-derived here. */
  views: CharacterPresenceView[];
  /**
   * Ids whose follow toggle request is IN FLIGHT (UF-1). This is UI state, NOT
   * the follow truth: nothing reads it as `following` (contract §2.4). It only
   * disables the row's follow button and marks it `aria-busy`.
   */
  pendingFollowing: ReadonlySet<string>;
  /** A nook is already open -> "Visit their ikigai" is disabled (§6.4). */
  nookOpen: boolean;
  /** Avatar click. Only called when `state === 'in-scene'` (UF-2). */
  onOpenCharacter(id: string): void;
  /** "Go to them". Always called; the absent/no-op + notify live in `04` (P-20). */
  onTravelTo(id: string): void;
  /** Follow toggle; `next` is the computed terminal state (contract §2.4). */
  onToggleFollowing(id: string, next: boolean): void;
  /** "Visit their ikigai"; independent of presence state (UF-4). */
  onOpenNook(id: string): void;
  /** Player-visible feedback (contract §6 MUST NOT #6). */
  notify(message: string): void;
  /**
   * Avatar URL resolver, injected by App (P-18): the real one is module-private.
   * Falls back to the raw path so this component stays standalone/testable.
   */
  assetUrl?(path: string, kind: AssetMediaKind): string | undefined;
  /**
   * What the player could say to each character now: an ink count on the avatar, and a
   * bubble on hover / focus that previews them. A tap on a line opens that person and says it.
   */
  linesByCharacter?: Readonly<Record<string, readonly { key: string; say: string }[]>>;
  onSayTo?(id: string, line: { key: string; say: string }): void;
  /** The character whose stage is open: their lines are already under the conversation, no bubble. */
  openId?: string | null;
  /** 「状态」「技能」 under this person's name; App decides who gets them. */
  quick?(id: string): React.ReactNode;
}

export function CharacterRail({
  views,
  pendingFollowing,
  nookOpen,
  onOpenCharacter,
  onTravelTo,
  onToggleFollowing,
  onOpenNook,
  notify,
  assetUrl,
  linesByCharacter,
  onSayTo,
  openId = null,
  quick,
}: CharacterRailProps): React.ReactElement {
  const { locale, t } = useLocale();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());

  // ---- the rail carrier's call ---
  // Everything below is DERIVED from the store snapshot: the rail holds no call
  // state, so the `useState` above stays the only one in this file (32 §3.1).
  const available = useLiveCallAvailable();
  const call = useLiveCallState();
  const lines = useLiveCallLines();
  const { start, stop } = useLiveCallActions();
  /** `rail:` in the snapshot's ownership field IS this carrier's identity
   * (30 §2.2 freeze 1) — the global phase is never an ownership test. */
  const railOwnsCall = typeof call.owner === 'string' && call.owner.startsWith('rail:');
  /** Transporting = the call is moving bytes. Says nothing about who owns it. */
  const railCallActive = call.phase === 'connecting' || call.phase === 'live';
  /** The card shows while live OR errored (32 §3.1): the error phase MUST stay
   * reachable, or its alert and its hang-up vanish together. Deliberately does
   * NOT consult `views` — a call whose character left the projection still needs
   * an exit. Deliberately NOT gated on `available` (32 §3.6). */
  const railCallVisible = railOwnsCall && (railCallActive || call.phase === 'error');
  /** Display-only suffix for the aria-labels; a missing row yields ''. */
  const railCallName = views.find(view => view.id === call.characterId)?.name ?? call.characterId ?? '';

  // Render-time mirrors so the unmount cleanup reads the LAST snapshot rather
  // than the first render's closure — same shape as `NookView`'s refs.
  const railOwnsCallRef = useRef(railOwnsCall);
  railOwnsCallRef.current = railOwnsCall;
  const callRef = useRef(call);
  callRef.current = call;

  // A carrier's call dies with it (30 §2.3 freeze 2). Owner-scoped on purpose:
  // a bare `stop()` would hang up a dialogue call too. `stop` is a module-level
  // stable reference, so this effect never re-fires (live-call.ts `ACTIONS`).
  useEffect(() => () => {
    if (railOwnsCallRef.current) void stop(`rail:${callRef.current.characterId}`);
  }, [stop]);

  const resolve = useCallback(
    (path?: string): string | undefined => (path ? (assetUrl ? assetUrl(path, 'image') : path) : undefined),
    [assetUrl],
  );

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    // `prototype-residents` = existing top-right column positioning; `prototype-chrome`
    // = shell chrome visibility; `character-rail` = this component's style hook.
    <div className="prototype-residents prototype-chrome character-rail" role="group" aria-label={t('Characters')}>
      {/* This carrier's call card — a direct child of the rail root, NOT inside
          a row: at most one call exists process-wide (30 §2.4 freeze 3), and a
          row would fight its fixed height and the hover panel's anchor. Always
          rendered while the rail owns a call, so the hang-up is reachable with
          no hover at all (32 §3.2; 33 §6.2 B2). */}
      {railCallVisible && (
        <div
          className={`character-rail__call character-rail__call--${call.phase}`}
          data-rail-call=""
          role="log"
        >
          <span className="character-rail__call-status" role="status">
            {call.phase === 'connecting'
              ? t('Connecting…')
              : call.phase === 'live'
                ? t('On a call')
                : t('Could not connect')}
          </span>

          {call.phase === 'error' && call.error ? (
            <p className="character-rail__call-alert" role="alert">{call.error}</p>
          ) : (
            <LiveCallTranscript
              lines={lines}
              call={{ outputText: call.outputText, inputText: call.inputText, phase: call.phase }}
              className="character-rail__call-transcript"
            />
          )}
          <LiveCallStatus call={call} className="character-rail__call-state" />

          <button
            type="button"
            className="character-rail__call-hangup"
            onClick={() => void stop(`rail:${call.characterId}`)}
            aria-label={`${call.phase === 'error' ? t('Close') : t('Hang up')} · ${railCallName}`}
          >
            {call.phase === 'error' ? t('Close') : t('Hang up')}
          </button>
        </div>
      )}
      {/* Rendered in `views` array order — never re-sorted (UF-7c): a state flip
          must not move the row the player is about to click (contract §4.2). */}
      {views.map(view => {
        const entry = railEntry(view);
        const displayName = view.name || view.id;
        const avatarUrl = resolve(view.avatar);
        const pending = pendingFollowing.has(view.id);
        const isExpanded = expanded.has(view.id);
        const actionsId = `character-actions-${view.id}`;
        const statusId = `character-status-${view.id}`;
        const statusLabel = view.following
          ? `${t(entry.statusKey)} · ${t('Following you')}`
          : t(entry.statusKey);
        /** This row's character is the one on the call (30 §2.2 freeze 1: the
         * judgment is the character id, never the global phase — a foreign call
         * MUST NOT grey this row out, and the error phase must stay retryable). */
        const rowCallActive = railCallActive && call.characterId === view.id;
        const lines = entry.canTalk && view.id !== openId ? linesByCharacter?.[view.id] ?? [] : [];

        return (
          <div
            key={view.id}
            className={`character-rail__item character-rail__item--${entry.tone}${isExpanded ? ' character-rail__item--expanded' : ''}`}
            data-has-lines={lines.length > 0 && onSayTo ? 'true' : undefined}
          >
            <button
              type="button"
              className={`prototype-companion-orb character-rail__orb character-rail__orb--${entry.tone}${view.following ? ' character-rail__orb--following' : ''}`}
              // The gesture means ONE thing everywhere: talk. Non-in-scene cannot
              // talk, so the click is refused with a visible reason (UF-2, P-20).
              onClick={() => {
                if (entry.canTalk) onOpenCharacter(view.id);
                else if (entry.talkHintKey) notify(t(entry.talkHintKey));
              }}
              aria-label={entry.canTalk ? t('Talk to {name}', { name: displayName }) : displayName}
              aria-describedby={entry.canTalk ? undefined : statusId}
              style={avatarUrl ? { backgroundImage: `url("${withBase(avatarUrl)}")` } : undefined}
            >
              {!avatarUrl && <span aria-hidden="true">{view.id.charAt(0).toUpperCase()}</span>}
              {view.following && <span className="character-rail__follow-dot" aria-hidden="true" />}
              {lines.length > 0 && <span className="character-rail__ink" data-testid="rail-ink" aria-label={t('{count} things to say', { count: lines.length })}>{lines.length}</span>}
            </button>

            {/* The character's side of the options: previewed on hover / focus, said on a tap. */}
            {lines.length > 0 && onSayTo && (
              <div className="character-rail__lines" role="group" data-testid="rail-lines" aria-label={t('Say to {name}', { name: displayName })}>
                {lines.map((line) => (
                  <button key={line.key} type="button" className="character-rail__line" onClick={() => onSayTo(view.id, line)}>{line.say}</button>
                ))}
              </div>
            )}

            <small className="character-rail__label">{displayName}</small>
            <span id={statusId} className="character-rail__status">{statusLabel}</span>
            {quick?.(view.id)}

            {/* Independent, focusable expander -> the three keys (§3.6). On touch
                it is always visible; on desktop hover is only the fast path. */}
            <button
              type="button"
              className="character-rail__expander"
              aria-expanded={isExpanded}
              aria-controls={actionsId}
              aria-label={t('Actions for {name}', { name: displayName })}
              onClick={() => toggleExpanded(view.id)}
            >
              <span aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
            </button>

            {/* Always in the DOM; shown by CSS on hover / :focus-within / expander. */}
            <div id={actionsId} className="character-rail__actions" role="group" aria-label={t('Actions for {name}', { name: displayName })}>
              <button
                type="button"
                className="character-rail__action"
                // Always called; absent -> `navigateTo` shows the hint and does not
                // travel (P-20: the single notifier is navigateTo).
                onClick={() => onTravelTo(view.id)}
                aria-label={`${t('Go to them')} · ${displayName}`}
              >
                {t('Go to them')}
              </button>
              <button
                type="button"
                className={`character-rail__action${pending ? ' character-rail__action--pending' : ''}`}
                // `next` comes from the projection, never from local state (§2.4).
                onClick={() => { if (!pending) onToggleFollowing(view.id, !view.following); }}
                disabled={pending}
                aria-busy={pending}
                aria-label={`${t(entry.followActionKey)} · ${displayName}`}
              >
                {t(entry.followActionKey)}
              </button>
              <button
                type="button"
                className="character-rail__action"
                onClick={() => onOpenNook(view.id)}
                disabled={nookOpen}
                aria-disabled={nookOpen}
                aria-label={`${t('Visit their ikigai')} · ${displayName}`}
              >
                {t('Visit their ikigai')}
              </button>
              {/* The entry. Double-gated: `available` says the service can take a
                  call at all (00 §2.9 — "no entry may be rendered"), and
                  `entry.canTalk` keeps the row from contradicting its own orb,
                  which refuses to talk to a non-present character (32 §3.5). */}
              {available && entry.canTalk && (
                <button
                  type="button"
                  className="character-rail__action"
                  onClick={() => {
                    const savePath = agentActivityStore.getActiveSavePath();
                    if (!savePath || !agentActivityStore.isSaveActive(savePath)) return;
                    void start({
                      characterId: view.id,
                      locale: locale === 'ja' || locale === 'ko' ? locale : 'en',
                      uiLocale: locale,
                      owner: `rail:${view.id}`,
                      savePath,
                    });
                  }}
                  disabled={rowCallActive}
                  aria-label={`${t(rowCallActive ? 'On a call' : 'Start a call')} · ${displayName}`}
                >
                  {t(rowCallActive ? 'On a call' : 'Start a call')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
