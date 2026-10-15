import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { useLocale } from '../../lib/i18n.js';
import { useLiveCallActions, useLiveCallAvailable, useLiveCallState } from '../../lib/live-call.js';
import { guardImeKey } from '../../lib/ime.js';
import { VoiceInputButton } from '../chrome/VoiceInputButton.js';
import { SendButton } from '../chrome/SendButton.js';
import { NarratedText, StopVoiceButton, useStopVoiceOnEscape } from '../chrome/SpeakerControls.js';
import { MotionPortrait } from '../overlay/MotionPortrait.js';
import { CharacterRail, type CharacterRailProps } from './CharacterRail.js';
import { LineChips, useLineBatch, type LineChip } from './LineChips.js';
import { useCharacterDialogue } from '../../lib/character-dialogue.js';
import { latestExchange, recordDockLine } from '../../lib/message-stream.js';
import { useSpokenLines } from '../../lib/use-spoken-lines.js';
import type { CharacterFrameQueue } from '../../lib/character-frame-queue.js';
import type { FocusCoordinator, FocusSurfaceLease } from '../../lib/focus-coordinator.js';
import './character-dock.css';

/**
 * CharacterDock — the right rail as ONE carrier with two states (the design notes
 * §2, §6; the design notes with the team's 2026-09-19 merge).
 *
 *   collapsed — the avatar column, rendered by the UNCHANGED `CharacterRail`
 *               so its root class literal keeps a single owner (check:ux
 *               `visibility.rail-root-keeps-chrome`).
 *   expanded  — the selected character's portrait, a compact scrollback and a
 *               one-line input, stacked UNDER the same column.
 *
 * It is non-modal on purpose: the canvas stays live behind it, so the dock does
 * NOT claim the `character-dialogue` focus owner (that owner means "the stage
 * has the floor" and refuses dice/radial — the design notes + overlay-admission). It
 * registers a `workspace` surface instead, which is what gives it Escape.
 *
 * Mutual exclusion (the design notes: only one listener at a
 * time) is a window-level capture `pointerdown`: a press outside this root
 * collapses the dock. Pressing the writer FAB therefore collapses it, pressing
 * an avatar inside it does not, and pressing the canvas collapses it — one rule
 * instead of three call sites. The same pattern the reading paper uses.
 */

/**
 * The id the follow invitation is spoken under. Negative on purpose: the
 * scrollback's own ids count up from 1, so this can never collide with a real
 * line and the speaker's "already said this one" set stays correct.
 */
const INVITE_LINE_ID = -1;

