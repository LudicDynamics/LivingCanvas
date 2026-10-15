import { useCharacterTick } from './lib/tick/use-character-tick.js';
import { requestNpcTalk } from './lib/npc-dialogue.js';
import { appVersionOf, track, trackTurn, visit } from './lib/analytics.js';
import { autoNewcomerGift, onNewcomerGift } from './lib/newcomer-gift.js';
import { currentLocale, followWorldLocale, localeChosen, preferredLocale, suggestedLocale, translate, useLocale, type Locale } from './lib/i18n.js';
import { TTS_REQUIRES_ACCOUNT_EVENT } from './lib/tts-readiness.js';
import { friendlyModelError } from './lib/model-errors.js';
import { callCarries, useLiveCallActions, useLiveCallState } from './lib/live-call.js';
import { withBase } from './lib/base-path.js';
import { AgentSettings } from './components/AgentSettings.js';
import { TtsSettings } from './components/TtsSettings.js';
import { WriterBar, type WriterBarProps } from './components/chrome/WriterBar.js';
import { ActivityRail } from './components/chrome/ActivityRail.js';
import { AgentActivityLog } from './components/chrome/AgentActivityLog.js';
import { CanvasArrangeControl, type CanvasArrangeControlHandle } from './components/chrome/CanvasArrangeControl.js';
import { ConnectedWorldToastRegion } from './components/chrome/WorldToast.js';
import { ItemArtwork } from './components/ItemArtwork.js';
import { HtmlDetailDialog } from './components/html/HtmlDetailDialog.js';
import { NookView } from './components/nook/NookView.js';
import { ghostItemFor } from './lib/init-ghost.js';
import { useViewpointReport } from './hooks/useViewpointReport.js';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas } from './components/canvas/Canvas.js';
import { CharacterModal } from './components/overlay/CharacterModal.js';
import { DiceCeremony } from './components/performance/DiceCeremony.js';
import { GateThreshold } from './components/performance/GateThreshold.js';
import { PerformanceLayer } from './components/performance/PerformanceLayer.js';
import { PerformanceSettings, PerformanceSettingsTrigger } from './components/PerformanceSettings.js';
import { setPerformancePreset, updatePerformanceSettings, usePerformanceSettings } from './lib/performance-settings.js';
import { FrameProbeHud } from './components/performance/FrameProbeHud.js';
import { initializeFrameProbe } from './lib/frame-probe.js';
import {
  parseDiceFrame,
  parseDiceFrameResult,
  shouldPlayFrame,
  markPlayed,
  playCeremony,
  clearCeremony,
  subscribeCeremony,
  getCeremonySnapshot,
} from './lib/dice-ceremony.js';
import { getCharacterFrameQueue, isCharacterFrame } from './lib/character-frame-queue.js';
import {
  createCameraMemoryStack,
  projectionTarget,
  type CameraMemoryStack,
  type ProjectionTarget,
} from './lib/camera.js';
import { useWriterState, requestWriterStop, resetForReconnect, retryWriterPrompt, getWriterState, subscribeWriterState } from './lib/writer-state.js';
import { accountData, worldKeyOf } from './lib/account-data.js';
import { NoticeDot } from './components/Announcements.js';
import { buildItemActionPrompt, appendItemAction } from './lib/item-action-draft.js';
import { PLAY_HINT_REQUEST } from './lib/play-hints.js';
import { agentActivityStore } from './lib/agent-activity-store.js';
import { agentCursorStore } from './lib/agent-cursor.js';
import { worldEventToastStore } from './lib/world-event-toast.js';
import { GodModeToolbar } from './components/god/GodModeToolbar.js';
import { RadialMenu, type RadialItemType } from './components/god/RadialMenu.js';
import { radialItemsFor, type RadialToolId } from './lib/radial-items.js';
import { worldCategoryIdOf } from '@airp/shared/themes';
import { MuteButton } from './components/chrome/MuteButton.js';
import { VoiceToggle } from './components/chrome/VoiceToggle.js';
import { useAudio } from './state/useAudio.js';
import { useCamera } from './state/useCamera.js';
import { useWorld } from './state/useWorld.js';
import type { EnterLayerOutcome } from './state/useWorld.js';
import {
  ActionFeedbackProvider,
  canonicalActionKey,
  createActionFeedbackCoordinator,
  type ActionFeedback,
  type ActionIntent,
  type ActionResultLike,
  type ReconcileReceipt,
} from './lib/action-feedback.js';
import { CharacterRail } from './components/sidebar/CharacterRail.js';
import { CharacterDock } from './components/sidebar/CharacterDock.js';
import { NpcDialogueHost } from './components/sidebar/NpcDialogue.js';
import { ChoiceRail } from './components/sidebar/ChoiceRail.js';
import { ContactPanel } from './components/chrome/ContactPanel.js';
import { ReportIssueButton, ReportIssueSheet } from './components/chrome/ReportIssue.js';
import type { ReportContext } from './lib/report-issue.js';
import { browserModeRequested } from './lib/browser-mode.js';
import { AccountPanel } from './components/chrome/AccountPanel.js';
import { onPlayWorldRequest } from './lib/play-again.js';
import { ClaimPrompt } from './components/chrome/DailyClaim.js';
import { OnboardingGuide, useOnboardingGuide } from './components/chrome/OnboardingGuide.js';
import { ForcedTutorial } from './components/chrome/ForcedTutorial.js';
import { FirstRunLanguage, FirstRunMenu, FirstRunSignInCard } from './components/chrome/FirstRun.js';
import { decideFirstRun, firstRunAccessOf, firstRunBuild, firstRunEntryOf, gateOfGuestRefusal, type FirstRunGate, isHandoffWorld, firstRunParams, hideForcedTutorial, markFirstRunDone, markFromPrologue, prologueIdFor, prologueNextIdFor, prologuePathOf, prologueRecap, readFirstRunMark, readFromPrologue } from './lib/first-run.js';
import { isPrologueWorld, openingRepliesFor, openingReplyItemsFor, replyChipsEnabled, worldExperienceOf } from '@airp/shared/experience';
import { buildInteractiveFields as buildChoiceFields, visibleChoiceOptions as visibleRouteOptions } from '@airp/shared/frontmatter';
import { hintSlips, linesFor, markUsed, mergeSlips, optionDoneOf, optionUsedOf, readUsed, routeOptions, SAY_LINE_EVENT, type RouteCard, type SayLineRequest, type WriterSlip } from './lib/option-routing.js';
import { resetHint, useHint } from './lib/hint-store.js';
import { WriterTrayFab } from './components/chrome/WriterTrayFab.js';
import { MessageDrawer } from './components/chrome/MessageDrawer.js';
import { canvasChalks, chalkIsOpen, messageStream, orderChalks, readChalkKeep, useMessageStream, useRetiringChalks, useStreamHistory, type ChalkLike } from './lib/message-stream.js';
import { streamItemsOfEvent, type StreamEventLike } from '@airp/shared/stream-history';
import { tickStreamKey } from '@airp/shared/tick';
import { getTickView, subscribeTick } from './lib/tick/store.js';
import { clearCardEmphasis, emphasizeCard } from './lib/card-emphasis.js';
import { onDrawerDownRequest, onDrawerRequest, useBottomStack, useNarrowLayout, type DrawerTab } from './lib/drawer-layout.js';
import { TutorialCueCard } from './components/chrome/TutorialCueCard.js';
import {
  diceRewardSource,
  diceRolled,
  INITIAL_TUTORIAL_LATCH,
  isSearchChalk,
  readTutorialDone,
  settleArrivalGreeting,
  TUTORIAL_ARRIVAL_MAX_MS,
  tutorialArrivalPending,
  tutorialFirstLine,
  tutorialArmOnEntry,
  tutorialPlaces,
  writeTutorialDone,
  type ArrivalGreeting,
  type TutorialSnapshot,
  type TutorialStep,
} from './lib/forced-tutorial.js';
import { useLayoutMode } from './lib/layout-mode.js';
import { companionIdOf, planOpening, returnCue, type OpeningPhase, type OpeningPlan } from './lib/opening.js';
import { characterStopFrame, chatEndFrame, holdChatBeats } from './lib/chat-end.js';
import { enterLayerView, enterWorldView, layerDeclaredViewOf, useViewMode, worldDefaultViewOf } from './lib/view-mode.js';
import { Board } from './components/board/Board.js';
import { ViewModeSwitch } from './components/chrome/ViewModeSwitch.js';
import { ClosedRun } from './components/chrome/ClosedRun.js';
import { StoryEvents } from './components/chrome/StoryEvents.js';
import { LoopBanner } from './components/chrome/LoopBanner.js';
import { CgReveal } from './components/chrome/CgReveal.js';
import { MilestoneStage } from './components/chrome/MilestoneStage.js';
import { SceneReel } from './components/chrome/SceneReel.js';
import { isStageBusy, sceneReel, subscribeStageBusy, whenStageIdle } from './lib/milestones.js';
import { characterAnswerSettled, characterAnswerStarted } from './lib/stage-performance.js';
import { RUN_REFRESH_DOM, useClosedRun } from './lib/closed-run.js';
import { autoOpenWorldShelf, rememberWorldShelf } from './lib/world-shelf-pref.js';
import { useProfileRecorder } from './lib/profile-journal.js';
import { useWorldPanels, worldHoverAnchor } from './lib/panels.js';
import { useWorldSheets } from './lib/sheets.js';
import { HoverPanel, PlayerPanel, StateLines, WorldPanelBody } from './components/chrome/StatePanels.js';
import { AvatarQuick, AvatarSheetPanel, type QuickTab } from './components/chrome/AvatarQuick.js';
import { SheetBody } from './components/chrome/CharacterSheet.js';
import { CompanionSkills, InspirationRoll } from './components/chrome/SheetExtras.js';
import { setCharacterNames } from './lib/character-names.js';
import { WorkshopArtPanel, useWorkshopArt } from './components/chrome/WorkshopArtPanel.js';
import { isArtAuthoring, missingMapSlot, showWorkshopChrome } from './lib/workshop-art.js';
import { forgetDialogueScrollback, lastCharacterLine } from './lib/character-dialogue.js';
import { useDraggableOffset } from './lib/use-draggable-offset.js';
import { usePresence } from './state/usePresence.js';
import { setShareWorld } from './lib/share-art.js';
import { airpGateway, isWorldUnavailable, onWorldUnavailable, AirpRequestError, type AssetMediaKind, type WorldShelf } from './lib/airp-gateway.js';
import { WorldShelf as WorldShelfDialog } from './components/WorldShelf.js';
import { WorldLauncher } from './components/WorldLauncher.js';
import { RotateHint } from './components/chrome/RotateHint.js';
import { CreateWorldDialog } from './components/CreateWorldDialog.js';
import { WorldIntroDialog } from './components/WorldIntroDialog.js';
import { INITIAL_INTRO_GATE, introGateFrom, tutorialHeldByIntro, type IntroGate } from './lib/world-theme.js';
import { LAUNCHER_THEME, restartTargetOf, trialOriginOf, worldTitle } from './lib/world-launcher.js';
import { BagItemDialog } from './components/BagItemDialog.js';
import { guardImeKey } from './lib/ime.js';
import { initialShell, transitionShell } from './lib/ui-shell.mjs';
import { MarkdownText } from './lib/md.js';
import { BookOpen, ChevronDown, ChevronUp, Maximize, Minimize, UserRound, Backpack, Sparkles } from 'lucide-react';
import { preloadAudio } from './lib/audio.js';
import { mediaReadiness } from './lib/media-readiness.js';
import { useStill } from './lib/motion.js';
import { createFocusCoordinator, type FocusOwner } from './lib/focus-coordinator.js';
import { createOverlayAdmission } from './lib/overlay-admission.js';
import { detectAccountMode, gateDecision, guestDecision, playTargetOf, takeResumePath, withAccount } from './lib/play-gate.js';
import { worldLoadFailureOf } from './lib/world-load-error.js';
import { afterGuestTurn, askGuestToSignIn, isTrialWorldPath, startGuestTrial, useGuestTrial, guestModeOf } from './lib/guest-trial.js';
import { remoteErrorCode, remoteErrorText } from './lib/remote-sync.js';
import { createWorldSync, installWorldSync, worldSync } from './lib/world-sync.js';
import { ACCOUNT_CHANGED_EVENT } from './lib/account-open.js';
import { usePlayerBoard } from './state/usePlayerBoard.js';
import { useClueBoard } from './components/canvas/ClueBoard.js';
import { continueStoryAction, createWorldReopener } from './lib/world-reopen.js';

// Restore the persisted frame-diagnostics toggle before first paint so the
// HUD is up when a stutter report starts recording.
initializeFrameProbe();

interface WorldManifest {
  id: string;
  locale?: 'en' | 'ja' | 'zh-CN' | 'ko';
  name: string;
  description: string;
  genre: string;
  material: string;
  audio?: { theme: string | null };
  cover?: string;
  player?: { id: string; name: string; avatar?: string };
  /**
   * First playable layer declared by world.json (`WorldManifestSchema.entry`).
   * The server always emits it (schema default `'map'`); the client still falls
   * back to `'map'` for legacy manifests and unknown layers.
   */
  entry?: string;
  /**
   * The first act. `greeter` names the character whose README
   * carries the opening line; `greeting` is the narrator's line for a world
   * with nobody to speak. Absent → this world opens in silence, as before.
   */
  opening?: { greeter?: string; greeting?: string; replies?: unknown };
  /** A guided experience: the first-run prologue's kind, where its ending leads, its turn-end command. */
  experience?: unknown;
  /**
   * The view this world opens in (`WorldManifestSchema.view`):
   * `map` for TRPG worlds with drawn maps. Absent → the canvas.
   */
  view?: { default?: 'canvas' | 'map' };
  /**
   * The forced tutorial's authored bits: `firstLine` is the
   * line its `speak` step pre-fills — one string, or one per locale.
   */
  tutorial?: { firstLine?: string | Partial<Record<'en' | 'ja' | 'zh-CN' | 'ko', string>> };
  /**
   * The workshop. `authoring` is decided by the
   * server: this save is the author's own original of a made world, so the
   * creator guide shows and the writer builds rather than narrates.
   */
  workshop?: { status: 'draft' | 'published'; owner: string };
  authoring?: boolean;
  /** The lobby card / theme: `worldCategoryIdOf` reads the world's category from them. */
  intro?: unknown;
  theme?: unknown;
  layers: Record<string, { name?: string; parent?: string | null; material?: string }>;
  characters: CharacterView[];
}

interface BackpackItem {
  path: string;
  filename: string;
  frontmatter: Record<string, any> | null;
  body: string;
}

interface CharacterView {
  avatarVideo?: string;
  id: string;
  name?: string;
  home?: string;
  role?: string;
  avatar?: string;
  bio?: string;
  description?: string;
  /** README frontmatter `voice` alias, via /api/characters. undefined → server default. */
  voice?: string;
  /**
   * The first act's author-written lines, via /api/characters.
   * `greeting` opens the world, `invitesFollowLine` asks to come along, and
   * `arrivalLine` is what they say on reaching a new layer while following.
   */
  greeting?: string;
  invitesFollowLine?: string;
  arrivalLine?: string;
  /**
   * Per-emotion portrait paths, via /api/characters.
   * Present only when all six exist; undefined → the modal keeps the single
   * MotionPortrait fallback.
   */
  emotions?: Record<string, string>;
  /**
   * Where this character actually IS — the ONE
   * cross-layer fact. The key is ALWAYS present; `null` = not in the world.
   * NEVER `home`: that is only the initial layer baked into world.json.
   */
  presence: { layer: string; following: boolean } | null;
}

type Attention = 'ambient' | 'writer' | 'authoring';

function labelOf(value: string): string {
  if (value === 'first-snow-jp') return '初雪ラジオ · 日本語';
  if (value.startsWith('first-snow-jp-')) return `初雪ラジオ · ${value.slice('first-snow-jp-'.length)}`;
  const tail = value.split('/').filter(Boolean).at(-1) || value;
  return tail
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Strip a display extension for the fallback label. BOTH call sites in the
 * belongings list share this one helper (two inline `.md`-only strips is the
 * bug this replaced): the bag can now carry `.html` pages too (H1 contract §6.1).
 */
function stripExt(name: string): string {
  return name.replace(/\.(?:md|html)$/i, '');
}

function assetUrl(path?: string, mediaKind: AssetMediaKind = 'image'): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('/api/asset')) {
    const url = new URL(path, window.location.origin);
    const assetPath = url.searchParams.get('path');
    return assetPath ? airpGateway.assetUrl(assetPath, undefined, mediaKind) : undefined;
  }
  if (/^(?:https?:|data:|blob:)/.test(path)) return path;
  return airpGateway.assetUrl(path.replace(/^\/+/, ''), undefined, mediaKind);
}
function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
  return target.closest('[contenteditable]:not([contenteditable="false"]),button,a,[role="switch"]') !== null;
}

function isComposingEscape(event: KeyboardEvent): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

function sceneName(manifest: WorldManifest | null, layer: string): string {
  return manifest?.layers?.[layer]?.name || labelOf(layer === 'map' ? manifest?.name || 'World Map' : layer);
}

/** World.json `tick`: present → this world has a character tick; `wip` = 「制作中」. */
function worldTickOf(manifest: unknown): { wip: boolean } | null {
  const tick = (manifest as { tick?: unknown } | null)?.tick;
  return tick && typeof tick === 'object' ? { wip: (tick as { wip?: unknown }).wip === true } : null;
}

