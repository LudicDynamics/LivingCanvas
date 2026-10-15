import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MotionPortrait } from './MotionPortrait.js';
import { ActivityRail } from '../chrome/ActivityRail.js';
import { AgentActivityLog } from '../chrome/AgentActivityLog.js';
import { commitVoiceOutcomeIfCurrent, fetchVoiceUrl } from '../../lib/tts-request.js';
import { agentActivityStore } from '../../lib/agent-activity-store.js';
import { translate, useLocale, type Locale } from '../../lib/i18n.js';
import { guardImeKey } from '../../lib/ime.js';
import { VoiceInputButton } from '../chrome/VoiceInputButton.js';
import { SendButton } from '../chrome/SendButton.js';
import { playStinger, playVoice, stopVoice, unlock, type Emotion } from '../../lib/audio.js';
import { sanitiseTtsText } from '@airp/shared/tts-text';
import { NarratedText } from '../chrome/SpeakerControls.js';
import {
  clampPageIndex,
  charDelay,
  createCharacterTurn,
  consumeCharacterFrame,
  GREETING_LINE,
  parseEmoPages,
  resetCharacterTurn,
  type CharacterTurnBuffer,
  type DialoguePage,
} from './dialogue-pages.js';
import {
  getCharacterFrameQueue,
  type CharacterFrame,
  type CharacterFrameQueue,
  type CharacterFrameQueueEvent,
} from '../../lib/character-frame-queue.js';
import type { FocusCoordinator, FocusReturnHandle, FocusSurfaceLease } from '../../lib/focus-coordinator.js';
import {
  useLiveCallState,
  useLiveCallLines,
  useLiveCallActions,
  useLiveCallAvailable,
} from '../../lib/live-call.js';
import { LiveCallStatus } from '../live/LiveCallStatus.js';
import { LiveCallTranscript } from '../live/LiveCallTranscript.js';
import { StateLines } from '../chrome/StatePanels.js';
import { SheetBody } from '../chrome/CharacterSheet.js';
import type { SheetView, WorldSheets } from '../../lib/sheets.js';
import type { MappedState } from '../../lib/panels.js';
const STINGER_VOICE_GRACE_MS = 1200;
/**
 * CharacterModal — galgame dialogue overlay (wave 2 Task D T3.3; TTS pagination T1/03).
 *
 * Full rewrite from the v1 IM/bubble-transcript layout:
 *  - the canvas itself is dimmed + blurred behind a warm-ink tint (no black sheet)
 *  - a single bottom-pinned portrait slot with a shared safe baseline
 *  - a slightly tilted paper dialog at the bottom: current dialogue page,
 *    advance prompt, and a bottom input row that stays hidden until the
 *    pages are exhausted; identity/status lives in a separate sibling.
 *
 * No chat bubbles, no scrollable history, no HUD. The character's reply is
 * paginated one non-empty line per page (contract §6); each page types itself
 * out and speaks its own TTS line; the player clicks the stage to fast-forward
 * or advance, and the input only fades in once the last page has been reached.
 *
 * A3: the text comes from the real character agent. App
 * routes identity into the shared FIFO; this modal only drains that queue.
 * T1: the page split, per-page voice, click/keyboard advance
 * and the mock greeting are frozen in `the design notes`; pure helpers live in
 * `./dialogue-pages.js`.
 */

interface CharacterModalProps {
  characterId: string;
  displayName?: string;
  avatarVideo?: string;
  effectsEnabled?: boolean;
  avatar?: string;
  bio?: string;
  onClose: () => void;
  onOpenNook?: () => void;
  /** character_prompt protocol — the app wraps this in the message type; unchanged. */
  onSendMessage?: (msg: string) => void;
  /** Shared FIFO owner; App routes identity, this component only drains it. */
  frameQueue?: CharacterFrameQueue;
  /** Canonical active save from WorldLoadResult.path; null during a world switch. */
  worldPath?: string | null;
  /** Current world manifest.id for the `airp:greeted:<worldId>:<charId>` key segment. */
  worldId?: string;
  /** NEW: the character's DashScope voice (README frontmatter `voice`, via /api/characters). undefined → server default. */
  voice?: string;
  /** NEW: TTS request-body `language` — the world content language. Defaults to 'en'. */
  language?: string;
  /** Surface coordinator owned by App; this component never installs an Escape listener. */
  focus?: FocusCoordinator;
  /**
   * NEW: per-emotion portrait URLs. Present only when
   * the world ships all six; when set, the stage shows the matching still per
   * `[emo: tag]` instead of the single MotionPortrait clip.
   */
  emotions?: Record<string, string>;
  /** Declared states as the author's prose; hidden ones never arrive. */
  states?: MappedState[];
  /** This character's skill sheet, read-only; folded until asked. */
  sheet?: SheetView | null;
  sheetRules?: WorldSheets['rules'];
}


/**
 * 真实流缺席时的沉默兜底——一句诚实的"舞台指示"，绝不是伪造的角色台词。
 * 仅在发了 prompt 却整轮没有任何 delta/message（watchdog 超时）时用一次。
 */
const SILENCE_LINE: Record<Locale, { text: string; emo: Emotion }> = {
  en: { text: '[emo: sad] (She does not answer right now.)', emo: 'sad' },
  ja: { text: '[emo: sad] （今は、答えが返ってこない。）', emo: 'sad' },
  'zh-CN': { text: '[emo: sad] （此刻，没有回应。）', emo: 'sad' },
  ko: { text: '[emo: sad] (지금은 대답이 돌아오지 않는다.)', emo: 'sad' },
};

/** 服务端 turn 超时 90s（lifecycle） + 5s 余量：watchdog 只作最后兜底。 */
const TURN_WATCHDOG_MS = 95000;

/** Current on-stage performance: idle → thinking → streaming → done. */
type Phase = 'idle' | 'thinking' | 'streaming' | 'done';

/** Per-page TTS request lifecycle (contract §6.5 / §15.15 — `ready` is the
 *  observable proxy for "this page actually spoke"). */
