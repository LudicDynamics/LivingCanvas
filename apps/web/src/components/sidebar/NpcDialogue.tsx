import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { guardImeKey } from '../../lib/ime.js';
import { airpGateway, AirpRequestError } from '../../lib/airp-gateway.js';
import { SendButton } from '../chrome/SendButton.js';
import { useSpokenLines } from '../../lib/use-spoken-lines.js';
import { NarratedText, StopVoiceButton, useStopVoiceOnEscape } from '../chrome/SpeakerControls.js';
import {
  NPC_TALK_EVENT,
  npcInitial,
  npcLineId,
  npcSpeakableLines,
  npcTalkTarget,
  type NpcTalkRequest,
  type NpcTalkTarget,
} from '../../lib/npc-dialogue.js';
import type { FocusCoordinator } from '../../lib/focus-coordinator.js';
import { LineChips, useLineBatch } from './LineChips.js';
import { latestExchange, messageStream } from '../../lib/message-stream.js';
import './character-dock.css';

/**
 * NpcDialogue — talking to an NPC card.
 *
 * The same stage as the companion dock (its stylesheet and class names), minus
 * everything that belongs to a CHARACTER: no rail, no follow, no call, no agent.
 * Each line goes to `POST /api/npc/talk`, where the writer answers in the NPC's
 * voice; the exchange is recorded on the card, so reopening it after a reload
 * shows the conversation where it was left.
 *
 * Mounted once by App. It opens on the `airp:npc-talk` window event that the
 * card's 「对话」 button raises (lib/npc-dialogue.ts).
 */
export interface NpcDialogueHostProps {
  /** World content language for `/api/tts` (same value the dock sends). */
  language: string;
  focus?: FocusCoordinator;
  /** The stage shares the right column with the companion; App hides theirs while this is open. */
  onOpenChange?(open: boolean): void;
  /** The layer on screen (for 「再生成一批」's context; a new place drops the batch). */
  layer?: string;
  /** Why 「再生成一批」 is grey (a guest), or null. Absent `layer` = no chip at all. */
  regenLocked?: string | null;
  /** The drawer or the writer owns the screen now: the stage hides, the talk stays open. */
  yielded?: boolean;
}

type Notice = { text: string; kind: 'error' | 'gift' };

