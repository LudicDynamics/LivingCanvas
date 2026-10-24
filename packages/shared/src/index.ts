export * from './schemas/world.js';
export * from './schemas/world-intro.js';
export * from './schemas/agent-settings.js';
export * from './schemas/world-settings.js';
export * from './schemas/frontmatter.js';
export * from './schemas/components.js';
export * from './schemas/events.js';
export * from './schemas/canvas.js';
export * from './schemas/nook-note.js';
export * from './schemas/create-char.js';
export * from './schemas/live.js';
export * from './store/world-store.js';
export * from './store/local-store.js';
export * from './store/run-variants.js'; // prepareRun / pickVariant / runVariantsOf
export * from './schemas/forms.js';
export * from './schemas/appearance.js';
export * from './components/appearance-registry.js';
export * from './appearance/resolver.js';
export * from './store/layers.js';
export * from './db/schema.js';
export * from './layout/flow-columns.js';

// WS vocabulary (B6 / R0). Frame names, close codes, protocol version and the
// replay ring's shape — the code-side anchor for the developer handbook's "new frames land
// in three places at once".
export * from './protocol/ws.js';         // PROTOCOL_VERSION / WS_CLOSE / closeKind / WS_COMMANDS / GATEWAY_EVENTS / REPLAY_*
export * from './protocol/ws-command.js'; // WsCommandSchema / WsCommand (strict client → server frames)
export * from './schemas/tts.js';        // TtsRequestSchema / TtsRequest (save-scoped HTTP voice body)

// Init (I1) rules. Same no-glob discipline as below: a missing line is a silent
// unreachable module. These are consumed by the server routes and the `airp-init`
// extension command.
export * from './rules/player-notes.js';  // player sticky notes + clue board
export * from './rules/characters.js';    // isValidCharacterId / nookIdOf / characterIdOfPath
export * from './rules/emptiness.js';     // isLayerEmpty / isNookEmpty / hasInitProduct
export * from './rules/init-fallback.js'; // w2SceneTemplate
export * from './rules/voices.js';       // resolveVoice / VOICES / voiceEntry
export * from './rules/voice-roster-cast.js';  // Fish voices: casting rules against play's voice roster
export * from './rules/voice-roster.js';       // the roster snapshot this build ships + castWorldVoice
export * from './rules/emotions.js';     // EMOTIONS / Emotion / isEmotion / emotionPortraitsOf
export * from './rules/tts-text.js';     // sanitiseTtsText
export * from './rules/media.js';        // assertImageAsset / assertAssetReference
export * from './rules/experience.js';  // opening.replies / experience
export * from './commands/turn-end.js'; // POST /api/turn-end: the experience's turn-end command
export * from './rules/guest-trial.js';  // GUEST_TRIAL_WORLDS / isGuestTrialWorldId

