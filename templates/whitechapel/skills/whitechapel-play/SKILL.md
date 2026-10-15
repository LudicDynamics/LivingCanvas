---
name: whitechapel-play
description: |
  Read this before all actions, moves, checks, generations, and revisits in this world. It governs continuity and win conditions.
---

# World Execution Rules

This is a play that actually updates files. Do not declare success with dialogue alone. First, read sources of actions, current location and parent's README, intents, related items, character memories, and provided visitation history. README lists location and known exits, Chalk shows current choices with generation intent, this skill holds world invariants. Intents are directions for authors, not new engine commands.

## Language and knowledge
Narration, titles, choices and generation prompts are English. Filenames, directories and character IDs stay stable lowercase English kebab-case; never use a display name as a path. Examples: world/harbor-chart/beyond-the-fog/lighthouse-road/README.md, player/introduction-letter.md, characters/nanami/memory.md. Preserve README.md, SKILL.md, world.json, preset.json and existing asset paths. Give new Chalk a stable English path and English title and body. Characters know only what they witnessed or were told. Never turn secrets the player has not encountered into memories in an epilogue.

## Completing Actions
Each choice returns exactly one concrete change. Picked-up items move; reading does not move them. README doesn't move. Do not treat people as tools. Submissions are references, not consumption. Confirm paths and player meanings. Choosing does not substitute unsaid inference, plans or confessions. Draft substitute writing only on player request and confirmation.

Before execution, list files to create, update, or release. Write one passage fully, reread all files. If conditions unmet or tools fail, report deficiencies without releasing materials. Retry reads existing results, fixing only gaps. Prevent double rewards or spending. Do not create new world state files; keep facts in flat status.data and corresponding texts.

## Judgments
Before rolling, show target, needed items, uncertainty reasons, formulas, success/failure criteria, probabilities, major success, failures and risks, and option to cancel in Chalk. roll_dice must be YAML multiline. Inline {type:...} doesn't support rewriting results. expect uses quotes. Submission/entrance don't call roll_dice alone. Player rolls seeing conditions. Redo if conditions change. Dice don't decide truth or consent. Don't erase existing results or reroll free.


## Creating New Locations
Make one subfolder only within parent's README and Entrances. Don't expand town by checking ordinary rooms. Write a brief phrase at entrance, then README, two meaningful items, chalk with actions, and return gate. Include a note introducing one new inhabitant if needed, with name, job, possible words. Don't make conversation buttons for unregistered characterId. Author plays that encounter.


Do not consider README existence alone as complete. Verify child's README, two items, Chalk, and gate; fix missing. Don't redraw places or people on revisit. Call generate_image once after text completion, requiring real background matching time, light and objects. Write returned real asset only to README's bg. Image failure is text not failure; on failure say image absent, no auto-retry. Remove old bgVideo if incompatible. Playable with finished text first. 1–2 minutes are production budget, not generation time.


## Clear Objectives, Truth Through Investigation
Holmes's job is to investigate the person causing incidents matching the novel and stop today's fourth case. State clearly in Entrance README and indoor Chalk. Do not hide objectives in allegory. The culprit is illustrator Wayne, not author Edith. He adds illustrations to text he first receives, then matches incidents to those images. Don't replace with other culprits. Don't reveal truth in prologues or typical character intros.


## Connect Places and Characters
Pigments and composition at the third scene, forensic incident time, print shop's delivery slips and duty logs, editorial room's correction circulation, illustrator's reactions, and explanations in 221B sitting room are distinct evidence. The records appear only after the player searches and rolls. Distinguish read records from spoken testimony; don't fabricate unvisited talks. Don't convict on name alone. Don't generate notes with same name or unregistered characterId. Watson's home is the London map. Move with move_to if asked to accompany scene, no duplicate spirits of same name.
Rank zero has warm light and trust; crime scenes have cold observation; print shop has type sounds and workers; sitting room has first-person words. Avoid making all abstract gray monologues. Show at least one concrete investigation point. Do not use existing decor nor indecipherable writing as new evidence.

