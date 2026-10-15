---
name: magic-academy-play
description: This skill is read every time for all actions, moves, checks, generation, and revisits in this world. It defines world continuity and completion conditions.
---

# World Operation Rules

This is a play that actually updates files. It doesn't declare success by dialogue alone. First, read the current action source, location and parent README, intent, relevant items, character memories, and provided visit history. README gives place and known exits; Chalk gives current choices and generation intents; this skill carries world invariants. Intent is instruction to the author, not a new engine command.

## Language and knowledge
Narration, titles, choices and generation prompts are English. Filenames, directories and character IDs stay stable lowercase English kebab-case; never use a display name as a path. Examples: world/harbor-chart/beyond-the-fog/lighthouse-road/README.md, player/introduction-letter.md, characters/nanami/memory.md. Preserve README.md, SKILL.md, world.json, preset.json and existing asset paths. Give new Chalk a stable English path and English title and body. Characters know only what they witnessed or were told. Never turn secrets the player has not encountered into memories in an epilogue.

## Completing Actions
One choice returns one concrete change. Items taken are moved; reading alone doesn't move. README does not move. Don't treat characters as tools. Submissions are references, not consumption. Confirm paths and meanings of items players mention. Do not ghostwrite unspoken thoughts or plans just by pressing options. Draft ghostwriting is done only when requested and confirmed by the player.

Before execution, list files to create, update, and final releases. Write one text piece fully, then reread all files. If conditions unmet or tools fail, report missing items and do not release. Reattempt fixes only missing parts by reading existing results. No duplicate rewards or consumption on double clicks. New world state files not created; facts saved flatly in content and status.data.

## Checks
Before checks show target, needed items, uncertainty reasons, formula, success criteria, probabilities, normal and great success, failure and rare harm, and option to not roll in the same Chalk. roll_dice must be multi-line YAML. Inline {type:...} doesn't support result rewrites. expect quoted. Submission and entrance don't call roll_dice. Player rolls after seeing conditions. Changed conditions invite redo. Don't decide fact truth or consent by dice. Don't erase existing results or offer free rerolls.

## When Generating New Locations
Create only one child folder within the explicit range of the parent README and entrance Chalk. Don't expand towns just by inspecting ordinary rooms. First write the entrance's visible phrase, then README, two meaningful items, action Chalk, and a gate back to the parent. If needed, introduce one new resident note with name, role, and witnessable speech. No conversation buttons for unregistered characters; the author roleplays those meetings.

Don't treat README’s mere existence as completion. Check child README, two items, Chalk, and exit. Repair missing parts in the same location. Don't re-randomize places or people on revisit. Call generate_image once after text completion for backgrounds matching actual light, objects, and time. Write returned valid assets to README bg. Failures don’t count as text failures; report missing images and do not auto retry. Remove old bgVideo if conflicting with new images. Playable text can be used in advance. Time 1–2 is budget, not speed promise.

## Short Combination Lessons
Entrance → Atlas → Combination → Cost presentation → Naming and explicit casting → Short results. No full semester creation. Verify material ownership by actual items. Don't consume during proposals. Accept synonyms and coherent creativity for verbs.

player/spell-draft.md saves the player’s words. Reads drafts into world/spell-atlas/03-casting-terms.md with item paths, what’s possible, impossible, costs, and why the combination is chosen. Provides "Name and cast with these conditions", "Modify", and "Quit" options. Asks for undecided names. Executes only with player’s consent. Can quote item combos for short roleplaying resolutions; dice not mandatory.

Candidate costs include the star fragment temporarily resting its light until the next night. No permanent loss of memory, voice, or name without prior consent. Agree on range before choosing a different cost. Only uncertain casts get optional pre-declared checks. Display formula, thresholds, all result probabilities, normal/great success, failure/rare harm, then await player dice input. No silent numerical additions.

If "Open" + star fragment agreed to open space, generate README for world/spell-atlas/star-chart-room, changed-space.md, cost-trace.md, 01-my-spell.md, and return-gate.md, placing an entrance to the observatory. If "Reflect" + hand mirror agrees on portable star map, make same structure for world/spell-atlas/palm-stars and player/named-star-chart.md. This reflects stars in the mirror but no entrance. Don’t merge all successes to the same entrance. Make one short alternative from meaning and cost.

Only after casting apply costs to actually used items, record the execution fact and result location in the same draft. No double execution. Generate a suitable background image for results if needed. Seraphina quotes the player-named words and shows changes before you.

## Separation of Confirmed Actions and Authors (Current)
choice_actions are implemented UI action declarations matching choice.options English IDs. Use only read(paths), take(paths), stage(paths), enter(target), character(character), reply(text), and writer(prompt optional). Reading, moving, returning to places, staging materials, or short dice displays don’t trigger authors. Stage checks materials only, no submission or execution. Writer used only for generating, free RP, unconfirmed promises, or strategies. Character questions open dialogues; don’t send lines unprompted.
New Chalks also get choice ids and choice_actions. Reading and returning aren't vague writer choices. Don’t declare future material paths as existing reads. No undefined action types, scripts, or fake APIs. UI declarations are decided operations; authors will not double execute.

## Clear Guidance
Player-facing text is short and uses everyday words. Scenes convey “what happened” and “what you can do now.” Clues show “known facts → possible deductions → next places to check” in order. Separate facts and speculations without long caveats each sentence. Replace difficult words. Use atmosphere metaphors without hiding goals or actions. New dice are only 1d10, 2d10, 1d100. Current investigation cards are 2d10, success ≥ 11, steps 2–4/5–10/11–17/18–20. Don’t increase known costs; show next actions even after failure.

## Skills and checks
This world uses D&D-like skills (world.json `rules`). The protagonist's sheet is `sheet:` in player/README.md (ability modifiers and proficient skills); a companion's is in its character README. A check is d20 + the skill modifier against a DC (easy 10, moderate 12, hard 15, very hard 20), with advantage or disadvantage when the fiction gives it; a natural 20 always succeeds, a natural 1 always fails. When the protagonist attempts something uncertain, call skill_check with the fitting skill and DC, then stop and let the player roll; narrate from the resolved tier. A companion may roll for its own action (skill_check, actor "self"). Never decide such an outcome in prose; feelings, promises and consent are never checks.