// Action layer public surface (01 §8). Extensions import the whole barrel from
// `shared/dist/index.js`, so anything they call MUST be exported here.
export * from './actions/types.js';
export * from './actions/errors.js';
export * from './actions/actor.js';
export * from './actions/service.js';
export * from './actions/closed-world-state.js';
export * from './actions/closed-world.js';
export * from './actions/ending-text.js'; // the ending card's words: body + conditional `passages`
export * from './actions/story-event.js';
export * from './actions/refs.js';
export * from './actions/canvas.js';
export * from './actions/image-provider.js';
export * from './actions/generate-image.js';
export * from './actions/image-openai-provider.js';
export * from './rules/dice.js';
export * from './rules/skills.js';      // worldRulesOf / parseSheet / checkSpec / resolveCheck
export * from './rules/chat-transcript.js'; // parseCharacterSession / ChatSummary
export * from './rules/stream-history.js'; // the message drawer's history: pageStreamItems / streamItemsOfEvent
export * from './rules/themes.js';      // THEME_RULES / STRUCTURE_FLAGS / THEME_PRESETS / resolveTheme
export * from './rules/outcome-tiers.js'; // OUTCOME_TIERS / outcomeOfRoll / dice.consequences defaults
export * from './rules/music.js';       // MUSIC_CATALOG / AMBIENT_CATALOG
export * from './rules/interactive.js';
export * from './rules/debrief.js';     // scoreDebrief / publicMysteries / debriefWriterNote
export * from './rules/milestones.js';  // visitedScenes
export * from './rules/character-view.js'; // what a character agent may read
export * from './rules/npc.js';         // NPC objects: npcCardErrors / buildNpcBrief / parseNpcReply
export * from './rules/ambient.js';     // Ambient life: barks / emotes / chats per person
export * from './schemas/tick.js';      // Character tick: world.json `tick`
export * from './rules/tick.js';        // Character tick: the pure beat rules
export * from './rules/tick-model.js';  // Character tick v2: the model call (prompt, strict validation, cost)
export * from './schemas/tick-prompt.js'; // Character tick v2: the person's own tick prompt
export * from './rules/option-state.js'; // Is an option done?
export * from './rules/hints.js';       // Companion hints: hints.json and the per-beat pick
export * from './actions/tick.js';      // Character tick: the engine (beat, seen, view, page_moves)
export { hintDueNow } from './actions/hints.js'; // Companion hints: is one due this beat (character tick v2 keeps quiet then)
export * from './rules/art.js';         // creation-mode art: ArtBlockSchema / artOf / artErrors / worldArtManifest
export * from './actions/roll-dice.js';
export * from './components/index.js';
export * from './actions/component.js';
export * from './actions/show.js';
export * from './actions/choose.js';
export * from './actions/move.js';
export * from './actions/delete.js';
export * from './actions/edit-character-config.js';
export * from './actions/presence.js';
export * from './actions/move-to.js';
export * from './actions/initial-presence.js';
export * from './actions/look-at.js';
export * from './actions/following.js';
export * from './actions/use-item.js';
export * from './actions/create-char.js';

export * from './actions/chalk.js';
export * from './actions/create.js';
export * from './actions/search.js';       // search → dice chalk
export * from './actions/skill-cards.js';  // character sheets + skill-check cards
export * from './actions/skill-check.js';  // skillCheck → a check card / a character's own roll
export * from './actions/dice-consequence.js'; // the four tiers' consequences: record / dice_consequence / settle
export * from './actions/dice-tier-rules.js'; // check:worlds: the four-tier rules for authored dice
export * from './rules/inspiration.js';     // the inspiration roll: config, gate, which hint
export * from './rules/passive.js';         // passive checks: `passive:` declarations
export * from './rules/tutorial-cues.js';   // teach-once cues the engine marks (first inspiration / passive / follow / skill)
export * from './actions/assist.js';        // companion specialties: who rolls a skill for the player
export * from './actions/passive.js';       // runPassiveChecks: the dark roll on entering / reading
export * from './actions/inspiration.js';   // inspire / inspirationStatus
export * from './actions/layer.js';
export * from './actions/talk.js';
export * from './actions/nook-note.js';
export * from './actions/player-notes.js';
export * from './actions/world.js';       // snapshotWorld / rollbackWorld (doc-16)
export * from './schemas/loop.js';        // world.json `loop`
export * from './actions/loop.js';        // loopReset / prepareLoop / readLoopStatus
export * from './actions/loop-stages.js'; // loop.stages: what a new loop brings (applyLoopStages / loopOverlayPathProblem)
export * from './actions/option-state.js'; // the save's answer: optionStatesOf (GET /api/layer, look_at)
export * from './actions/loop-history.js'; // eventsThisLoop: the log since the last loop_reset

