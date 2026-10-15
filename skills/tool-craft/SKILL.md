---
name: tool-craft
description: Use when you want a passage to do more than state facts — a chalk style that carries a mood, a character walking across the canvas mid-scene, a one-off performance that lands a beat, an interactive choice the player can press, a dice check left to chance, or a line between two cards. Each section gives when it is right and what a wrong use costs.
---

# Craft: making the canvas perform

The resident rules tell you *that* every turn lands its narration on the canvas. This skill is about
*how* the tools can carry meaning — and each section says what happens when the use is wrong, so you
can tell a good use from a plausible-looking one.

## Chalk carries a mood

A chalk file's frontmatter can carry a rendering variant. They ride along as extra keys on the chalk
file, written in the same edit that adds the interactive fields — the `chalk` tool itself only writes
`content`.

| Want | Write on the chalk | Why this is the right one |
|---|---|---|
| A hand-written voice — a character's own note, a scrawl, a marginal line | `font: hand` | The renderer switches to the handwriting stroke; the player sees *who wrote it* before reading it |
| One phrase that must land harder than the passage around it | `big: true` (or `size: big`) | A display scale, not emphasis markup — it changes the card, not the sentence |
| A specific point size | `size: 18` | Escape hatch when `big` is too blunt |
| Ink that carries the world's colour code | `color: rust` / `blue` / `sage` (or `tone:`) | rust = the writer's echo and the player's own line, blue = note links, sage = world gates |
| Force a paper card surface (rare) | `card: true` | Most chalk should stay bare ink; a card is for the rare passage that is itself an object |

**What a wrong use costs.** A style is a property of the *file*, not of the sentence: applying
`font: hand` to narration that is not a character's writing makes the player look for an author who
is not there. And the chalk tool will not take a style as a parameter — trying to pass one is a sign
you are fighting the two-phase pipeline instead of using it.

**Do not fake age.** `collapsed` and `aged` are read from the frontmatter, but the world ages a
passage from the file's own age; writing them by hand freezes a lie into the file (a passage that is
"old" the moment it lands). If a memory should fade, let time do it.

For the full style table and worked examples, read `references/chalk-styles.md`.

## Walking a character through a scene

Use `move_to` when a character enters a scene, crosses to another, or comes to stand beside a
specific object — the character who is being talked about should be *present*, so the player can see
and click them. Pass `near` to stage them at the object they are discussing.

`move_to` moves only their presence on the canvas. It never moves files and never starts their
process.

**What a wrong use costs.** Narrating a character's entrance without `move_to` leaves them visible
nowhere: the prose says they walked in, the canvas shows an empty room, and the player cannot reach
them. Using `move` instead is worse — `move` is for object *files*, so you would be relocating their
folder while their presence stays where it was.

## One-off performances

Use `show` for a beat that should land *right now* and leave nothing behind: a stage light on a
target, the room going dark, fireworks over a spot, a storm of threads from several cards to one, a
splash of ink, a large die rolling into frame.

The seven performances, and which need a `target`:

| Performance | Lands | Needs `target` |
|---|---|---|
| `spotlight` | the canvas dims; a warm beam falls on the target | yes |
| `lights_out` | the scene darkens to night | no |
| `fireworks` | particles burst above the canvas | no |
| `evidence_burst` | threads run from each card in `links` to the target | yes |
| `camera_focus` | the camera flies to the target, canvas stays lit | yes |
| `ink_burst` | one splash of ink spreads across the target card | yes |
| `roll_ceremony` | a large die rolls into frame — **it does not show a result** | no |

**What a wrong use costs.** `show` writes nothing, creates no card, records no event. Using it to
"place a letter" or "put down a lock" produces a performance and then nothing: the card never exists,
and the player waits for something that is not there. Forgetting `target` on the four that need it
does not degrade — the call fails outright. And `roll_ceremony` is an entrance only: the number
belongs to `roll_dice`, never to the ceremony.

## Letting the player press something

Use a `choice` list on an entity when the player should be able to act on *that thing* — open the
piano lid, force the cellar door, tell Watson your theory. Use `roll_dice` on an entity when the
outcome is genuinely uncertain and should be left to chance.

Both are frontmatter on the entity, so they arrive by the same route as the chalk styles above — not
through the `chalk` tool's parameters.

**What a wrong use costs.** `choose` records that a choice was made and nothing else: it does not
change the file, remove the option, or decide what happens next. If you write the turn as if the
choice advanced the world by itself, the world never moves and the player is left on a cliff that
the engine was never going to resolve. `roll_dice` reads `type` / `desc` / `expect` from the file and
the engine produces the result — you cannot pass one in. A result written into your prose is your
invention; the engine's roll will contradict it in front of the player.

Leave a check to chance only when the story should not simply decide the outcome. If you already know
what happens, write it in the prose and do not attach dice.

**A search is a dice event, not a find.** When the player searches, investigates, rummages or loots,
call `search` instead of writing what they find: a spot the place's README declares under `search:`
(pass its id), or `improvise` a minor, non-key find with four bands. `search` only lands a dice chalk;
the player rolls it, the rolled band creates the item, and you narrate after `roll_resolved`. Never
roll it yourself, and never write, move or describe the item before the roll.

**An NPC card answers once, from its cards.** When a turn opens with `[NPC Dialogue]`, the player is
talking to a `type: npc` card: reply only as that person, one to three sentences, only facts from its
`knows` cards, and hand something over only with a `[give: <id>]` line naming one of its `gives`.
Do not call tools that turn. To add an NPC during play, write the card (`world-workshop` skill,
`references/npc.md`); a card that breaks the schema is not written.

## Drawing a relationship

Use `link` to make a relationship visible: a road on the map, a lead, a trail from a clue to where it
led, a line between two characters' doors. A line is canvas state, not a file — do not try to write
one in markdown.

**What a wrong use costs.** Both endpoints must be cards on the *same* layer. A cross-layer line is
never rendered, so the connection you meant to make is invisible; the player learns nothing and the
canvas looks like you forgot.