export function NpcDialogueHost({ language, focus, onOpenChange, layer, regenLocked = null, yielded = false }: NpcDialogueHostProps): React.ReactElement | null {
  const { t } = useLocale();
  const [target, setTarget] = useState<NpcTalkTarget | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [portraitFailed, setPortraitFailed] = useState(false);
  /** Line ids already on the card when it was opened: never read aloud again. */
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set());
  const rootRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTarget(null);
    setBusy(false);
    setNotice(null);
  }, []);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onTalk = (event: Event): void => {
      const next = npcTalkTarget((event as CustomEvent<NpcTalkRequest>).detail);
      if (!next) return;
      abortRef.current?.abort();
      abortRef.current = null;
      setTarget(next);
      setSeen(new Set(next.dialogue.map(npcLineId)));
      setDraft('');
      setBusy(false);
      setNotice(null);
      setPortraitFailed(false);
    };
    window.addEventListener(NPC_TALK_EVENT, onTalk);
    return () => window.removeEventListener(NPC_TALK_EVENT, onTalk);
  }, []);

  const open = target !== null;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => { onOpenChangeRef.current?.(open); }, [open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open, target?.path]);
  // Every line of the talk goes to the message drawer; the stage keeps the latest exchange.
  useEffect(() => {
    if (!target) return;
    target.dialogue.forEach((line, index) => {
      const text = line.text.trim();
      if (!text) return;
      messageStream.record({
        id: `npc:${target.path}:${index}:${text.slice(0, 24)}`,
        kind: line.by === 'player' ? 'you' : 'character',
        name: target.name,
        text,
      });
    });
  }, [target?.dialogue, target?.path, target?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [target?.dialogue, busy, notice]);

  // Escape closes it before the layer-back gesture, like the dock.
  useEffect(() => {
    if (!target || !focus) return;
    const lease = focus.registerSurface({
      key: `npc-dialogue:${target.path}`,
      owner: 'workspace',
      priority: 500,
      root: rootRef.current,
      close: () => closeRef.current(),
    });
    return () => lease.unregister();
  }, [target?.path, focus]);

  // A press anywhere else ends the conversation (the card can be clicked again).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const node = event.target as Node | null;
      if (node && rootRef.current?.contains(node)) return;
      closeRef.current();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const spoken = useMemo(() => (target ? npcSpeakableLines(target.dialogue, seen) : []), [target, seen]);
  const speakerNames = useMemo(() => [target?.name], [target?.name]);
  const voiceLine = useSpokenLines({
    characterId: target ? `npc:${target.path}` : null,
    lines: spoken,
    voice: target?.voice,
    language,
    names: speakerNames,
  });
  useStopVoiceOnEscape(rootRef, voiceLine.speaking, voiceLine.stop);

  // The NPC's own bubble: the card's written lines, then 「再生成一批」. Said lines leave it.
  const [saidLines, setSaidLines] = useState<ReadonlySet<string>>(() => new Set());
  const dialogueRef = useRef(target?.dialogue ?? []);
  dialogueRef.current = target?.dialogue ?? [];
  const pathRef = useRef(target?.path ?? null);
  pathRef.current = target?.path ?? null;
  const requestBatch = useCallback((signal: AbortSignal) => {
    const npc = pathRef.current;
    if (!npc) return Promise.reject(new Error('closed'));
    const recent = dialogueRef.current.slice(-6).map((l) => ({ who: l.by === 'player' ? 'player' as const : 'character' as const, text: l.text }));
    return airpGateway.suggestReplies({ npc, layer, recent }, signal).then((r) => r.lines);
  }, [layer]);
  const batch = useLineBatch(target?.path ?? null, layer ?? '', layer !== undefined ? requestBatch : null, regenLocked);
  const written = (target?.replies ?? []).filter((l) => !saidLines.has(`${target?.path}:${l}`)).map((say) => ({ key: `npc:${target?.path}:${say}`, say }));

  const send = (override?: string): void => {
    const text = (override ?? draft).trim();
    if (!target || text === '' || busy) return;
    const path = target.path;
    if (override === undefined) setDraft('');
    setNotice(null);
    setBusy(true);
    // A new line interrupts what the NPC was still saying.
    voiceLine.stop();
    // Shown at once; the server's copy replaces it when the answer lands.
    setTarget(current => current && current.path === path
      ? { ...current, dialogue: [...current.dialogue, { by: 'player', text, at: new Date().toISOString() }] }
      : current);
    const controller = new AbortController();
    abortRef.current = controller;
    airpGateway.talkToNpc(path, text, controller.signal)
      .then(reply => {
        if (controller.signal.aborted) return;
        setTarget(current => current && current.path === path ? { ...current, dialogue: reply.dialogue } : current);
        if (reply.gives.length > 0) setNotice({ kind: 'gift', text: t('{name} handed something over.', { name: reply.name }) });
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        // No model on this computer: the settings notice (TtsSettings) says what to do.
        if (/No model is configured/.test(failure instanceof Error ? failure.message : String(failure))) {
          window.dispatchEvent(new CustomEvent('airp:model-unavailable'));
          setNotice({ kind: 'error', text: t('No model is set up yet. Add a model API key in Settings to talk to the characters.') });
          return;
        }
        const code = failure instanceof AirpRequestError ? failure.payload?.code : undefined;
        // The in-tab server lost the world: the page is reopening it (App.tsx), so "try again" would be false.
        if (code === 'no_active_world') {
          setNotice({ kind: 'error', text: t('The world connection dropped. Reopening it…') });
          return;
        }
        // One conversation per card at a time (engine/npc-talk.ts): the first answer is still coming.
        if (code === 'conflict') {
          setNotice({ kind: 'error', text: t('{name} is still answering.', { name: target.name }) });
          return;
        }
        setNotice({ kind: 'error', text: t('{name} did not answer. Try again.', { name: target.name }) });
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
        if (!controller.signal.aborted) setBusy(false);
      });
  };

  if (!target) return null;
  const avatar = target.avatar && !portraitFailed ? airpGateway.assetUrl(target.avatar, undefined, 'image') : null;

  return (
    <section
      ref={rootRef}
      className="character-dock__stage npc-dialogue"
      data-npc-path={target.path}
      hidden={yielded || undefined}
      aria-label={t('Talk to {name}', { name: target.name })}
    >
      <div className="character-dock__portrait emo-normal" aria-hidden="true">
        {avatar ? (
          <img className="character-dock__still" src={avatar} alt="" onError={() => setPortraitFailed(true)} />
        ) : (
          <div className="character-dock__monogram npc-dialogue__silhouette">{npcInitial(target.name)}</div>
        )}
      </div>

      <header className="character-dock__head">
        <h2 className="character-dock__name">{target.name}</h2>
        <button type="button" className="character-dock__collapse" onClick={close} aria-label={t('Close dialog')}>×</button>
      </header>

      <div className="character-dock__lines" ref={scrollRef} role="log" aria-live="polite">
        {target.dialogue.length === 0 && !busy && (
          <p className="character-dock__hint">{t('Say something to {name}…', { name: target.name })}</p>
        )}
        {latestExchange(target.dialogue.map((line, index) => ({ ...line, index, who: line.by === 'player' ? 'player' as const : 'character' as const }))).map(({ index, ...line }) => (
          <p key={`${index}-${line.at ?? ''}`} className={`character-dock__line character-dock__line--${line.by === 'player' ? 'player' : 'character'}`}>
            {line.by === 'player' ? line.text : <NarratedText text={line.text} names={speakerNames} />}
          </p>
        ))}
        {busy && <p className="character-dock__thinking">{t('{name} is thinking…', { name: target.name })}</p>}
        {notice && (
          <p className="character-dock__line character-dock__line--character" data-notice="true" role={notice.kind === 'error' ? 'alert' : 'status'}>
            {notice.text}
          </p>
        )}
      </div>

      <LineChips
        lines={written}
        batch={layer !== undefined ? batch : null}
        busy={busy}
        testId="npc-line-chips"
        onSay={(line, generated) => {
          if (generated) batch.spend(line.key);
          else setSaidLines((prev) => new Set(prev).add(`${target.path}:${line.say}`));
          send(line.say);
        }}
      />

      <div className="character-dock__input-row">
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
          placeholder={t('Say something to {name}…', { name: target.name })}
          aria-label={t('Say something to {name}…', { name: target.name })}
        />
        {voiceLine.speaking && (
          <StopVoiceButton onStop={voiceLine.stop} label={t('Stop {name} speaking', { name: target.name })} />
        )}
        <SendButton
          className="character-send"
          label={t('Send to {name}', { name: target.name })}
          disabled={busy || draft.trim() === ''}
          onSend={() => send()}
        />
      </div>
    </section>
  );
}
