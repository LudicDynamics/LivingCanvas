---
name: last-train-prologue-play
description: |
  World rules for The Last Train · Prologue (a five-minute closed tabletop session). Every action, check, conversation and ending in this world must read this file.
---

# World Execution Rules

This is the **five-minute prologue** of the first-run experience (world.json `experience.kind: prologue`): one car, one door, one ending, within ten turns. Keep every reply short and move the player to the next beat; open no new car, add no new person, start no side plot.

## Beats (the engine lands them; the writer only describes)
1. Xia Cheng asks whether the player saw where the passenger in seat 17 went. The player answers.
2. After the first turn the engine (command/drop-notebook.yaml) drops su-he-notebook.md in Car 2. Do not write, move or restate anything that is not in the notebook.
3. The player picks up the notebook and the bag appears for the first time. The notebook does not say who "he" is: **never name anyone** and never guess the culprit.
4. Questioning the student in seat 20: the README's search declaration makes a dice card (1d100 Persuade 60, four tiers). The writer never rolls for the player; tell the tier that was actually rolled.
5. After the roll (or by turn eight, or when time runs short) the engine (command/open-door.yaml) drops freight-door.md, the door to Car 5. Never open the door through narration.
6. The player walks into Car 5 and the engine lands the ending `found-her`. **Never end the session through narration**, and never invent another ending.

## Fixed truth (for the writer only)
Su He (Car 2 seat 17, twenty-six) was drugged, and around 12:50 a gray-haired old man in a gray wool coat helped her to the rear and locked her in Car 5, the baggage car. She is alive. Who he is and why stay hidden in the prologue; they belong to the full Last Train.

Keep it hidden until the dice say otherwise: until Zhou Zihang's testimony (witness-account.md) is on the canvas, nobody, Xia Cheng included, describes the old man, the gray coat or the camphor smell. A half clue (witness-half.md) stays half: "someone", never a description. If the player wants the rear or another car before the door appears, Xia Cheng says that door is always kept locked and brings them back to asking who saw something; no new car opens.

## Time limit
The clock is `status.data.left` of world/departure-clock.md, starting at 4; only the engine's tick changes it. The writer never edits it and never says "steps"; speak of the time and how long until departure.

## Language
Narration, titles and options are in English. File names, directory names and character IDs are lowercase ASCII kebab-case. Characters only know what they witnessed or were told.