export interface CharacterDockProps extends CharacterRailProps {
  /**
   * Who the dock is ABOUT. Not the same question as whether the stage is open:
   * a companion the player collapsed is still their companion, and keeping
   * them here is what keeps their scrollback alive
   *
   * null = this world has nobody by default.
   */
  active: {
    id: string;
    name?: string;
    avatar?: string;
    avatarVideo?: string;
    bio?: string;
    emotions?: Record<string, string>;
    /** DashScope voice from the character's frontmatter; undefined → server default. */
    voice?: string;
  } | null;
  /** Canonical active save path from `WorldLoadResult.path`; null during a switch. */
  worldPath?: string | null;
  /**
   * The whole conversation lives in the message drawer: the
   * stage keeps only the latest exchange and offers this to read the rest.
   */
  onOpenStream?(): void;
  /** World content language for `/api/tts`, the same value the modal sends. */
  language?: string;
  /**
   * Whether the stage is open. Collapsing is not forgetting: `active` survives
   * it, so clicking the same companion again reopens the conversation they were
   * already having rather than an empty box.
   */
  expanded?: boolean;
  /** Collapse the dock (App releases the dialogue lane). */
  onClose(): void;
  /** `character_prompt` payload; App wraps it in the message type (unchanged). */
  onSendMessage(text: string): void;
  effectsEnabled?: boolean;
  frameQueue?: CharacterFrameQueue;
  focus?: FocusCoordinator;
  /** Roots that must not collapse the dock when pressed (e.g. the writer FAB). */
  /** Presses inside these (the writer) always collapse the stage. */
  closeFor?: React.RefObject<HTMLElement | null>[];
  /**
   * The companion: stays put through presses elsewhere (only `closeFor` moves
   * them). Anyone else opened for a word collapses on any press outside the dock.
   */
  stayOnStage?: boolean;
  /**
   * The tutorial's own 「跟我来」
   * offered for the companion when no authored invitation
   * is on screen, so every world has something for the follow step to point at.
   * Same mechanism as accepting the invitation (`setFollowing(id, true)`).
   */
  followOffer?: { pending: boolean; onAccept(): void } | null;
  /**
   * ANY character turn has just settled — not only the first act's.
   *
   * Separate from `opening.onAnswered` on purpose: that one is the save's
   * marker and must fire only while the act is awaiting its answer, whereas
   * the onboarding guide's first step is cleared by any answer at all, so a
   * player whose save has no greeter still gets past it.
   */
  onCharacterAnswered?(): void;
  /**
   * A line to put in an EMPTY reply box — the forced tutorial's first line
   *.
   * Filled once when it arrives (or when the dock turns to someone else while
   * it stands), selected so the player sees it is theirs to send or change;
   * never written over anything the player typed. null / absent: no prefill.
   */
  prefill?: string | null;
  /**
   * Tappable first replies (world.json `opening.replies`, the design notes): shown above the reply box while the
   * greeting waits for its answer; a tap SENDS that line (no keyboard). Typing stays possible.
   */
  replies?: readonly string[] | null;
  /** Other one-tap moves above the reply box (the prologue's chips, the design notes). Shown when no reply is. */
  chips?: React.ReactNode;
  /**
   * The character's bubble: written lines to SAY to whoever is on stage, then 「再生成一批」.
   * When given (even empty), it replaces `chips`. A tap sends the line; `onLineSaid` lets App mark it used.
   */
  lines?: readonly LineChip[] | null;
  onLineSaid?(line: LineChip, generated: boolean): void;
  /** 「再生成一批」: how to ask (the dock adds the last lines of this conversation), or why not (`locked`). */
  regenerate?: { request(recent: { who: 'player' | 'character'; text: string }[], signal: AbortSignal): Promise<string[]>; locked: string | null } | null;
  /** The place on screen: a new place drops every generated batch. */
  place?: string;
  /** The companion's written hint of this beat: one ✦ line under the conversation. */
  nudge?: { id: string; text: string } | null;
  /** Say this line now (a line picked from the rail's hover bubble); `key` makes it once. */
  sayNow?: { key: string; character: string; text: string } | null;
  onSaidNow?(key: string): void;
  /**
   * In place of the replies, the chips AND the reply box: the first run's sign-in card — the
   * greeter's line stays readable, nothing can be sent until the player signs in.
   */
  gate?: React.ReactNode;
  /**
   * The first act. `line` is the greeter's author-written
   * opening, seeded as their first bubble before any agent exists. `narration`
   * is the same beat for a world with nobody to speak — the narrator's voice,
   * above the avatars, with no portrait and no reply box.
   *
   * `coach` shows the one hint of the whole first act, attached to the reply
   * box it is about. `awaitingAnswer` means the player has replied and the
   * character's first answer is on its way: when it lands, `onAnswered` fires
   * once, which is what ends the act and writes the save's marker.
   *
   * `invite` is the follow invitation — a line in the conversation, not a step:
   * it arrives after that first answer with its two controls inline.
   */
  opening?: {
    line?: string | null;
    narration?: string | null;
    coach?: boolean;
    awaitingAnswer?: boolean;
    onAnswered?(): void;
    invite?: string | null;
    onAcceptFollow?(): void;
    onDeclineFollow?(): void;
  } | null;
}