## No Quizzes: Characters Apply the Pressure
This world has **no question-and-answer, form-filling or submitted-deduction step**. Do not ask the player "whom do you suspect, and on what grounds", do not have them write a deduction or an operation plan, do not grade deductions, and never open a door with "say the right answer". Play moves on three things only: searching by hand, the objects found, and pressure from the characters.
- Once the player has established enough by searching (world.json trigger wayne-turns-up: three of the seven key clues have turned up; if every place has been searched and five of them yielded only half clues, wayne-turns-up-anyway brings him all the same, with little in the player's hands), the engine has Wayne himself come to Holmes: he stops Holmes with a red envelope and says he must hand the proof of the fourth picture to Edith in person. Play him polite, stubborn, unwilling to leave, never confessing first; he reacts concretely only to objects laid in front of him.
- Watson presses: twenty minutes to noon, and Edith is still in the sitting room. Edith wants to face Wayne herself but will not be used as bait. Characters may push the player to decide; they never decide for the player.
- The decisions are on world/london-map/03-before-noon.md: confront him (needs "the picture came first" and "his hand was at the scene" established), play along and meet him in the print-shop courtyard (needs who read the new address), have Watson take Edith out first, or let him go and follow him. Which moves are open depends on what the player actually found. The engine carries them out (the `end` in command/*.yaml); the writer never announces an ending in prose and never lets Wayne confess before the decision.
- Before Wayne turns up, do not let him give away the truth, and let no one name the culprit for the player.

## Endings and the Debrief
This is a `semi` world with a clock, "Until Noon" (world.json `clock`, 10 steps from 10:00 to 12:00, counted on world/london-map/03-before-noon.md), and three endings — "The One Not in the Fourth Picture" (Wayne held on the spot), "What Was Kept, What Was Missed" (Edith safe, Wayne walks away), "The Fourth Picture" (he was not stopped before noon; also reached by the engine when the clock hits 0). Only the dice move the clock: a failed search costs one step, a critical failure two; the writer never moves it in prose. Endings land only through the card's decisions or triggers; the writer never announces an ending in the story text. After an ending, only talking to the characters remains.
The debrief comes only after the ending: a few questions about the case that the player may answer or skip. It scores the run and unlocks epilogues; it **never changes the ending**. Never ask these questions during play, never give the player the answers, and never let a character reveal them outright.

## Hidden Wounds
The player has wounds with no number shown (hp in player/README.md, shown only as Unhurt / Hurt / Badly hurt / Barely alive). There are no monsters here; harm comes from accidents and the confrontation: the wet railing at the third scene, the toppling type case at the print shop, the coal cart in the unnamed street (the worst band of those searches costs hp, applied by the engine), and Wayne's shove in the courtyard or a blow in the fog. The writer describes wounds in words only and never changes hp. When hp reaches zero, the engine fires too-hurt: Watson helps Holmes back to 221B, and the ending is "The Fourth Picture".

## Confirmed Operations and Separation of Writer (Current)
choice_actions declares implemented UI operations, matching English IDs in choice.options. Use only read(paths), take(paths), stage(paths), enter(target), character(character), reply(text), search(spot), and optionally writer(prompt). Do not invoke writer to read, carry, return to existing scenes, arrange materials, or show short dice results. stage is only for checking materials, not submission/execution. Use writer only to generate, roleplay freely, or execute tentative promises or strategies. Use character to start dialogues with characters; never send lines unprompted.
Add IDs and choice_actions per option in new Chalk generated. Do not make reading or returning ambiguous writer choices. Do not declare future material paths as existing reads. Do not write undefined action types, scripts, or fictional APIs. UI declarations are judged operations; writer does not execute twice.

## Searches and Dice (Current)
No clue lies pre-placed in an investigation spot, and no investigation dice card waits there. Each place's README declares what "Search here" can find in its search: list. When the player picks "Search here (roll)" or says in their own words that they search, investigate or rummage, the writer calls search with the README's spot id, which puts search-<id>.md, a dice chalk, in that place. The clue does not exist yet: only after the player rolls does the rolled band create the clue file and its note, and then the writer narrates from the actual roll and the created files. The writer never rolls for the player, never writes, moves or retells the clue before the roll, and never invents these key clues. The truth is fixed, but the dice decide how much of it you see here: a success or great success yields the place's key clue (a great success with something extra); a failure yields only a half clue (what was half-seen and what is still missing) and costs a step of time; a critical failure yields the half clue, costs two steps, and may hurt. Never hand over or retell the key clue after a failure; the other places can still get the player there. Places can be searched in any order. Players never need to explain a correct solution or submit any deduction.
dice_outcomes applies four-level short results and next choice_actions to the existing action layer in one file. Writer does not duplicate reflection, re-judgment, or extra charging.
Even low rolls give a half clue and a next step. A great roll may turn up one more thing others missed; the worst band may hurt. The writer never generates ending scenes. Do not pretend undiscovered characters have been met; distinguish solved deductions from conversation records. Do not treat waiting for generation as dice failure.

## Clear Guidance
Player-facing text should be short and in everyday language. Scenes explain "what happened" and "what you can do now." Clues follow "facts discovered → possible thoughts from them → next place to verify" order. Separate facts and guesses but avoid lengthy caution notes every sentence. Substitute difficult words. Do not hide objectives or actions in metaphorical moods. New dice only use 1d10, 2d10, and 1d100. Current search dice use 1d100, success <=60: 1–12 great success, 13–60 success, 61–95 failure (half clue, one step of time), 96–100 critical failure (half clue, two steps of time, maybe hurt). Freeze the threshold before rolling; never reinterpret an existing result. Do not increase known costs; show next moves even upon failure.

## Skills and checks
This world uses CoC-like skills (world.json `rules`). The protagonist's sheet is `sheet:` in player/README.md; a companion's is in its character README. Every search names the skill it tests, and its dice follow the sheet: d100 at or under the skill, hard = half, extreme = a fifth, 01 a critical, 96–100 a fumble. For any other uncertain action of the protagonist, call skill_check with the fitting skill and a difficulty you can justify, then stop and let the player roll; narrate from the resolved tier. A companion may roll for its own action (skill_check, actor "self"). Never decide such an outcome in prose; feelings and consent are never checks.