// B2/B3 injection surface. TS `export *` has no glob, so every new module MUST
// be added here by hand — a missing line is a SILENT unreachable module
//. This block is the single authoritative union.
export * from './render/spatial.js';      // dirPhrase (02 presencePhrase dep; extension + web share it)
export * from './render/layer-page.js';   // summaryOf / kindWordOf / renderLayerBlock
export * from './render/state.js';        // Section / renderState / STATE_* (01)
export * from './render/sections.js';     // WRITER_SECTIONS / CHARACTER_SECTIONS / sectionsFor / SECTION_CAPS (02)
export * from './render/events.js';       // renderEventWindow / EventWindowLine (03)
export * from './render/next-step.js';    // computeNextStep / NextStepFacts (04)
export * from './render/viewpoint.js';    // ViewRect / quantiseViewRect / encodeViewRect / decodeViewRect / viewpointKey / VIEWPOINT_* (05)
export * from './render/sanitise.js';     // sanitiseForBlock (00 §14)
export * from './render/canvas-snapshot.js'; // CanvasSnapshotV1 perception/read fence
export * from './render/canvas-screenshot.js'; // CanvasScreenshot transport contract (06 §4.5)
export * from './render/brief.js';        // buildSceneInitBrief / buildNookInitBrief
export * from './render/writer-pages.js'; // collectWriterPages / renderWriterPages
export * from './inject/turn-cache.js';   // readTurnBlock / writeTurnBlock (01)
export * from './inject/collect.js';      // collectSections / makeSectionDeps / buildNextStepFacts (01)
export * from './store/cursor.js';        // settleTurnCursor (03; shared by writer extension and character server side)
export * from './actions/backpack.js';    // listBackpack (02; server route imports it by package name)
export * from './store/nook-layers.js';  // deriveNookLayers / nookSceneDoors / nookSceneOfPath / nookSceneCards
export * from './rules/html-head.js';    // HtmlHead / HTML_DESIGN_WIDTHS / parseHtmlHead / htmlVirtualFrontmatter / isHtmlPath
export * from './rules/html-item.js';    // displayItemOf

// C1 world commands. TS `export *` has no glob, so a
// missing line is a SILENT unreachable module for the extension side — which
// imports this barrel by relative path (`extensions/*.ts`).
//
// `condition.js` is listed explicitly rather than through `export *`: it is
// deliberately dependency-free, so `rules/dice.js` (whose own contract is
// "zero dependencies") independently declares an identical `ParseResult<T>`.
// Re-exporting both would be an ambiguity error; `dice.js`'s copy wins because
// it is the older public name, and `condition.js`'s is re-listed below by name
// so every one of its symbols stays reachable.
export * from './commands/world-command.js';
export * from './commands/effects.js';
export * from './commands/limits.js';
export * from './commands/bindings.js';
export * from './commands/execute.js';
export * from './commands/run.js';
export * from './commands/trigger.js';
export * from './commands/idempotency.js';
export * from './commands/serial.js';
export * from './commands/paths.js';
export * from './commands/receipt.js';
// Triggers + declared states. `world-triggers.js`
// registers the ActionService hook at load time, like the action modules.
export * from './rules/states.js';         // StateDeclSchema / mappedStates / harmAmount / example packs
export * from './rules/character-form.js'; // characterFormOf: a `form` state switches name / avatar / voice
export * from './schemas/triggers.js';     // TriggerSchema / parseWorldTriggers
export * from './actions/states.js';       // writeState / stateFileOf / assertStateWriteAllowed
export * from './actions/music.js';        // setMusic (set_music, the design notes)
export * from './actions/scene-media.js';  // showCg / swapBackground / readCgLog (show_cg / swap_background effects)
export * from './commands/world-triggers.js'; // runWorldTriggers / planTriggers / fireKeywordTrigger / applyRollHarm
// The writer's fast path: one call per beat — the pack, the reply, the ops.
export * from './fast-path/pack.js';
export * from './fast-path/reply.js';
// A living world: world clock, residents' schedules,
// off-screen days, the return digest. `living.js` registers its ActionService hook.
export * from './schemas/living.js';
export * from './rules/living.js';
export * from './actions/living.js';
// A clock that moves with the player's turns (world.json `clock.perTurns`); registers its ActionService hook.
export * from './actions/turn-clock.js';
export {
  COMMAND_PROFILE,
  ConditionAst,
  ConditionAtom,
  ConditionEvalError,
  ConditionEvalErrorCode,
  ConditionOperator,
  ConditionProfile,
  ConditionProfileName,
  ConditionResult,
  ConditionScope,
  EXPECT_PROFILE,
  Operand,
  RangeOperand,
  Scalar,
  WHEN_PROFILE,
  collectHasPaths,
  collectRefPaths,
  collectRefs,
  conditionScopeOf,
  evalWhen,
  evaluateCondition,
  normalizeScalar,
  parseCommandWhen,
  parseCondition,
} from './commands/condition.js';