export function CharacterDock({
  active,
  language = 'en',
  worldPath = null,
  expanded = false,
  onClose,
  onSendMessage,
  effectsEnabled = false,
  frameQueue,
  focus,
  closeFor,
  stayOnStage = false,
  opening,
  followOffer = null,
  onCharacterAnswered,
  prefill = null,
  replies = null,
  chips = null,
  gate = null,
  lines = null,
  onLineSaid,
  regenerate = null,
  place = '',
  nudge = null,
  sayNow = null,
  onSaidNow,
  onOpenStream,
  ...railProps
}: CharacterDockProps): React.ReactElement {
  const { t, locale } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  const [draft, setDraft] = useState('');
  const [portraitFailed, setPortraitFailed] = useState(false);
  const dialogue = useCharacterDialogue(active?.id ?? null, frameQueue, opening?.line, worldPath);
  // Every settled line goes to the message drawer; the stage shows the latest exchange only.
  const speakerId = active?.id ?? null;
  useEffect(() => {
    if (!speakerId) return;
    for (const line of dialogue.lines) {
      if (line.pending || line.notice) continue;
      recordDockLine(speakerId, line);
    }
  }, [dialogue.lines, speakerId]);
  const shownLines = latestExchange(dialogue.lines);
  const hiddenLines = dialogue.lines.length - shownLines.length;

  /**
   * The follow invitation is the character's SECOND line, so
   * it is spoken like one
   * It is RENDERED outside the scrollback because its two buttons hang
   * off it, which is exactly why it has to be handed to the speaker by name —
   * otherwise the one line that asks the player a direct question is the one
   * line they never hear.
   *
   * The id is a constant outside the scrollback's own counter, so it is spoken
   * once and never collides with a real line.
   */
  const spokenLines = useMemo(() => (opening?.invite
    ? [...dialogue.lines, {
      id: INVITE_LINE_ID,
      who: 'character' as const,
      text: opening.invite,
      // `normal`, not the scrollback's current mood: this is AUTHORED text, and
      // a fixed mood is also what lets it be synthesised ahead of time and
      // still be the same cache entry when it is finally spoken.
      emo: 'normal' as const,
      pending: false,
    }]
    : dialogue.lines), [dialogue.lines, opening?.invite]);

  /**
   * Synthesise the author-written lines before they are needed
   *
   *
   * Both lines of the first act are written in the character's files, so both
   * texts exist the moment the world opens. Only the INVITATION is warmed: the
   * greeting is spoken the instant the dock appears, so asking for it early
   * would be the same request twice rather than earlier. The invitation is a
   * whole conversational turn away — long enough to have it ready, which is the
   * difference between it answering the player and it pausing at them.
   *
   * This warms the SAME `/api/tts` cache the speaker will ask, through the SAME
   * request function, so the ask that plays it is a cache hit. Nothing plays here.
   */
  const prefetch = useMemo(
    () => (typeof opening?.invite === 'string' && opening.invite.trim() !== '' ? [opening.invite] : []),
    [opening?.invite],
  );

  /**
   * The dock has a voice. Every character line is spoken as
   * it settles — the SEEDED greeting included, because a silent opening is
   * exactly what left the player with no reason to type. The player's own lines
   * are never spoken, and a line queued for one character is dropped rather
   * than played after a switch (`lib/use-spoken-lines.ts`). Mute and the TTS
   * switch are honoured inside that path, not re-checked here.
   */
  /** The stage is open only when there is someone on it AND it was opened. */
  const onStage = active !== null && expanded;
  /** Names the narration fallback may see as "the speaker", memoised for the hook. */
  const speakerNames = useMemo(() => [active?.name], [active?.name]);
  // Each character has their own queue: collapsing the dock or turning to
  // someone else stops THIS character at once, and nobody else carries on with
  // their lines; the previous character's scrollback, still
  // in state for the one render a switch takes, is never voiced as the new one.
  const voiceLine = useSpokenLines({
    characterId: active?.id ?? null,
    worldPath,
    lines: spokenLines,
    voice: active?.voice,
    language,
    names: speakerNames,
    open: onStage,
    prefetch,
  });
  useStopVoiceOnEscape(rootRef, onStage && voiceLine.speaking, voiceLine.stop);

  /**
   * The call, read from the ONE store (the design notes: at most one
   * call exists process-wide). The dock holds no call state of its own — it
   * owns a door, not a session — and `dock:<id>` as the owner is what keeps
   * hanging up here from ending a call the rail started.
   */
  const call = useLiveCallState();
  const callAvailable = useLiveCallAvailable();
  const { start: callStart, stop: callStop } = useLiveCallActions();
  const dockCallOwner = active ? `dock:${active.id}` : null;
  const callLive = call.phase === 'connecting' || call.phase === 'live';
  const dockOnCall = callLive && call.owner === dockCallOwner;
  /** Someone else's call is running: ours is neither startable nor ours to end. */
  const callBusyElsewhere = callLive && call.owner !== dockCallOwner;

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const requestClose = useCallback(() => {
    const lease = leaseRef.current;
    // Mark first so Escape and a press cannot both dispatch, but never let a
    // stale lease swallow the gesture: `onClose` is idempotent.
    lease?.markClosing();
    closeRef.current();
  }, []);
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => setPortraitFailed(false), [active?.id]);
  // Focus follows the OPENING of the stage, not the arrival of a subject: a
  // companion who is merely present must not steal the caret from the canvas.
  useEffect(() => { if (active && expanded) inputRef.current?.focus(); }, [active?.id, expanded]);
  useEffect(() => { setDraft(''); }, [active?.id]);
  // After the reset above (same commit, queued in order): the tutorial's line
  // goes into an empty box only.
  const prefilledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!prefill || !active) return;
    setDraft(current => {
      if (current.trim()) return current;
      prefilledRef.current = prefill;
      return prefill;
    });
  }, [prefill, active?.id]);
  // With the opening's reply chips on screen the chips ARE the first line (one of them says the same thing):
  // no untouched copy of it waits in the box as well.
  const hasReplies = Boolean(replies && replies.length > 0);
  useEffect(() => {
    if (hasReplies && prefill) setDraft(current => (current === prefill ? '' : current));
  }, [hasReplies, prefill]);
  // Select it once the box is on screen, so it reads as editable.
  useEffect(() => {
    const input = inputRef.current;
    if (!input || !expanded || !prefill || prefilledRef.current !== prefill || draft !== prefill) return;
    prefilledRef.current = null;
    input.focus();
    input.select();
  }, [draft, prefill, expanded]);

  /**
   * The first answer ends the first act. Watch the phase
   * rather than the line count: an `error` / `turn_aborted` frame also returns
   * to `idle`, and a greeting the player answered has been answered even when
   * the agent failed — replaying it next time would be the wrong correction.
   */
  const awaitingAnswer = opening?.awaitingAnswer === true;
  const onAnsweredRef = useRef(opening?.onAnswered);
  onAnsweredRef.current = opening?.onAnswered;
  const answerPhaseRef = useRef(dialogue.phase);
  // The guide's copy of the same edge, without the act's gate: any settled turn
  // means the player has been answered, which is what its first step waits for.
  const onCharacterAnsweredRef = useRef(onCharacterAnswered);
  onCharacterAnsweredRef.current = onCharacterAnswered;
  useEffect(() => {
    const was = answerPhaseRef.current;
    answerPhaseRef.current = dialogue.phase;
    if (awaitingAnswer && was !== 'idle' && dialogue.phase === 'idle') onAnsweredRef.current?.();
    if (was !== 'idle' && dialogue.phase === 'idle') onCharacterAnsweredRef.current?.();
  }, [awaitingAnswer, dialogue.phase]);
  // Newest line stays in view without moving the canvas.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dialogue.lines, dialogue.phase]);

  // Escape closes the expanded state before the layer-back gesture.
  // Only the OPEN stage owns a surface — a present-but-collapsed companion has
  // nothing for Escape to close, and registering for them would make Escape
  // stop reaching the layer-back gesture for the rest of the session.
  useEffect(() => {
    if (!active || !expanded || !focus) return;
    const lease = focus.registerSurface({
      key: `character-dock:${active.id}`,
      owner: 'workspace',
      priority: 500,
      root: rootRef.current,
      close: () => closeRef.current(),
    });
    leaseRef.current = lease;
    return () => {
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.unregister();
    };
  }, [active?.id, expanded, focus]);

  // The companion stays on stage while the player plays: pressing the canvas,
  // a card, the map or the rail no longer sends them away
  // Only turning
  // to the writer — a press inside `closeFor` — collapses the stage; the close
  // button and Escape still work as before.
  useEffect(() => {
    if (!active || !expanded) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (closeFor?.some(ref => ref.current?.contains(target))) { requestCloseRef.current(); return; }
      if (stayOnStage) return;
      if (rootRef.current?.contains(target)) return;
      requestCloseRef.current();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [active?.id, expanded, closeFor, stayOnStage]);

  const send = (): void => sendText(draft, true);
  const sendText = (raw: string, fromDraft = false): void => {
    const text = raw.trim();
    if (text === '' || dialogue.phase !== 'idle') return;
    // A chip or a line sent while the box still holds the untouched tutorial line: that line is spent too.
    if (fromDraft || (prefill && draft === prefill)) setDraft('');
    if (nudge) setNudgeSeen(nudge.id);
    // A new line to the same character interrupts what they were still saying.
    voiceLine.stop();
    dialogue.pushPlayerLine(text);
    onSendMessage(text);
  };

  const displayName = active?.name || active?.id || '';
  const busy = dialogue.phase !== 'idle';

  // 「再生成一批」 for whoever is on stage: the request carries the last lines of THIS conversation.
  const linesRef = useRef(dialogue.lines);
  linesRef.current = dialogue.lines;
  const regenRef = useRef(regenerate);
  regenRef.current = regenerate;
  const requestBatch = useCallback((signal: AbortSignal) => {
    const recent = linesRef.current.filter((l) => !l.notice && !l.pending && l.text.trim()).slice(-6)
      .map((l) => ({ who: l.who === 'player' ? 'player' as const : 'character' as const, text: l.text }));
    return regenRef.current ? regenRef.current.request(recent, signal) : Promise.reject(new Error('unavailable'));
  }, []);
  const batch = useLineBatch(active?.id ?? null, place, regenerate ? requestBatch : null, regenerate?.locked ?? null);

  // The hint stays under the conversation until the player answers anything.
  const [nudgeSeen, setNudgeSeen] = useState<string | null>(null);
  const showNudge = nudge && nudge.id !== nudgeSeen ? nudge : null;

  // A line picked from the rail's bubble: said once the stage is open on that person and free.
  const saidNowRef = useRef<string | null>(null);
  const saidNowCb = useRef(onSaidNow);
  saidNowCb.current = onSaidNow;
  useEffect(() => {
    if (!sayNow || !active || !expanded || active.id !== sayNow.character || dialogue.phase !== 'idle') return;
    if (saidNowRef.current === sayNow.key) return;
    saidNowRef.current = sayNow.key;
    sendText(sayNow.text);
    saidNowCb.current?.(sayNow.key);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sayNow?.key, active?.id, expanded, dialogue.phase]);
  const emotionStill = active?.emotions?.[dialogue.emo];

  return (
    <div
      ref={rootRef}
      className={`character-dock${onStage ? ' character-dock--expanded' : ''}`}
      data-dock-state={onStage ? 'expanded' : 'collapsed'}
      /* Who the dock is about, even collapsed — the companion is still here. */
      data-dock-subject={active?.id}
    >
      {/* A world with nobody to speak still opens: the line
          arrives in the narrator's voice, above the avatars, with no portrait
          and no reply box — there is no one to reply to. */}
      {opening?.narration && (
        <p className="character-dock__narration" role="note">{opening.narration}</p>
      )}

      <CharacterRail {...railProps} />

      {onStage && (
        <section
          className="character-dock__stage"
          aria-label={t('Talk to {name}', { name: displayName })}
        >
          {/* The cut-out stands in the scene, behind the words and deaf to the
              pointer: a press here belongs to the canvas, not to a panel. */}
          <div className={`character-dock__portrait emo-${dialogue.emo}`} aria-hidden="true">
            {emotionStill && !portraitFailed ? (
              <img
                className="character-dock__still"
                src={emotionStill}
                alt=""
                onError={() => setPortraitFailed(true)}
              />
            ) : active.avatar && !portraitFailed ? (
              <MotionPortrait
                video={active.avatarVideo}
                poster={active.avatar}
                enabled={effectsEnabled}
                name={displayName}
                onPosterError={() => setPortraitFailed(true)}
              />
            ) : (
              <div className="character-dock__monogram">
                {(active.id.charAt(0) || '?').toUpperCase()}
              </div>
            )}
          </div>

          <header className="character-dock__head">
            <h2 className="character-dock__name">{displayName}</h2>
            <button
              type="button"
              className="character-dock__collapse"
              onClick={requestClose}
              aria-label={t('Close dialog')}
            >
              ×
            </button>
          </header>

          <div className="character-dock__lines" ref={scrollRef} role="log" aria-live="polite">
            {dialogue.lines.length === 0 && dialogue.phase === 'idle' && (
              <p className="character-dock__hint">{t('Say something to {name}…', { name: displayName })}</p>
            )}
            {/* Earlier lines are in the message drawer, one tap away. */}
            {hiddenLines > 0 && onOpenStream && (
              <button type="button" className="character-dock__earlier" data-testid="dock-earlier" onClick={onOpenStream}>
                {t('Earlier lines · {count}', { count: hiddenLines })}
              </button>
            )}
            {shownLines.map(line => (
              <p
                key={line.id}
                className={`character-dock__line character-dock__line--${line.who}`}
                data-pending={line.pending ? 'true' : undefined}
                data-notice={line.notice ? 'true' : undefined}
              >
                {line.notice ? t(line.text) : line.who === 'character' ? <NarratedText text={line.text} names={speakerNames} /> : line.text}
              </p>
            ))}
            {dialogue.phase === 'thinking' && (
              <p className="character-dock__thinking">{t('{name} is thinking…', { name: displayName })}</p>
            )}
            {/* The companion's written hint: said as written, no model call. */}
            {showNudge && dialogue.phase === 'idle' && (
              <p className="character-dock__line character-dock__line--character character-dock__nudge" data-testid="dock-nudge" data-hint={showNudge.id}>
                <span className="character-dock__nudge-mark" aria-hidden="true">✦</span>
                <NarratedText text={showNudge.text} names={speakerNames} />
              </p>
            )}

            {/* The follow invitation is the character's SECOND line, not a step
                : it sits in the scrollback where they said it,
                with its two controls attached. Declining sends NOTHING — the
                rail's own follow toggle stays, so "not now" never means
                "never". */}
            {opening?.invite && (
              <div className="character-dock__invite">
                <p className="character-dock__line character-dock__line--character"><NarratedText text={opening.invite} names={speakerNames} /></p>
                <div className="character-dock__invite-actions">
                  <button
                    type="button"
                    className="character-dock__invite-accept"
                    data-tutorial="follow"
                    onClick={() => opening.onAcceptFollow?.()}
                  >
                    {t('Come with me')}
                  </button>
                  <button
                    type="button"
                    className="character-dock__invite-decline"
                    onClick={() => opening.onDeclineFollow?.()}
                  >
                    {t('Not just now')}
                  </button>
                </div>
              </div>
            )}
            {!opening?.invite && followOffer && (
              <div className="character-dock__invite-actions">
                <button
                  type="button"
                  className="character-dock__invite-accept"
                  data-tutorial="follow"
                  disabled={followOffer.pending}
                  onClick={() => followOffer.onAccept()}
                >
                  {t('Come with me')}
                </button>
              </div>
            )}
          </div>

          {/* The whole tutorial: one sentence, on the thing it is about
              . It leaves on the first reply and never returns
              for this save. */}
          {opening?.coach && !gate && (
            <p className="character-dock__coach" role="note">{t('Say something back — that is how it starts.')}</p>
          )}

          {gate ? gate : (
          // The chips and the reply box as one block: while the opening's replies show, the forced tutorial's
          // 「speak」 step lights this whole block, so a tap on a chip is as much the first line as Enter is; the
          // four-step guide's 「speak」 bubble anchors on it too (first match in the document), so it sits above the
          // chips instead of covering them.
          <div className="character-dock__reply" data-tutorial={replies && replies.length > 0 ? 'speak-replies' : undefined} data-guide-target={replies && replies.length > 0 ? 'speak' : undefined}>
          {replies && replies.length > 0 ? (
            <div className="reply-chips" role="group" data-testid="opening-replies">
              {replies.map((line) => (
                <button key={line} type="button" className="reply-chip" disabled={busy} onClick={() => sendText(line)}>{line}</button>
              ))}
            </div>
          ) : lines !== null ? (
            <LineChips
              lines={lines}
              batch={regenerate ? batch : null}
              busy={busy}
              onSay={(line, generated) => {
                if (generated) batch.spend(line.key);
                sendText(line.say);
                onLineSaid?.(line, generated);
              }}
            />
          ) : chips}

          {/* What the guide's first step points at: the reply
              box itself, marked here so the guide never learns a class name. */}
          <div className="character-dock__input-row" data-guide-target="speak" data-tutorial="speak">
            <input
              ref={inputRef}
              type="text"
              className="character-dock__input"
              value={draft}
              disabled={busy}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (guardImeKey(event)) return;
                if (event.key === 'Enter') { event.preventDefault(); send(); }
              }}
              placeholder={t('Say something to {name}…', { name: displayName })}
              aria-label={t('Say something to {name}…', { name: displayName })}
            />
            {voiceLine.speaking && (
              <StopVoiceButton onStop={voiceLine.stop} label={t('Stop {name} speaking', { name: displayName })} />
            )}
            <VoiceInputButton disabled={busy} getDraft={() => draft} onDraft={setDraft} />
            {/* The writer's send pill: same `send` as Enter. It sits inside the
                speak step's highlighted row, so the forced tutorial's prefilled
                first line can be sent by tapping it. */}
            <SendButton
              className="character-send"
              label={t('Send to {name}', { name: displayName })}
              disabled={busy || draft.trim() === ''}
              onSend={send}
            />
            {/* The call, out where the conversation is
                It used to
                live only inside an avatar's hover menu, which is two gestures
                away from the person you are already talking to. Same store, same
                one-call-at-a-time rule as the rail's entry — this is a second
                DOOR, never a second call. The owner keeps them apart so hanging
                up here cannot end a call the rail started. */}
            {callAvailable && active && (
              <button
                type="button"
                className={`character-dock__call is-${call.phase}`}
                onClick={() => (dockOnCall
                  ? void callStop(`dock:${active.id}`)
                  : void callStart({ characterId: active.id, locale: locale === 'ja' || locale === 'ko' ? locale : 'en', uiLocale: locale, owner: `dock:${active.id}`, savePath: worldPath ?? '' }))}
                // A call someone ELSE owns is not ours to hang up, and starting a
                // second one is refused by the store anyway — say so on the button
                // instead of letting the click fail silently.
                disabled={callBusyElsewhere || (!dockOnCall && !worldPath)}
                aria-label={dockOnCall ? t('Hang up') : t('Start a call')}
                title={dockOnCall ? t('Hang up') : t('Start a call')}
              >
                {dockOnCall ? <PhoneOff aria-hidden="true" /> : <Phone aria-hidden="true" />}
              </button>
            )}
          </div>
          </div>
          )}
        </section>
      )}
    </div>
  );
}
