---
name: unwritten-door-play
description: Read for every action, entry, adjudication, generation and revisit in this world.
---

# World execution rules

Read this skill, the current and parent README, the action source and its intent, relevant actual objects, and supplied played history before acting. README defines the place and known exits; Chalk states the immediate action and generation intent; this skill defines continuity. The intent field is prose for the Writer, not another engine command.

All prose, prompts, ordinary folders and filenames are English. Keep protocol identifiers and existing asset paths. Narrate one concrete consequence of the action, not an invented player decision. Move an actual item only when taking it is requested. Reading is not possession. Submission does not consume an item. Do not treat a person as inventory.

Before writing, enumerate the files required by this action. Read them back before claiming completion; create any unlocking receipt LAST. On failure report missing pieces, keep the gate locked, and repair only missing pieces on retry. Repeated clicks do not grant duplicate rewards. Store facts in the relevant entity body and flat status.data, not a new state file.

Never roll automatically on entry or submission. Before any optional roll, disclose the formula, threshold, reason, probabilities, ordinary and great rewards, failure, small-probability real harm, and an option to decline. Await the player's roll under those exact terms. Never reroll by deleting result. Dice cannot change established truth or another person's consent.

A generated place needs a README, two meaningful objects, an actionable Chalk, and a return gate. A resident can be a nonportable note with a name, occupation, visible behaviour and limited knowledge, performed by the Writer; do not invent an unregistered character button. Existing README alone does not mean complete: inspect and repair missing files, never reroll the place on revisit. Text first, then generate_image ONCE for the exact scene. Attach only a returned, existing asset to bg; remove conflicting bgVideo. Image failure leaves the text playable, is reported honestly and is not retried automatically. The 1–2 minute segment is a design budget, not a latency promise.

## Envelope and phone
Read their current locations even if moved to player/. Opening the envelope creates one short contemporary message containing a place or person and a personal stake. Update the actual item with the message and public Context. Merely examining its outside does not reveal the message. A phone call is fictional roleplay; persist the actual exchange and one concrete sound or spoken landmark. Neither object secretly contributes facts before discovery.

## Opening the door
The only initial expansion is world/outside. Read both actual items and their public Context again. If unused, contribute no hidden facts. If a letter was opened, respect its place or person. If a call happened, reflect its audible detail or landmark. If both happened, honour both. If neither happened, create a plausible contemporary place with one small opportunity; do not punish curiosity or invent a cult by default.

Write world/outside/README.md, resident.md, found-object.md, 01-arrival.md and return.md. The return gate targets map. The resident is a nonportable note: name, present activity, one line they can say and what they do not know. The found object should connect to a revealed detail without revealing the entire mystery. The arrival Chalk offers talk, inspect and return; its intent allows only one explicitly motivated further discovery, not an infinite tree. Add one concrete line to the parent door explaining what is now beyond it.

Verify all five files, even when README already exists. Repair a partial scene without inventing a different resident or geography. Text completion precedes one generate_image call: restrained cinematic contemporary atmosphere, the actual weather and objects, no UI or lettering. Do not make the phone or letter a giant background prop. Store the returned asset in README bg. Missing image is a visible pending illustration, not a fabricated success.

## First-minute reward
When the player talks to the resident, quote a detail the player really supplied or noticed, then update resident.md with what they learned. Inspecting the found object yields one usable fact or small item, not a solved conspiracy. The punch line is recognising something from inside in a newly materialised outside. Returning uses map and preserves the outside. No campaign ending is required.

## Direct actions and writer turns
choice_actions maps stable choice.options IDs to implemented UI recipes: read(paths), take(paths), stage(paths), enter(target), character(character), reply(text), writer(optional prompt). Reading, taking, navigating existing scenes and staging materials do not invoke the writer. Stage does not submit or execute. Unknown content, new promises, fictional calls and generation still require explicit writer input. Add these bindings to new choices, preserving free RP. Never invent action kinds, script execution or references to nonexistent readable files.

## Clear player guidance
Use short, familiar language. Say what happened and what the player can do next. Explain clues as fact, possible meaning, then where to check. Keep atmosphere without hiding the goal. New dice must use 1d10, 2d10 or 1d100, with conditions and consequences visible before the player decides to roll.

## Skills and checks
This world uses D&D-like skills (world.json `rules`). The protagonist's sheet is `sheet:` in player/README.md (ability modifiers and proficient skills); a companion's is in its character README. A check is d20 + the skill modifier against a DC (easy 10, moderate 12, hard 15, very hard 20), with advantage or disadvantage when the fiction gives it; a natural 20 always succeeds, a natural 1 always fails. When the protagonist attempts something uncertain, call skill_check with the fitting skill and DC, then stop and let the player roll; narrate from the resolved tier. A companion may roll for its own action (skill_check, actor "self"). Never decide such an outcome in prose; feelings, promises and consent are never checks.