export function App() {
  const { locale, setLocale, t } = useLocale();
  const settings = usePerformanceSettings();
  const [performanceSettingsOpen, setPerformanceSettingsOpen] = useState(false);
  const performanceSettingsTriggerRef = useRef<HTMLElement | null>(null);
  const openPerformanceSettings = useCallback((trigger: HTMLButtonElement) => {
    performanceSettingsTriggerRef.current = trigger;
    setPerformanceSettingsOpen(true);
  }, []);
  const closePerformanceSettings = useCallback(() => setPerformanceSettingsOpen(false), []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.airpPerformance = settings.preset;
    root.dataset.airpEffects = settings.effectsEnabled ? 'on' : 'off';
    root.dataset.airpShadow = settings.shadowQuality;
    root.dataset.airpBlur = settings.backdropBlur;
    root.dataset.airpGrain = settings.canvasGrain ? 'on' : 'off';
    return () => {
      delete root.dataset.airpPerformance;
      delete root.dataset.airpEffects;
      delete root.dataset.airpShadow;
      delete root.dataset.airpBlur;
      delete root.dataset.airpGrain;
    };
  }, [settings]);
  const [manifest, setManifest] = useState<WorldManifest | null>(null);
  const [activeWorldPath, setActiveWorldPath] = useState<string | null>(null);
  // A world's language shows in the interface only for a player who never picked one and whose browser reads it,
  // and only while that world is open (lib/i18n.ts followWorldLocale; the design notes).
  useEffect(() => {
    followWorldLocale(manifest?.locale ?? null);
  }, [manifest?.id, manifest?.locale]);
  // Share cards (lib/share-art.ts): CGs shown now belong to this world; its cover is the fallback picture.
  useEffect(() => {
    setShareWorld(manifest ? { key: manifest.id, title: worldTitle(manifest.name || '') || null, coverSrc: manifest.cover ? airpGateway.assetUrl(manifest.cover, undefined, 'image') : null } : null);
  }, [manifest?.id, manifest?.name, manifest?.cover]);
  const [backpack, setBackpack] = useState<BackpackItem[]>([]);
  const [characters, setCharacters] = useState<CharacterView[]>([]);
  const [shelf, setShelf] = useState<WorldShelf>({ templates: [], worlds: [] });
  const [attention, setAttention] = useState<Attention>('ambient');
  const [isGodHandOpen, setIsGodHandOpen] = useState(false);
  const allowChalkDrag = isGodHandOpen;
  const [shell, setShell] = useState(initialShell);
  const [bagOpen, setBagOpen] = useState(false);
  const [selectedBagPath, setSelectedBagPath] = useState<string | null>(null);
  const selectedBagItem = backpack.find(item => item.path === selectedBagPath);
  const reducedMotion = useStill();
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);
  const focusCoordinator = useMemo(() => createFocusCoordinator(), []);
  const overlayAdmission = useMemo(() => createOverlayAdmission(focusCoordinator), [focusCoordinator]);
  const [, setFocusRevision] = useState(0);
  useEffect(() => focusCoordinator.subscribe(() => setFocusRevision(value => value + 1)), [focusCoordinator]);
  const focusTokensRef = useRef(new Map<FocusOwner, string>());
  const syncFocus = useCallback((owner: FocusOwner, active: boolean) => {
    const token = focusTokensRef.current.get(owner);
    if (active && !token) {
      focusTokensRef.current.set(owner, focusCoordinator.acquire(owner));
    } else if (!active && token) {
      focusCoordinator.release(token);
      focusTokensRef.current.delete(owner);
    }
  }, [focusCoordinator]);
  const characterAdmissionRef = useRef<string | null>(null);
  const radialAdmissionRef = useRef<string | null>(null);
  const diceAdmissionRef = useRef<string | null>(null);
  const closeCharacterRef = useRef<() => void>(() => {});
  const [radialState, setRadialState] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null);
  const toggleShell = (action: 'header' | 'journal' | 'immersion') => setShell(current => transitionShell(current, action));
  const [worldPickerOpen, setWorldPickerOpen] = useState(false);
  // Every session opens on the launcher, and every world returns to it.
  const [launcherOpen, setLauncherOpen] = useState(true);
  /**
   * The first-run experience: `checking` holds the lobby back while
   * the page decides; `language` is the language screen; `starting` opens the guest session and the prologue;
   * `off` is the page as before. A build without VITE_AIRP_FIRST_RUN starts and stays `off`.
   */
  const [firstRunPhase, setFirstRunPhase] = useState<'checking' | 'language' | 'starting' | 'off'>(() => (firstRunBuild() ? 'checking' : 'off'));
  /** The prologue is open: the minimal play chrome (`app--first-run`), no forced tutorial, chips, the two-choice ending. */
  const prologueOpen = !launcherOpen && isPrologueWorld(manifest);
  // Dialogs portalled to <body> (the dice card) read the prologue from <html> (first-run.css).
  useLayoutEffect(() => {
    if (!prologueOpen) return;
    document.documentElement.dataset.airpFirstRun = 'on';
    return () => { delete document.documentElement.dataset.airpFirstRun; };
  }, [prologueOpen]);
  const worldEffectsEnabled = settings.effectsEnabled && !launcherOpen;
  // The workshop's create dialog, and the save whose publish is in flight
  //.
  const [createOpen, setCreateOpen] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);
  useEffect(() => {
    if (launcherOpen) void airpGateway.worlds().then(setShelf).catch(() => {});
  }, [launcherOpen]);
  // 本机 / 云端: the 云端 worlds sync every few minutes, when the page is
  // hidden, and on leaving a world; a pass that changed something re-reads the shelf (badges).
  useEffect(() => {
    const sync = createWorldSync({
      api: airpGateway,
      onChanged: () => { void airpGateway.worlds().then(setShelf).catch(() => {}); },
      doc: typeof document === 'undefined' ? null : document,
    });
    installWorldSync(sync);
    const stop = sync.start();
    // Signed in (or out) just now: a pass brings this account's 云端 worlds down / settles the status.
    const onAccount = () => { void sync.run('manual'); };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, onAccount);
    return () => { stop(); window.removeEventListener(ACCOUNT_CHANGED_EVENT, onAccount); };
  }, []);
  const wasInWorld = useRef(false);
  useEffect(() => {
    if (launcherOpen && wasInWorld.current) void worldSync()?.run('exit');
    wasInWorld.current = !launcherOpen;
  }, [launcherOpen]);
  const [profileOpen, setProfileOpen] = useState(false);
  const closeProfile = useCallback(() => setProfileOpen(false), []);
  const [activeCharacter, setActiveCharacter] = useState<CharacterView | null>(null);
  /**
   * Which shell is on screen. `classic` renders exactly what
   * shipped — a full-screen `CharacterModal` and the bottom `WriterBar` dock —
   * so every existing contract and test keeps its meaning; `companion` moves
   * the dialogue into the right rail and the writer into a bottom-right FAB.
   */
  const [layoutMode] = useLayoutMode();
  // The prologue always plays in the companion shell: it is what its chips and its phone layout are built on.
  const companion = layoutMode === 'companion' || prologueOpen;
  /** The writer sheet's open state; `companion` only. */
  const [writerSheetOpen, setWriterSheetOpen] = useState(false);
  /** The writer sheet sits over the character rail: the height the rail keeps (it scrolls), or null. */
  const [writerRailLimit, setWriterRailLimit] = useState<number | null>(null);
  // Companion: the writer sheet is the face of the `authoring` attention. Every
  // path that starts authoring (Enter, a hint draft, using an item) opens it,
  // and every path that ends it (Escape, entering a world) puts it away.
  useEffect(() => {
    if (companion) setWriterSheetOpen(attention === 'authoring');
  }, [companion, attention]);
  const writerSuspendedForBagRef = useRef(false);
  /**
   * The first act: the greeter's line, the player's first
   * reply, their answer, and — if they have one — the follow invitation. The
   * act IS the first conversation, so `phase` walks the exchange rather than a
   * tour. `null` = no first act (already shown, `classic`, or a world that
   * declares none); clearing it leaves the greeting in the scrollback.
   */
  const [opening, setOpening] = useState<(OpeningPlan & { phase: OpeningPhase }) | null>(null);
  // The forced tutorial runs on EVERY world entry — a first arrival or a return
  // — until the player presses "Don't show again"
  //
  const [tutorialArmedState, setTutorialArmed] = useState(false);
  // The prologue's beats ARE the tutorial: the forced one is never armed there.
  const tutorialArmed = tutorialArmedState && !prologueOpen;
  // No quiet writer beat after a chat while the forced tutorial runs (lib/chat-end.ts).
  useEffect(() => { holdChatBeats(tutorialArmed); }, [tutorialArmed]);
  /** Messages the player sent to any character since the tutorial armed: its `speak` step. */
  const [tutorialSent, setTutorialSent] = useState(0);
  /** The step the forced tutorial is showing (null: not showing). `speak` pre-fills the reply box. */
  const [tutorialStep, setTutorialStep] = useState<TutorialStep | null>(null);
  /**
   * Once per world entry. The entry arms it, and so does the greeting — which
   * can come LATER (a save resumed inside a place greets only on reaching the
   * entry layer, often the tutorial's own last move): re-arming then restarted
   * a finished tutorial at `speak` behind a full mask, stuck until "Skip this
   * time". Keyed by the world (lib/forced-tutorial
   * `tutorialArmOnEntry`): a reopen of the same save or a second greeting in
   * the same visit never brings a skipped tutorial back; only the launcher
   * (and a page reload, which lands there) or another world starts a new entry.
   */
  const tutorialLatchRef = useRef(INITIAL_TUTORIAL_LATCH);
  const armTutorial = useCallback((worldId: string | null | undefined) => {
    const { latch, arm } = tutorialArmOnEntry(tutorialLatchRef.current, worldId, readTutorialDone(window.localStorage));
    tutorialLatchRef.current = latch;
    if (!arm) return;
    setTutorialSent(0);
    setTutorialArmed(true);
    setTutorialStep(null);
  }, []);
  // A message to a character: the tutorial's `speak` step, and their answer is
  // a performance the tutorial waits out (lib/stage-performance).
  const countTutorialSend = useCallback(() => {
    setTutorialSent(count => count + 1);
    characterAnswerStarted();
  }, []);
  /**
   * The first-entry intro of a workshop world: once
   * per save, before the forced tutorial — which stays armed but hidden while
   * the marker is read and while the popup is up.
   */
  const [introGate, setIntroGate] = useState<IntroGate>(INITIAL_INTRO_GATE);
  /**
   * The onboarding guide: four sentences, each one waiting
   * for the player to perform its move and clearing itself when they do.
   * `classic` has no rail, no dock and no writer FAB to point at, so it gets
   * none of this.
   *
   * Progress is the PLAYER's, not the save's — see `lib/onboarding.ts`. The
   * four events that clear the steps are wired where each one already happens
   * (the writer accepting a turn, the rail resolving a choice, the layer
   * changing, the dock settling a turn), so there is no second state machine
   * to keep in step with the game.
   */
  const authoring = manifest?.authoring === true;
  // The full 末班车 opened from the prologue's ending: only the writer line.
  const handoff = isHandoffWorld(manifest?.id, readFromPrologue());
  const guide = useOnboardingGuide(companion, authoring ? 'creator' : handoff ? 'handoff' : 'player');
  const markGuide = guide.mark;
  const resetGuide = guide.reset;
  /** Turning to the writer is the one press that sends the companion off stage. */
  const writerFabRef = useRef<HTMLDivElement>(null);
  const dockCloseFor = useRef([writerFabRef]).current;
  /**
   * The classic dialogue covers the canvas, so the canvas goes `inert` beneath
   * it. The companion dock sits beside a canvas the player keeps dragging,
   * rolling dice on and walking through — it must never take that away.
   */
  const dialogueBlocksCanvas = !companion && activeCharacter !== null;
  const [nookChar, setNookChar] = useState<string | null>(null);
  /** Nook sub-scene addressing. A path RELATIVE to the
   *  character root; `null` = the root itself. Kept beside `nookChar` rather than
   *  merged into it: `nookChar` decides the projection (push/pop a camera frame),
   *  `nookScene` only picks a page INSIDE that projection (04 §⑪ C1). */
  const [nookScene, setNookScene] = useState<string | null>(null);
  const [preparedAction, setPreparedAction] = useState('');
  const preparedSource = useRef<string | null>(null);
  const worldLoadGeneration = useRef(0);
  // The save this page has open, to reopen once when the server loses it (lib/world-reopen.ts).
  const worldReopener = useRef(createWorldReopener()).current;
  const loadWorldRef = useRef<((worldPath: string) => Promise<void>) | null>(null);
  const reopenInFlight = useRef(false);
  // Closed worlds: re-read on every load (a new save of the same world is a new
  // key, so "play again" never shows the previous run's ending).
  // The bag button can be dragged out of the way; its offset is remembered.
  const bagDrag = useDraggableOffset('airp.bag.offset');
  const [loadingWorld, setLoadingWorld] = useState<string | null>(null);
  // The run is read only once a load has finished: during a load the server may
  // still answer for the previous save, and the presentations would take that
  // answer as their baseline.
  const runKey = manifest && loadingWorld === null ? `${manifest.id}#${worldLoadGeneration.current}` : '';
  const closedRun = useClosedRun(runKey);
  // 个人页面: endings seen and play time, kept on this device and sent to chronicle.
  useProfileRecorder(closedRun, shelf);
  /**
   * The finale quotes the companion's closing line:
   * their last finished words on this save, read once when the ending arrives.
   */
  const finaleEndingId = closedRun.ending?.id ?? null;
  const finaleCompanion = useMemo(() => {
    if (!finaleEndingId) return null;
    const id = companionIdOf(manifest?.opening, characters);
    const who = characters.find(item => item.id === id);
    if (!who) return null;
    return { name: who.name || who.id, avatar: assetUrl(who.avatar) ?? null, line: lastCharacterLine(who.id) };
  }, [finaleEndingId, manifest?.opening, characters]);
  // `/api/opening` read ONCE per world load and shared: the greeting below and
  // the opening scene card must see the
  // same answer, though the greeting marks it as soon as it has read it.
  const openingReadRef = useRef<{ key: string; read: Promise<{ shown: boolean }> } | null>(null);
  const readOpeningOnce = useCallback((key: string) => {
    if (openingReadRef.current?.key !== key) openingReadRef.current = { key, read: airpGateway.opening() };
    return openingReadRef.current.read;
  }, []);
  // The opening scene card: `first` = this save has not had its opening
  // (null while reading); `done` once the card has played. The forced tutorial
  // waits for it, so the two never collide.
  const [openingScene, setOpeningScene] = useState<{ key: string; first: boolean | null; done: boolean }>({ key: '', first: false, done: true });
  useEffect(() => {
    if (!runKey) return;
    let live = true;
    setOpeningScene({ key: runKey, first: null, done: false });
    const settle = (first: boolean) => { if (live) setOpeningScene((s) => (s.key === runKey && s.first === null ? { ...s, first } : s)); };
    readOpeningOnce(runKey).then((r) => settle(!r.shown), () => settle(false));
    // An unreadable marker, or a card that never gets to play, must not wedge the tutorial.
    const read = window.setTimeout(() => settle(false), 5000);
    const wedge = window.setTimeout(() => { if (live) setOpeningScene((s) => (s.key === runKey ? { ...s, done: true } : s)); }, 30_000);
    return () => { live = false; window.clearTimeout(read); window.clearTimeout(wedge); };
  }, [runKey, readOpeningOnce]);
  const openingSceneHold = !runKey || (openingScene.key === runKey ? openingScene.first === null || (openingScene.first && !openingScene.done) : true);
  // The arrival greeting of THIS entry (lib/forced-tutorial `ArrivalGreeting`):
  // the forced tutorial shows nothing until the world has opened, its opening
  // card has played and the companion's greeting has been delivered — then the
  // `character` / `voice` performances hold it until the line has been heard
  //.
  // Keyed per entry: a load the launcher still covers is not an arrival yet.
  const entryKey = !launcherOpen && runKey ? runKey : '';
  const [arrival, setArrival] = useState<{ key: string; greeting: ArrivalGreeting }>({ key: '', greeting: 'waiting' });
  useEffect(() => {
    if (!entryKey) return;
    setArrival((a) => (a.key === entryKey ? a : { key: entryKey, greeting: 'waiting' }));
  }, [entryKey]);
  const settleArrival = useCallback((key: string, greeting: 'sent' | 'none') => {
    setArrival((a) => (a.key === key ? { ...a, greeting: settleArrivalGreeting(a.greeting, greeting) } : a));
  }, []);
  // A greeting that never comes must not keep the tutorial away: counted from
  // the end of the opening card, which can itself run long.
  useEffect(() => {
    if (!entryKey || openingSceneHold) return;
    const cap = window.setTimeout(() => settleArrival(entryKey, 'none'), TUTORIAL_ARRIVAL_MAX_MS);
    return () => window.clearTimeout(cap);
  }, [entryKey, openingSceneHold, settleArrival]);
  // Player / world / character panels: declared states as prose, on demand.
  const worldPanels = useWorldPanels(manifest ? `${manifest.id}#${worldLoadGeneration.current}` : '');
  // Character skills: the sheets the player panel and character modal open on demand.
  const worldSheets = useWorldSheets(manifest ? `${manifest.id}#${worldLoadGeneration.current}` : '');
  const [toast, setToast] = useState<string | null>(null);
  const [backdropReady, setBackdropReady] = useState(false);
  const writerState = useWriterState();
  const writerWorking = writerState.phase === 'writing';
  const writerStatusText = writerState.error
    ? writerState.error.message
    : writerState.phase === 'writing'
      ? writerState.stopRequested
        ? t('Stop requested')
        : writerState.stage ?? t('Waiting for the writer…')
      : writerState.stage ?? t('Ready for your next action');
  const writerStatusKind = writerState.error
    ? 'error'
    : writerState.phase === 'writing'
      ? 'working'
      : 'ready';
  const [writerSubmitPending, setWriterSubmitPending] = useState(false);
  const writerRef = useRef<HTMLInputElement>(null);
  const bagButtonRef = useRef<HTMLButtonElement>(null);
  const bagCloseRef = useRef<HTMLButtonElement>(null);
  const closeBag = useCallback(() => {
    setBagOpen(false);
    if (writerSuspendedForBagRef.current) {
      writerSuspendedForBagRef.current = false;
      setWriterSheetOpen(true);
      window.setTimeout(() => writerRef.current?.focus(), 0);
    } else {
      window.setTimeout(() => bagButtonRef.current?.focus(), 0);
    }
  }, []);
  const openBelongings = useCallback(() => {
    if (bagOpen) return;
    writerSuspendedForBagRef.current = writerSheetOpen;
    if (writerSheetOpen) {
      setWriterSheetOpen(false);
      writerRef.current?.blur();
    }
    setBagOpen(true);
  }, [bagOpen, writerSheetOpen]);
  const toggleBag = useCallback(() => {
    if (bagOpen) closeBag();
    else openBelongings();
  }, [bagOpen, closeBag, openBelongings]);
  useEffect(() => {
    if (!bagOpen) return;
    window.requestAnimationFrame(() => bagCloseRef.current?.focus());
  }, [bagOpen]);
  const activeSavePath = shelf.groups?.flatMap(group => group.saves).find(save => save.active)?.path;
  useEffect(() => {
    if (writerRef.current) writerRef.current.value = '';
    preparedSource.current = null;
    setPreparedAction('');
    setSelectedBagPath(null);
  }, [manifest?.id, activeSavePath]);
  const writerHistory = useRef<string[]>([]);
  const writerHistoryCursor = useRef(0);
  const [writerDraft, setWriterDraft] = useState('');
  const historyDraft = useRef('');
  const toastTimer = useRef<number | null>(null);
  const toastShowing = useRef<string | null>(null);
  const clearAdmittedCeremony = useCallback(() => {
    clearCeremony();
    const token = diceAdmissionRef.current;
    if (token) {
      overlayAdmission.release(token);
      diceAdmissionRef.current = null;
    }
  }, [overlayAdmission]);
  const writerPendingRef = useRef(false);

  // Character frames cross the one App-owned identity router into the queue.
  const frameQueue = useMemo(() => getCharacterFrameQueue(), []);

  // Dice ceremony (presentation channel, the design notes): the fullscreen roll
  // driven by the `dice_result` frame. Module store ... App is only mount.
  const ceremony = useSyncExternalStore(subscribeCeremony, getCeremonySnapshot);
  useEffect(() => {
    if (!ceremony && !diceAdmissionRef.current) return;
    const lease = focusCoordinator.registerSurface({
      key: 'dice-ceremony',
      owner: 'workspace',
      priority: 310,
      root: null,
      close: clearAdmittedCeremony,
    });
    return () => lease.unregister();
  }, [ceremony, clearAdmittedCeremony, focusCoordinator]);

  const camera = useCamera();
  const { setAmbient, setBGM, setTheme } = useAudio();

  // Canvas world state (layer payload, WS events, card persistence).
  const world = useWorld();
  const { state, layer, enterLayer, refresh, moveCard, sendToWriter, sendMessage } = world;
  // Where this save got to, for the launcher on any device (lib/account-data.ts): noted after each writer turn.
  const turnContext = useRef({ manifest, shelf, layer });
  const turnCounts = useRef(new Map<string, number>());
  turnContext.current = { manifest, shelf, layer };
  useEffect(() => {
    let began: { at: number; turn: boolean } | null = null;
    return subscribeWriterState(() => {
      const writer = getWriterState();
      if (writer.phase === 'writing') { began ??= { at: Date.now(), turn: writer.reason === 'turn' }; return; }
      const turn = began;
      began = null;
      // A replayed history flips writing → idle at once, and chalk is not a turn: only a turn that ran counts.
      if (!turn?.turn || writer.error || Date.now() - turn.at < 1500) return;
      const { manifest: current, shelf: saves, layer: place } = turnContext.current;
      const group = saves.groups?.find(g => g.saves.some(save => save.active));
      const active = group?.saves.find(save => save.active);
      if (!group || !active) return;
      accountData()?.noteTurn({ saveId: active.id, worldId: worldKeyOf(group), worldRef: group.id, worldName: worldTitle(current?.name || group.name), scene: sceneName(current, place) });
      // 改进产品: the first turn and every 5th (lib/analytics.ts) — the count only, never the text.
      const counted = accountData()?.getState().saves.find(save => save.saveId === active.id)?.turns;
      const n = counted ?? (turnCounts.current.set(active.id, (turnCounts.current.get(active.id) ?? 0) + 1).get(active.id) ?? 1);
      trackTurn(n, worldKeyOf(group));
      // …and the n-th turn of this visit (session_turn at 1, 2, 3, 6, 11, 21 …; chronicle 「每次来玩几回合」).
      visit.turn(place);
      // The guest trial: re-read the trial credits; nearly used → ask to sign in once (lib/guest-trial.ts).
      void afterGuestTurn();
      // A guided experience counts its turns by command: the world's turn-end runs now.
      // A world with a character tick sends its beat through useCharacterTick instead (one call for both).
      if (worldExperienceOf(current)?.turnEnd && !worldTickOf(current) && (current as { hints?: unknown } | null)?.hints !== true) void airpGateway.turnEnd().catch(() => {});
    });
  }, []);
  // 「总打开次数」: each time the launcher gives way to a world, chronicle hears `world.open` once (the server folds a
  // reopen of the same world within 30 minutes; signed out = nothing sent). Keyed by the save, so a re-render is not an open.
  const openedSave = useRef<string | null>(null);
  const activeOpen = shelf.groups?.find(g => g.saves.some(save => save.active));
  const activeOpenSave = activeOpen?.saves.find(save => save.active)?.id ?? null;
  useEffect(() => {
    if (launcherOpen || !activeOpen || !activeOpenSave) { if (launcherOpen) openedSave.current = null; return; }
    if (openedSave.current === activeOpenSave) return;
    openedSave.current = activeOpenSave;
    accountData()?.noteOpen({ worldRef: activeOpen.id });
    const resumed = (accountData()?.getState().saves.find(save => save.saveId === activeOpenSave)?.turns ?? 0) > 0;
    track('world_enter', { resumed, tracked: true }, worldKeyOf(activeOpen));
    visit.enter(worldKeyOf(activeOpen), turnContext.current.layer);
  }, [launcherOpen, activeOpen, activeOpenSave]);
  // Back to the launcher = this visit ended: its turns and where the player stopped (world_leave).
  useEffect(() => { if (launcherOpen) visit.leave({ close: true }); }, [launcherOpen]);
  // 改进产品: the lobby (launcher) was shown.
  useEffect(() => { if (launcherOpen && firstRunPhase === 'off') track('lobby_view'); }, [launcherOpen, firstRunPhase]);
  // A first scene entry is one of the two presentation moments, and
  // `layer_entered` is not in the world-event forward set: re-read the run
  // when the layer changes.
  useEffect(() => {
    if (layer) window.dispatchEvent(new CustomEvent(RUN_REFRESH_DOM));
  }, [layer]);
  // 改进产品 (lib/analytics.ts): the player is now in another scene.
  useEffect(() => {
    if (layer && !launcherOpen) track('scene_entered', undefined, activeOpen ? worldKeyOf(activeOpen) : null);
    if (!launcherOpen) visit.place(layer);
  }, [layer]); // eslint-disable-line react-hooks/exhaustive-deps
  // 新手礼包 (lib/newcomer-gift.ts): a signed-in player entering a scene gets the one-time 500 credits
  // without a click (once per session; the daily 100 stays a click: DailyClaim / ClaimPrompt).
  useEffect(() => {
    if (layer && !launcherOpen) void autoNewcomerGift();
  }, [layer]); // eslint-disable-line react-hooks/exhaustive-deps
  // Creation mode's 素材 panel: the author's own draft only.
  // Re-read on world load, on every place change and whenever the panel opens,
  // so prompts the writer just wrote show up.
  const artAuthoring = isArtAuthoring(manifest);
  const [artPanelOpen, setArtPanelOpen] = useState(false);
  const workshopArt = useWorkshopArt(artAuthoring, manifest ? `${manifest.id}#${worldLoadGeneration.current}#${layer}#${artPanelOpen}` : '');
  const unpaintedMap = artAuthoring && workshopArt.art ? missingMapSlot(workshopArt.art.slots, layer) : null;
  const actionRequestResolver = useCallback(async <TDetails,>(intent: ActionIntent, signal: AbortSignal): Promise<ActionResultLike<TDetails>> => {
    try {
      if (intent.verb === 'present' && intent.item && intent.target) {
        const details = await airpGateway.useItem(intent.item, intent.target, signal);
        return { ok: true, ...details } as unknown as ActionResultLike<TDetails>;
      }
      if (intent.verb === 'choice' && intent.target && intent.choice !== undefined) {
        const details = await airpGateway.choose(intent.target, intent.choice, signal);
        return { ok: true, ...details } as unknown as ActionResultLike<TDetails>;
      }
      if ((intent.verb === 'take' || intent.verb === 'drop' || intent.verb === 'move') && intent.from && intent.to) {
        const details = await airpGateway.move(intent.from, intent.to, signal);
        return { ok: true, ...details } as unknown as ActionResultLike<TDetails>;
      }
      return { ok: false, code: 'invalid_argument', error: 'The action parameters are incomplete.' } as ActionResultLike<TDetails>;
    } catch (error) {
      return { ok: false, error } as ActionResultLike<TDetails>;
    }
  }, []);
  // One coordinator belongs to the currently active world. A new manifest
  // identity gets a fresh context, so late work from the previous world can
  // never publish into the new projection.
  const actionCoordinator = useMemo(() => createActionFeedbackCoordinator(actionRequestResolver), [actionRequestResolver, manifest?.id]);
  useEffect(() => {
    if (manifest?.id) actionCoordinator.reset(manifest.id);
  }, [actionCoordinator, manifest?.id]);
  const arrangeControlRef = useRef<CanvasArrangeControlHandle>(null);
  /** Canvas or map: the chalk canvas, or the layer drawn as a place. */
  const [viewMode, setViewMode] = useViewMode();
  // Entering a world opens it in its own view (map-first TRPG worlds), unless the
  // player switched views in this world before (lib/view-mode.ts `enterWorldView`).
  const worldView = worldDefaultViewOf(manifest);
  useEffect(() => {
    enterWorldView(manifest?.id ?? null, worldView);
  }, [manifest?.id, worldView]);
  useEffect(() => {
    worldEventToastStore.setProjectId(manifest?.id ?? null);
  }, [manifest?.id]);
  const cameraStackRef = useRef<CameraMemoryStack | null>(null);
  if (cameraStackRef.current === null) {
    cameraStackRef.current = createCameraMemoryStack(camera, projectionTarget('layer', layer));
  }
  const cameraStack = cameraStackRef.current!;
  useEffect(() => {
    if (nookChar === null && !activeCharacter) {
      cameraStack.setCurrent(projectionTarget('layer', layer));
    }
  }, [activeCharacter, cameraStack, layer, nookChar]);
  const callerProjectionRef = useRef<ProjectionTarget | null>(null);
  const projectionTransitionRef = useRef<{ epoch: number; nook: string | null }>({ epoch: 0, nook: null });
  const chromeVisible = !shell.immersive;
  const isDusk = backdropReady;

  // The canonical writer-state projection owns busy phase; App only derives
  // the input lock and never mirrors progress frames into local state.
  const writerLocked = writerWorking || writerSubmitPending || state?.worldFrozen === true;
  useEffect(() => {
    if (writerWorking && writerPendingRef.current) {
      writerPendingRef.current = false;
      setWriterSubmitPending(false);
    }
  }, [writerWorking]);

  // The ONLY writer of `nookScene`. Entering a scene is
  // a page swap in the SAME projection, so it touches no camera frame — the
  // canvas slot swap on `currentLayer` already moves the camera (04 §③ step 4).
  const enterNookScene = useCallback((next: string | null) => {
    setNookScene(next);
  }, []);
  const openPrivateSpace = useCallback((characterId: string) => {
    // Dialogue and rail use one App-owned transition. Closing an active
    // dialogue first restores its caller projection, then this transition
    // pushes the private-space target without asking either child to own camera.
    if (!characterId) return;
    const nextEpoch = projectionTransitionRef.current.epoch + 1;
    projectionTransitionRef.current = { epoch: nextEpoch, nook: characterId };
    if (activeCharacter) closeCharacterRef.current();
    if (nookChar === characterId) {
      // Closing dialogue temporarily borrows callerProjectionRef; restore the
      // Nook's underlying layer caller before leaving this transition.
      if (!callerProjectionRef.current) callerProjectionRef.current = projectionTarget('layer', layer);
      return;
    }

    // Replacing one Nook with another must unwind the old top frame first.
    // Keeping A→B as nested frames would make closing B restore A and then
    // unmount the stage, leaving the camera pointed at a non-active root.
    let caller: ProjectionTarget = nookChar
      ? projectionTarget('nook', nookChar)
      : projectionTarget('layer', layer);
    if (nookChar) {
      const frame = cameraStack.popTransition(caller);
      if (frame) {
        cameraStack.restoreProjection(frame);
        caller = frame.caller;
      }
    }
    const target = projectionTarget('nook', characterId);
    cameraStack.pushTransition(target);
    cameraStack.restoreTarget(target);
    callerProjectionRef.current = caller;
    frameQueue.clear('switch');
    setNookChar(characterId);
    setNookScene(null); // #4: switching character never passes through null (00 §4.6)
    writerSuspendedForBagRef.current = false;
    setBagOpen(false);
    setSelectedBagPath(null);
    setProfileOpen(false);
    setShell(current => current.header || current.journal || current.immersive ? { ...current, header: false, journal: false, immersive: false } : current);
  }, [activeCharacter, cameraStack, frameQueue, layer, nookChar]);

  const closeNook = useCallback(() => {
    // A stale Back handler from a replaced Nook must not pop a newer camera frame.
    const transition = projectionTransitionRef.current;
    if (nookChar === null || transition.nook !== nookChar) return;
    projectionTransitionRef.current = { epoch: transition.epoch + 1, nook: null };
    const caller = callerProjectionRef.current;
    callerProjectionRef.current = null;
    if (caller) {
      const frame = cameraStack.popTransition(caller);
      if (frame) cameraStack.restoreProjection(frame);
    }
    frameQueue.clear('close');
    // Leaving her space ends the chat there (the writer's summary); the agent
    // itself belongs to the dialogue, which may stay open.
    sendMessage(chatEndFrame(nookChar, 'dialogue'));
    setNookChar(null);
    void refresh();
  }, [cameraStack, frameQueue, nookChar, refresh, sendMessage]);
  const notify = useCallback((message: string) => {
    // A scene card on screen: the notice waits and shows right after it.
    if (isStageBusy()) {
      whenStageIdle(() => notify(message));
      return;
    }
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastShowing.current = message;
    setToast(message);
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = null;
      toastShowing.current = null;
      setToast(null);
    }, 3000);
  }, []);
  // 新手礼包 arrived just now (lib/newcomer-gift.ts): a small toast, 「新手礼包 500 积分已到账」.
  useEffect(() => onNewcomerGift((g) => notify(t('Newcomer gift: {credits} credits have arrived', { credits: g.credits.toLocaleString() }))), [notify, t]);
  // A notice already up when a scene card arrives (e.g. "Action confirmed…" right
  // before the entered scene's card) is taken down and shown again, in full, after it (§3.3).
  useEffect(() => subscribeStageBusy(() => {
    const showing = toastShowing.current;
    if (!isStageBusy() || showing === null) return;
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = null;
    toastShowing.current = null;
    setToast(null);
    whenStageIdle(() => notify(showing));
  }), [notify]);
  useEffect(() => { syncFocus('world-shelf', worldPickerOpen); }, [syncFocus, worldPickerOpen]);
  useEffect(() => { syncFocus('nook', nookChar !== null); }, [nookChar, syncFocus]);
  // Leaving the nook always returns to the character ROOT. This covers the three
  // `setNookChar(null)` sites; the fourth (`openPrivateSpace` switching to another
  // character, above) skips `null` and resets the scene explicitly (00 §4.6).
  useEffect(() => { if (nookChar === null) setNookScene(null); }, [nookChar]);
  // `character-dialogue` means "the stage has the floor": while it is held,
  // overlay-admission refuses dice and the radial menu. That is right for the
  // classic modal, which covers the canvas — and wrong for the companion dock,
  // which sits beside a live canvas the player must keep using. The dock takes
  // a `workspace` surface instead (CharacterDock), so Escape still closes it.
  useEffect(() => { syncFocus('character-dialogue', !companion && activeCharacter !== null); }, [companion, activeCharacter, syncFocus]);
  // Deferring the character's pointer is paid for by the classic stage DIMMING
  // the canvas: you could not watch it work, so the steps are recorded and
  // replayed from the avatar on close (lib/agent-cursor.ts). The companion dock
  // leaves the canvas fully visible, so that trade has nothing to buy — the
  // pointer runs live WHILE you chat, which is the whole point of talking to
  // someone who is standing in the scene. Reporting `null`
  // is exactly "no dialogue is covering the canvas"; nothing here touches the
  // dice / radial admission, which is a separate gate.
  useEffect(() => {
    agentCursorStore.setDialogue(companion ? null : activeCharacter?.id ?? null);
  }, [companion, activeCharacter?.id]);
  useEffect(() => { syncFocus('belongings', bagOpen || selectedBagItem !== undefined); }, [bagOpen, selectedBagItem, syncFocus]);
  useEffect(() => { syncFocus('profile', profileOpen); }, [profileOpen, syncFocus]);
  useEffect(() => { syncFocus('writer', attention === 'authoring' && !shell.immersive); }, [attention, shell.immersive, syncFocus]);
  useEffect(() => { syncFocus('journal', shell.journal); }, [shell.journal, syncFocus]);

  // The single presence projection (§4.1): both the canvas avatars and the
  // character rail consume THESE views, never a re-derivation of their own.
  const { views: presenceViews, navigateTo: navigateToCharacter } = usePresence({
    characters,
    layer,
    presence: state?.presence ?? [],
    readLayerState: world.readLayerState,
    enterLayer: world.enterLayer,
    camera,
    // `lib/presence.ts` stays pure and emits English KEY strings for its
    // notices; translate them at the boundary, like the
    // rail does. Passing `notify` straight through leaked English into a
    // Japanese session.
    notify: (key: string) => notify(t(key)),
  });
  // The rail lists only people the player has met in this run (末班车 playtest 10-13: 钟怀礼's face sat on the rail
  // from the first beat, marked 「其他地区」): someone becomes met once they stand on the player's page or follow.
  // Kept for this load only — after a reload a person reappears as soon as they are seen again.
  const [metIds, setMetIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => { setMetIds(new Set()); }, [runKey]);
  useEffect(() => {
    const seen = presenceViews.filter((view) => view.state === 'in-scene' || view.following).map((view) => view.id);
    if (seen.every((id) => metIds.has(id))) return;
    setMetIds((current) => new Set([...current, ...seen]));
  }, [presenceViews, metIds]);
  const railViews = useMemo(
    () => presenceViews.filter((view) => view.state === 'in-scene' || view.following || metIds.has(view.id)),
    [presenceViews, metIds],
  );
  /** The way out of this layer on the map; none at the top of the world. */
  const boardParent = useMemo(() => {
    if (layer === 'map') return null;
    const parentId = manifest?.layers?.[layer]?.parent || 'map';
    return { id: parentId, name: sceneName(manifest, parentId) };
  }, [layer, manifest]);
  /**
   * Everyone and where they are, as map tokens: those on this
   * layer stand on it, those inside one of its places stand beside that place.
   */
  const boardCharacters = useMemo(
    () => presenceViews
      // Only people the player can know about: the rail's rule — here, following,
      // or met in this load. Someone never met is not a token on the map either.
      .filter(view => view.state !== 'absent' && (view.state === 'in-scene' || view.following || metIds.has(view.id)))
      .map(view => ({
        id: view.id,
        name: view.name,
        avatar: assetUrl(view.avatar, 'image') ?? undefined,
        layer: view.layer,
        here: view.state === 'in-scene',
      })),
    [presenceViews, metIds],
  );
  // The rail carrier's call, if any. The immersive wake button below is its
  // only reachable hang-up once `.is-immersive` hides the rail root, so it MUST
  // carry the snapshot's ownership field verbatim — `rail:<id>` already has its
  // prefix.
  const liveCall = useLiveCallState();
  const { stop: liveCallStop } = useLiveCallActions();
  // Read by the character-frame boundary below without re-subscribing it on every call tick.
  const liveCallRef = useRef(liveCall);
  liveCallRef.current = liveCall;
  const railCallOwner = typeof liveCall.owner === 'string' && liveCall.owner.startsWith('rail:')
    ? liveCall.owner
    : null;
  // Ids whose follow request is in flight. UI only — NOT the follow truth:
  // nothing reads it as `following`.
  const [pendingFollowing, setPendingFollowing] = useState<ReadonlySet<string>>(new Set());

  const toggleFollowing = useCallback(async (id: string, next: boolean) => {
    setPendingFollowing(current => new Set(current).add(id));
    try {
      await airpGateway.setFollowing(id, next);
      // No optimistic write: `presence.following` is the only truth (§2.4), and
      // the writer may have flipped it in the meantime. The world event brings
      // the new projection.
    } catch {
      notify(t('Could not change whether {name} follows you.', { name: labelOf(id) }));
    } finally {
      setPendingFollowing(current => {
        const nextPending = new Set(current);
        nextPending.delete(id);
        return nextPending;
      });
    }
  }, [notify, t]);

  /**
   * Surface the characters that could NOT follow into the new layer
   *. The server reports them in the
   * `enter-layer` reply; a left-behind character must never be silent.
   * A `null` result means "same layer or the request failed" — that path is
   * already surfaced by `airp:gate-feedback` / `airp:notice` in `useWorld`.
   */
  const applyFollowFailures = useCallback(
    (result: EnterLayerOutcome | null) => {
      const details = result?.kind === 'accepted' ? result.details : null;
      if (!details?.followers?.failures?.length) return;
      notify(t('Some of the party could not follow you.'));
    },
    [notify, t]
  );

  const loadChromeData = async () => {
    const generation = worldLoadGeneration.current;
    try {
      const [nextManifest, nextBackpack, nextCharacters, nextShelf] = await Promise.all([
        airpGateway.manifest<WorldManifest>(),
        airpGateway.backpack<BackpackItem[]>(),
        airpGateway.characters<CharacterView[]>(),
        airpGateway.worlds(),
      ]);
      if (generation !== worldLoadGeneration.current) return;
      setManifest(nextManifest);
      setBackpack(nextBackpack.items);
      setCharacters(nextCharacters.characters);
      setShelf(nextShelf);
    } catch (error) {
      // `no_active_world` is not a data failure: the world shelf is already
      // opening (see the `onWorldUnavailable` effect) and telling the player to
      // "retry" would be false. Only genuine load errors get the toast.
      const unavailable = error instanceof AirpRequestError && error.payload?.code === 'no_active_world';
      if (!unavailable) {
        // The character rail's ONLY data source: a silent empty rail would read
        // as "nobody is here".
        notify(t('Could not load the world data. Please retry.'));
        console.warn('Could not load AIRP chrome data:', error);
      }
    }
  };
  useEffect(() => {
    const unavailable = () => {
      // The page still shows a world the server no longer has open: reopen that
      // save (at most once a minute) instead of stranding the player on the shelf.
      // Every world-scoped request answers 409 at once: one reopen, the rest wait for it.
      if (reopenInFlight.current) return;
      const reopen = worldReopener.take();
      if (reopen && loadWorldRef.current) {
        reopenInFlight.current = true;
        notify(t('The world connection dropped. Reopening it…'));
        void loadWorldRef.current(reopen).finally(() => { reopenInFlight.current = false; });
        return;
      }
      writerPendingRef.current = false;
      setWriterSubmitPending(false);
      setManifest(null);
      setBackpack([]);
      setCharacters([]);
      setNookChar(null);
      setActiveCharacter(null);
      callerProjectionRef.current = null;
      cameraStack.clear();
      // Phones: the shelf starts collapsed (lib/world-shelf-pref.ts) — it covered the lobby's tiles.
      if (autoOpenWorldShelf()) setWorldPickerOpen(true);
      frameQueue.clear('disconnect');
      void airpGateway.worlds().then(setShelf).catch(() => notify('Could not load the world shelf. Please retry.'));
    };
    // Replayed subscription, not a one-shot `airp:world-unavailable` listener:
    // the first `no_active_world` can land before this effect registers, and a
    // missed signal would leave the player on a blank canvas with no way to pick
    // a world.
    return onWorldUnavailable(unavailable);
  }, []);

  useEffect(() => {
    const onNotice = (event: Event) => {
      const customEvent = event as CustomEvent<unknown>;
      const detail: unknown = customEvent.detail;
      if (detail && typeof detail === 'object' && 'id' in detail && typeof detail.id === 'string') {
        let copyKey: string | null = null;
        switch (detail.id) {
          case 'character_close_deferred': copyKey = 'Character close is queued until the model update finishes.'; break;
          case 'character_close_world_changed': copyKey = 'The character was closed by the active world change.'; break;
          case 'character_close_error': copyKey = 'The character close could not be fully completed.'; break;
        }
        if (copyKey) {
          notify(t(copyKey));
          return;
        }
      }
      const raw = typeof detail === 'string' ? detail : String(detail);
      const friendly = friendlyModelError(raw);
      notify(t(friendly ?? raw));
    };
    window.addEventListener('airp:notice', onNotice);
    return () => window.removeEventListener('airp:notice', onNotice);
  }, [t]);
  // Signed out / a guest: no voices (lib/tts-readiness.ts asks nothing more this session) — said once, quietly.
  useEffect(() => {
    const onVoiceNeedsAccount = () => notify(t("Sign in to hear the characters' voices."));
    window.addEventListener(TTS_REQUIRES_ACCOUNT_EVENT, onVoiceNeedsAccount);
    return () => window.removeEventListener(TTS_REQUIRES_ACCOUNT_EVENT, onVoiceNeedsAccount);
  }, [notify, t]);

  // I1 initialiser outcome: a failed materialisation must be
  // visible — never a silent canvas (contract §8 anti-pattern 8). The success
  // path needs no UI here; the ghost clears and the refetched layer replaces it.
  // The App is the sole identity boundary: only an active, valid character
  // frame reaches the shared FIFO. Missing ids never inherit modal context.
  useEffect(() => {
    const onCharacterFrame = (event: Event) => {
      const msg = (event as CustomEvent).detail as unknown;
      const activeId = activeCharacter?.id;
      if (!activeId) return;
      if (!isCharacterFrame(msg)) {
        const candidate =
          msg && typeof msg === 'object' && 'characterId' in msg ? msg.characterId : undefined;
        if (candidate === undefined) notify('This character reply could not be assigned. Reopen the dialogue.');
        return;
      }
      if (msg.savePath !== activeWorldPath) return;
      if (msg.characterId !== activeId) {
        // The character on a call speaks through the call: their frames are
        // not a stray reply to this dialogue, and a toast per frame is noise.
        if (callCarries(liveCallRef.current, msg.characterId)) return;
        notify(`Character reply for ${msg.characterId} could not be assigned to ${activeId}.`);
        return;
      }
      frameQueue.enqueue(msg, frameQueue.nextDeliverySeq());
    };
    window.addEventListener('airp:character-frame', onCharacterFrame);
    return () => window.removeEventListener('airp:character-frame', onCharacterFrame);
  }, [activeCharacter?.id, activeWorldPath, frameQueue, notify]);

  // Dice ceremony: forwarded raw frame → boundary guard → layer filter / dedup
  // → ceremony layer. Rebinds on the current layer so the filter reads the live
  // value; the cleanup ends an in-flight ceremony when the player switches
  // layers.
  useEffect(() => {
    const onDiceFrame = (event: Event) => {
      const raw = (event as CustomEvent).detail as unknown;
      const parsed = parseDiceFrameResult(raw);
      if (!parsed.ok) {
        if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'dice_result') {
          notify('The dice result could not be understood.');
        }
        return;
      }
      const v = parsed.value;
      if (!shouldPlayFrame(v, layer)) return;
      const record = raw && typeof raw === 'object' ? raw : null;
      const rawSource = record && 'source' in record ? record.source : undefined;
      const rawCharacterId = record && 'characterId' in record ? record.characterId : undefined;
      if (rawSource === 'character' || rawCharacterId !== undefined) {
        if (rawSource !== 'character' || !activeCharacter || v.characterId !== activeCharacter.id) return;
      }
      if (diceAdmissionRef.current) clearAdmittedCeremony();
      const caller: FocusOwner = activeCharacter ? 'character-dialogue' : nookChar ? 'nook' : 'workspace';
      const admission = overlayAdmission.request('dice', caller);
      if (!admission.accepted) {
        notify(admission.message);
        return;
      }
      markPlayed(v.path);
      diceAdmissionRef.current = admission.token;
      playCeremony(v);
    };
    window.addEventListener('airp:dice-frame', onDiceFrame);
    return () => {
      window.removeEventListener('airp:dice-frame', onDiceFrame);
      clearAdmittedCeremony();
    };
  }, [activeCharacter?.id, clearAdmittedCeremony, layer, nookChar, notify, overlayAdmission]);

  useEffect(() => {
    void loadChromeData();
    const onWorldEvent = () => void loadChromeData();
    window.addEventListener('airp:world-event', onWorldEvent);
    return () => {
      window.removeEventListener('airp:world-event', onWorldEvent);
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const themeUrl = manifest?.audio?.theme ?? null;
  // While the launcher is open the world's beds stay silent under its own music;
  // closing it re-runs these and brings the world's sound back.
  useEffect(() => {
    if (!state || launcherOpen) return;
    setAmbient(state.audio.ambient ?? null);
    setBGM(state.audio.bgm ?? null);
    const urls = [state.audio.ambient, state.audio.bgm, themeUrl].filter(
      (url): url is string => typeof url === 'string' && url.length > 0
    );
    if (urls.length) void preloadAudio(urls);
  }, [state?.audio?.ambient, state?.audio?.bgm, themeUrl, setAmbient, setBGM, launcherOpen]);
  // A place with its own music (`bgm:`) or a declared `bgm: silence` rests the
  // world theme — the two never play together; leaving
  // that place brings the theme back. `state` null (loading) keeps the theme.
  const themeRests = !!state && (!!state.audio.bgm || state.audio.quiet === true);
  useEffect(() => { if (!launcherOpen) setTheme(themeRests ? null : themeUrl); }, [themeUrl, themeRests, setTheme, launcherOpen]);
  useEffect(() => {
    if (!launcherOpen) return;
    setAmbient(null);
    setBGM(null);
    setTheme(LAUNCHER_THEME);
  }, [launcherOpen, setAmbient, setBGM, setTheme]);
  useEffect(() => {
    const src = state?.bg?.src;
    if (!src || loadingWorld) {
      setBackdropReady(false);
      return;
    }
    const imageUrl = airpGateway.assetUrl(src, undefined, 'image');
    const sync = () => setBackdropReady(mediaReadiness.snapshot('background', imageUrl).state === 'ready');
    sync();
    return mediaReadiness.subscribe(sync);
  }, [state?.bg?.src, loadingWorld]);

  const dispatchEscape = useCallback((event: KeyboardEvent): boolean => {
    if (event.key !== 'Escape' || isComposingEscape(event) || event.defaultPrevented) return false;

    if (arrangeControlRef.current?.isFocused() && arrangeControlRef.current.cancel()) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    const surface = focusCoordinator.closeTopmostSurface();
    if (surface) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    const topmost = focusCoordinator.peek();
    if (topmost) {
      const entry = focusCoordinator.handleEscape();
      // A closing surface retains its owner until its commit/unmount. Consume
      // another Escape during that window without falling through to parent.
      event.preventDefault();
      event.stopPropagation();
      if (!entry) return true;
      if (entry.owner === 'character-dialogue') closeCharacterRef.current();
      else if (entry.owner === 'nook') closeNook();
      else if (entry.owner === 'world-shelf') { rememberWorldShelf(false); setWorldPickerOpen(false); }
      else if (entry.owner === 'belongings') {
        if (selectedBagPath !== null) setSelectedBagPath(null);
        else closeBag();
      } else if (entry.owner === 'profile') setProfileOpen(false);
      else if (entry.owner === 'writer') {
        writerRef.current?.blur();
        setAttention('ambient');
        setIsGodHandOpen(false);
      } else if (entry.owner === 'journal') {
        setShell(current => ({ ...current, journal: false }));
      }
      return true;
    }

    if (shell.journal) {
      event.preventDefault();
      event.stopPropagation();
      setShell(current => ({ ...current, journal: false }));
      return true;
    }
    if (shell.header) {
      event.preventDefault();
      event.stopPropagation();
      setShell(current => ({ ...current, header: false }));
      return true;
    }
    if (shell.immersive) {
      event.preventDefault();
      event.stopPropagation();
      setShell(current => ({ ...current, immersive: false }));
      return true;
    }
    if (layer !== 'map') {
      event.preventDefault();
      event.stopPropagation();
      void enterLayer(manifest?.layers?.[layer]?.parent || 'map').then(applyFollowFailures);
      return true;
    }
    return false;
  }, [enterLayer, focusCoordinator, layer, manifest, selectedBagPath, shell.header, shell.immersive, shell.journal, closeNook]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dispatchEscape(event);
        return;
      }
      if (isTextEditingTarget(event.target) || activeCharacter) return;
      // A focused canvas card (a door) owns its own Enter. Doors only became
      // focusable this batch, so this capture-phase handler used to steal focus
      // to the writer as a side effect of walking in.
      // `closest`, not `matches`: the card is a DESCENDANT of the world surface.
      if (event.target instanceof Element && event.target.closest('[data-depth-surface="world"]')) return;
      if ((event.key === 'Tab' || event.key === 'Enter') && focusCoordinator.peek() !== null) return;
      if (event.shiftKey && event.key.toLowerCase() === 'r') {
        if (focusCoordinator.peek() !== null) return;
        event.preventDefault();
        if (shell.immersive) {
          setShell(current => ({ ...current, immersive: false }));
          window.requestAnimationFrame(() => arrangeControlRef.current?.request());
        } else {
          arrangeControlRef.current?.request();
        }
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        toggleShell('immersion');
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        setAttention('authoring');
        setShell(current => ({ ...current, immersive: false }));
        window.setTimeout(() => writerRef.current?.focus(), 0);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [activeCharacter, dispatchEscape, focusCoordinator, shell.immersive]);

  const chalks = useMemo(
    () => (state?.items || []).filter((item) => item.frontmatter?.type === 'chalk'),
    [state?.items],
  );
  const readme = useMemo(() => {
    const expected = layer === 'map' ? 'world/README.md' : `${layer}/README.md`;
    // `/api/layer` returns the layer's own README as `scene`, not among `items`;
    // reading only `items` left every sub-layer "not ready", so the overlay gate
    // refused dialogue and dice there ("The world is unavailable").
    if (state?.scene?.path === expected) return state.scene;
    return state?.items.find((item) => item.path === expected);
  }, [layer, state?.items, state?.scene]);
  const worldReady = Boolean(manifest && state && readme);
  useEffect(() => {
    overlayAdmission.setWorldAvailable(worldReady);
    if (!worldReady) {
      clearAdmittedCeremony();
      const dialogueToken = characterAdmissionRef.current;
      if (dialogueToken) {
        overlayAdmission.release(dialogueToken);
        characterAdmissionRef.current = null;
      }
      const radialToken = radialAdmissionRef.current;
      if (radialToken) {
        overlayAdmission.release(radialToken);
        radialAdmissionRef.current = null;
      }
      setRadialState(null);
    }
  }, [clearAdmittedCeremony, overlayAdmission, worldReady]);
  const handItems = backpack.filter((item) => item.filename.toLowerCase() !== 'readme.md');
  /** What the player carries, by path: a map door that asks for something else is drawn locked. */
  const carriedPaths = useMemo(() => new Set(handItems.map(item => item.path)), [handItems]);
  // Only while a world is open: before that (the language screen, the lobby) every report was a 409 no_active_world.
  useViewpointReport({ camera, layer, bagCount: handItems.length, enabled: nookChar === null && activeWorldPath !== null });
  /**
   * ONE writer prompt definition for both shells: the classic
   * bottom dock and the companion FAB sheet render the same `WriterBar` with
   * the same draft, the same history keys and the same lock, so submit / stop /
   * retry / voice input cannot drift between layouts.
   */
  const writerBarProps: WriterBarProps = {
    embedded: true,
    inputRef: writerRef,
    inputAriaLabel: t('Action'),
    value: writerDraft,
    onChange: setWriterDraft,
    onSend: text => submitWriterText(text),
    disabled: writerLocked,
    placeholder: t("What do you do? You can also address someone by name…"),
    writingPlaceholder: t('The writer is writing…'),
    sendLabel: '↑',
    onKeyDown: event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key) || !writerHistory.current.length) return;
      event.preventDefault();
      event.stopPropagation();
      const history = writerHistory.current;
      if (writerHistoryCursor.current === history.length) historyDraft.current = writerDraft;
      writerHistoryCursor.current = Math.max(0, Math.min(history.length, writerHistoryCursor.current + (event.key === 'ArrowUp' ? -1 : 1)));
      const next = writerHistoryCursor.current === history.length ? historyDraft.current : history[writerHistoryCursor.current];
      setWriterDraft(next);
      window.requestAnimationFrame(() => {
        const input = writerRef.current;
        if (input) input.setSelectionRange(input.value.length, input.value.length);
      });
    },
  };
  const canvasItems = (state?.items || []).filter((item) => item.path !== readme?.path);
  // The player's sticky notes + clue board:
  // the world canvas only — never in a nook. Toolbar and board mode are play
  // only; a note can also be pinned from the radial while authoring.
  const playerBoard = usePlayerBoard(nookChar || !state ? null : layer, notify);
  const boardCanvas = Boolean(state) && !nookChar && !loadingWorld && viewMode !== 'map';
  const clueBoard = useClueBoard({
    api: playerBoard,
    layer: nookChar ? null : layer,
    enabled: boardCanvas && attention !== 'authoring',
    notesEnabled: boardCanvas,
    nameOf: (path) => {
      const character = /^characters\/([^/]+)$/.exec(path);
      if (character) return characters.find((c) => c.id === character[1])?.name ?? character[1];
      const item = canvasItems.find((it) => it.path === path);
      const fm = item?.frontmatter;
      return String(fm?.title || fm?.name || (item?.body ?? '').split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').slice(0, 40) || path.split('/').pop() || path);
    },
  });
  const canvasLinks = React.useMemo(
    () => [...(state?.links || []), ...playerBoard.links],
    [state?.links, playerBoard.links],
  );
  // The provisional "taking shape" card while this layer's I1 init runs
  //. Client-only; deliberately NOT part of `canvasItems`.
  // Memoised: the seat reads module-level seat state, so recomputing per render
  // would let the card drift between frames.
  const ghostLabel = t('Taking shape…');
  const ghostItem = useMemo(
    () => (world.initializingLayer === layer ? ghostItemFor(layer, ghostLabel) : null),
    [world.initializingLayer, layer, ghostLabel]
  );
  const currentName = readme?.frontmatter?.title || sceneName(manifest, layer);
  const playerRole = manifest?.player?.name || (manifest?.id === 'wuwu' ? 'Harbor Investigator' : 'Traveler');
  const playerAvatar = assetUrl(manifest?.player?.avatar, 'image');
  const breadcrumbs: string[] = [];
  let crumb: string | null = layer;
  while (crumb && !breadcrumbs.includes(crumb)) {
    breadcrumbs.unshift(crumb);
    crumb = manifest?.layers?.[crumb]?.parent || (crumb === 'map' ? null : 'map');
  }

  useEffect(() => {
    const onBack = (event: KeyboardEvent) => {
      if (event.altKey && event.key === 'ArrowLeft' && !activeCharacter) {
        event.preventDefault();
        void enterLayer(manifest?.layers?.[layer]?.parent || 'map').then(applyFollowFailures);
      }
    };
    window.addEventListener('keydown', onBack);
    return () => window.removeEventListener('keydown', onBack);
  }, [layer, manifest, activeCharacter, enterLayer]);

  const actionProjection = useCallback((targetLayer = layer): string => {
    if (nookChar && (targetLayer === layer || targetLayer.startsWith('characters/'))) return `nook:${nookChar}`;
    return `layer:${targetLayer}`;
  }, [layer, nookChar]);
  const reconcileAction = useCallback(async (_details: unknown, signal: AbortSignal, projection: string): Promise<ReconcileReceipt> => {
    if (signal.aborted) throw new DOMException('Action reconciliation was cancelled.', 'AbortError');
    await refresh();
    if (signal.aborted) throw new DOMException('Action reconciliation was cancelled.', 'AbortError');
    await loadChromeData();
    return {
      status: 'confirmed',
      source: projection.startsWith('nook:') ? 'nook-refresh' : 'layer-refresh',
      projection,
    };
  }, [refresh, loadChromeData]);
  const executeFeedbackAction = useCallback(async <TDetails,>(
    intent: ActionIntent,
    request: (signal: AbortSignal) => Promise<ActionResultLike<TDetails>>,
    reconcile: (details: TDetails, signal: AbortSignal) => Promise<ReconcileReceipt> = (details, signal) => reconcileAction(details, signal, intent.projection),
    worldIdOverride?: string,
  ): Promise<ActionFeedback<TDetails> | null> => {
    const worldId = worldIdOverride ?? manifest?.id;
    if (!worldId) {
      notify(t('Load a world before doing that.'));
      return null;
    }
    const generation = worldLoadGeneration.current;
    const result = await actionCoordinator.execute({ ...intent, worldId }, request, reconcile);
    if (generation !== worldLoadGeneration.current) return result;
    // Only refusals and failures speak; a confirmed action is shown by the scene itself.
    if (result.outcome !== 'accepted' || result.reconcile !== 'confirmed' && result.reconcile !== 'not-required') {
      // The world is being reopened (or chosen): that notice already speaks for this failure.
      if (!isWorldUnavailable()) notify(t(result.message));
    } else if (result.presentation === 'eligible') {
      notify(t(result.message));
    }
    return result;
  }, [actionCoordinator, manifest?.id, notify, reconcileAction, t]);
  const enterGate = useCallback(async (target: string, source: string, worldIdOverride?: string): Promise<ActionFeedback | null> => {
    const projection = worldIdOverride ? `layer:${target}` : actionProjection();
    const intent: ActionIntent = {
      worldId: worldIdOverride ?? manifest?.id ?? '',
      projection,
      verb: 'enter',
      source,
      target,
      layer: target,
    };
    return executeFeedbackAction(
      intent,
      async () => {
        const outcome = await enterLayer(target);
        if (outcome.kind === 'accepted') return { ok: true, ...outcome.details };
        if (outcome.kind === 'same-layer') {
          return {
            ok: true,
            sameLayer: true,
            layer: target,
            name: '',
            first: false,
            followers: { moved: [], failures: [] },
          };
        }
        return { ok: false, code: outcome.code ?? outcome.kind, error: outcome.message };
      },
      async (details: unknown, signal: AbortSignal) => {
        const sameLayer = details && typeof details === 'object' && 'sameLayer' in details
          && details.sameLayer === true;
        if (sameLayer) return { status: 'not-required', source: 'details.event', projection };
        if (signal.aborted || world.readLayerState()?.layer !== target) {
          throw new DOMException('The entered scene is no longer current.', 'AbortError');
        }
        return { status: 'confirmed', source: 'layer-refresh', projection };
      },
      worldIdOverride,
    );
  }, [actionProjection, enterLayer, executeFeedbackAction, manifest?.id, reconcileAction]);
  const loadWorld = async (worldPath: string, options?: { fresh?: boolean }) => {
    preparedSource.current = null;
    // Another save is another conversation with everyone in it.
    forgetDialogueScrollback();
    if (writerRef.current) writerRef.current.value = '';
    const generation = ++worldLoadGeneration.current;
    actionCoordinator.reset('');
    setLoadingWorld(worldPath);
    agentActivityStore.selectSave(null);
    setCharacters([]); setBackpack([]); setPreparedAction('');
    writerSuspendedForBagRef.current = false;
    setBagOpen(false);
    setWorldPickerOpen(false);
    setSelectedBagPath(null);
    setWriterDraft('');
    resetForReconnect('world_change');
    writerPendingRef.current = false;
    setWriterSubmitPending(false);
    frameQueue.clear('world-change');
    cameraStack.clear();
    callerProjectionRef.current = null;
    setNookChar(null);
    projectionTransitionRef.current = { epoch: projectionTransitionRef.current.epoch + 1, nook: null };
    try {
      const result = await airpGateway.loadWorld<WorldManifest>(worldPath, options);
      if (generation !== worldLoadGeneration.current) return;
      agentActivityStore.selectSave(result.path);
      setActiveWorldPath(result.path);
      worldReopener.opened(result.path);
      setManifest(result.manifest);
      // Settings are per-world and live under the (now-active) save's
      // `.airpworld/`, so re-read them before entering the world's first layer
      // — `enterLayer` gates the I1 initialiser on `autoWrite`.
      await world.reloadSettings();
      if (generation !== worldLoadGeneration.current) return;
      // Enter the layer the world declares as its entry (world.json `entry`);
      // a manifest that omits it, or names a layer this world does not have,
      // falls back to the filesystem root `map` (create-char.ts uses the same
      // rule for a new character's `home`).
      const entryLayer = result.manifest.entry && result.manifest.layers?.[result.manifest.entry]
        ? result.manifest.entry
        : 'map';
      await enterGate(entryLayer, 'startup', result.manifest.id);
      if (generation !== worldLoadGeneration.current) return;
      await loadChromeData();
      if (generation !== worldLoadGeneration.current) return;
      // Entering a world is the moment the companion is restored, so whatever
      // collapsed the dock before it does not carry in. It must be reset HERE
      // and not only on a manifest id change: two saves of the same world share
      // one id, and the presses that open the launcher are themselves "outside
      // presses" that collapse the dock on the way through.
      setDockDismissed(false);
      // Every entry decides afresh whether this save owes a first act or a
      // welcome back. Keyed on the world id alone, two saves of one world
      // shared the answer and the second never heard its companion speak.
      openingWorldRef.current = null;
      setWorldPickerOpen(false);
      setLauncherOpen(false);
      setAttention('ambient');
      setIsGodHandOpen(false);
      setShell(initialShell);
      setProfileOpen(false);
      writerSuspendedForBagRef.current = false;
      setBagOpen(false);
      // The prologue opens on its own scene card; no toast over it.
      if (!isPrologueWorld(result.manifest)) notify(`Entered ${result.manifest.name}`);
    } catch (error) {
      if (generation === worldLoadGeneration.current) {
        agentActivityStore.selectSave(null);
        setActiveWorldPath(null);
        setWorldPickerOpen(true);
        // A failed download in words the player can act on (lib/world-load-error.ts); signed out → sign in, then it opens.
        const failure = worldLoadFailureOf(error, (key) => t(key));
        notify(failure.text);
        if (failure.kind === 'sign-in') void withAccount('play', () => { void loadWorld(worldPath, options); }, worldPath);
      }
    } finally {
      if (generation === worldLoadGeneration.current) setLoadingWorld(null);
    }
  };
  loadWorldRef.current = (worldPath) => loadWorld(worldPath);
  /**
   * 「继续这个故事」: back into the world the SERVER has open (lib/world-reopen.ts `continueStoryAction`). After a
   * reload the page shows that world without having selected its save, so nothing it sent reached anyone; another
   * tab may have opened another save meanwhile.
   */
  const continueStory = async () => {
    const open = await airpGateway.activeWorld().then((r) => r.path, () => undefined);
    const next = continueStoryAction(activeWorldPath, open);
    if (next.kind === 'enter') { void loadWorld(next.path); return; }
    if (next.kind === 'adopt') {
      agentActivityStore.selectSave(next.path);
      setActiveWorldPath(next.path);
      worldReopener.opened(next.path);
      await Promise.all([world.reloadSettings(), loadChromeData(), world.refresh()]).catch(() => {});
    }
    setLauncherOpen(false);
  };
  // 「重新开始这个世界」 (world panel) and the closed run's "Play again": the
  // launcher's "＋ Start a new game" for the world in hand. The current save
  // stays on the shelf. Undefined when the world has nothing to start from.
  const restartTarget = restartTargetOf(shelf, manifest?.id);
  const restartWorld = restartTarget ? () => { void loadWorld(restartTarget.path, { fresh: restartTarget.fresh }); } : undefined;
  // 试玩: from the draft, a fresh play copy of
  // its latest content at the opening; from that copy, back to the draft.
  const startTrial = artAuthoring && manifest?.id ? () => { void loadWorld(`worlds/${manifest.id}`, { fresh: true }); } : undefined;
  const trialOrigin = trialOriginOf(shelf, manifest);
  /**
   * Publish or unpublish a made world from its brick (the design notes,
   * the design notes). 「发布」 means PUBLIC FOR EVERYONE, so it goes
   * through the account's remote in one action:
   *   - local, signed in: upload to my remote drafts → publish there (the
   *     tenant keeps only unpublished drafts) → the local copy is published too;
   *     「撤回发布」 withdraws it on the remote, then locally.
   *   - hosted: the page's own session publishes through the same sync path.
   *   - signed out (and an account is required): the 「登录 / 注册」 sheet, then on.
   *   - no account system (old server / `AIRP_PLAY_WITHOUT_ACCOUNT=1` signed out):
   *     this computer's own publish, as before.
   * `target` is `worlds/<id>` (the author's original) or, hosted, `published/<id>`
   * (a public world of mine whose draft has left the tenant).
   * The shelf is re-read afterwards so the brick follows the server's answer.
   */
  const publishWorld = async (target: string, publish: boolean) => {
    const id = target.split('/').pop() ?? '';
    // An official edition's owner copy (worlds/<edition id>): only ever republished, and only
    // on the account's remote — the edition lives in the lobby, not in this computer's published root.
    const official = Boolean(shelf.groups?.find(group => group.workshop?.editPath === target)?.workshop?.official);
    const run = async () => {
      setPublishing(target);
      try {
        const mode = await detectAccountMode();
        if (official) {
          if (!publish) return;
          if (mode.kind !== 'local' || !mode.signedIn) { notify(t('Sign in with the account that owns this official world to republish it.')); return; }
          notify(t('Uploading to your account…'));
          const pushed = await airpGateway.pushToRemote(target);
          notify(t('Publishing…'));
          await airpGateway.publishOnRemote(pushed.id);
          setShelf(await airpGateway.worlds());
          notify(t('Republished. Everyone now plays the new version of this official world.'));
          return;
        }
        if (mode.kind === 'hosted') {
          notify(publish ? t('Publishing…') : t('Withdrawing…'));
          try {
            await airpGateway.hostedSync(id, publish ? 'publish' : 'unpublish');
          } catch (error) {
            // A deployment without the sync lane keeps the seat's own publish.
            if (remoteErrorCode(error) !== 'sync_not_configured' || !target.startsWith('worlds/')) throw error;
            if (publish) await airpGateway.publishWorld(target); else await airpGateway.unpublishWorld(target);
          }
        } else if (mode.kind === 'local' && mode.signedIn) {
          if (publish) {
            notify(t('Uploading to your account…'));
            const pushed = await airpGateway.pushToRemote(target);
            notify(t('Publishing…'));
            await airpGateway.publishOnRemote(pushed.id);
            await airpGateway.publishWorld(target);
          } else {
            notify(t('Withdrawing…'));
            try {
              await airpGateway.unpublishOnRemote(target.startsWith('worlds/') ? { worldPath: target } : { id });
            } catch (error) {
              // Never public there (published before this computer signed in): nothing to withdraw remotely.
              if (remoteErrorCode(error) !== 'not_public') throw error;
            }
            if (target.startsWith('worlds/')) await airpGateway.unpublishWorld(target);
          }
        } else if (target.startsWith('worlds/')) {
          if (publish) await airpGateway.publishWorld(target); else await airpGateway.unpublishWorld(target);
        }
        setShelf(await airpGateway.worlds());
        if (manifest?.authoring) void loadChromeData();
        notify(publish ? t('Published. Everyone can now find and play this world.') : t('Withdrawn. The world is back in your drafts; only you can see it.'));
      } catch (error) {
        const code = remoteErrorCode(error);
        if (code === 'busy') notify(t('Another submission for this world is still running. Try again when it has finished.'));
        else if ((code === 'not_connected' || code === 'signed_out') && gateDecision(await detectAccountMode()) !== 'go') {
          // The session ended on the way: sign in again, then carry on.
          notify(t('Sign in or sign up to publish. Publishing continues afterwards.'));
          void withAccount('publish', () => void run());
        }
        else notify(remoteErrorText(error, error instanceof Error ? error.message : t('Could not change publishing.')));
      } finally {
        setPublishing(null);
      }
    };
    const mode = await detectAccountMode();
    if (gateDecision(mode) === 'go') await run();
    else await withAccount('publish', () => void run());
  };
  /** 「点击游玩就有登录 注册」: every way into a world asks a signed-out player to sign in first (lib/play-gate.ts). */
  /** 「上传到云端」: signed out → the account panel first, then it carries on. */
  const keepInCloud = (worldPath: string) => {
    const run = async () => {
      setPublishing(worldPath);
      try {
        notify(t('Uploading to your account…'));
        await airpGateway.keepInCloud(worldPath);
        setShelf(await airpGateway.worlds());
        void worldSync()?.refresh();
        notify(t('This world is now kept in the cloud. It syncs when you leave it and every few minutes.'));
      } catch (error) {
        notify(remoteErrorText(error, error instanceof Error ? error.message : t('Could not upload this world.')));
      } finally {
        setPublishing(null);
      }
    };
    void withAccount('publish', () => void run());
  };
  /** 「两份都保留」 for a conflict (§5.2): the cloud version comes down as a second world. */
  const keepBoth = async (worldPath: string) => {
    setPublishing(worldPath);
    try {
      await airpGateway.keepBoth(worldPath);
      setShelf(await airpGateway.worlds());
      void worldSync()?.refresh();
      notify(t('Both kept: the cloud version is now a second world next to this one.'));
    } catch (error) {
      notify(remoteErrorText(error, error instanceof Error ? error.message : t('Could not keep both versions.')));
    } finally {
      setPublishing(null);
    }
  };
  /** `then`: after the world opened (the prologue's bridge line). */
  const playWorld = (worldPath: string, then?: () => void) => {
    const open = () => { void loadWorld(worldPath).then(() => { if (typeof then === 'function') then(); }); };
    void (async () => {
      // The guest trial: signed out, the trial world opens on a guest session; any other asks to sign in.
      const guest = guestDecision(await detectAccountMode(), isTrialWorldPath(shelf, worldPath));
      if (guest === 'guest') {
        const v = await startGuestTrial();
        if (v?.active) { open(); return; }
        // This device / network already used its trial: sign in, then the pick carries on.
        if (v?.refused === 'claim_limited' || v?.refused === 'guest_limited') { void withAccount('trial', open, worldPath); return; }
      }
      // The local edition asks only for a shared world: this computer's worlds play with the player's own key.
      void withAccount('play', open, worldPath, playTargetOf(worldPath));
    })();
  };
  // 「再玩一次」 in the account popup's 我的记录 tab (lib/play-again.ts): the same gated start as the launcher.
  const playWorldRef = useRef(playWorld);
  playWorldRef.current = playWorld;
  useEffect(() => onPlayWorldRequest((path) => playWorldRef.current(path)), []);
  // Back from a hosted sign-in (the account panel reloads the page; Google comes back here): enter the world picked before it, once.
  useEffect(() => {
    const resume = takeResumePath();
    if (resume) void withAccount('play', () => { void loadWorld(resume); }, undefined, playTargetOf(resume));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── The first-run experience ──────────────────────
  /** The shelf the first-run decision read (the prologue's template path and cover come from it). */
  const firstRunShelf = useRef<WorldShelf | null>(null);
  /**
   * Why the prologue is open behind the sign-in card, or null: during a first run the player
   * never lands in the lobby — no guest session (sign-in required, the trial used here, the services down) opens
   * the prologue's first scene (art + the greeter's written line, no model call) with the card over the reply box.
   */
  const [firstRunGate, setFirstRunGate] = useState<FirstRunGate | null>(null);
  // The language page marks the browser's language when nothing was chosen (never applies it: default English).
  const [firstRunSuggestion] = useState<Locale | null>(() => (localeChosen() ? null : suggestedLocale()));
  /**
   * Into the prologue (or a save of it): signed in, or no account needed → straight in; signed out where the guest
   * trial is on → a guest session first; no guest session to be had → in, behind the sign-in card. The first-run
   * flow never opens the account dialog by itself and never shows the lobby.
   */
  const enterFirstRun = async (path: string) => {
    setFirstRunPhase('starting');
    let entry = firstRunEntryOf(firstRunAccessOf(await detectAccountMode()));
    let gate: FirstRunGate | null = entry === 'gate' ? 'sign-in' : null;
    if (entry === 'guest') {
      const v = await Promise.race([startGuestTrial(), new Promise<null>((done) => { window.setTimeout(() => done(null), 8_000); })]);
      if (!v?.active) { entry = 'gate'; gate = gateOfGuestRefusal(v?.refused, v?.refusedBy); }
    }
    setFirstRunGate(gate);
    await loadWorldRef.current?.(path);
    setFirstRunPhase('off');
  };
  /** The sign-in card's button: sign in (or up), then the prologue carries on — reopened, so its agents start signed in. */
  const signInFromFirstRun = () => {
    const save = activeWorldPath;
    void withAccount('play', () => {
      setFirstRunGate(null);
      if (save) void loadWorldRef.current?.(save);
    }, save ?? undefined);
  };
  /** A language-screen pick (any button, the guessed one or not): that language, then that language's prologue. */
  const startPrologue = (pick: Locale) => {
    const groups = firstRunShelf.current?.groups ?? shelf.groups ?? [];
    void enterFirstRun(prologuePathOf(groups, prologueIdFor(pick)));
  };
  const enterFirstRunRef = useRef(enterFirstRun);
  enterFirstRunRef.current = enterFirstRun;
  const startPrologueRef = useRef(startPrologue);
  startPrologueRef.current = startPrologue;
  // Once per page load: is this a new visitor? Anything slow or broken on the way → the lobby, as before.
  useEffect(() => {
    if (firstRunPhase !== 'checking') return;
    let live = true;
    const giveUp = window.setTimeout(() => { if (live) setFirstRunPhase('off'); }, 8_000);
    void (async () => {
      try {
        const [mode, shelfNow] = await Promise.all([detectAccountMode(), airpGateway.worlds()]);
        if (!live) return;
        window.clearTimeout(giveUp);
        firstRunShelf.current = shelfNow;
        setShelf(shelfNow);
        const { forced, deepLink } = firstRunParams(window.location.search);
        const decision = decideFirstRun({ flag: true, forced, deepLink, access: firstRunAccessOf(mode), mark: readFirstRunMark(), localeChosen: localeChosen(), groups: shelfNow.groups ?? [] });
        if (decision.kind === 'off') { setFirstRunPhase('off'); return; }
        if (decision.kind === 'resume') { void enterFirstRunRef.current(decision.path); return; }
        if (decision.askLanguage) { setFirstRunPhase('language'); return; }
        startPrologueRef.current(preferredLocale());
      } catch {
        if (live) setFirstRunPhase('off');
      }
    })();
    return () => { live = false; window.clearTimeout(giveUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** 「看看所有世界」 (the ⋯ menu, the ending): the lobby, and the next visit is a returning one. */
  const leavePrologueToLobby = () => {
    markFirstRunDone();
    setFirstRunGate(null);
    setLauncherOpen(true);
  };
  const submitWriterText = useCallback((rawText: string, layerOverride?: string, prepared = false): boolean => {
    if (writerLocked || writerPendingRef.current) return false;
    const text = rawText.trim();
    if (!text) {
      notify(t('Please enter an action before sending.'));
      return false;
    }
    const prompt = prepared ? text : buildItemActionPrompt(text, backpack);

    writerPendingRef.current = true;
    setWriterSubmitPending(true);
    const result = sendToWriter(prompt, layerOverride);
    if (!result.accepted) {
      writerPendingRef.current = false;
      setWriterSubmitPending(false);
      notify(result.message);
      return false;
    }
    // What the player asked the writer for, in the message drawer.
    messageStream.record({ id: `you:${Date.now()}:${text.slice(0, 16)}`, kind: 'you', who: 'writer', text: rawText.trim(), layer: layerOverride ?? layer });
    if (writerHistory.current.at(-1) !== text) writerHistory.current.push(text);
    if (writerHistory.current.length > 50) writerHistory.current.shift();
    writerHistoryCursor.current = writerHistory.current.length;
    setWriterDraft('');
    // An accepted writer turn IS the guide's fourth move:
    // the player has asked the writer to change the scene, so it stops asking.
    // In the author's own world it is also the creator guide's first move.
    markGuide('writer');
    markGuide('beyond');
    if (authoring) markGuide('build');
    notify(t('The writer is listening…'));
    return true;
  }, [authoring, backpack, layer, markGuide, notify, sendToWriter, t, writerLocked]);

  const prepareWriterHint = useCallback((): boolean => {
    if (writerLocked || !worldReady) {
      notify(!worldReady ? t('Load a world and wait for the scene to appear before asking for a hint.') : t('The writer is already working.'));
      return false;
    }
    setAttention('authoring');
    setWriterDraft(t(PLAY_HINT_REQUEST));
    writerHistoryCursor.current = writerHistory.current.length;
    notify(t('Next-step hint draft ready. Review it, then press Send.'));
    window.requestAnimationFrame(() => writerRef.current?.focus());
    return true;
  }, [notify, t, worldReady, writerLocked]);
  const prepareItemUse = useCallback((itemPath: string): void => {
    if (writerLocked) {
      notify(t('The writer is already working.'));
      return;
    }
    const item = backpack.find((candidate) => candidate.path === itemPath);
    if (!item) {
      notify(t('This item is no longer available. Please refresh.'));
      return;
    }
    setWriterDraft((current) => appendItemAction(current, item, t));
    setSelectedBagPath(null);
    setAttention('authoring');
    notify(t('Item selected. Review it, then press Send.'));
    window.requestAnimationFrame(() => writerRef.current?.focus());
  }, [backpack, notify, t, writerLocked]);

  const reconcileProjection = async (details: unknown, signal: AbortSignal, projection: string, caller?: () => Promise<void>): Promise<ReconcileReceipt> => {
    if (caller) await caller();
    if (signal.aborted) throw new DOMException('Action reconciliation was cancelled.', 'AbortError');
    if (caller && projection.startsWith('nook:')) {
      await loadChromeData();
      return { status: 'confirmed', source: 'nook-refresh', projection };
    }
    return reconcileAction(details, signal, projection);
  };

  const handleItemDrop = async (itemPath: string, targetPath: string, reconcile?: () => Promise<void>): Promise<ActionFeedback | null> => {
    const projection = actionProjection();
    return executeFeedbackAction(
      { worldId: manifest?.id ?? '', projection, verb: 'present', source: 'canvas', item: itemPath, target: targetPath },
      async signal => {
        const details = await airpGateway.useItem(itemPath, targetPath, signal);
        return { ok: true, ...details };
      },
      reconcile ? (details, signal) => reconcileProjection(details, signal, projection, reconcile) : undefined,
    );
  };

  const handleReturnItem = async (itemPath: string, targetLayer = layer, reconcile?: () => Promise<void>): Promise<boolean> => {
    const filename = itemPath.split('/').pop() || 'item.md';
    const destination = targetLayer === 'map' ? `world/${filename}` : `${targetLayer}/${filename}`;
    const projection = actionProjection(targetLayer);
    const result = await executeFeedbackAction(
      { worldId: manifest?.id ?? '', projection, verb: 'drop', source: 'bag', item: itemPath, from: itemPath, to: destination, target: destination },
      async signal => {
        const details = await airpGateway.move(itemPath, destination, signal);
        return { ok: true, ...details };
      },
      reconcile ? (details, signal) => reconcileProjection(details, signal, projection, reconcile) : undefined,
    );
    return result?.outcome === 'accepted' && (result.reconcile === 'confirmed' || result.reconcile === 'not-required');
  };

  const handleTakeItem = async (itemPath: string, reconcile?: () => Promise<void>): Promise<ActionFeedback | null> => {
    const destination = `player/${itemPath.split('/').pop() || 'item.md'}`;
    const projection = actionProjection();
    const result = await executeFeedbackAction(
      { worldId: manifest?.id ?? '', projection, verb: 'take', source: 'button', item: itemPath, from: itemPath, to: destination, target: destination },
      async signal => {
        const details = await airpGateway.move(itemPath, destination, signal);
        return { ok: true, ...details };
      },
      reconcile ? (details, signal) => reconcileProjection(details, signal, projection, reconcile) : undefined,
    );
    return result;
  };

  const moveCardAction = async (path: string, x: number, y: number, reconcile?: () => Promise<void>): Promise<ActionFeedback | null> => {
    const projection = actionProjection();
    return executeFeedbackAction(
      { worldId: manifest?.id ?? '', projection, verb: 'move', source: 'canvas', cardPath: path, x, y },
      async signal => {
        const details = await moveCard(path, x, y, signal);
        return { ok: true, ...details };
      },
      reconcile ? (details, signal) => reconcileProjection(details, signal, projection, reconcile) : undefined,
    );
  };

  const handleToggleFreeze = async () => {
    try {
      await airpGateway.toggleFreeze();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not change world time');
    }
  };
  const handleToggleGodHand = () => {
    // Switching God Hand on is the creator guide's second move.
    if (!isGodHandOpen) markGuide('god');
    setIsGodHandOpen(open => !open);
  };

  const openCharacter = (character: CharacterView, priorLine?: string) => {
    // Switching companions in the dock is one gesture, not close-then-open:
    // the classic modal refuses a second open because it owns the screen.
    if (activeCharacter && (!companion || activeCharacter.id === character.id)) return;
    const admission = overlayAdmission.request('dialogue', nookChar ? 'nook' : 'workspace');
    if (!admission.accepted) {
      notify(admission.message);
      return;
    }
    // Switching away in the dock retires the previous agent and its admission
    // token; `closeCharacter` is not called, so this is the one place that can.
    if (activeCharacter) {
      sendMessage({ ...characterStopFrame(activeCharacter.id), savePath: activeWorldPath });
      const previous = characterAdmissionRef.current;
      if (previous) overlayAdmission.release(previous);
      agentActivityStore.clearSurface('character-modal');
    }
    characterAdmissionRef.current = admission.token;
    const worldId = manifest?.id || '';
    // Only the classic modal changes projection. The dock talks to someone
    // standing in the CURRENT scene, so pushing a `dialogue` camera frame here
    // would restore an unused slot and jerk the visible canvas away.
    if (!companion) {
      const caller: ProjectionTarget = nookChar
        ? projectionTarget('nook', nookChar)
        : projectionTarget('layer', layer);
      const target = projectionTarget('dialogue', character.id, caller.slot);
      cameraStack.pushTransition(target);
      cameraStack.restoreTarget(target);
      callerProjectionRef.current = caller;
    }
    // Only one listener at a time. Choosing to talk to someone
    // is the explicit act that puts the writer sheet away (a press elsewhere no
    // longer does); the sheet's authoring attention ends with it, the draft stays.
    if (companion) setWriterSheetOpen(false);
    if (companion && attention === 'authoring') {
      closeRadial();
      setAttention('ambient');
      setIsGodHandOpen(false);
    }
    frameQueue.clear('switch');
    setActiveCharacter(character);
    // The opening line was shown, not sent: the agent never
    // saw it. Carrying it as the character's previous line is what makes the
    // first reply an answer instead of a second hello.
    const scene = chalks.slice(-3).map((chalk) => chalk.body).join('\n\n');
    const prior = priorLine?.trim()
      ? `${character.name || character.id}: ${priorLine.trim()}`
      : '';
    sendMessage({
      type: 'character_start',
      characterId: character.id,
      recentContext: [scene, prior].filter(Boolean).join('\n\n'),
    });
  };
  // Keep the freshest closure reachable after an awaited layer change.
  const openCharacterRef = useRef(openCharacter);
  openCharacterRef.current = openCharacter;
  // Meet them where they are: a declared `character` action
  // or a portrait click on someone in another scene first travels to that scene
  // (navigateToCharacter: enterLayer → one frame → flyTo), so the dialogue
  // opens with that scene's chalk as its context and returns there on close.
  // Someone already here, or nowhere in particular, is opened in place.
  const meetCharacter = useCallback(async (id: string) => {
    const view = presenceViews.find((item) => item.id === id);
    if (view?.state === 'elsewhere' && await navigateToCharacter(id) === 'failed') return;
    const character = characters.find((item) => item.id === id);
    if (character) openCharacterRef.current(character);
  }, [characters, navigateToCharacter, presenceViews]);
  /**
   * The first act runs once per SAVE, on arrival at its entry layer
   *. The marker lives on the server because the opening
   * belongs to the save, so this asks rather than remembers. Everything it
   * shows is author-written and displayed: no agent starts here.
   */
  /**
   * The player closed the first act without answering. That collapses the
   * stage and nothing else: the plan stays, so the greeting stays seeded in
   * the companion's scrollback and is still the line their agent has to answer
   * when the player comes back to them. Before 2026-09-21
   * this was `setOpening(null)`, which took the whole character with it.
   */
  const [openingDismissed, setOpeningDismissed] = useState(false);
  /**
   * The player collapsed the dock in THIS world. Without it the auto-open below
   * would reopen the stage the moment they closed it, which is a fight the
   * player always loses.
   */
  const [dockDismissed, setDockDismissed] = useState(false);
  // An NPC conversation takes the right column while open.
  const [npcTalking, setNpcTalking] = useState(false);
  const openingWorldRef = useRef<string | null>(null);
  /** The load (`runKey`) whose entry made that one attempt. */
  const openingRunRef = useRef<string>('');
  // Read by the replay control, which must not re-run on every cast change.
  const manifestRef = useRef(manifest);
  manifestRef.current = manifest;
  const charactersRef = useRef(characters);
  charactersRef.current = characters;
  /**
   * The companion speaks first on a return visit. The authored greeting is a
   * first meeting and has been used up (the marker says so), so the character
   * agent is asked to open with a line of its own — it knows where things were
   * left. Nothing is added to the scrollback as the player's: only the reply
   * lands there, and the dock speaks it like any other line.
   *
   * A world with no named greeter has no companion to speak, and stays quiet.
   */
  const greetReturningPlayerRef = useRef<(occasion?: 'return' | 'arrive') => void>(() => {});
  greetReturningPlayerRef.current = (occasion: 'return' | 'arrive' = 'return') => {
    // Queued, not sent: entering a world replaces the socket, and a greeting
    // sent in that instant was lost. The effect below sends it once live.
    if (manifest?.id) setPendingGreeting({ occasion, worldId: manifest.id, entry: runKey });
    else settleArrival(runKey, 'none');
    // Entering a world — first arrival or return — runs the forced tutorial
    // (until "Don't show again"); the authored first act arms it on its own.
    armTutorial(manifest?.id);
  };
  const [pendingGreeting, setPendingGreeting] = useState<{ occasion: 'return' | 'arrive'; worldId: string; entry: string } | null>(null);
  useEffect(() => {
    if (!pendingGreeting || !world.socketLive) return;
    if (launcherOpen) return; // held until the player actually enters the world
    const { occasion, worldId, entry } = pendingGreeting;
    setPendingGreeting(null);
    // A greeting queued for a world the player has since left is dropped.
    if (worldId !== manifest?.id) { settleArrival(entry, 'none'); return; }
    const companionId = companionIdOf(manifest?.opening, characters);
    const greeter = characters.find(item => item.id === companionId);
    if (!greeter) { settleArrival(entry, 'none'); return; }
    openCharacterRef.current(greeter);
    sendMessage({ type: 'character_prompt', characterId: greeter.id, message: returnCue(manifest?.locale, occasion), savePath: activeWorldPath });
    // Their opening line is a performance: the tutorial's first step waits for it.
    characterAnswerStarted();
    // Asked for: from here the answer (`character`) and its voice hold the tutorial.
    settleArrival(entry, 'sent');
  }, [pendingGreeting, world.socketLive, manifest?.id, manifest?.opening, manifest?.locale, characters, sendMessage, launcherOpen, settleArrival, activeWorldPath]);
  useEffect(() => {
    const worldId = manifest?.id;
    if (!companion || !worldId || characters.length === 0) return;
    // Not while the launcher covers the world: the server loads a default world
    // at startup, and its companion used to greet (and speak, in that world's
    // language) behind the world list.
    if (launcherOpen) return;
    // Not mid-load: the marker read is shared with the opening scene card, per finished load.
    if (!runKey) return;
    // The greeting (text and voice) waits for the opening scene card to finish (§3.2).
    if (openingSceneHold) return;
    // A save resumed inside a place greets only on reaching the entry layer:
    // nothing is coming for this arrival, so the tutorial need not wait for it.
    if (layer !== (manifest?.entry || 'map')) { settleArrival(runKey, 'none'); return; }
    // One attempt per world per session: a re-render or a layer bounce must not
    // re-ask, and the marker write below would race itself if it did. An entry
    // after that attempt (same world, a later load) has no greeting to wait for.
    if (openingWorldRef.current === worldId) {
      if (openingRunRef.current !== runKey) settleArrival(runKey, 'none');
      return;
    }
    openingWorldRef.current = worldId;
    openingRunRef.current = runKey;
    let live = true;
    let concluded = false;
    void (async () => {
      try {
        if ((await readOpeningOnce(runKey)).shown) {
          // A return, not a first meeting: the companion still speaks first
          //.
          if (live) { concluded = true; greetReturningPlayerRef.current(); }
          return;
        }
      } catch {
        concluded = true;
        settleArrival(runKey, 'none');
        return; // Unreachable marker: stay silent rather than replay an opening.
      }
      if (!live) return;
      concluded = true;
      const plan = planOpening({ opening: manifest?.opening, characters });
      if (plan) {
        setOpening({ ...plan, phase: 'greeting' });
        // On screen now (and spoken by the dock: the `voice` performance).
        settleArrival(runKey, 'sent');
        armTutorial(manifest?.id);
        // The authored greeting is said ONCE per save
        // Marked as soon as it is shown: the rest of this first act —
        // answer, invitation — plays out in memory, and the next visit is a return
        // where the companion speaks first in new words instead of repeating it.
        markOpeningShown();
        return;
      }
      // No authored greeting — an old save, or a world that never wrote one.
      // The companion still speaks first, in its own words, and the marker is
      // set so the next visit is a return rather than another first arrival.
      greetReturningPlayerRef.current('arrive');
      void airpGateway.markOpening(true).catch(() => { /* next visit simply arrives again */ });
    })();
    return () => {
      live = false;
      // Cut off before it decided (a cast refresh mid-read): let the re-run ask
      // again, or this entry would never greet and the tutorial would wait the cap out.
      if (!concluded && openingRunRef.current === runKey) openingWorldRef.current = null;
    };
  }, [companion, manifest?.id, manifest?.entry, manifest?.opening, characters, layer, armTutorial, launcherOpen, readOpeningOnce, runKey, openingSceneHold, settleArrival]);
  // A world switch re-arms it; the next save gets its own first act.
  useEffect(() => {
    openingWorldRef.current = null;
    setOpening(null);
    setTutorialArmed(false);
    setOpeningDismissed(false);
    setDockDismissed(false);
  }, [manifest?.id]);
  // Entering a world arms the forced tutorial by itself — whatever layer the
  // save reopens on, and even when the opening marker cannot be read. The
  // greeting paths above used to be the only trigger, so a save resumed inside
  // a place (not the entry layer) or a failed marker read showed no tutorial.
  useEffect(() => {
    const worldId = manifest?.id;
    // Back at the launcher: the next entry — even into the same world — is a new one.
    if (!worldId || launcherOpen) {
      tutorialLatchRef.current = INITIAL_TUTORIAL_LATCH;
      setTutorialArmed(false); // its mask must not dim the launcher
      // The first act ends with the visit: kept, its seeded greeting came back
      // into the reloaded scrollback and was SPOKEN again under the launcher
      // while the next save loaded (and once more before the return greeting).
      if (launcherOpen) setOpening(null);
      return;
    }
    if (!companion || characters.length === 0) return;
    armTutorial(worldId);
  }, [manifest?.id, launcherOpen, companion, characters.length, armTutorial]);

  /**
   * Remember the first act for this save. Called when the greeting is SHOWN
   * — it used to wait for the first answer so an unanswered
   * greeting would wait for the player next time, but that replayed the same
   * words on every visit. Calling it again when the answer lands is harmless.
   */
  const markOpeningShown = useCallback(() => {
    void airpGateway.markOpening(true).catch(() => {
      // A failed mark only means the opening plays again next time. Telling the
      // player about it would be noise about something they cannot act on.
    });
  }, []);

  /**
   * The answer landed. If the greeter has an invitation it becomes their next
   * line; otherwise the act is over and only the conversation remains.
   */
  const openingAnswered = useCallback(() => {
    markOpeningShown();
    setOpening(current => {
      if (!current || current.phase !== 'answering') return current;
      return current.invite ? { ...current, phase: 'invite' } : null;
    });
  }, [markOpeningShown]);

  /** The invitation is answered either way; the conversation simply continues. */
  const finishOpening = useCallback(() => setOpening(null), []);

  /**
   * The player reached a layer that is not this world's entry — which is the
   * whole of "点这里可以去到下一个场景", whether they went through a gate card,
   * the rail, or the breadcrumb. Entering the world is not it: at load the
   * entry layer IS the current layer, so this stays silent until they leave it.
   */
  useEffect(() => {
    if (!manifest) return;
    if (layer !== (manifest.entry || 'map')) markGuide('enter');
  }, [layer, manifest, markGuide]);

  const introWorkshop = Boolean(manifest?.workshop);
  useEffect(() => {
    const worldId = manifest?.id;
    if (!worldId || launcherOpen || !introWorkshop) return;
    let live = true;
    airpGateway.worldIntro()
      .then(state => { if (live) setIntroGate(introGateFrom(worldId, state)); })
      // An unreadable marker must not wedge the tutorial behind a popup that never comes.
      .catch(() => { if (live) setIntroGate(introGateFrom(worldId, null)); });
    return () => { live = false; };
  }, [manifest?.id, introWorkshop, launcherOpen]);
  const introHold = tutorialHeldByIntro(introGate, manifest?.id, introWorkshop);
  /** The first-entry intro card (「开始之前…」) is on screen. */
  const introCardOpen = introGate.status === 'open' && !!introGate.state && introGate.worldId === manifest?.id && !launcherOpen;

  /** Settings → "replay the tutorial": clear the marker and run it now. */
  const replayOpening = useCallback(async () => {
    try {
      await airpGateway.markOpening(false);
    } catch {
      notify(t('Could not reset the tutorial. Please retry.'));
      return;
    }
    // One control, both halves: the save's first act and the player's guide.
    resetGuide();
    const plan = planOpening({ opening: manifestRef.current?.opening, characters: charactersRef.current });
    if (plan) {
      setOpeningDismissed(false);
      setOpening({ ...plan, phase: 'greeting' });
    }
    // The forced tutorial comes back on, for every world, even one with no
    // authored greeting.
    writeTutorialDone(window.localStorage, false);
    tutorialLatchRef.current = { worldId: manifestRef.current?.id ?? null, ran: true };
    setTutorialSent(0);
    setTutorialArmed(true);
  }, [notify, resetGuide, t]);

  /**
   * The default companion
   *
   *
   *
   * Read from the MANIFEST, never from `opening` state. The opening marker says
   * whether the GREETING and the coach mark have been used up; it was never
   * meant to say whether the character exists. Tying presence to it meant a
   * companion the player had just been introduced to disappeared the moment
   * they closed the dock without answering.
   *
   * A world with no `opening.greeter` — a save made before openings existed —
   * falls back to the first of its cast (`companionIdOf`), so every world has
   * someone who speaks first. Only a world
   * with nobody in it has no companion.
   */
  const greeterId = companionIdOf(manifest?.opening, characters) ?? '';
  const defaultCompanion = greeterId !== ''
    ? characters.find(item => item.id === greeterId) ?? null
    : null;

  /**
   * Who the dock is ABOUT. The character the player opened, else the default
   * companion — who stays the subject through a collapse, which is what keeps
   * their scrollback alive.
   */
  const dockCharacter = activeCharacter ?? defaultCompanion;
  // The prologue: what this run did, for the ending's 「你刚刚……」; the first reply's chips.
  const [prologueFacts, setPrologueFacts] = useState({ spoke: false, rolled: false, mapped: false });
  useEffect(() => { setPrologueFacts({ spoke: false, rolled: false, mapped: false }); }, [runKey]);
  // Once on the map, the 画布 / 地图 switch stays for the run: switching back to the canvas must not take it away.
  useEffect(() => { if (prologueOpen && viewMode === 'map') setPrologueFacts((f) => (f.mapped ? f : { ...f, mapped: true })); }, [prologueOpen, viewMode]);
  useEffect(() => { if (prologueOpen && ceremony) setPrologueFacts((f) => (f.rolled ? f : { ...f, rolled: true })); }, [prologueOpen, ceremony]);
  // Reaching the prologue's ending: the next visit is a returning one, and the forced tutorial does not start
  // over in the next world (the prologue taught speaking, taking, rolling and doors).
  useEffect(() => {
    if (!prologueOpen || !closedRun.ending) return;
    markFirstRunDone();
    hideForcedTutorial();
  }, [prologueOpen, closedRun.ending?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const experienceTurnEnd = Boolean(worldExperienceOf(manifest)?.turnEnd);
  /** The world carries a companion hint table: every settled move is a beat, the server picks the hint. */
  const hintsOn = (manifest as { hints?: unknown } | null)?.hints === true;
  /**
   * Character tick: in a world that declares `tick`, every settled player input
   * is one beat on the layer on screen; the intent menu's enter / take / talk are played with the real actions.
   */
  useCharacterTick({
    enabled: worldTickOf(manifest) !== null,
    beats: hintsOn,
    worldKey: activeWorldPath,
    layer,
    paused: opening !== null && opening.phase === 'greeting',
    onEnter: (target) => { void enterGate(target, 'tick'); },
    onTake: (path) => { void handleTakeItem(path); },
    onTalk: (card) => {
      if (card.startsWith('characters/')) { void meetCharacter(card.split('/')[1]); return; }
      requestNpcTalk({ path: card, frontmatter: canvasItems.find((item) => item.path === card)?.frontmatter ?? null });
    },
    onResolved: () => { void refresh(); },
  });
  /**
   * A guided experience: a settled answer is a turn — its turn-end command runs, and the
   * visit counts it (session_turn), since the prologue is played mostly in conversation. Elsewhere: nothing.
   */
  const experienceAnswered = () => {
    if (!experienceTurnEnd) return;
    if (!worldTickOf(manifest) && !hintsOn) void airpGateway.turnEnd().catch(() => {});
    // A `story` experience only counts its turns by command; the prologue's chrome and visit count are its own.
    if (!isPrologueWorld(manifest)) return;
    setPrologueFacts((f) => (f.spoke ? f : { ...f, spoke: true }));
    visit.turn(layer);
  };
  /**
   * Reply chips (any world, the design notes / §9.8): world.json `ui.replyChips`, on by default where the world wrote
   * `opening.replies`. The first answer's lines while the greeting waits; afterwards this place's card options.
   */
  const replyChipsOn = replyChipsEnabled(manifest);
  const openingReplies = replyChipsOn && opening && opening.phase === 'greeting' && opening.greeterId && dockCharacter?.id === opening.greeterId
    ? openingRepliesFor(manifest?.opening?.replies, locale, manifest?.locale)
    : null;
  /** The ending's first choice: the next world's edition in the prologue's language (`last-train-prologue-zh` → `last-train-zh`). */
  const prologueNextId = prologueNextIdFor(worldExperienceOf(manifest)?.next, manifest?.id, manifest?.locale, locale);
  const prologueNextName = (() => {
    const group = prologueNextId ? shelf.groups?.find((g) => g.id === prologueNextId) : null;
    return group ? worldTitle(group.name) : t('The Last Train');
  })();
  /**
   * straight into the full 末班车 in the same language — the same gated
   * start as a lobby tile, so a guest stays a guest (last-train is a trial world) and a signed-in player goes in;
   * sign-in is asked only by the usual guest prompts later. A fresh start (no prologue state carried), then one
   * line of bridge; the guide gives only the writer hint there.
   */
  const continueFromPrologue = () => {
    markFirstRunDone();
    hideForcedTutorial();
    setFirstRunGate(null);
    if (!prologueNextId) { setLauncherOpen(true); return; }
    markFromPrologue(prologueNextId);
    playWorld(prologuePathOf(shelf.groups ?? [], prologueNextId), () => {
      notify(t('The prologue is over. The full Last Train — more passengers, more cars.'));
    });
  };
  /**
   * The companion stays on stage; anyone else opened for a word folds away on a
   * press outside them
   * The companion is the
   * greeter, or whoever is following the player now.
   */
  const dockStaysOnStage = dockCharacter !== null && (
    dockCharacter.id === defaultCompanion?.id
    || presenceViews.some(view => view.id === dockCharacter.id && view.following)
  );

  /** What the forced tutorial can observe; each field is one step's real event. */
  const tutorialItemKey = canvasItems.map(item => item.path).join('\n');
  const tutorialGreeterFollowing = presenceViews.some(view => view.id === greeterId && view.following);
  // The authored invitation is still to come (answer in flight) or on screen;
  // otherwise the dock offers the tutorial's own 「跟我来」.
  const tutorialInvitePending = opening !== null && Boolean(opening.invite)
    && (opening.phase === 'answering' || opening.phase === 'invite');
  // Which places here open with what is carried; if none, what to take first.
  const tutorialPlaceInfo = useMemo(() => tutorialPlaces(canvasItems, carriedPaths), [canvasItems, carriedPaths]);
  const tutorialCarriedKey = [...carriedPaths].join('\n');
  // The search the writer sets up: dice chalks, which of them are rolled, and
  // what each roll paid out (`dice_reward.source`). Keys, so the memo holds.
  const tutorialChalkKey = canvasItems.filter(item => isSearchChalk(item.path, item.frontmatter)).map(item => item.path).join('\n');
  const tutorialRolledKey = canvasItems.filter(item => diceRolled(item.frontmatter)).map(item => item.path).join('\n');
  const tutorialRewardKey = canvasItems
    .map(item => { const source = diceRewardSource(item.frontmatter); return source ? `${item.path}\t${source}` : ''; })
    .filter(Boolean).join('\n');
  const tutorialSnapshot = useMemo<TutorialSnapshot>(() => ({
    playerSentCount: tutorialSent,
    followAvailable: defaultCompanion !== null,
    followInvitePending: tutorialInvitePending,
    greeterFollowing: tutorialGreeterFollowing,
    layer,
    writerOpen: companion ? writerSheetOpen : true,
    writerWriting: writerWorking,
    itemPaths: tutorialItemKey ? tutorialItemKey.split('\n') : [],
    unlockedPlaceAvailable: tutorialPlaceInfo.unlockedPlaceAvailable,
    lockItemPath: tutorialPlaceInfo.lockItemPath,
    lockItemIsKey: tutorialPlaceInfo.lockItemIsKey,
    carriedPaths: tutorialCarriedKey ? tutorialCarriedKey.split('\n') : [],
    searchChalks: tutorialChalkKey ? tutorialChalkKey.split('\n') : [],
    rolledPaths: tutorialRolledKey ? tutorialRolledKey.split('\n') : [],
    rewards: tutorialRewardKey
      ? tutorialRewardKey.split('\n').map(line => { const [path, source] = line.split('\t'); return { path, source }; })
      : [],
    designedOptions: replyChipsOn,
  }), [replyChipsOn, tutorialChalkKey, tutorialRolledKey, tutorialRewardKey, tutorialSent, defaultCompanion, tutorialInvitePending, tutorialGreeterFollowing, layer, companion, writerSheetOpen, writerWorking, tutorialItemKey, tutorialPlaceInfo.unlockedPlaceAvailable, tutorialPlaceInfo.lockItemPath, tutorialPlaceInfo.lockItemIsKey, tutorialCarriedKey]);
  /**
   * The tutorial's follow control for a world with no invitation (or one the
   * player declined): the companion's dock offers 「跟我来」 once the player has
   * spoken, until they follow. Same call as accepting the invitation.
   */
  const tutorialFollowOffer = tutorialArmed && tutorialSent > 0 && defaultCompanion !== null
    && !tutorialGreeterFollowing && !tutorialInvitePending && dockCharacter?.id === defaultCompanion.id
    ? { pending: pendingFollowing.has(defaultCompanion.id), onAccept: () => void toggleFollowing(defaultCompanion.id, true) }
    : null;
  const endTutorial = useCallback(() => {
    setTutorialArmed(false);
    setTutorialStep(null);
  }, []);

  /**
   * Whether the stage is OPEN. The first act opens it for the greeter, and
   * opening a character opens it for them. Nothing else does: a narrator-only
   * opening has no one to reply to (§4.1), so it stays a line above the
   * avatars with no portrait and no reply box.
   */
  const dockExpanded = activeCharacter !== null
    || (!openingDismissed && (opening?.greeterId ?? null) !== null)
    // A world with a companion opens WITH them
    //
    // Before this, coming back to a save put the player in front of a column of
    // avatars they had to click before anything was said.
    //
    // No first-act guard is needed and none is wanted: this only OPENS the
    // stage, it starts no agent and sends nothing, so it cannot pre-empt the
    // greeting — and the greeter is this same companion anyway. It must also
    // not depend on standing on the entry layer, which is exactly where a
    // resumed save usually is not.
    || (!dockDismissed && defaultCompanion !== null)
    // The prologue keeps the conversation open: its next moves live above the reply box.
    || (prologueOpen && defaultCompanion !== null);

  /**
   * The world's content language, as `/api/tts` wants it. One value for both
   * carriers: the modal and the dock speak the same world.
   */
  const contentLanguage = manifest?.locale === 'ja' || manifest?.locale === 'en' || manifest?.locale === 'zh-CN' || manifest?.locale === 'ko'
    ? manifest.locale
    : 'en';
  /**
   * The forced tutorial's `speak` step pre-fills the reply box with a first
   * line in the WORLD's language (world.json `tutorial.firstLine`, else the
   * built-in default) so the player can just send it. Only
   * while that step is on screen; the dock never overwrites what was typed.
   */
  /**
   * The world is still arriving (lib/forced-tutorial `tutorialArrivalPending`):
   * the forced tutorial renders nothing until it has opened, played its
   * opening card and delivered the greeting. A layout with no companion has
   * no greeting to wait for.
   */
  const tutorialArriving = tutorialArrivalPending({
    worldReady: entryKey !== '',
    openingDone: !openingSceneHold,
    greeting: !companion ? 'none' : arrival.key === entryKey ? arrival.greeting : 'waiting',
  });
  const tutorialSpeakLine = tutorialArmed && !launcherOpen && !introHold && tutorialStep === 'speak'
    ? tutorialFirstLine(manifest, locale, translate)
    : null;


  const closeRadial = useCallback(() => {
    setRadialState(null);
    const token = radialAdmissionRef.current;
    if (token) overlayAdmission.release(token);
    radialAdmissionRef.current = null;
  }, [overlayAdmission]);
  useEffect(() => {
    if (!radialState && !radialAdmissionRef.current) return;
    const lease = focusCoordinator.registerSurface({
      key: 'radial-menu',
      owner: 'workspace',
      priority: 280,
      root: null,
      close: closeRadial,
    });
    return () => lease.unregister();
  }, [closeRadial, focusCoordinator, radialState]);

  // A choice widget click is the choice: it lands the
  // `choice_selected` event through `/api/choice` right away, and the world's
  // `autoWrite` setting decides whether the writer picks it up. Nothing is
  // parked in the writer draft.
  const runChoice = useCallback((path: string, choice: string) => {
    void airpGateway.choose(path, choice).catch(error => notify(error instanceof Error ? error.message : String(error)));
  }, [notify]);
  // An entity action ("the player requests …") goes straight to the writer;
  // the only guard is a writer that is already mid-turn.
  const runEntityAction = useCallback((prompt: string) => {
    if (writerLocked) {
      notify(t('The writer is already working.'));
      return;
    }
    void submitWriterText(prompt);
  }, [notify, submitWriterText, t, writerLocked]);
  // The right-click / long-press radial: ALWAYS a menu, its
  // satellites by world category and attention (lib/radial-items.ts) — TRPG
  // play gets the player's tools, free / story play and authoring the creators.
  const radialItems = radialItemsFor(worldCategoryIdOf(manifest), attention === 'authoring');
  const openRadial = (x: number, y: number, worldX: number, worldY: number) => {
    const admission = overlayAdmission.request('radial', 'workspace');
    if (!admission.accepted) {
      notify(admission.message);
      return;
    }
    radialAdmissionRef.current = admission.token;
    setRadialState({ x, y, worldX, worldY });
  };
  const runRadialTool = (tool: RadialToolId, x: number, y: number, worldX: number, worldY: number) => {
    if (tool === 'note') clueBoard.openNoteAt(x, y, worldX, worldY);
    else if (tool === 'board') clueBoard.toggleBoard();
    else if (tool === 'hint') prepareWriterHint();
    else {
      setAttention('authoring');
      setShell(current => ({ ...current, immersive: false }));
      window.setTimeout(() => writerRef.current?.focus(), 0);
    }
  };
  const createAt = async (type: RadialItemType, title: string, content: string, x: number, y: number) => {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `creation-${Date.now()}`;
    const base = layer === 'map' ? 'world' : layer;
    const filePath = type === 'gate' ? `${base}/${slug}/README.md` : `${base}/${slug}.md`;
    const form = type === 'character' ? 'sprite' : type;
    try {
      await airpGateway.godAction('create', filePath, `---\ntype: ${form}\ntitle: ${JSON.stringify(title)}\n---\n${content}`, radialItems.mode);
      await refresh();
      closeRadial();
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not create the object'); }
  };
  const closeCharacter = () => {
    if (activeCharacter) sendMessage({ ...characterStopFrame(activeCharacter.id), savePath: activeWorldPath });
    const token = characterAdmissionRef.current;
    if (token) {
      overlayAdmission.release(token);
      characterAdmissionRef.current = null;
    }
    agentActivityStore.clearSurface('character-modal');
    frameQueue.clear('close');
    // Stopped mid-answer: nothing is performing any more.
    characterAnswerSettled();
    const caller = callerProjectionRef.current;
    if (caller) {
      const frame = cameraStack.popTransition(caller);
      if (frame) cameraStack.restoreProjection(frame);
    }
    callerProjectionRef.current = null;
    setActiveCharacter(null);
  };
  closeCharacterRef.current = closeCharacter;

  // ── Option routing: moves ride the writer's tray, lines a character's bubble ──
  const hint = useHint();
  useEffect(() => { resetHint(activeWorldPath); }, [activeWorldPath]);
  const routeRun = activeOpenSave ?? activeWorldPath ?? null;
  const [usedLines, setUsedLines] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => { setUsedLines(readUsed(routeRun)); }, [routeRun]);
  const spendLine = useCallback((key: string) => { setUsedLines(markUsed(routeRun, key)); }, [routeRun]);
  const fromPrologueHere = Boolean(manifest?.id) && readFromPrologue() === manifest?.id;
  /** `to: companion` = whoever follows the player now, else the world's own companion (role: companion). */
  const routeCompanion = presenceViews.find((view) => view.following)?.id
    ?? (manifest?.characters?.find((c) => c.id === greeterId)?.role === 'companion' ? greeterId : null);
  const routeCards: (RouteCard & { body?: string })[] = readme ? [readme, ...canvasItems] : canvasItems;
  const routeOptionsOf = (card: RouteCard) => {
    try {
      const choice = buildChoiceFields(card.frontmatter ?? {}).choice;
      return choice ? visibleRouteOptions(choice) : [];
    } catch {
      return [];
    }
  };
  // Done options are gone everywhere: the save's answer (`optionStates`), else the page's reading.
  const optionIsDone = optionDoneOf({ states: state?.optionStates, cards: routeCards, carried: carriedPaths, dir: layer === 'map' ? 'world' : layer, used: usedLines });
  const optionIsUsed = optionUsedOf(state?.optionStates, usedLines);
  const routed = replyChipsOn && !nookChar
    ? routeOptions(routeCards, routeOptionsOf, { companion: routeCompanion, fromPrologue: fromPrologueHere, used: usedLines, done: optionIsDone, isUsed: optionIsUsed })
    : { slips: [] as WriterSlip[], lines: [] };
  // An opening reply addressed to the writer is a move, not a line.
  const openingWriterSlips: WriterSlip[] = replyChipsOn && opening && opening.phase === 'greeting'
    ? openingReplyItemsFor(manifest?.opening?.replies, locale, manifest?.locale, opening.greeterId ?? '')
      .filter((reply) => reply.to === 'writer')
      .map((reply) => ({ key: `reply:${reply.text}`, label: reply.text, glyph: '✎', text: reply.text }))
    : [];
  const writerSlips = nookChar ? [] : mergeSlips([...hintSlips(hint, routeCards, routeOptionsOf, layer, usedLines, optionIsDone), ...openingWriterSlips], routed.slips);
  // The writer's margin note (D9): a hint with nobody here to say it; it stays for the place it was said in.
  const [noteLayer, setNoteLayer] = useState<{ id: string; layer: string } | null>(null);
  useEffect(() => { if (hint?.by === 'writer') setNoteLayer({ id: hint.id, layer }); }, [hint?.id, hint?.beat]); // eslint-disable-line react-hooks/exhaustive-deps
  const writerNote = hint && hint.by === 'writer' && noteLayer?.id === hint.id && noteLayer.layer === layer ? { id: hint.id, text: hint.say } : null;
  // While the companion's greeting is still on its way, offer no lines to say to anyone: a card line
  // (「苏禾是谁？」) flashing before she has spoken answers a question nobody asked yet.
  const linesOf = (id: string) => tutorialArriving
    ? []
    : linesFor(id, { hint, routed: routed.lines, used: usedLines }).map((line) => ({ key: line.key, say: line.say }));
  const dockLines = replyChipsOn && dockCharacter ? linesOf(dockCharacter.id) : null;
  const railLines: Record<string, { key: string; say: string }[]> = replyChipsOn && !nookChar
    ? Object.fromEntries(presenceViews.map((view) => [view.id, linesOf(view.id)]))
    : {};
  const guestView = useGuestTrial();
  const lineLocked = guestModeOf(guestView) ? t('Sign in to get new lines') : null;
  const faces: Record<string, { name: string; avatar?: string | null }> = Object.fromEntries(
    characters.map((c) => [c.id, { name: c.name || c.id, avatar: assetUrl(c.avatar, 'image') ?? null }]),
  );
  // A line picked from the rail's bubble (or the left rail): open that person, then say it.
  const [sayNow, setSayNow] = useState<{ key: string; character: string; text: string } | null>(null);
  const sayTo = (id: string, line: { key: string; say: string }) => {
    spendLine(line.key);
    setSayNow({ key: `${line.key}:${Date.now()}`, character: id, text: line.say });
    if (id === defaultCompanion?.id && !activeCharacter) {
      setDockDismissed(false);
      setOpeningDismissed(false);
      return;
    }
    void meetCharacter(id);
  };
  const sayToRef = useRef(sayTo);
  sayToRef.current = sayTo;
  const companionRef = useRef(routeCompanion);
  companionRef.current = routeCompanion;
  useEffect(() => {
    const onSay = (event: Event) => {
      const request = (event as CustomEvent<SayLineRequest>).detail;
      if (!request) return;
      const to = request.to === 'companion' ? companionRef.current : request.to;
      if (to) sayToRef.current(to, { key: request.key, say: request.say });
    };
    window.addEventListener(SAY_LINE_EVENT, onSay);
    return () => window.removeEventListener(SAY_LINE_EVENT, onSay);
  }, []);
  // The writer's tray never opens by itself: new slips or a
  // margin note make the ✎'s ink count pulse once (WriterFab), hover previews, a press opens.
  // Each layer's own view (D8): the player's switch on this layer in this run, else the layer's `view`, else as is.
  const viewLayerKey = readme && !nookChar ? `${routeRun ?? ''}|${layer}` : '';
  useEffect(() => {
    if (!viewLayerKey) return;
    enterLayerView(routeRun, layer, layerDeclaredViewOf(readme?.frontmatter as Record<string, unknown> | null | undefined));
  }, [viewLayerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The message drawer ─────────────────────────────────────────────
  // The canvas keeps the world and the newest narration; every word goes to one timeline at the bottom.
  // Not under the lobby: a drawer behind the world launcher is a target nobody can see.
  const streamOn = companion && !nookChar && !launcherOpen;
  const streamScope = activeWorldPath ?? manifest?.id ?? null;
  useEffect(() => { messageStream.scope(streamScope); }, [streamScope]);
  // What was said before this page opened — a reload, a reopened save — from the save itself.
  // This page's chalks, stamped in file order the first time the page is seen (lib/message-stream.ts).
  const chalkDir = layer === 'map' ? 'world' : layer;
  const pageChalks = useMemo(
    () => chalks.filter((chalk) => chalk.path.slice(0, chalk.path.lastIndexOf('/')) === chalkDir),
    [chalks, chalkDir],
  );
  // Not while a world is loading: the new save is already active but the page still shows the old world's chalks.
  const streamSettled = loadingWorld === null && !launcherOpen;
  useEffect(() => {
    if (!streamScope || !streamSettled || nookChar || pageChalks.length === 0) return;
    messageStream.observeChalks(layer, pageChalks);
  }, [layer, nookChar, pageChalks, streamScope, streamSettled]);
  useEffect(() => {
    if (streamScope && streamSettled) void messageStream.loadLatest();
  }, [streamScope, streamSettled]);
  const streamHistory = useStreamHistory();
  // A choice made on a card, a CG's caption, an ending, a loop reset: the same entries the history names
  // (`streamItemsOfEvent`), so a reload finds them where they were. Rolls come from the ceremony below.
  useEffect(() => {
    const onEvent = (event: Event) => {
      const ev = (event as CustomEvent).detail as StreamEventLike | null;
      if (!ev || typeof ev.id !== 'string') return;
      // Story events have their own listener below. (`.includes()` form: an EVENT type, not a frame name — check:ws.)
      if (['story_event'].includes(ev.type)) return;
      for (const item of streamItemsOfEvent(ev)) if (item.kind !== 'dice') messageStream.record(item);
    };
    window.addEventListener('airp:stream-event', onEvent);
    return () => window.removeEventListener('airp:stream-event', onEvent);
  }, []);
  // A roll, however it was made (writer / character frame, the player's card): one line in the stream.
  useEffect(() => {
    let lastKey = getCeremonySnapshot()?.key ?? null;
    return subscribeCeremony(() => {
      const snap = getCeremonySnapshot();
      if (!snap || snap.key === lastKey) return;
      lastKey = snap.key;
      const v = snap.verdict;
      messageStream.record({
        id: `dice:${v.path}:${v.result}:${snap.key}`,
        kind: 'dice',
        title: v.desc || v.name,
        text: v.desc || v.name || v.dice,
        score: v.expect ? `${v.result} / ${v.expect}` : String(v.result),
        ...(v.path ? { chalkPath: v.path } : {}),
        outcome: v.crit ? 'crit' : v.fumble ? 'fumble' : v.passed ? 'pass' : 'fail',
        layer: v.layer ?? undefined,
      });
    });
  }, []);
  // A story event (an address: who or what a roll landed on).
  useEffect(() => {
    // The history's own mapping (`streamItemsOfEvent`): a person's own beat (character tick) is their words, a hint none.
    const onEvent = (event: Event) => {
      const ev = (event as CustomEvent).detail as StreamEventLike | null;
      if (!ev || typeof ev.id !== 'string') return;
      for (const item of streamItemsOfEvent(ev)) messageStream.record(item);
    };
    window.addEventListener('airp:story-event', onEvent);
    return () => window.removeEventListener('airp:story-event', onEvent);
  }, []);
  // What people said / wrote on their own turn (character tick v2), and what their moves came to.
  useEffect(() => {
    const take = () => {
      for (const entry of getTickView().recent) {
        const words = entry.words;
        // `tickStreamKey`: the id made unique by its time — the history names the same entry the same way.
        const key = tickStreamKey(entry);
        const at = entry.at ? Date.parse(entry.at) : NaN;
        const when = Number.isFinite(at) ? { at } : {};
        // A chatter beat and every move's outcome arrive as their story event (above); here only the words said
        // with an intent, which no event quotes.
        if (entry.chatter) continue;
        if (words?.say) messageStream.record({ id: `tick:${key}:say`, kind: 'character', who: entry.actor, name: entry.name, text: words.say, layer: entry.page, ...when });
        if (words?.invite) messageStream.record({ id: `tick:${key}:invite`, kind: 'character', who: entry.actor, name: entry.name, text: words.invite, layer: entry.page, ...when });
        if (words?.note) messageStream.record({ id: `tick:${key}:note`, kind: 'character', who: entry.actor, name: entry.name, title: words.note.title, text: words.note.body, note: true, layer: entry.page, ...when });
      }
    };
    take();
    return subscribeTick(take);
  }, []);
  // The left story journal is classic-only now; a remembered open journal must not trap Escape in companion.
  useEffect(() => { if (companion && shell.journal) setShell(current => ({ ...current, journal: false })); }, [companion, shell.journal]);
  const streamEntries = useMessageStream();
  const [streamSolo, setStreamSolo] = useState(false);
  const [streamFocus, setStreamFocus] = useState<{ id: string; n: number } | null>(null);
  const streamOpen = streamOn && (writerSheetOpen || streamSolo);
  // ── One layout for the drawer and the people ──────────────────
  // Narrow screens (the dock's own breakpoint, character-dock.css) have ONE bottom area: the drawer or a
  // dialogue stage, never both. Wide screens keep the people in the right column; there only the writer
  // folds the stage (one listener at a time, the design notes). Folding is derived, so closing the writer /
  // the drawer brings the stage back by itself.
  const narrowLayout = useNarrowLayout();
  const stageYields = streamOn && (writerSheetOpen || (narrowLayout && streamOpen));
  const stageShown = dockExpanded && !npcTalking && !stageYields;
  const stageOnScreen = (dockExpanded || npcTalking) && !stageYields;
  // A dialogue the player opens on a narrow screen takes the bottom: a drawer up on its own goes down.
  useEffect(() => {
    if (narrowLayout && (activeCharacter !== null || npcTalking)) setStreamSolo(false);
  }, [narrowLayout, activeCharacter?.id, npcTalking]); // eslint-disable-line react-hooks/exhaustive-deps
  // The player panel (character sheet) shares the bottom-left with the drawer: one at a time.
  useEffect(() => {
    if (!profileOpen) return;
    setStreamSolo(false);
    if (writerSheetOpen) onWriterOpenChange(false);
  }, [profileOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // A guide / tutorial step whose target lives in the drawer pulls it up first.
  const [drawerTab, setDrawerTab] = useState<{ tab: DrawerTab; n: number } | null>(null);
  useEffect(() => onDrawerRequest(({ tab }) => {
    if (!streamOn) return;
    setProfileOpen(false);
    setStreamSolo(true);
    setDrawerTab((current) => ({ tab, n: (current?.n ?? 0) + 1 }));
  }), [streamOn]);
  // …and a step pointing at a dialogue stage the drawer covers lowers it (only a drawer up on its own).
  useEffect(() => onDrawerDownRequest(() => setStreamSolo(false)), []);
  useBottomStack(streamOn);
  /** The writer sheet opens / closes; the message drawer rises and falls with it. */
  const onWriterOpenChange = (next: boolean): void => {
    if (next) {
      writerSuspendedForBagRef.current = false;
      setBagOpen(false);
    }
    setWriterSheetOpen(next);
    // In companion the sheet IS the authoring attention: closing it
    // (× / FAB / Escape — never a press elsewhere) ends both, so no
    // orphaned God Hand stays armed behind a closed sheet.
    if (!next) {
      closeRadial();
      setAttention('ambient');
      setIsGodHandOpen(false);
      // Put away together: a drawer opened on its own goes down with the writer too.
      setStreamSolo(false);
    }
    // Only one listener at a time: opening the
    // writer collapses whoever was being spoken to.
    if (next) {
      if (activeCharacter) closeCharacter();
      setProfileOpen(false);
      setAttention('authoring');
      setShell(current => ({ ...current, immersive: false }));
      // A phone with moves on the tray: the slips first, no keyboard over them (D1 「手机：点一下打开」).
      const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
      if (!(coarse && writerSlips.length > 0)) window.setTimeout(() => writerRef.current?.focus(), 0);
    }
  };
  /** The drawer's ⌄: down together — a writer sheet that is up goes down with it. */
  const closeStream = (): void => {
    setStreamSolo(false);
    if (writerSheetOpen) onWriterOpenChange(false);
  };
  // 「状态」「技能」 beside every avatar: one panel at a time, and it shares the rules of §11 —
  // it lowers a drawer / writer that is up, and the drawer or the writer coming up closes it.
  const [quickOpen, setQuickOpen] = useState<{ who: string; tab: QuickTab } | null>(null);
  useEffect(() => {
    if (!quickOpen) return;
    setStreamSolo(false);
    setProfileOpen(false);
    if (writerSheetOpen) onWriterOpenChange(false);
  }, [quickOpen?.who, quickOpen?.tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (streamOpen || launcherOpen) setQuickOpen(null); }, [streamOpen, launcherOpen]);
  const quickHas = (who: string): { hasState: boolean; hasSkills: boolean } => ({
    hasState: who === 'player' ? worldPanels.player.states.length > 0 : (worldPanels.characters[who]?.length ?? 0) > 0,
    hasSkills: Boolean(worldSheets.rules) && (who === 'player' ? Boolean(worldSheets.player) : Boolean(worldSheets.characters[who])),
  });
  const quickName = (who: string): string => (who === 'player' ? playerRole : characters.find((c) => c.id === who)?.name || who);
  const quickFor = (who: string, variant: 'player' | 'companion'): React.ReactNode => (
    <AvatarQuick
      who={who}
      name={quickName(who)}
      // Both buttons whenever there is anything to show; an empty tab says so in one line.
      hasState={quickHas(who).hasState || quickHas(who).hasSkills}
      hasSkills={quickHas(who).hasState || quickHas(who).hasSkills}
      variant={variant}
      open={quickOpen?.who === who ? quickOpen.tab : null}
      onOpen={(tab) => setQuickOpen(tab ? { who, tab } : null)}
    />
  );
  // Companions with the player get the pair: following, or on this page.
  const railQuick = (id: string): React.ReactNode => {
    const view = railViews.find((v) => v.id === id);
    return view && (view.following || view.state === 'in-scene') ? quickFor(id, 'companion') : null;
  };
  // The dice card's 「X 替你掷」 needs a display name for an id (DiceRoller has no world).
  useEffect(() => { setCharacterNames(Object.fromEntries(characters.map((c) => [c.id, c.name || c.id]))); }, [characters]);
  const openStreamAt = useCallback((path?: string) => {
    setProfileOpen(false);
    setStreamSolo(true);
    if (path) setStreamFocus((f) => ({ id: `chalk:${path}`, n: (f?.n ?? 0) + 1 }));
  }, []);
  // Which chalks stay on the canvas / the map: the newest few plus every one still asking for something.
  const chalkKeep = useMemo(() => readChalkKeep(), []);
  const chalkAsks = (chalk: ChalkLike): boolean => {
    const roll = (chalk.frontmatter as { roll_dice?: unknown } | null | undefined)?.roll_dice;
    return Boolean(roll) || routeOptionsOf(chalk as RouteCard).some((option) => !option.repeat);
  };
  const chalkOpen = (chalk: ChalkLike): boolean => chalkIsOpen(chalk, (c) => routeOptionsOf(c as RouteCard), (c, o) => optionIsDone(c as RouteCard, o));
  const orderedChalks = orderChalks(pageChalks);
  const shownChalks = canvasChalks(orderedChalks, chalkKeep, chalkOpen);
  const retiringChalks = useRetiringChalks(shownChalks, `${streamScope ?? ''}|${layer}`);
  const stageItems = streamOn
    ? canvasItems.filter((item) => item.frontmatter?.type !== 'chalk' || shownChalks.has(item.path) || retiringChalks.has(item.path) || !pageChalks.includes(item))
    : canvasItems;
  const chalkDone = (path: string): boolean => {
    const chalk = pageChalks.find((c) => c.path === path);
    return chalk ? chalkAsks(chalk) && !chalkOpen(chalk) : false;
  };
  const openOptionCount = routeCards.reduce((sum, card) => sum + routeOptionsOf(card).filter((option) => !optionIsDone(card, option)).length, 0);

  // 「报告问题 / 卡住了」 (lib/report-issue.ts): what goes with a report — shown in the sheet before sending.
  const reportContext: ReportContext = {
    worldId: !launcherOpen && activeOpen ? worldKeyOf(activeOpen) : null,
    edition: !launcherOpen && activeOpen ? activeOpen.id : null,
    worldName: !launcherOpen && activeOpen ? worldTitle(manifest?.name || activeOpen.name) : null,
    place: !launcherOpen && activeOpen && layer ? layer : null,
    placeTitle: !launcherOpen && activeOpen && layer ? sceneName(manifest, layer) : null,
    version: appVersionOf(import.meta.env as Record<string, string | undefined>),
    mode: browserModeRequested() ? 'browser' : 'local',
    locale,
  };
  return (
    <ActionFeedbackProvider coordinator={actionCoordinator}>
      <div data-depth-surface="ui" aria-hidden={performanceSettingsOpen || undefined} inert={performanceSettingsOpen || undefined} className={`airp-prototype${prologueOpen ? ' app--first-run' : ''}${isDusk ? ' is-dusk' : ''}${shell.immersive ? ' is-immersive' : ''}${shell.journal && !nookChar && !companion ? ' is-reading' : ''}${shell.header ? ' has-header' : ''}${attention === 'authoring' ? ' is-authoring' : ''}`} data-writer-over-rail={writerRailLimit !== null ? 'true' : undefined} data-stream-open={streamOpen ? 'true' : undefined} data-stage-on={stageOnScreen ? 'true' : undefined} data-first-run-bag={prologueOpen ? (handItems.length ? 'some' : 'empty') : undefined} data-first-run-clock={prologueOpen ? (closedRun.clock && closedRun.clock.left < closedRun.clock.start ? 'shown' : 'hidden') : undefined} data-first-run-view={prologueOpen ? (prologueFacts.spoke || prologueFacts.mapped || viewMode === 'map' ? 'shown' : 'hidden') : undefined} style={writerRailLimit !== null ? { '--airp-rail-limit': `${writerRailLimit}px` } as React.CSSProperties : undefined}>
      <main className="prototype-workspace">
        {/* Classic only: in companion the story so far is the bottom message drawer. */}
        {!companion && <aside className={`prototype-narrative${shell.journal && !nookChar ? ' is-open' : ''}`} aria-label={t("Story journal")} aria-hidden={!shell.journal || nookChar !== null} inert={!shell.journal || nookChar !== null}>
          <div className="prototype-narrhead">
            <span className="prototype-eyebrow">{t("THE STORY SO FAR")}</span>
            <button className="prototype-quiet" onClick={() => toggleShell('journal')} aria-label={t("Close story page")}>‹</button>
          </div>
          <div className="prototype-journal">
            <div className="prototype-small">{t('OPENING')} / {manifest?.genre || t('A LIVING WORLD')}</div>
            <h2 className="prototype-chapter">{manifest?.name || t('A world is waiting.')}</h2>
            <div className="prototype-time-label">{layer === 'map' ? t('THE FIRST MOMENT') : t('THE STORY CONTINUES')}</div>
            <p className="prototype-narrline">{manifest?.description || t('Choose a world to begin.')}</p>
            {readme?.body && <div className="prototype-narrline"><MarkdownText text={readme.body} /></div>}
            {chalks.slice(-4).map((chalk) => (
              <blockquote key={chalk.path} className="prototype-quote">{chalk.body}</blockquote>
            ))}
            {chalks.length === 0 && (
              <p className="prototype-small">{t("The writer has not left a mark in this scene yet.")}</p>
            )}
          </div>
          <div className="prototype-narrfoot">
            {t('You are the player inside {world}', { world: manifest?.name || t('this world') })}
            <span>{t('Current place: {place}', { place: currentName })}</span>
          </div>
        </aside>}

        <section className="prototype-world" aria-label={t("Spatial story canvas")}>
          {nookChar && (
            <div
              className="prototype-nook"
              data-airp-projection={`nook:${nookChar}`}
              aria-hidden={dialogueBlocksCanvas || worldPickerOpen}
              inert={dialogueBlocksCanvas || worldPickerOpen}
            >
              <NookView key={nookChar}
                worldId={manifest?.id ?? ''}
                characterId={nookChar!}
                character={characters.find((item) => item.id === nookChar) ?? { id: nookChar! }}
                effectsEnabled={worldEffectsEnabled}
                particleDensity={settings.particleDensity}
                hidden={!pageVisible}
                reducedMotion={reducedMotion}
                allowChalkDrag={allowChalkDrag}
                resolveAssetUrl={assetUrl}
                locale={locale}
                scene={nookScene}
                focus={focusCoordinator}
                onEnterScene={enterNookScene}
                onClose={closeNook}
                inactive={activeCharacter !== null}
                onMoveCard={moveCardAction}
                writerLocked={writerLocked}
                onSelectChoice={runChoice}
                onEntityAction={runEntityAction}
                onOpenCharacterModal={(id) => {
                  const character = characters.find((item) => item.id === id);
                  if (character) openCharacter(character);
                }}
                onItemDropOnTarget={handleItemDrop}
                onDropItemToScene={handleReturnItem}
                onTakeItem={handleTakeItem}
                onRequestInit={(kind, target, request) => sendMessage({ type: 'airp_init', kind, target, ...(request ? { request } : {}), by: 'player' })}
              />
            </div>
          )}
          {!nookChar && (
            <div
              data-airp-projection={`layer:${layer}`}
              data-airp-projection-active="true"
              aria-hidden={dialogueBlocksCanvas || worldPickerOpen}
              inert={dialogueBlocksCanvas || worldPickerOpen}
            >
              {viewMode === 'map' ? (
                /* Map mode: the same layer drawn as a place. Every
                   click reuses the canvas's own action, so this is a view, not a
                   second way to play. */
                <Board
                  worldId={manifest?.id ?? ''}
                  layerId={layer}
                  readme={readme?.frontmatter ?? null}
                  // The layer's own still picture; a video background is not a map.
                  image={state?.bg?.src && !/\.(mp4|webm)$/i.test(state.bg.src) ? assetUrl(state.bg.src, 'image') ?? null : null}
                  items={stageItems}
                  characters={boardCharacters}
                  // The prologue has one car to stand in: no way out to the train overview it never visits.
                  parent={prologueOpen ? null : boardParent}
                  carried={carriedPaths}
                  onEnterPlace={(target) => { void enterGate(target, 'board'); }}
                  onMeetCharacter={(id) => { void meetCharacter(id); }}
                  onTakeItem={(path) => { void handleTakeItem(path); }}
                  onLeave={(parentId) => { void enterLayer(parentId).then(applyFollowFailures); }}
                  clearCompanion={stageOnScreen && !nookChar}
                  resolveAsset={(path) => assetUrl(path, 'image') ?? null}
                  onEntityAction={runEntityAction}
                  focus={focusCoordinator}
                />
              ) : (
                <Canvas
                  key={manifest?.id || 'opening'}
                  effectsEnabled={worldEffectsEnabled}
                  particleDensity={settings.particleDensity}
                  currentLayer={layer}
                  focus={focusCoordinator}
                  hidden={!pageVisible}
                  reducedMotion={reducedMotion}
                  allowChalkDrag={allowChalkDrag}
                  stillPortraits={reducedMotion}
                  ghost={ghostItem}
                  ghostLabel={ghostLabel}
                  ghostCopy={{
                    reused: t('Already had this image'),
                    failed: t('The picture could not be drawn.'),
                    unreachable: t('The picture could not be shown.'),
                  }}
                  items={stageItems}
                  retiringPaths={streamOn ? retiringChalks : undefined}
                  onChalkToStream={streamOn ? openStreamAt : undefined}
                  links={canvasLinks}
                  playerTags={playerBoard.tags}
                  {...clueBoard.canvasProps}
                  bg={(!loadingWorld && state?.bg) || { src: null, tone: 'warm', grain: 'parchment' }}
                  onMoveCard={moveCardAction}
                  onSelectChoice={runChoice}
                  onEntityAction={runEntityAction}
                  onOpenCharacterModal={(id) => { void meetCharacter(id); }}
                  presence={presenceViews}
                  assetUrl={assetUrl}
                  onEnterGate={(target) => { void enterGate(target, 'double-click'); }}
                  carried={carriedPaths}
                  onDropItemToScene={handleReturnItem}
                  onTakeItem={handleTakeItem}
                  onOpenRadialMenu={openRadial}
                  onLongPress={openRadial}
                  ambient
                />
              )}
              {!nookChar && clueBoard.chrome}
            </div>
          )}

          {/* One stable show owner serves whichever stage projection is active. */}
          <PerformanceLayer
            layer={nookChar ? `characters/${nookChar}` : layer}
            frozen={state?.worldFrozen === true}
            hidden={!pageVisible}
            effectsEnabled={worldEffectsEnabled}
            reducedMotion={reducedMotion}
            admission={overlayAdmission}
          />
          <div className="prototype-vignette" aria-hidden="true" />

          <header className="prototype-worldtop prototype-chrome" hidden={nookChar !== null} aria-label={t("World header")} inert={!shell.header || shell.immersive || nookChar !== null}>
            <span className="prototype-brand">World<span>lines</span></span>
            {/* The world hover hangs here when no clock badge shows. */}
            {manifest && worldHoverAnchor(closedRun) === 'title' && (
              <HoverPanel className="world-title-hover" label={t('World panel')} panel={<WorldPanelBody panels={worldPanels} name={manifest.name || ''} time={null} onRestart={restartWorld} />}>
                <span className="prototype-world-title">{manifest.name}</span>
              </HoverPanel>
            )}
            <nav className="prototype-crumbs" aria-label={t("Scene path")}>
              {breadcrumbs.map((part) => {
                const label = part === 'map' ? t('Map') : sceneName(manifest, part);
                // One line, ellipsised: a wrapped crumb breaks the fixed-height header.
                return <button key={part} title={label} onClick={() => { void enterGate(part, 'breadcrumb'); }}><span className="prototype-crumb-label">{label}</span></button>;
              })}
            </nav>
            <div className="prototype-spacer" />
            <span className="prototype-freeze" aria-label={state?.worldFrozen ? t('World paused') : t('World awake')}>{state?.worldFrozen ? t('WORLD PAUSED') : t('WORLD AWAKE')}</span>
            <span className="prototype-status" aria-label={t('{items} items · {people} people', { items: handItems.length, people: characters.length })}>{t('{items} ITEMS · {people} PEOPLE', { items: handItems.length, people: characters.length })}</span>
            <button className="prototype-pill" data-guide-target="home" onClick={() => { if (authoring) markGuide('home'); setLauncherOpen(true); }}>{t('World launcher')}<NoticeDot /></button>
            <button className="prototype-pill" onClick={() => setWorldPickerOpen(true)}>{t("Worlds")}</button>
            <ContactPanel focus={focusCoordinator} />
            {/* 「报告问题 / 卡住了」: beside 联系我们, one tap from any scene. */}
            <ReportIssueButton />
            <AccountPanel focus={focusCoordinator} />
            <label className="prototype-language"><span className="sr-only">{t('Language')}</span><select aria-label={t('Language')} value={locale} onChange={event => setLocale(event.target.value as 'en' | 'zh-CN' | 'ja' | 'ko')}><option value="en">English</option><option value="zh-CN">简体中文</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label>
            <AgentSettings
              settings={world.settings}
              onSaveSettings={world.saveSettings}
              focus={focusCoordinator}
              onReplayTutorial={companion ? replayOpening : undefined}
              characterTick={worldTickOf(manifest)}
              worldKey={activeWorldPath ?? manifest?.id ?? null}
            />
            <TtsSettings focus={focusCoordinator} />
            <MuteButton />
            <PerformanceSettingsTrigger variant="header" open={performanceSettingsOpen} onOpen={openPerformanceSettings} />
            <button className="prototype-quiet prototype-header-close" onClick={() => toggleShell('header')} aria-label={t("Close header")}><ChevronUp size={16} /></button>
          </header>
          {/* 试玩: a play copy of the author's own
              draft says so, with the way back, above everything but the modals. */}
          {trialOrigin && !nookChar && (
            <div className="trial-bar" role="status" data-testid="trial-bar">
              <span>{t('Play test')}</span>
              <button type="button" data-testid="trial-end" disabled={loadingWorld !== null} onClick={() => { void loadWorld(trialOrigin); }}>{t('End trial, back to editing')}</button>
            </div>
          )}

          {!nookChar && (
            <div className="prototype-edge-controls prototype-chrome">
              {!companion && <button onClick={() => toggleShell('journal')} aria-label={t("Toggle story journal")} aria-expanded={shell.journal}><BookOpen size={17} /></button>}
              <button onClick={() => toggleShell('header')} aria-label={t("Toggle header")} aria-expanded={shell.header}><ChevronDown size={17} /></button>
              {/* Character voice on/off in one tap, header open or not. */}
              <VoiceToggle />
            </div>
          )}

          {/* Canvas ⇄ map: always in sight, next to the immersion
              toggle. It lived in the canvas tools column, which nobody found. */}
          {!nookChar && <ViewModeSwitch mode={viewMode} onChange={setViewMode} />}
          {/* Event cards: what a roll made happen to a character, an item or a place. */}
          <StoryEvents />
          {/* Looping worlds: 「第 N 轮」 when the world resets. */}
          <LoopBanner />
          {/* Closed worlds: clock, ending, play again. */}
          <ClosedRun
            run={closedRun}
            worldId={manifest?.id ?? ''}
            worldName={manifest?.name || ''}
            onPlayAgain={() => restartWorld?.()}
            onLobby={() => setLauncherOpen(true)}
            companion={finaleCompanion}
            held={launcherOpen || loadingWorld !== null}
            worldPanel={(clockLine) => <WorldPanelBody panels={worldPanels} name={manifest?.name || ''} time={clockLine} onRestart={restartWorld} />}
            prologue={prologueOpen ? {
              recap: prologueRecap({ spoke: prologueFacts.spoke, took: handItems.length > 0, rolled: prologueFacts.rolled, door: true }, defaultCompanion?.name || defaultCompanion?.id || '', t),
              next: { name: prologueNextName, line: t('More passengers, more cars · the same night, from the start') },
              onNext: continueFromPrologue,
              onAllWorlds: leavePrologueToLobby,
            } : null}
          />
          {prologueOpen && <FirstRunMenu onAllWorlds={leavePrologueToLobby} />}
          {!nookChar && (
            <button className="prototype-immersion-toggle" onClick={() => toggleShell('immersion')} aria-label={shell.immersive ? t('Show interface') : t('Hide interface')} title={t("Toggle immersion · Tab")}>{shell.immersive ? <Minimize size={17} /> : <Maximize size={17} />}</button>
          )}
          {!nookChar && shell.immersive && (
            <button
              type="button"
              className="prototype-edge-wake"
              onClick={() => toggleShell('immersion')}
              aria-label={t('Show interface')}
              title={t('Show interface')}
            />
          )}
          {/* Immersive-only hang-up for a rail call:
              the rail root carries `prototype-chrome`, which `.is-immersive`
              hides — mounting, not unmounting — so without this the call would
              keep billing with no reachable exit. Same shape as the edge wake
              above: a SEPARATE element that never carries `prototype-chrome`,
              never a CSS override fought against the hide. `railCallOwner` is
              already prefixed, so it is passed through untouched. */}
          {!nookChar && shell.immersive && railCallOwner && (
            <button
              type="button"
              className="prototype-call-wake"
              onClick={() => void liveCallStop(railCallOwner)}
              aria-label={t('Hang up')}
              title={t('Hang up')}
            />
          )}


          {/* 全局 activity rail（契约 §7.1）：writer/functional 在角色或小天地
              打开时也必须可见；character 只进入 CharacterModal 自己的 surface，
              避免串台。始终挂在这里，不作为 modal 的后代。 */}
          <ActivityRail surface="rail" className="prototype-chrome" />
          <ConnectedWorldToastRegion className="prototype-chrome" />
          <AgentActivityLog query={{ surface: 'rail' }} className="prototype-chrome" focus={focusCoordinator} />

          {!nookChar && (
            <div className="prototype-tools prototype-chrome" role="group" aria-label={t("Canvas tools")}>
              <span className="prototype-tools__mode" role="status" aria-label={t("Explore mode")}><span aria-hidden="true">↖</span><span className="prototype-tools__label">{t("Explore")}</span></span>
              <button onClick={() => cameraStack.restoreTarget(projectionTarget('layer', layer))} title={t("Return to scene")} aria-label={t("Return to scene")}><span aria-hidden="true">⌖</span><span className="prototype-tools__label">{t("Return")}</span></button>
              <CanvasArrangeControl
                ref={arrangeControlRef}
                worldId={manifest?.id ?? null}
                layer={layer}
                worldReady={worldReady}
                writerBusy={writerLocked}
                worldChanging={loadingWorld !== null}
                state={state}
                requestArrange={world.requestArrange}
                cancelArrange={world.cancelArrange}
                refresh={refresh}
              />
            </div>
          )}

          <div
            className="prototype-belongings prototype-chrome"
            role="group"
            aria-label={t("Belongings")}
            hidden={nookChar !== null}
            aria-hidden={nookChar !== null}
            // The draggable button stays in its saved home; the open panel is a
            // viewport-level sibling so its fixed bounds ignore the button offset.
            data-writer-open={writerSheetOpen ? 'true' : undefined}
            data-clear-companion={stageOnScreen && !nookChar ? 'true' : undefined}
            style={bagDrag.style}
          >
            <button ref={bagButtonRef} className="prototype-bag-toggle" {...bagDrag.handlers} onClick={() => { if (!bagDrag.consumeDrag()) toggleBag(); }} title={t('Drag to move')} aria-label={t(bagOpen ? "Close belongings" : "Open belongings")} aria-expanded={bagOpen} aria-controls="bag-panel"><Backpack size={19} /><span>{handItems.length}</span></button>
          </div>
          {bagOpen && nookChar === null && (
            <div id="bag-panel" className="prototype-bag-content prototype-chrome" role="region" aria-label={t("Belongings")}>
              <div className="inventory-heading"><span>{t("BELONGINGS")}</span><button ref={bagCloseRef} type="button" onClick={closeBag} aria-label={t('Close')}>×</button></div>
              {handItems.length === 0 && <p>{t("Nothing carried yet.")}</p>}
              {handItems.map((item) => (
                <button
                  key={item.path}
                  className="inventory-item"
                  draggable
                  onClick={() => setSelectedBagPath(item.path)}
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', item.path)}
                  aria-label={String(item.frontmatter?.title || labelOf(stripExt(item.filename)))}
                >
                  <ItemArtwork item={item} />
                  <span className="inventory-item__name">{item.frontmatter?.title || labelOf(stripExt(item.filename))}</span>
                  <span className="inventory-item__open" aria-hidden="true">↗</span>
                </button>
              ))}
              <SceneReel scenes={sceneReel(closedRun.moments ?? null)} resolveAsset={(path, kind) => assetUrl(path, kind) ?? null} />
            </div>
          )}

          <button className="prototype-player-orb prototype-chrome" hidden={nookChar !== null} aria-hidden={nookChar !== null} style={playerAvatar ? { backgroundImage: `url("${withBase(playerAvatar)}")`, backgroundSize: 'cover', backgroundPosition: 'center 25%' } : undefined} onClick={() => setProfileOpen((open) => !open)} aria-label={t("Open player profile")} aria-expanded={profileOpen}>{!playerAvatar && <UserRound size={25} />}<span className="prototype-player-label"><small>{t("YOU")}</small>{playerRole}</span></button>
          {/* 「状态」「技能」 on the player's own avatar: always in sight, one press to the panel. */}
          {!nookChar && !launcherOpen && quickFor('player', 'player')}
          {quickOpen && !nookChar && !launcherOpen && (
            <AvatarSheetPanel
              who={quickOpen.who}
              tab={quickOpen.tab}
              title={`${quickName(quickOpen.who)} · ${quickOpen.tab === 'skills' ? t('Skills') : t('Status')}`}
              onClose={() => setQuickOpen(null)}
            >
              {quickOpen.tab === 'state' ? (
                quickHas(quickOpen.who).hasState
                  ? <StateLines states={quickOpen.who === 'player' ? worldPanels.player.states : worldPanels.characters[quickOpen.who] ?? []} />
                  : <p className="avatar-sheet__empty">{t('Nothing unusual right now.')}</p>
              ) : worldSheets.rules && (quickOpen.who === 'player' ? worldSheets.player : worldSheets.characters[quickOpen.who]) ? (
                <>
                  <SheetBody
                    sheet={(quickOpen.who === 'player' ? worldSheets.player : worldSheets.characters[quickOpen.who])!}
                    rules={worldSheets.rules}
                    canUse={quickOpen.who === 'player'}
                    testId={quickOpen.who === 'player' ? 'player-sheet' : 'companion-sheet'}
                  />
                  {quickOpen.who === 'player' && <InspirationRoll inspiration={worldSheets.inspiration} system={worldSheets.rules.system} />}
                  {quickOpen.who === 'player' && <CompanionSkills sheets={worldSheets} />}
                </>
              ) : <p className="avatar-sheet__empty">{t('No skills are written for this world.')}</p>}
            </AvatarSheetPanel>
          )}
          {/* The player panel: opened from the orb, never always on screen. */}
          <PlayerPanel
            open={profileOpen && chromeVisible && !nookChar}
            onClose={closeProfile}
            name={playerRole}
            avatar={playerAvatar ? withBase(playerAvatar) : null}
            blurb={manifest?.id === 'wuwu' ? 'Newly posted to Fogwharf. Three commissions, one unfinished case. Your story begins here.' : t('Your story unfolds in {world}.', { world: manifest?.name || t('this world') })}
            states={worldPanels.player.states}
            carried={handItems.length}
            onOpenBelongings={openBelongings}
            sheets={worldSheets}
          />

          {/* The message drawer: one timeline at the bottom, pulled up with the writer. Its 「选项」
              page is the old LEFT column — every option on this layer, the layer README's own
              `choice` first, the same `useDeclaredChoice` the card panel uses — drawn flat instead of parked at
              the left edge, where it was easy to miss. */}
          {streamOn && (
            <MessageDrawer
              entries={streamEntries}
              history={streamHistory}
              onLoadOlder={() => void messageStream.loadOlder()}
              open={streamOpen}
              onOpen={() => openStreamAt()}
              onClose={closeStream}
              focus={streamFocus}
              tabRequest={drawerTab}
              faces={faces}
              player={{ name: playerRole, avatar: playerAvatar ?? null }}
              placeName={(id) => (!id ? '' : id === 'map' ? t('Map') : sceneName(manifest, id))}
              onCanvas={shownChalks}
              isDone={chalkDone}
              onShowOnCanvas={(path) => {
                emphasizeCard(path);
                window.setTimeout(clearCardEmphasis, 2400);
              }}
              place={currentName}
              crowded={stageOnScreen}
              optionCount={openOptionCount}
              options={(
            <ChoiceRail
              variant="drawer"
              cards={readme ? [readme, ...canvasItems] : canvasItems}
              projection={`layer:${layer}`}
              focus={focusCoordinator}
              /* Any option that resolves is the guide's second move: the player
                 has found the column and used it. All three
                 outcomes count — writer prompt, gate, character. */
              onChoice={(prompt) => { markGuide('options'); runEntityAction(prompt); }}
              onEnterGate={(target) => { markGuide('options'); void enterGate(target, 'choice-rail'); }}
              onOpenCharacter={(id) => { markGuide('options'); void meetCharacter(id); }}
              /* The world's own map, at the foot of the column: the layers it
                 declares, where the player is, and one click to any of them. */
              layers={manifest?.layers}
              currentLayer={layer}
              isDone={optionIsDone}
              onEnterLayer={(target) => {
                markGuide('options');
                void enterLayer(target).then(applyFollowFailures);
              }}
            />
              )}
            />
          )}

          {/* The character rail: RIGHT column, stacked
              above the belongings, no tabs. It replaced the companion-only
              `.prototype-residents` row, which could not express "elsewhere"
              or "absent" and never showed who was following. */}
          {/* NPC cards talk through the writer, not an agent. */}
          {!nookChar && <NpcDialogueHost language={contentLanguage} focus={focusCoordinator} onOpenChange={setNpcTalking} yielded={stageYields} layer={replyChipsOn ? layer : undefined} regenLocked={lineLocked} />}
          {!nookChar && (companion ? (
            /* The same rail, wrapped by its two-state carrier:
               the avatar column IS `CharacterRail`, the portrait + compact
               dialogue is the expanded state stacked under it. */
            <CharacterDock
              quick={railQuick}
              worldPath={activeWorldPath}
              onOpenStream={() => openStreamAt()}
              views={railViews}
              pendingFollowing={pendingFollowing}
              nookOpen={nookChar !== null}
              onOpenCharacter={(id) => {
                const character = characters.find((item) => item.id === id);
                if (!character) return;
                // Coming back to a greeter the player closed without answering:
                // the greeting is still the last thing said on screen, so it is
                // still the line their agent has to answer.
                const prior = opening?.greeterId === id && opening.phase === 'greeting'
                  ? opening.line
                  : undefined;
                openCharacter(character, prior);
              }}
              onTravelTo={(id) => void navigateToCharacter(id)}
              onToggleFollowing={(id, next) => void toggleFollowing(id, next)}
              onOpenNook={openPrivateSpace}
              notify={notify}
              assetUrl={assetUrl}
              active={dockCharacter ? {
                id: dockCharacter.id,
                name: dockCharacter.name,
                avatar: assetUrl(dockCharacter.avatar, 'image'),
                avatarVideo: assetUrl(dockCharacter.avatarVideo, 'video'),
                bio: dockCharacter.bio || dockCharacter.description,
                emotions: dockCharacter.emotions
                  ? Object.fromEntries(
                    Object.entries(dockCharacter.emotions).map(([emo, path]) => [emo, assetUrl(path, 'image') ?? ''])
                  )
                  : undefined,
                // The dock speaks with the same voice the modal would use.
                voice: dockCharacter.voice,
              } : null}
              expanded={stageShown}
              language={contentLanguage}
              prefill={tutorialSpeakLine}
              replies={openingReplies}
              lines={dockLines}
              onLineSaid={(line, generated) => { if (!generated) spendLine(line.key); }}
              regenerate={dockCharacter ? {
                request: (recent, signal) => airpGateway.suggestReplies({ character: dockCharacter.id, layer, recent }, signal).then((r) => r.lines),
                locked: lineLocked,
              } : null}
              place={layer}
              nudge={hint && dockCharacter && hint.by === dockCharacter.id && !hint.id.startsWith('tick:') ? { id: `${hint.id}:${hint.beat}`, text: hint.say } : null}
              sayNow={sayNow}
              onSaidNow={() => setSayNow(null)}
              linesByCharacter={railLines}
              onSayTo={sayTo}
              openId={stageShown ? dockCharacter?.id ?? null : null}
              // No guest session for this first run: the scene and the greeter's line, the sign-in card instead of the reply box.
              gate={prologueOpen && firstRunGate ? (
                <FirstRunSignInCard reason={firstRunGate} onSignIn={signInFromFirstRun} onAllWorlds={leavePrologueToLobby} />
              ) : null}
              // The first act belongs to the character who greets. Opening 老莫's
              // dock while 薇拉's greeting is pending showed 薇拉's words under
              // 老莫's name; any other character opens on their own scrollback.
              opening={opening && (opening.greeterId === null || opening.greeterId === dockCharacter?.id) ? {
                line: opening.greeterId ? opening.line : null,
                narration: opening.greeterId ? null : opening.line,
                // The whole tutorial: one hint, on the reply box, until they use
                // it. While the guide is showing its own first step it is
                // saying the same sentence on the same box, so the dock's copy
                // stands down rather than printing it twice.
                coach: opening.phase === 'greeting' && opening.greeterId !== null && guide.step !== 'speak',
                awaitingAnswer: opening.phase === 'answering',
                onAnswered: openingAnswered,
                invite: opening.phase === 'invite' ? opening.invite : null,
                onAcceptFollow: () => {
                  if (opening.greeterId) void toggleFollowing(opening.greeterId, true);
                  finishOpening();
                },
                // Declining sends nothing at all; the rail's follow toggle stays.
                onDeclineFollow: finishOpening,
              } : null}
              onClose={() => {
                // Closing someone opened for a word hands the stage back to the
                // companion. Closing the companion themself is the player's word
                // on it, and the auto-open above has to hear it or it reopens the
                // stage on the next render and the close button does nothing.
                if (dockStaysOnStage) setDockDismissed(true);
                // Dismissing a greeting nobody has answered yet is not closing a
                // dialogue — no agent is running to stop. It collapses the
                // stage; the companion stays in the world.
                if (!activeCharacter) { setOpeningDismissed(true); return; }
                closeCharacter();
              }}
              followOffer={tutorialFollowOffer}
              onSendMessage={(message) => {
                countTutorialSend();
                if (activeCharacter) {
                  sendMessage({ type: 'character_prompt', characterId: activeCharacter.id, message, savePath: activeWorldPath });
                  // A first act the player stepped out of and came back to is
                  // still the first act: answering the greeter here ends it the
                  // same way, and the save's marker is written when the answer
                  // settles rather than never.
                  setOpening(current => (
                    current && current.greeterId === activeCharacter.id && current.phase === 'greeting'
                      ? { ...current, phase: 'answering' }
                      : current
                  ));
                  return;
                }
                // First reply to the opening: NOW the agent starts, carrying the
                // greeting it never saw. The coach mark goes
                // with it and the act waits for their answer.
                if (!dockCharacter) return;
                openCharacter(dockCharacter, opening?.line);
                sendMessage({ type: 'character_prompt', characterId: dockCharacter.id, message, savePath: activeWorldPath });
                setOpening(current => (current ? { ...current, phase: 'answering' } : null));
              }}
              effectsEnabled={worldEffectsEnabled}
              frameQueue={frameQueue}
              focus={focusCoordinator}
              closeFor={dockCloseFor}
              stayOnStage={dockStaysOnStage}
              /* Someone answered them — the guide's first move, whether or not
                 this save had a first act to answer. */
              onCharacterAnswered={() => { markGuide('speak'); characterAnswerSettled(); experienceAnswered(); }}
            />
          ) : (
          <CharacterRail
            quick={railQuick}
            views={railViews}
            pendingFollowing={pendingFollowing}
            nookOpen={nookChar !== null}
            onOpenCharacter={(id) => {
              const character = characters.find((item) => item.id === id);
              if (character) openCharacter(character);
            }}
            onTravelTo={(id) => void navigateToCharacter(id)}
            onToggleFollowing={(id, next) => void toggleFollowing(id, next)}
            onOpenNook={openPrivateSpace}
            notify={notify}
            assetUrl={assetUrl}
          />
          ))}
          {/* Classic chrome: the "What do you do?" toggle, the floating stop /
              retry controls and the bottom writer dock. In `companion` all four
              live inside the bottom-right FAB's sheet instead. */}
          {!companion && (<>
            <button className="prototype-action-toggle prototype-chrome" onClick={() => {
              if (attention === 'authoring') {
                closeRadial();
                setAttention('ambient');
                setIsGodHandOpen(false);
                return;
              }
              setAttention('authoring');
              setShell(current => ({ ...current, immersive: false }));
              window.setTimeout(() => writerRef.current?.focus(), 0);
            }} aria-label={t("Write an action")}><Sparkles size={17} /><span>{t('What do you do?')}</span></button>
            {writerWorking && <button type="button" className="writer-stop-control" data-writer-stop disabled={writerState.stopRequested} onClick={() => {
              if (requestWriterStop()) sendMessage({ type: 'writer_abort' });
            }} aria-label={t(writerState.stopRequested ? 'Stop requested' : 'Stop writing')}>
              ■ {writerState.stopRequested ? t('Stop requested') : t('Stop writing')}
            </button>}
            {writerState.error?.retryable && retryWriterPrompt() && (
              <button type="button" className="writer-retry-control" data-writer-retry onClick={() => {
                const prompt = retryWriterPrompt();
                if (prompt) void submitWriterText(prompt, undefined, true);
              }}>
                {t('Retry writing')}
              </button>
            )}
            <div className="prototype-dock prototype-chrome">
              <div className="prototype-docktop">
                <b>{t("✧ SPEAK TO THE WRITER")}</b>
                <span>{state?.worldFrozen ? t('The world is paused') : t('Your action moves the world forward')}</span>
                <span className="prototype-dock-status" data-state={writerStatusKind} aria-live="polite">{writerStatusText}</span>
                <div className="prototype-spacer" />
                <span>↵</span>
              </div>
              <div className="prototype-dockrow">
                <WriterBar {...writerBarProps} />
              </div>
            </div>
          </>)}

          {companion && (
            <WriterTrayFab
              cards={routeCards}
              projection={`layer:${layer}`}
              onChoice={(prompt) => { runEntityAction(prompt); }}
              onEnterGate={(target) => { void enterGate(target, 'choice-rail'); }}
              onOpenCharacter={(id) => { void meetCharacter(id); }}
              onWriterLine={(text) => { void submitWriterText(text); }}
              slips={writerSlips}
              onSlipUsed={(slip) => {
                spendLine(slip.key);
                // A slip that is not a line for the writer (an option, a door) is still the player's move: in the
                // stream as theirs. A line for the writer is recorded by `submitWriterText` itself.
                if (!slip.text) messageStream.record({ id: `you:${Date.now()}:${slip.key}`, kind: 'you', who: 'writer', text: slip.label, layer });
              }}
              faces={faces}
              note={writerNote}
              rootRef={writerFabRef}
              // The companion's (or an NPC's) reply box owns the bottom-right
              // corner while the stage is open; the FAB steps left of that column
              // instead of landing on the send button.
              clearCompanion={stageOnScreen && !nookChar}
              holdOpen={isGodHandOpen}
              open={writerSheetOpen}
              // The writer's own tools ride in its sheet, not
              // in a second floating row on top of it.
              tools={(
                <div role="group" aria-label={t("Authoring tools")}>
                  <GodModeToolbar frozen={state?.worldFrozen === true} onToggleFreeze={handleToggleFreeze} allowChalkDrag={allowChalkDrag} onToggleChalkDrag={handleToggleGodHand} />
                </div>
              )}
              onRailLimit={setWriterRailLimit}
              onOpenChange={onWriterOpenChange}
              focus={focusCoordinator}
              onStop={() => { if (requestWriterStop()) sendMessage({ type: 'writer_abort' }); }}
              onRetry={() => {
                const prompt = retryWriterPrompt();
                if (prompt) void submitWriterText(prompt, undefined, true);
              }}
              bar={writerBarProps}
            />
          )}

          {writerWorking && (!writerSheetOpen || bagOpen) && (
            <div className="prototype-panel-stop" role="group" aria-label={t("Writer controls")}>
              <span role="status" aria-live="polite">{writerState.stopRequested ? t('Stop requested') : t('The writer is writing…')}</span>
              <button type="button" data-writer-stop disabled={writerState.stopRequested} onClick={() => { if (requestWriterStop()) sendMessage({ type: 'writer_abort' }); }}>
                {writerState.stopRequested ? t('Stop requested') : t('Stop writing')}
              </button>
            </div>
          )}

          {/* Classic only: in companion the writer's tools ride in its sheet. */}
          {attention === 'authoring' && !companion && !bagOpen && (
            <div className="prototype-authoring">
              <GodModeToolbar frozen={state?.worldFrozen === true} onToggleFreeze={handleToggleFreeze} allowChalkDrag={allowChalkDrag} onToggleChalkDrag={handleToggleGodHand} />
              <button className="prototype-quiet" onClick={() => { closeRadial(); setAttention('ambient'); setIsGodHandOpen(false); }}>{t("Close")}</button>
            </div>
          )}


          {showWorkshopChrome({ artAuthoring, nook: nookChar !== null, launcherOpen, introOpen: introCardOpen, modalOpen: createOpen }) && (
            <WorkshopArtPanel
              art={workshopArt.art}
              layer={layer}
              layerName={sceneName(manifest, layer)}
              open={artPanelOpen}
              onToggle={() => setArtPanelOpen(open => !open)}
              onNavigate={(target) => { void enterLayer(target).then(applyFollowFailures); }}
              onSlot={(slot, landed) => {
                workshopArt.update(slot);
                // A landed picture may now be this layer's bg / map / an avatar.
                if (landed) { void refresh(); void loadChromeData(); }
              }}
              // A new 设定 changes world.json `theme` / `mode`: re-read the manifest.
              onThemeSaved={() => { void loadChromeData(); }}
              onTrial={startTrial}
              // Clearing play traces rewrote cards in place: re-read the page.
              onPlayCleared={() => { void refresh(); void loadChromeData(); }}
              // A draft original's save path is its id (`isArtAuthoring`: id = directory).
              worldPath={manifest?.id ? `worlds/${manifest.id}` : undefined}
            />
          )}
          {/* Creation mode, map view, this place's map not painted yet: the
              board falls back to the scene picture; say so, with the prompt. */}
          {viewMode === 'map' && unpaintedMap && !nookChar && !artPanelOpen && (
            <div className="workshop-map-note" role="note">
              <strong>{t('This map is not painted yet')}</strong>
              <p>{unpaintedMap.prompt || t('Write the prompt for this picture…')}</p>
              <button type="button" onClick={() => setArtPanelOpen(true)}>{t('Open assets')}</button>
            </div>
          )}

        </section>
      </main>

      {loadingWorld && <div role="status" className="prototype-world-loading">{t(' · opening…')}</div>}
      <GateThreshold focus={focusCoordinator} />
      {/* The prologue has its own upright phone layout (first-run.css): no rotate hint there. */}
      {!launcherOpen && !prologueOpen && <RotateHint />}
      {/* The first-run experience holds the lobby back while it decides, and covers it with the language screen. */}
      {launcherOpen && firstRunPhase === 'checking' && <div className="first-run" aria-busy="true" data-testid="first-run-checking" />}
      {launcherOpen && (firstRunPhase === 'language' || firstRunPhase === 'starting') && (
        <FirstRunLanguage
          locale={locale}
          suggested={firstRunSuggestion}
          cover={(() => { const cover = (firstRunShelf.current ?? shelf).groups?.find((g) => g.id === prologueIdFor(locale))?.cover; return cover ? withBase(cover) : null; })()}
          busy={firstRunPhase === 'starting'}
          onLocale={setLocale}
          onPlay={() => startPrologue(locale)}
          onAllWorlds={() => { markFirstRunDone(); setFirstRunPhase('off'); }}
        />
      )}
      {launcherOpen && firstRunPhase === 'off' && (
        <WorldLauncher
          shelf={shelf}
          loading={loadingWorld}
          publishing={publishing}
          onLoad={playWorld}
          onCreate={() => { void withAccount('play', () => setCreateOpen(true), undefined, 'local'); }}
          onPublish={(editPath, publish) => void publishWorld(editPath, publish)}
          onKeepInCloud={keepInCloud}
          onKeepBoth={(worldPath) => void keepBoth(worldPath)}
          onClose={manifest ? () => { void continueStory(); } : undefined}
          onManageSaves={() => { rememberWorldShelf(!worldPickerOpen); setWorldPickerOpen(!worldPickerOpen); }}
          shelfOpen={worldPickerOpen}
          focus={focusCoordinator}
          performanceSettings={settings}
          hidden={!pageVisible}
          performanceSettingsOpen={performanceSettingsOpen}
          onOpenPerformanceSettings={openPerformanceSettings}
        />
      )}
      {createOpen && (
        <CreateWorldDialog
          focus={focusCoordinator}
          onClose={() => setCreateOpen(false)}
          onCreated={path => { setCreateOpen(false); void loadWorld(path); }}
        />
      )}
      {worldPickerOpen && (
        <WorldShelfDialog shelf={shelf} loading={loadingWorld} onLoad={playWorld} onClose={() => { rememberWorldShelf(false); setWorldPickerOpen(false); }} onRefresh={async () => { setShelf(await airpGateway.worlds()); }} focus={focusCoordinator} />
      )}

      {selectedBagItem && (
        selectedBagItem.frontmatter?.type === 'html' ? (
          // A carried .html opens the SAME second layer as its canvas card
          //. The marker is the FROZEN virtual frontmatter
          // (§5.1) — `isHtmlPath` is unreachable from the web bundle (the shared
          // barrel pulls `node:crypto`; lib/airp-gateway.ts:8-10).
          <HtmlDetailDialog
            item={selectedBagItem}
            onClose={() => setSelectedBagPath(null)}
            focus={focusCoordinator}
          />
        ) : (
          <BagItemDialog
            item={selectedBagItem}
            onClose={() => setSelectedBagPath(null)}
            onChoose={choice => runChoice(selectedBagItem.path, choice)}
            onPlace={handleReturnItem}
            onUse={prepareItemUse}
            useDisabled={writerLocked}
            focus={focusCoordinator}
          />
        )
      )}

      {radialState && <RadialMenu {...radialState} creators={radialItems.creators} tools={radialItems.tools} boardOn={clueBoard.boardMode} onClose={closeRadial} onCreate={createAt} onTool={runRadialTool} />}

      {/* The classic full-screen stage. In `companion` the same conversation is
          the right rail's expanded state and this never mounts:
          only ONE consumer may drain a character's frame lane. */}
      {!companion && activeCharacter && (
        <CharacterModal
          key={activeCharacter.id}
          characterId={activeCharacter.id}
          worldPath={activeWorldPath}
          displayName={activeCharacter.name}
          avatar={assetUrl(activeCharacter.avatar, 'image')}
          avatarVideo={assetUrl(activeCharacter.avatarVideo, 'video')}
          emotions={
            activeCharacter.emotions
              ? Object.fromEntries(
                Object.entries(activeCharacter.emotions).map(([emo, path]) => [emo, assetUrl(path, 'image') ?? ''])
                )
              : undefined
          }
          effectsEnabled={worldEffectsEnabled}
          bio={activeCharacter.bio || activeCharacter.description}
          states={worldPanels.characters[activeCharacter.id]}
          sheet={worldSheets.characters[activeCharacter.id] ?? null}
          sheetRules={worldSheets.rules}
          frameQueue={frameQueue}
          worldId={manifest?.id}
          voice={activeCharacter.voice}
          focus={focusCoordinator}
          onClose={closeCharacter}
          language={contentLanguage}
          onOpenNook={() => openPrivateSpace(activeCharacter.id)}
          onSendMessage={(message) => {
            countTutorialSend();
            sendMessage({ type: 'character_prompt', characterId: activeCharacter.id, message, savePath: activeWorldPath });
          }}
        />
      )}

      {/* Dice ceremony overlay (screen-fixed layer, same visual language as the player path) */}
      {ceremony && (
        <DiceCeremony key={ceremony.key} verdict={ceremony.verdict} diceRendering={settings.diceRendering} onDone={clearAdmittedCeremony} />
      )}

      {/* Four sentences, one at a time, each on the control it is about and
          each waiting for the player to use that control.
          Root level so it dims the whole shell; `pointer-events: none` so it
          blocks nothing it dims — including the control it points at. */}
      {/* Never over the lobby: the guide belongs to a world the player has entered. */}
      {companion && !launcherOpen && !tutorialArmed && !introHold && !prologueOpen && <OnboardingGuide guide={guide} />}
      {/* The engine's teach-once cues (灵感骰 / 被动检定 / 同行 / 技能): the guide's bubble, no dim. */}
      {!launcherOpen && !introHold && <TutorialCueCard />}

      {/* The forced first-run tutorial: dims everything but
          the one control to use next, and swallows presses elsewhere. */}
      {/* A workshop world's first-entry intro comes BEFORE the forced tutorial. */}
      {introCardOpen && introGate.state && (
        <WorldIntroDialog
          state={introGate.state}
          focus={focusCoordinator}
          onDone={() => setIntroGate(gate => ({ ...gate, status: 'done' }))}
        />
      )}

      {/* A world's CG (show_cg, the design notes): a sibling of the forced
          tutorial so the two stack in one context — the CG under the tutorial. */}
      {/* The two presentations: a new scene's
          name + animated picture, an item obtained; transient, just under the CG reveal. */}
      {!launcherOpen && (
        <MilestoneStage
          worldKey={runKey}
          moments={closedRun.moments ?? null}
          view={viewMode}
          hidden={!pageVisible}
          held={introHold || introCardOpen}
          opening={openingScene.key === runKey ? openingScene.first : null}
          onOpeningDone={() => {
            setOpeningScene((s) => (s.key === runKey ? { ...s, done: true } : s));
            markOpeningShown();
            track('opening_done', undefined, activeOpen ? worldKeyOf(activeOpen) : null);
          }}
          resolveAsset={(path, kind) => assetUrl(path, kind) ?? null}
        />
      )}
      {!launcherOpen && <CgReveal />}

      {tutorialArmed && !launcherOpen && !introHold && !openingSceneHold && (
        <ForcedTutorial snapshot={tutorialSnapshot} onPrefillWriter={setWriterDraft} writerSubmitPending={writerSubmitPending} arriving={tutorialArriving} onStep={setTutorialStep} onEnd={endTutorial} />
      )}

      {toast && <div className="prototype-toast" role="status">{toast}</div>}
      {/* 「领取今日额度」 only after a model call said claim_required (billing enforcing credits) */}
      <ClaimPrompt />
      <PerformanceSettings
        settings={settings}
        setPerformancePreset={setPerformancePreset}
        updatePerformanceSettings={updatePerformanceSettings}
        open={performanceSettingsOpen}
        onClose={closePerformanceSettings}
        focus={focusCoordinator}
        returnFocusRef={performanceSettingsTriggerRef}
      />
      {/* 「报告问题 / 卡住了」: one sheet for both entries (world header, 联系我们 panel); where the player is, never what they said. */}
      <ReportIssueSheet focus={focusCoordinator} context={reportContext} />
      <FrameProbeHud />
      </div>
    </ActionFeedbackProvider>
  );
}