type VoiceState = 'idle' | 'pending' | 'ready' | 'failed';

/** A dialogue page (contract §6.1) plus its voice request state. */
type StagePage = DialoguePage & { voiceUrl?: string; voiceState: VoiceState; voiceText?: string };


/** Grace window while a page's voice prefetch is still in flight, before the
 *  fallback stinger fires (contract §6.5; value is an inferred initial). */
export const CharacterModal: React.FC<CharacterModalProps> = ({
  characterId,
  displayName,
  avatarVideo,
  effectsEnabled = false,
  avatar,
  bio,
  onClose,
  onOpenNook,
  onSendMessage,
  frameQueue = getCharacterFrameQueue(),
  worldPath,
  worldId,
  voice,
  language = 'en',
  focus,
  emotions,
  states,
  sheet,
  sheetRules,
}) => {
  const { locale: uiLocale, t } = useLocale();
  // Every interface language (zh-CN / ko too, 2026-10-03): the modal's own copy goes through messages.json.
  const locale: Locale = uiLocale;
  const call = useLiveCallState();
  const lines = useLiveCallLines();
  const liveCallActions = useLiveCallActions();
  const liveCallAvailable = useLiveCallAvailable();
  /** The speaker, for the narration split: what reads as narration is never spoken (tts-text). */
  const speakerNames = useMemo(() => [displayName], [displayName]);
  /** The raw global snapshot. NOT an ownership test (contract 30 §2.2 冻结 1). */
  const callTransporting = call.phase === 'connecting' || call.phase === 'live';
  /** This paper speaks for THIS character only (contract 30 §4.2 冻结 7/7b). */
  const callActive = callTransporting && call.characterId === characterId;
  /**
   * This paper shows the call panel while the call is live **or errored**. The
   * error phase must stay on the call panel, otherwise its `role="alert"` would
   * vanish together with the layout (contract §9.1(a)); `callActive` alone hides
   * the alert. Ownership is per character, like the store snapshot (§4.1).
   */
  const callVisible = (callActive || call.phase === 'error') && call.characterId === characterId;
  const modeSwitchVisible = liveCallAvailable === true;
  /**
   * The alert text IS the store's error — derived, never copied into state: a
   * `useState` duplicate would be empty during a static render (effects never
   * run) and could drift from the snapshot.
   */
  const callAlert = call.error ?? '';
  const stopOwnedCall = useCallback(
    () => liveCallActions.stop('dialogue:' + characterId),
    [liveCallActions, characterId]
  );
  /** Unconditional: the dialogue hangs up the same character's call, whoever started it (§4.1). */
  const hangUp = useCallback(() => {
    void liveCallActions.stop();
  }, [liveCallActions]);
  const startDialogueCall = useCallback(() => {
    void liveCallActions.start({
      characterId,
      locale: uiLocale === 'ja' || uiLocale === 'ko' ? uiLocale : 'en',
      uiLocale,
      owner: 'dialogue:' + characterId,
      savePath: worldPath ?? '',
    });
  }, [liveCallActions, characterId, uiLocale, worldPath]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [emo, setEmo] = useState<Emotion>('normal');
  const [pages, setPages] = useState<DialoguePage[]>([]); // read-only projection of pagesRef
  const [pageIndex, setPageIndex] = useState(0); // render mirror of pageIndexRef
  const [pageShown, setPageShown] = useState(''); // prefix of the CURRENT page shown so far
  const [inputText, setInputText] = useState('');
  const [avatarError, setAvatarError] = useState(false);
  const [closing, setClosing] = useState(false);
  const dialogueScopeKey = JSON.stringify([worldPath ?? null, characterId]);
  const [renderScope, setRenderScope] = useState(dialogueScopeKey);
  const dialogueScopeRef = useRef(dialogueScopeKey);
  dialogueScopeRef.current = dialogueScopeKey;
  const renderScopeRef = useRef(renderScope);
  renderScopeRef.current = renderScope;
  const committedScopeRef = useRef(dialogueScopeKey);
  const characterIdRef = useRef(characterId);
  characterIdRef.current = characterId;
  const worldPathRef = useRef(worldPath);
  worldPathRef.current = worldPath;
  const scopeIsCurrent = useCallback(
    () => worldPathRef.current != null &&
      agentActivityStore.isSaveActive(worldPathRef.current) &&
      renderScopeRef.current === dialogueScopeRef.current,
    [],
  );
  const [activitySessionStartedAt, setActivitySessionStartedAt] = useState(() => Date.now());
  const modalRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  if (openerRef.current === null && typeof document !== 'undefined') {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body) openerRef.current = activeElement;
  }
  useEffect(() => {
    setActivitySessionStartedAt(Date.now());
  }, [characterId]);
  useEffect(() => {
    modalRef.current?.focus();
  }, []);

  const streamTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  /** Mirrors `callActive` (NOT `callVisible`): the gates ask "is a call transporting?".
   *  Assigned during render so the `useCallback` closures reading it never go stale. */
  const callActiveRef = useRef(false);
  const hangUpRef = useRef<HTMLButtonElement>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const turnBufferRef = useRef<CharacterTurnBuffer | null>(null); // turn/message aggregation truth
  const pagesRef = useRef<StagePage[]>([]); // 页数组（命令式真相源）
  const pageIndexRef = useRef(0); // 当前页下标，恒在 [0, max(0,len-1)]
  const pageShownRef = useRef(0); // 页内已显示字符数（取代旧的全局游标 shownRef）
  const voiceTurnRef = useRef(0); // turn 令牌：fetch 回来令牌变了就丢弃
  const mockRef = useRef(false); // 当前纸上是否为 mock 引导语页
  const mockSeededRef = useRef(false); // StrictMode 单实例只 seed 一次
  const stingerGraceRef = useRef<number | null>(null); // pending 语音的 stinger 宽限定时器
  const streamingRef = useRef(false);
  const messageEndedRef = useRef(false); // mock greeting compatibility; real turns close on idle
  const channelIdleRef = useRef(false); // received character_idle
  const finalRef = useRef(false); // true → final projection may seal its tail
  const phaseRef = useRef<Phase>('idle');
  const phaseBeforeTurnRef = useRef<Phase>('idle');
  const lastEmoRef = useRef<Emotion>('normal');
  const stingerFiredRef = useRef(false); // 当前页情绪音是否已了结（由语音取代或已响）
  const turnWatchdog = useRef<number | null>(null);
  const busyRef = useRef(false);
  const [queueVersion, setQueueVersion] = useState(0);
  const queueGapEventRef = useRef<Extract<CharacterFrameQueueEvent, { kind: 'gap' }> | null>(null);
  useEffect(
    () =>
      frameQueue.subscribe((event) => {
        if (event?.kind === 'gap') queueGapEventRef.current = event;
        setQueueVersion((version) => version + 1);
      }),
    [frameQueue]
  );

  const cancelStreamTimer = useCallback(() => {
    if (streamTimer.current !== null) window.clearTimeout(streamTimer.current);
    streamTimer.current = null;
  }, []);

  const clearWatchdog = useCallback(() => {
    if (turnWatchdog.current !== null) window.clearTimeout(turnWatchdog.current);
    turnWatchdog.current = null;
  }, []);

  const clearStingerGrace = useCallback(() => {
    if (stingerGraceRef.current !== null) window.clearTimeout(stingerGraceRef.current);
    stingerGraceRef.current = null;
  }, []);

  /** mood 变化时切立绘。stinger 不再由这里决定——它归 enterPage /
   *  onVoiceResolved / armStingerGrace 唯一裁定（contract §6.5）。 */
  const applyMood = useCallback((mood: Emotion) => {
    if (mood === 'thinking') return; // 揭幕期暂态，不发音、不换立绘
    if (mood !== lastEmoRef.current) {
      lastEmoRef.current = mood;
      setEmo(mood);
    }
  }, []);

  /** 末页封口 + 追平 + turn 终结 → 收工（contract §6.6。`pageIndex === last`
   *  是「页翻尽才放输入框」的机械落点）。 */
  const settleIfDrained = useCallback(() => {
    if (!channelIdleRef.current && !mockRef.current) return;
    const last = pagesRef.current.length - 1;
    const drained =
      last >= 0 &&
      pageIndexRef.current === last &&
      pagesRef.current[last].sealed &&
      pageShownRef.current >= pagesRef.current[last].text.length;
    if (!drained) return;
    streamingRef.current = false;
    clearWatchdog();
    setPhase('done');
  }, [clearWatchdog]);

  /** 泵：只读当前页，页内逐字推进（contract §6.3）。页数组由 syncPages 维护。 */
  const pump = useCallback(() => {
    if (streamTimer.current !== null) return; // 已有一步在排程
    const step = () => {
      if (streamTimer.current === null) return; // cancelled/unmounted
      const page = pagesRef.current[pageIndexRef.current];
      if (!page) {
        streamTimer.current = null;
        settleIfDrained();
        return;
      }
      applyMood(page.emo);
      if (pageShownRef.current >= page.text.length) {
        streamTimer.current = null;
        settleIfDrained();
        return;
      }
      const prev = page.text[pageShownRef.current];
      pageShownRef.current += 1;
      setPageShown(page.text.slice(0, pageShownRef.current));
      if (pageShownRef.current >= page.text.length) {
        streamTimer.current = null;
        settleIfDrained();
        return;
      }
      streamTimer.current = window.setTimeout(step, charDelay(prev)); // 韵律表原样复用
    };
    streamTimer.current = window.setTimeout(step, charDelay(''));
  }, [applyMood, settleIfDrained]);

  /** 语音结果落定：若正是当前页 → 播语音（有语音不响 stinger）；否则只预热。 */
  const onVoiceResolved = useCallback(
    (page: StagePage, i: number) => {
      if (!scopeIsCurrent()) return;
      if (pageIndexRef.current !== i) return; // 玩家已翻走 → 只预热，不播
      clearStingerGrace();
      if (page.voiceState === 'ready' && page.voiceUrl) {
        stopVoice();
        playVoice(page.voiceUrl); // 有语音 → 不响 stinger
        stingerFiredRef.current = true;
      } else if (!stingerFiredRef.current) {
        // 无语音（failed）→ 保留 stinger 作为情绪提示；mock 页不响
        stingerFiredRef.current = true;
        if (page.emo !== 'thinking' && !mockRef.current) playStinger(page.emo);
      }
    },
    [clearStingerGrace, scopeIsCurrent]
  );

  /** 页封口即预取（contract §6.5）：同页只发一次（voiceState 门）。
   *  网络那一半住在 lib/tts-request.ts（陪伴栏用的是同一条路径，不另开一条）；
   *  分页、voiceState 与 turn 令牌仍归本组件，契约不变。 */
  const prefetchVoice = useCallback(
    async (page: StagePage, i: number): Promise<void> => {
      if (!scopeIsCurrent()) return;
      if (page.voiceState !== 'idle') return; // 已 pending/ready/failed → 不重发
      const text = sanitiseTtsText(page.text, { names: speakerNames });
      page.voiceText = text;
      if (text === '') {
        page.voiceState = 'failed';
        onVoiceResolved(page, i);
        return;
      }
      page.voiceState = 'pending';
      const requestedText = text;
      const token = voiceTurnRef.current;
      const requestedCharacter = characterId;
      const requestedWorldPath = worldPath;
      if (requestedWorldPath == null) return;
      // Every await rechecks turn, actor, and save identity before it can publish audio.
      const stillValid = (): boolean =>
        token === voiceTurnRef.current &&
        scopeIsCurrent() &&
        characterIdRef.current === requestedCharacter &&
        worldPathRef.current === requestedWorldPath &&
        sanitiseTtsText(page.text, { names: speakerNames }) === requestedText;
      const outcome = await fetchVoiceUrl(
        { text, voice, language, savePath: requestedWorldPath, characterId, emotion: page.emo },
        stillValid,
      );
      const committed = commitVoiceOutcomeIfCurrent(outcome, stillValid, currentOutcome => {
        if (currentOutcome.status === 'failed') {
          page.voiceState = 'failed';
          onVoiceResolved(page, i);
          return;
        }
        page.voiceUrl = currentOutcome.url;
        page.voiceState = 'ready';
        onVoiceResolved(page, i); // 若正是当前页 → playVoice（truncated 不重试）
      });
      if (!committed) return;
    },
    [voice, language, characterId, worldPath, onVoiceResolved, scopeIsCurrent, speakerNames]
  );

  /** 语音在途 → 挂起 stinger，到点仍 pending 则响（contract §5.4）。 */
  const armStingerGrace = useCallback(
    (page: StagePage, i: number) => {
      clearStingerGrace();
      stingerGraceRef.current = window.setTimeout(() => {
        stingerGraceRef.current = null;
        if (!scopeIsCurrent() || pageIndexRef.current !== i || stingerFiredRef.current) return; // 已翻走、切档或已了结
        stingerFiredRef.current = true;
        if (!mockRef.current && page.emo !== 'thinking') playStinger(page.emo);
      }, STINGER_VOICE_GRACE_MS);
    },
    [clearStingerGrace, scopeIsCurrent]
  );

  /** 「一页成为当前页」的唯一动作点（contract §3.2）：翻页先打断上一句，
   *  再按该页语音状态发声，最后起逐字泵。 */
  const enterPage = useCallback(
    (i: number, opts: { announce: boolean }) => {
      if (!scopeIsCurrent()) return;
      const idx = clampPageIndex(i, pagesRef.current.length);
      pageIndexRef.current = idx;
      setPageIndex(idx);
      pageShownRef.current = 0;
      setPageShown('');
      const page = pagesRef.current[idx];
      stopVoice(); // 翻页先打断上一句（contract §6.5）
      if (!page) return;
      applyMood(page.emo);
      if (opts.announce) {
        if (page.voiceState === 'ready' && page.voiceUrl) {
          // 就绪 → 播语音、抑制 stinger。真实页与 mock 页走同一分支（§15.18）
          playVoice(page.voiceUrl);
          stingerFiredRef.current = true;
        } else if (page.voiceState === 'pending') {
          armStingerGrace(page, idx); // 在途 → 挂起；mock 页不因 mockRef 被排除
        } else if (!stingerFiredRef.current && page.emo !== 'thinking' && !mockRef.current) {
          // idle / failed 且非 mock 页 → 保留 stinger（§7.3：mock 页不响情绪音）
          stingerFiredRef.current = true;
          playStinger(page.emo);
        }
      }
      pump();
    },
    [applyMood, armStingerGrace, pump, scopeIsCurrent]
  );

  /** 分页与封口（唯一入口）：每次 turn projection 变化都调它。 */
  const syncPages = useCallback(
    (raw: string, opts: { final?: boolean; reset?: boolean }) => {
      const next = parseEmoPages(raw, { final: opts.final ?? false }).pages;
      if (opts.reset) {
        pagesRef.current = [];
        pageIndexRef.current = 0;
        pageShownRef.current = 0;
      }
      const list = pagesRef.current;
      const hadPages = list.length > 0; // capture before mutation: announce only on empty→non-empty
      if (list.length > next.length) list.length = next.length; // 权威文本可能让页数变少
      for (let i = 0; i < next.length; i++) {
        const np = next[i];
        const prev = list[i];
        if (!prev) {
          const fresh: StagePage = { text: np.text, emo: np.emo, sealed: np.sealed, voiceState: 'idle' };
          list.push(fresh);
          if (fresh.sealed && !callActiveRef.current) void prefetchVoice(fresh, i); // 页封口即预取
          continue;
        }
        if (np.text !== prev.text) {
          prev.text = np.text;
          prev.emo = np.emo;
          // Any text correction invalidates the prior request, whether the
          // page was already sealed or was still being projected.
          prev.voiceUrl = undefined;
          prev.voiceText = undefined;
          prev.voiceState = 'idle';
          if (np.sealed) {
            if (!callActiveRef.current) void prefetchVoice(prev, i);
            if (pageIndexRef.current === i) enterPage(i, { announce: false }); // 重驱当前页
          }
        }
        if (prev.sealed !== np.sealed) {
          prev.sealed = np.sealed;
          if (np.sealed && prev.voiceState === 'idle' && !callActiveRef.current) void prefetchVoice(prev, i);
        }
      }
      const snapshot: DialoguePage[] = list.map((p) => ({ text: p.text, emo: p.emo, sealed: p.sealed }));
      setPages(snapshot);
      // 页从空变非空且本 turn 在演 → 落在第 0 页（reset 路径自带显式 enterPage）。
      // 只在真正的「空→非空」跃迁时 announce，避免 delta 连发时重复 stopVoice/重播。
      if (!opts.reset && !hadPages && list.length > 0 && streamingRef.current) {
        enterPage(0, { announce: true });
      }
    },
    [enterPage, prefetchVoice]
  );

  /** 揭幕：清缓冲、进 thinking、起 100–400ms 沉思窗，然后开始泵。 */
  const beginStream = useCallback(() => {
    streamingRef.current = true;
    messageEndedRef.current = false;
    channelIdleRef.current = false;
    finalRef.current = false;
    stingerFiredRef.current = false;
    turnBufferRef.current = resetCharacterTurn();
    pageShownRef.current = 0;
    voiceTurnRef.current += 1; // 新 turn：作废在途的语音结果
    setPageShown('');
    setPhase('thinking');
    setEmo('thinking');
    lastEmoRef.current = 'thinking';
    const thinkMs = 100 + Math.random() * 300; // 100–400ms "陷入沉思"
    streamTimer.current = window.setTimeout(() => {
      streamTimer.current = null;
      setPhase('streaming');
      pump();
    }, thinkMs);
  }, [pump]);

  /** 点击/空格推进（contract §6.4）：未出完 → 快进；已完整 → 下一页；末页 → 钳制。 */
  const advance = useCallback(() => {
    if (closing || phaseRef.current === 'thinking') return; // 沉思期无页可推
    const page = pagesRef.current[pageIndexRef.current];
    if (!page) return;
    if (pageShownRef.current < page.text.length) {
      cancelStreamTimer();
      pageShownRef.current = page.text.length;
      setPageShown(page.text);
      settleIfDrained();
      return;
    }
    if (pageIndexRef.current < pagesRef.current.length - 1) {
      enterPage(pageIndexRef.current + 1, { announce: true });
    }
    // 末页且完整 → 不推进（等待玩家输入）
  }, [closing, enterPage, settleIfDrained, cancelStreamTimer]);

  const armTurnWatchdog = useCallback(() => {
    clearWatchdog();
    turnWatchdog.current = window.setTimeout(() => {
      if (!scopeIsCurrent()) return;
      turnWatchdog.current = null;
      const silence = SILENCE_LINE[locale];
      turnBufferRef.current = resetCharacterTurn();
      streamingRef.current = false;
      syncPages(silence.text, { final: true, reset: true });
      enterPage(0, { announce: false });
      const page = pagesRef.current[0];
      if (page) {
        cancelStreamTimer(); // 舞台指示一次落定，不逐字
        pageShownRef.current = page.text.length;
        setPageShown(page.text);
      }
      lastEmoRef.current = silence.emo;
      setEmo(silence.emo);
      setPhase('done');
    }, TURN_WATCHDOG_MS);
  }, [clearWatchdog, language, syncPages, enterPage, cancelStreamTimer, scopeIsCurrent]);

  /** 彻底收尾（卸载 / 切角色）：清所有定时器并复位流状态。 */
  const streamTurn = useCallback(() => {
    cancelStreamTimer();
    clearWatchdog();
    clearStingerGrace();
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    voiceTurnRef.current += 1; // 作废在途 fetch
    stopVoice();
    streamingRef.current = false;
  }, [cancelStreamTimer, clearWatchdog, clearStingerGrace]);
  useLayoutEffect(() => {
    if (committedScopeRef.current === dialogueScopeKey) return;
    committedScopeRef.current = dialogueScopeKey;
    renderScopeRef.current = dialogueScopeKey;
    setRenderScope(dialogueScopeKey);
    cancelStreamTimer();
    clearWatchdog();
    clearStingerGrace();
    voiceTurnRef.current += 1;
    stopVoice();
    turnBufferRef.current = resetCharacterTurn();
    pagesRef.current = [];
    pageIndexRef.current = 0;
    pageShownRef.current = 0;
    setPages([]);
    setPageIndex(0);
    setPageShown('');
    setInputText('');
    setPhase('idle');
    setEmo('normal');
    setActivitySessionStartedAt(Date.now());
    mockRef.current = false;
    mockSeededRef.current = false;
    streamingRef.current = false;
    messageEndedRef.current = false;
    channelIdleRef.current = false;
    finalRef.current = false;
    phaseRef.current = 'idle';
    phaseBeforeTurnRef.current = 'idle';
    lastEmoRef.current = 'normal';
    stingerFiredRef.current = false;
    queueGapEventRef.current = null;
  }, [dialogueScopeKey, cancelStreamTimer, clearWatchdog, clearStingerGrace]);

  // Close: brief paper-descend + fade (220ms), then unmount.
  const handleClose = useCallback(() => {
    if (closeTimer.current !== null) return;
    // Stop the owned Live session BEFORE onClose(): App's `character_stop` kills
    // the character agent, and a later stop would race an in-flight delegation
    // (contract §3.1.1). `stop(owner)` never touches the agent itself.
    void stopOwnedCall();
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      onClose();
    }, 220);
  }, [onClose, stopOwnedCall]);
  const requestClose = useCallback(() => {
    const lease = leaseRef.current;
    if (lease && !lease.markClosing()) return;
    handleClose();
  }, [handleClose]);
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;
  useEffect(() => {
    if (!focus) return;
    let restored = false;
    const returnFocus: FocusReturnHandle = {
      capture: () => {},
      restore: () => {
        if (restored) return false;
        restored = true;
        const opener = openerRef.current;
        if (opener && document.contains(opener)) {
          opener.focus();
          return true;
        }
        return false;
      },
    };
    const lease = focus.registerSurface({
      key: `character-dialogue:${characterId}`,
      owner: 'character-dialogue',
      close: () => handleCloseRef.current(),
      priority: 500,
      root: modalRef.current,
      returnFocus,
    });
    leaseRef.current = lease;
    return () => {
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.unregister();
      window.requestAnimationFrame(() => returnFocus.restore());
    };
  }, [characterId, focus]);

  // 挂载时复位（幂等）+ seed mock 引导语（contract §6.1 / §7）。
  useEffect(() => {
    if (!scopeIsCurrent()) return;
    // Call mode never seeds the mock greeting: it would be spoken by /api/tts and
    // write the irreversible `airp:greeted` key although the call already opened
    // the character's real greeting, losing it forever in text mode (contract §3.3).
    if (callActiveRef.current) return;
    if (mockSeededRef.current) {
      // StrictMode remount: the unmount cleanup just cancelled the greeting's
      // timers and invalidated its voice fetch. Re-arm it (nothing else to do)
      // so the opening page still types out and speaks.
      if (!mockRef.current || pagesRef.current.length === 0) return;
      for (const p of pagesRef.current) {
        p.voiceState = 'idle';
        p.voiceText = undefined;
      }
      streamingRef.current = true;
      messageEndedRef.current = true;
      setPhase('streaming');
      if (!callActiveRef.current) void prefetchVoice(pagesRef.current[0], 0);
      enterPage(0, { announce: true });
      return;
    }
    mockSeededRef.current = true;
    setEmo('normal');
    setPhase('idle');
    turnBufferRef.current = resetCharacterTurn();
    pagesRef.current = [];
    pageIndexRef.current = 0;
    pageShownRef.current = 0;
    setPages([]);
    setPageIndex(0);
    setPageShown('');
    streamingRef.current = false;
    messageEndedRef.current = false;
    channelIdleRef.current = false;
    finalRef.current = false;
    lastEmoRef.current = 'normal';
    stingerFiredRef.current = false;
    phaseRef.current = 'idle';
    phaseBeforeTurnRef.current = 'idle';

    const contentLanguage = language === 'ja' || language === 'zh-CN' || language === 'ko' ? language : 'en';
    const key = worldId === undefined ? null : `airp:greeted:v2:${worldId}:${characterId}:${contentLanguage}`;
    let greeted: string | null = null;
    if (key !== null) {
      try {
        greeted = localStorage.getItem(key);
      } catch {
        /* private mode → always show (degrade) */
      }
    }
    if (greeted !== null) return;

    const g = GREETING_LINE[contentLanguage];
    const mockPage: StagePage = { text: g.text, emo: g.emo, sealed: true, voiceState: 'idle' };
    pagesRef.current = [mockPage];
    mockRef.current = true;
    setPages([{ text: mockPage.text, emo: mockPage.emo, sealed: mockPage.sealed }]);
    if (key !== null) {
      try {
        localStorage.setItem(key, '1');
      } catch {
        /* ignore */
      }
    }
    // Treat the greeting as a completed single-page turn: it types itself out
    // with the input hidden and the ▼ hint showing, then reveals the input —
    // exactly like a real page, so the opening never looks like a chatbox.
    streamingRef.current = true;
    messageEndedRef.current = true;
    setPhase('streaming');
    if (!callActiveRef.current) void prefetchVoice(mockPage, 0); // §15.18 B1：mock 页必须走同一语音路径
    enterPage(0, { announce: true }); // 逐字 + 朗读，不响 stinger
  }, [characterId, language, worldId, worldPath, prefetchVoice, enterPage, scopeIsCurrent]);

  // Frames are drained from the shared FIFO in delivery order. The callback
  // below handles one frame; the effect after it drains every queued frame.
  const consumeCharacterFrameFromQueue = useCallback((frame: CharacterFrame) => {
    if (!scopeIsCurrent() || (worldPath !== undefined && frame.savePath !== worldPath)) return;
    // Call mode owns the transcript: the frame is still dequeued by `drainUntil`,
    // but this surface must not also drive the typewriter/pump against the same
    // line (contract §2.3). Never `frameQueue.clear` — the store listens on its
    // own window event, so clearing would manufacture a second truth.
    if (callActiveRef.current) return;
    /** 真实帧到达 → mock 引导语整块退场（不是插在真页前面，contract §7.2）。 */
    const dropMock = () => {
      if (!mockRef.current) return;
      mockRef.current = false;
      cancelStreamTimer(); // the greeting's typewriter timer
      pagesRef.current = [];
      pageIndexRef.current = 0;
      pageShownRef.current = 0;
      voiceTurnRef.current += 1; // mock 页的预取结果作废
      // The greeting was seeded as a closed turn; re-open it so the real
      // frame path re-enters beginStream() instead of inheriting mock state.
      streamingRef.current = false;
      messageEndedRef.current = false;
      channelIdleRef.current = false;
      finalRef.current = false;
      setPages([]);
      setPageIndex(0);
      setPageShown('');
      clearStingerGrace();
    };

    if (frame.type === 'character_delta') {
      dropMock();
      if (!streamingRef.current) beginStream();
      const buffer = turnBufferRef.current ?? createCharacterTurn();
      const projection = consumeCharacterFrame(buffer, { type: 'character_delta', delta: frame.delta });
      turnBufferRef.current = projection.buffer;
      syncPages(projection.rawText, { final: false });
      pump();
      return;
    }

    if (frame.type === 'character_message') {
      dropMock();
      if (!streamingRef.current) beginStream(); // 首个真实帧也能建立新 turn
      const buffer = turnBufferRef.current ?? createCharacterTurn();
      const projection = consumeCharacterFrame(buffer, { type: 'character_message', text: frame.text });
      turnBufferRef.current = projection.buffer;
      finalRef.current = true;
      // message_end closes only this assistant message; idle remains the turn boundary.
      cancelStreamTimer();
      streamingRef.current = true;
      setPhase('streaming');
      syncPages(projection.rawText, { final: true });
      pump();
      return;
    }

    if (frame.type === 'character_idle') {
      dropMock();
      const buffer = turnBufferRef.current ?? createCharacterTurn();
      const projection = consumeCharacterFrame(buffer, { type: 'character_idle' });
      turnBufferRef.current = projection.buffer;
      channelIdleRef.current = true;
      finalRef.current = true;
      if (projection.rawText.trim() === '') {
        // 纯工具轮：整轮无文本 → 归还 phase，纸上页数组不动（保留刚说完的页）。
        cancelStreamTimer();
        streamingRef.current = false;
        clearWatchdog();
        setPhase(phaseBeforeTurnRef.current);
      } else {
        if (projection.changed) syncPages(projection.rawText, { final: true });
        pump();
        settleIfDrained();
      }
      return;
    }

    // error：服务端已给英文文案，一次落定；复位并解除 busy。
    dropMock();
    cancelStreamTimer();
    clearWatchdog();
    streamingRef.current = false;
    messageEndedRef.current = false;
    channelIdleRef.current = false;
    finalRef.current = true;
    turnBufferRef.current = createCharacterTurn();
    const errorMessage = typeof frame.message === 'string' && frame.message.trim() !== ''
      ? frame.message
      : 'The character could not finish this turn.';
    syncPages(errorMessage, { final: true, reset: true });
    enterPage(0, { announce: false });
    const errPage = pagesRef.current[0];
    if (errPage) {
      pageShownRef.current = errPage.text.length; // 错误文案不该被逐字演出
      setPageShown(errPage.text);
    }
    setEmo('normal');
    lastEmoRef.current = 'normal';
    setPhase('done');

  }, [beginStream, pump, syncPages, enterPage, settleIfDrained, cancelStreamTimer, clearWatchdog, clearStingerGrace, scopeIsCurrent, worldPath]);

  /** A delivery gap is a presentation failure, not a partial reply. Stop the
   * current turn and leave a truthful, retryable page instead of concatenating
   * around the missing frame. */
  const presentQueueGap = useCallback(
    (event: Extract<CharacterFrameQueueEvent, { kind: 'gap' }>) => {
      if (event.characterId !== characterId) return;
      if (!scopeIsCurrent()) return;
      cancelStreamTimer();
      clearWatchdog();
      clearStingerGrace();
      voiceTurnRef.current += 1;
      stopVoice();
      mockRef.current = false;
      streamingRef.current = false;
      messageEndedRef.current = false;
      channelIdleRef.current = false;
      finalRef.current = true;
      turnBufferRef.current = createCharacterTurn();
      const text = translate(locale, 'The reply stopped because a line was missing (delivery {expected} was followed by {received}). Close and try again.', { expected: event.expectedSeq, received: event.receivedSeq });
      syncPages(text, { final: true, reset: true });
      enterPage(0, { announce: false });
      const page = pagesRef.current[0];
      if (page) {
        pageShownRef.current = page.text.length;
        setPageShown(page.text);
      }
      setEmo('normal');
      lastEmoRef.current = 'normal';
      setPhase('done');
    },
    [
      cancelStreamTimer,
      characterId,
      clearStingerGrace,
      clearWatchdog,
      enterPage,
      locale,
      scopeIsCurrent,
      syncPages,
    ]
  );

  useEffect(() => {
    if (!scopeIsCurrent()) return;
    if (closing) return;
    const gap = queueGapEventRef.current;
    if (gap) {
      queueGapEventRef.current = null;
      presentQueueGap(gap);
      return;
    }
    const frames = frameQueue.drainUntil(characterId);
    for (const frame of frames) consumeCharacterFrameFromQueue(frame);
  }, [frameQueue, characterId, closing, consumeCharacterFrameFromQueue, presentQueueGap, queueVersion, scopeIsCurrent]);

  // Unmount: cancel every pending timer + stop the voice channel.
  useEffect(() => streamTurn, [streamTurn]);
  // Unmount: close only the call this dialogue started (owner-scoped). Covers the
  // `key={activeCharacter.id}` swap, where handleClose never runs (contract §5.1).
  useEffect(() => () => { void stopOwnedCall(); }, [characterId, stopOwnedCall]);
  // Entering the call panel (or its error variant) parks focus on the hang-up /
  // close control — the mode button that was focused is disabled by then (§3.6).
  useEffect(() => {
    if (callVisible) hangUpRef.current?.focus();
  }, [callVisible]);


  // Reset the monogram fallback if the avatar path changes.
  useEffect(() => setAvatarError(false), [avatar, emo]);

  // Focus the input only once it is actually revealed (it is hidden before that).
  const busy = !scopeIsCurrent() || phase === 'thinking' || phase === 'streaming' || (pages.length > 0 && pageIndex < pages.length - 1);
  const inputReady = !busy;
  useEffect(() => {
    if (inputReady) inputRef.current?.focus();
  }, [inputReady]);

  const handleSend = () => {
    if (!scopeIsCurrent()) return;
    // Call mode must not drive the character through text as well (contract §3.1-4).
    if (callActiveRef.current) return;
    const msg = inputText.trim();
    if (!msg || busyRef.current) return; // one performance at a time
    // A retry after a delivery gap explicitly reopens the queue lane. This
    // does not alter the character_prompt payload or claim that stop succeeded.
    frameQueue.clear('stop');
    setInputText('');
    // 乐观占位：真实首帧要等 agent 启动 + 首个 token，期间不能露出"可再发一条"的窗口。
    phaseBeforeTurnRef.current = phaseRef.current;
    streamingRef.current = false;
    messageEndedRef.current = false;
    channelIdleRef.current = false;
    finalRef.current = false;
    // 清页队列（contract §6.6）：否则新回复的页接在旧页后面。
    voiceTurnRef.current += 1;
    turnBufferRef.current = resetCharacterTurn();
    pagesRef.current = [];
    pageIndexRef.current = 0;
    pageShownRef.current = 0;
    setPages([]);
    setPageIndex(0);
    setPageShown('');
    clearStingerGrace();
    stopVoice();
    setPhase('thinking');
    setEmo('thinking');
    lastEmoRef.current = 'thinking';
    stingerFiredRef.current = false;
    onSendMessage?.(msg); // character_prompt protocol — App wires the message type
    armTurnWatchdog();
  };

  busyRef.current = busy;
  callActiveRef.current = callActive; // render-phase mirror for the useCallback gates
  phaseRef.current = phase;
  const showAvatar = !avatarError && !!avatar;
  const monogram = characterId.trim().charAt(0).toUpperCase() || '?';
  // The still for the current mood, when the world ships the six-emotion set.
  // Undefined keeps the legacy single-portrait path, so nothing changes for
  // worlds without differentials.
  const visibleScope = scopeIsCurrent();
  const visibleEmo = visibleScope ? emo : 'normal';
  const emotionStill = emotions?.[visibleEmo];
  const currentPage = visibleScope ? pages[pageIndex] : undefined;
  const visiblePhase = visibleScope ? phase : 'idle';
  const visiblePageShown = visibleScope ? pageShown : '';
  // ▼ 提示仅在「有页可推、非沉思、且还没到该玩家输入」时出现（contract §16.2）。
  const canAdvance = visibleScope && phase !== 'thinking' && pages.length > 0 && !inputReady;
  const dialogTitleId = `character-modal-title-${characterId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const dialogDescriptionId = `character-modal-description-${characterId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  return (
    <div
      ref={modalRef}
      data-depth-surface="modal"
      className={`character-modal-layer${closing ? ' modal-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={dialogTitleId}
      aria-describedby={dialogDescriptionId}
      tabIndex={-1}
    >
      <button type="button" className="modal-close" onClick={requestClose} aria-label={t('Close dialog')}>
        ×
      </button>

      {/* One portrait slot, anchored to the shared bottom safe baseline. */}
      <div className="portrait-stage" aria-label={t('{name} portrait', { name: characterId })}>
        <div className="portrait-slot lit">
          <div className="portrait-breathe">
            <div className={`portrait-emo emo-${visibleEmo}${visibleEmo === 'shock' ? ' emo-shock-shake' : ''}`}>
              {/* Six-emotion world: the still for the
                  current `[emo: tag]` wins over the single clip, so the face
                  actually changes. A missing/failed still falls through to
                  MotionPortrait, never a blank stage. */}
              {emotionStill && !avatarError ? (
                <img
                  className="portrait-still"
                  src={emotionStill}
                  alt={displayName || characterId}
                  onError={() => setAvatarError(true)}
                />
              ) : showAvatar ? (
                <MotionPortrait video={avatarVideo} poster={avatar} enabled={effectsEnabled} name={displayName || characterId} onPosterError={() => setAvatarError(true)} />
              ) : (
                <div className="portrait-fallback" role="img" aria-label={`${characterId} portrait`}>
                  {monogram}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Identity and activity stay outside the speech paper so the paper
          remains a focused line/advance/input surface. */}
      <aside className="identity-status" aria-labelledby={dialogTitleId}>
        <div className="identity-heading">
          <h2 id={dialogTitleId} className="identity-name">{displayName || characterId}</h2>
          {onOpenNook && (
            <button type="button" onClick={onOpenNook}>
              {t('Visit ikigai')}
            </button>
          )}
        </div>
        {modeSwitchVisible && (
          <div className="dialogue-modes" role="group" aria-label={t('Dialogue mode')} data-dialogue-mode-switch="">
            <button type="button" className="dialogue-mode" aria-pressed={!callVisible} onClick={hangUp}>
              {t('Text')}
            </button>
            <button
              type="button"
              className="dialogue-mode"
              aria-pressed={callVisible}
              disabled={callActive && call.characterId === characterId}
              onClick={startDialogueCall}
            >
              {callActive ? t('On a call') : t('Start a call')}
            </button>
          </div>
        )}
        <p id={dialogDescriptionId} className="identity-bio">{bio || '(necessary description)'}</p>
        {states && states.length > 0 && <StateLines states={states} className="identity-states" />}
        {sheet && sheetRules && (
          <details className="identity-sheet" data-testid="character-sheet-fold">
            <summary>{t('Skills')}</summary>
            <SheetBody sheet={sheet} rules={sheetRules} testId="character-sheet" />
          </details>
        )}
        <div className="identity-activity" aria-label={t('Activity status')}>
          <ActivityRail surface="character-modal" agentId={`character:${characterId}`} />
          <AgentActivityLog
            query={{ surface: 'character-modal', agentId: `character:${characterId}`, since: activitySessionStartedAt }}
            className="character-activity-log"
            sessionLabel={displayName || characterId}
            focus={focus}
          />
        </div>
      </aside>

      {/* Bottom tilted paper: current line, advance prompt, player input. */}
      <div
        className={`speech-paper${closing ? ' speech-paper-closing' : ''}`}
        data-dialogue-mode={callVisible ? 'call' : 'text'}
      >
        {callVisible ? (
          <div className="call-stage">
            <ActivityRail surface="character-modal" agentId={`character:${characterId}`} />
            <LiveCallTranscript
              lines={lines}
              call={{ outputText: call.outputText, inputText: call.inputText, phase: call.phase }}
              className="call-stage__transcript"
            />
            <LiveCallStatus call={call} className="call-stage__state" />
            <div className="call-bar">
              <span className="call-status" role="status">
                {call.phase === 'connecting' ? t('Connecting…') : call.phase === 'live' ? t('On a call') : t('Could not connect')}
              </span>
              <button ref={hangUpRef} type="button" className="call-hangup" onClick={hangUp}>
                {call.phase === 'error' ? t('Close') : t('Hang up')}
              </button>
            </div>
            {callAlert !== '' && <p className="dialogue-call-alert" role="alert">{callAlert}</p>}
          </div>
        ) : (
          <>
            <div
              className={`line-stage${canAdvance ? ' is-advanceable' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={t('Continue dialogue')}
              aria-keyshortcuts="Enter Space"
              aria-describedby={dialogDescriptionId}
              onClick={advance}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ' && event.code !== 'Space') return;
                event.preventDefault();
                advance();
              }}
            >
              {visiblePhase === 'thinking' && (
                <span className="thinking-hint">{t('{name} is thinking…', { name: characterId })}</span>
              )}
              {currentPage && currentPage.text !== '' && (
                <span className="speech-line">
                  <NarratedText text={visiblePageShown} names={speakerNames} />
                  {visiblePhase === 'streaming' && visiblePageShown.length < currentPage.text.length && (
                    <span className="type-caret" aria-hidden="true" />
                  )}
                </span>
              )}
            </div>

            <span className={`advance-indicator${canAdvance ? '' : ' is-hidden'}`} aria-hidden="true">
              ▼
            </span>

            <div className={`speech-input-row${inputReady ? ' is-ready' : ''}`}>
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (guardImeKey(e)) return;
                  if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
                }}
                placeholder={t('Say something to {name}… (Enter to send)', { name: characterId })}
                aria-label={t('Message to {name}', { name: characterId })}
                disabled={busy}
                className="speech-input"
              />
              <VoiceInputButton
                disabled={busy}
                getDraft={() => inputText}
                onDraft={setInputText}
              />
              {/* The writer's send pill (SendButton): same submit as Enter, so
                  the busy / empty guards in handleSend stay the only gate. */}
              <SendButton
                className="character-send"
                label={t('Send to {name}', { name: characterId })}
                disabled={busy || inputText.trim() === ''}
                onSend={handleSend}
              />
            </div>
          </>
        )}
      </div>
    </div>

  );
};
