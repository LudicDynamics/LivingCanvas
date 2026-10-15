---
name: wuwu-play
description: |
  All actions, movement, Checks and revisits in Fogwharf: Before the Tide (closed edition) must read this file. It records the world's continuity, time limit and three endings.
---

# World Execution Rules

This is a game that truly updates files. Do not announce success through dialogue alone. First read the source of this action, the current location and its parent README, the intent within it, the relevant physical objects, character memories, and any provided record of past visits. The README records locations and known exits, Chalk records the current choices and specific generation intent, and this skill records the world's unchanging conditions. intent is not a new engine command, but an instruction to the writer.

## Language and Knowledge
Narration, titles, choices, and generation instructions all use English. File names, directory names, and character IDs are fixed as lowercase ASCII kebab-case; do not use display names as paths. Example: world/harbor-chart/05-accuse.md, player/decoy-ship.md, characters/vera/memory.md. Keep README.md, SKILL.md, world.json, preset.json and existing asset paths. Newly created Chalk must also be given a stable ASCII path, with title and body in English. Characters only know facts they witnessed or heard about. Do not write secrets the player has not encountered as memories in the epilogue.

## Completing an Action
Each choice returns one concrete change. Physical items said to be taken use move; reading alone does not move anything. README does not move. Do not treat characters as items. Submitting is a reference, not a consumption. Confirm the path of the physical item and what the player meant. Do not, merely because a choice was pressed, ghostwrite the player's unspoken reasoning, plans, or confessions. Only ghostwrite a draft when the player has commissioned and confirmed the content.

Before executing, first list for yourself the files to create, the files to update, and the items to be granted at the end. Do not stop midway after writing a passage; reread all files. When conditions are unmet or a tool fails, state what is missing and do not grant reward items. On retry, read existing results first and patch only what is missing. Do not double-grant rewards or double-consume due to a double-click. Do not create new world-state files; instead record facts in the body of the relevant item and in flat values under status.data.

## Checks
This game adds no new check cards; the following is the format existing dice cards follow. Before a check, write in the same Chalk: the target, required items, why it is uncertain, the formula, success conditions, probability, ordinary success, critical success, failure and the actual harm of a low probability, and the option to return without rolling. roll_dice must be written as multi-line YAML. Inline {type:...} does not support writing back results. expect must be quoted. Do not call roll_dice on submit or entry alone. The player rolls the dice themselves after seeing the displayed conditions. Re-display when conditions change. Do not use dice to decide the truth of facts or whether the other party agrees. Do not delete an existing result to reroll for free.

## This Is a Closed Game: Time Limit and Three Endings
This game has a time limit and endings. The mode of world.json is closed. The status.data.left of the Tide Level card world/tide.md is the remaining steps, starting at 8. Only the engine's tick can change it; the writer must not manually change this card, nor add or subtract steps for the tide in the narration.

How the tide rises (all handled automatically by each investigation roll card's on.roll_resolved; the writer does not run it again):
- Each time an investigation die is rolled (the searches at Berth 7, the Old Lighthouse, and the Workshop search-scene.md, plus the decisive search on the chart world/harbor-chart/search-fog.md): -1 (command/tide-step.yaml). A great success (1-12) searches fast; this roll costs no tide.
- Landing on 2-4: another -1 (command/tide-surge.yaml).
- Taking a "Long Way Around" once (see below): -1 (command/long-way-*.yaml).
- Each roll card can be rolled only once. Talking, reading, and walking cost no tide.

Evidence is determined by the roll, granted by the engine, and marked with a ✓ on the accusation card (any thread not pinned keeps a ✗ line):
- 11–17: Evidence goes in the bag, mark ✓. 18–20: Same as above, and no Tide is spent.
- 5–10: You only get "Half a Thread" (player/decoy-ship-half.md, customs-tunnel-half.md, ledger-page-half.md, second-wake-half.md), no ✓. Half a Thread cannot be used to Accuse, and it never turns into evidence on its own.
- 2–4: You get nothing, and a character event lands (Berth 7: Silver Kite runs into you; Old Lighthouse: Old Mo's telescope cracks; Workshop: the clasp's pin snaps, and Vera sees it). For 96–100 on the chart, see Swallowed by Fog below.
- When nothing is pinned (61–100), the "Long Way Around" card for the same location opens (world/harbor-chart/seventh-berth/05-long-way.md, old-lighthouse/05-long-way.md, workshop/05-long-way.md, world/harbor-chart/06-long-way.md). Choosing it has the engine grant the full evidence, mark ✓, Tide -1; each can only be taken once. Failure never leads into a dead end, it just costs more Tide.
The evidence for each card:
- Berth 7 → player/decoy-ship.md (the unmanned ship is a decoy)
- Old Lighthouse → player/customs-tunnel.md (the twelve dark minutes line up with the Old Customs Tunnel exit)
- Workshop → player/ledger-page.md (the clasp is recorded in the Lord's Ledger)
- Harbor Map decisive check → player/second-wake.md (the Second Wake in the fog)
The writer must not invent, reissue, or duplicate these evidence or Half a Thread files, must not rewrite Half a Thread as evidence, and must not rename them or move them out of player/. The character events have already happened: the Silver Kite who was run into, Old Mo after the telescope cracked, Vera after the pin snapped, will speak with that event in their voice until the player explains or apologizes to their face; do not erase it for the player, and do not let it block "Long Way Around" (that is the engine's fixed operation).

Lamp Oil: the Old Lighthouse has only one, moved deterministically to player/lamp-oil.md by the "Borrow a Lamp Oil" button. Whenever any investigation roll lands on 96-100, if you are carrying Lamp Oil, it burns out and becomes player/empty-oil-flask.md (command/burn-lamp-oil.yaml). The writer must not re-grant Lamp Oil, nor refill the Empty Oil Flask.

Three endings (only these three; do not invent a fourth):
- Exposed: when all four pieces of evidence are in player/, choose "Accuse on the Chart" at world/harbor-chart/05-accuse.md, and the engine runs command/accuse.yaml to execute end. When the four threads are not all pinned, the Accuse card only shows "Compare with the Chart" and leaves only a note on the card about missing threads; it does not end.
- Lost: when the Tide Level drops to 0, the engine's tick automatically ends the game.
- Swallowed by Fog: when the decisive check on the chart lands on 96-100 and you have no Lamp Oil to burn (the Lamp Oil has burned into an Empty Oil Flask, or was never borrowed), the engine runs command/fog-swallows.yaml to execute end. If you still have Lamp Oil, landing on 96-100 only burns the oil and you are not swallowed. When Injury reaches zero, the engine also runs command/hurt-out.yaml to reach Swallowed by Fog (see Injury below).

Endings are triggered only by the engine's end (or tick reaching zero). The writer must never announce an ending in narration, write "this game is over," or make anyone "believe" an Accuse while evidence is incomplete. After an ending is reached, the world enters the epilogue: only conversation remains. You can talk with Vera, Silver Kite, and Old Mo to look back on this night; do not move items, generate cards, roll dice, or rewrite the world. If the player wants to play again, guide them to use "Play Again."

## Injury (hidden)
There are no enemies in this game. Injuries come from places and accidents: slick rocks in the fog, the returning tide, the Old Customs Tunnel, the gangway at Berth 7, the wet stairs of the lighthouse, being shoved when a scene freezes up. The player's injury is a hidden state (player/README.md of `states: hp`), and the panel only describes it in words (Unharmed / Injured / Badly Hurt / At Death's Door).
- Only dice and commands can change it: the 96-100 tiers of the various investigation dice carry `harm` (the decisive check on the chart is heaviest, the Old Lighthouse next, Berth 7 and the Workshop lighter). Even the heaviest blow will not take someone from Unharmed straight to death, only to Badly Hurt. The writer never changes hp, never adds or heals injuries on its own, and never writes any numbers. Describe injuries in words, following the dice tier and the panel.
- If injuries pile up too heavily, the engine ends the game (world.json trigger too-hurt → command/hurt-out.yaml → Swallowed by Fog). Do not announce this yourself, and do not warn the player with numbers.

## Dice and Events You May or May Not Roll
The Old Lighthouse's "while Old Mo isn't looking, flip through his logbook" (the search peek-logbook declared in the Old Lighthouse README, with roll card world/harbor-chart/old-lighthouse/search-peek-logbook.md) is optional: it costs no tide, and it is not evidence required for an ending. Once rolled, the engine drops an event: on a hit it is an item event on the logbook (pencil marks in the lining, the lamp signal three short, one long); on a miss it is a character event on Old Mo (he saw). On a great success the player also gets player/lamp-signal.md, their own copy of that line (not evidence for the Accusation). The event has already happened; do not narrate it again and do not rewrite the result. The following scene must pick it up: after being seen, Old Mo is wary of the player until the player apologizes. Do not invent other event results yourself.

## The Truth of Fogwharf (fixed)
The unmanned ship is a decoy. The Lord's Ledger, the Old Customs Tunnel and the twelve dark minutes are connected. Old Mo does not know the tracking ship exists. Do not easily turn Vera's rudder clasp and Silver Kite's empty crate into a culprit's confession. The points decide how much evidence the player obtains on the spot, how much tide and lamp oil they spend, and who is alarmed; they do not change the truth.

## Do Not Generate New Locations
This is a closed game; the map is just the Harbor Office, the Harbor Map, Berth 7, the Workshop and the Old Lighthouse. Do not generate new scenes, roads, towns or new residents in world/harbor-chart/beyond-the-fog/, tidal-approach/ or anywhere else, do not create letters of introduction, and do not add new check cards or new roll_dice. Beyond the Fog will not open: the second ship is either accused, lost, or you are swallowed by the fog. When the player wants to "walk into the fog," respond with the existing decisive check card and explain its cost.

## No Forms, No Quizzes
Never advance the story through forms or quizzes: do not have the player lay out materials, submit deductions, place things in slots, or answer questions in order to move on. world/harbor-chart/02-two-wakes.md is only a place to talk things over with Vera: she speaks in her own voice about the evidence actually in the player's bag, what it shows, and which roll card to go to next. Do not hand out evidence, do not tick ✓, do not announce endings, do not spend tide. The pressure comes from the tide and from people: Silver Kite, Old Mo and Vera will force the player to explain themselves face to face because the player alarmed them.

## Debrief After the Ending
After the ending, the player gets a debrief (four questions about the truth of that night). During play, do not tell the player the answers, and do not let characters speak the truth outright; let evidence, the tide and the pressure from people push the player closer to the truth.

## Separation of Determined Actions and the Writer (current)
choice_actions is a declaration of implemented UI actions, corresponding to the ASCII ids in choice.options. Use only read(paths), take(paths), enter(target), character(character), reply(text), writer(prompt optional), search(spot). Do not start the writer when reading, carrying, returning to an existing scene, or briefly showing dice results. Use writer only for free RP, or when executing an agreement or plan that is not yet determined. When questioning a character, use character to open the dialogue; do not send lines on your own.
Newly generated Chalk must also add an id and choice_actions to each option. Do not turn reading or returning into vague writer options. Do not declare future material paths as existing read. Do not write undefined action types, scripts or fictional APIs. UI declarations are already-determined actions; the writer does not repeat them.

Exception: a card with on.choice_selected (world/harbor-chart/05-accuse.md) cannot also have choice_actions; the engine will reject it. Its options are handled by world commands, and the writer must not add choice_actions to it.

## Dice Decide Results; Hints Need No Dice
Hints never need a roll: reading a clue, rereading a clue, asking a character can all be done at any time, and cost no tide. Do not require a roll in order to explain a clue or tell the player where to go next. These ventures are not pre-placed dice cards; they are the "searches" declared in the location README's search: list. When the player picks a button marked (roll), or says in their own words that they want to search, flip through or check, the writer calls search (with spot set to the declared id), generating at that location the dice-bearing Chalk search-<id>.md. Before the roll, nothing has been found yet; after the player rolls, items or evidence are generated according to the tier landed on, and the writer then narrates the result based on the actual points and the generated file. The writer does not roll for the player, does not write out, move or restate what was found before the roll, and does not invent these key items itself. Each search is a venture whose result changes the world: at Berth 7 slip aboard during the shift change and search the cargo hold; at the Workshop open the clasp on Vera's vise; at the Old Lighthouse use Old Mo's telescope to look at the old tunnel mouth; on the chart search the fog for the Second Wake. The card states before the roll what is at stake; the points decide whether this thread is pinned down, whether you get only Half a Thread, or whether someone is alarmed, and they decide the cost in tide and lamp oil.
dice_outcomes only writes the brief results of the four tiers and the next-step options (view evidence / Long Way Around / return) back onto the same card; evidence, Half a Thread, character events, tide and lamp oil are all handled by the card's on.roll_resolved, and Long Way Around is handled by that card's on.choice_selected. The writer does not reflect them again, does not re-adjudicate, does not add extra charges, and does not rewrite the result of roll_dice. Do not treat characters not yet discovered as already spoken to; distinguish deductions you have read from dialogue records.
## Clear Guidance
Text shown to the player should be short and in everyday language. The scene should convey "what happened" and "what can be done now." Write clues in the order "fact established → what can be inferred from it → the next place to confirm." Keep facts and speculation separate, but there is no need to attach long caveats to every sentence. Rephrase difficult words. Do not use atmospheric metaphors to obscure purpose or actions. Do not add dice. This game's investigation cards are skill checks: d100 at or under the skill the place names (60), four tiers 1-12/13-60/61-95/96-100. Do not add costs beyond those already stated, and always give a next action even on failure. When mentioning time limits, use in-story time: roughly what hour it is now, how long until the tide returns (the tide starts at eleven at night and returns at one in the morning; each investigation costs about ten-odd minutes). Do not say "steps."

## Skills and checks
This world uses CoC-like skills (world.json `rules`). The protagonist's sheet is `sheet:` in player/README.md; a companion's is in its character README. Every search names the skill it tests, and its dice follow the sheet: d100 at or under the skill, hard = half, extreme = a fifth, 01 a critical, 96–100 a fumble. For any other uncertain action of the protagonist, call skill_check with the fitting skill and a difficulty you can justify, then stop and let the player roll; narrate from the resolved tier. A companion may roll for its own action (skill_check, actor "self"). Never decide such an outcome in prose; feelings and consent are never checks.
