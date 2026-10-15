---
name: world-workshop
description: Use when a workshop prompt says the player is the AUTHOR of a blank made world — how to build it end to end from their description with the layer tree three to four deep, every README carrying its play logic, a scene picture and a map picture per layer from generate_image, and the people from create_char; and how later author requests revise the world instead of narrating a turn.
---
# World workshop

A made world starts as one directory: `world/README.md` (name, description, `bg:` pointing at the cover) and `world.json` with no characters. The author tells you what the world is. You build it — all of it — in that turn. Playing comes afterwards and is the ordinary writer job; this skill is only for building and revising.

## 1. Read before building

1. `world.json` (`name`, `description`, `locale`, `player`), `world/README.md`, and `assets/maps/PROMPTS.md` if it exists (the world's shared picture style, §4).
2. Everything under `world/`: a second build request continues from what exists. Never re-paint a picture or rewrite a scene the author may already have seen unless they asked for that.
3. The `scene-initialization` and `component-narration` skills: this skill says what the world must contain; those say how one layer and one object are done well.

Every displayed text — names, titles, prose, choice labels, chalk — is in the world's `locale`. Ids, directory names and file names stay ASCII lower-kebab-case.

## 2. The shape: a tree, three to four deep

The world is a multi-way tree of directories under `world/`; each directory is one place with its own map. Scale is declared per node (`map.kind`), never inferred from depth: a root can be a single room that opens onto a whole town.

- **Root** (`world/`, entry): where the player starts. Usually `interior` or `town`.
- **Depth 2**: two to four children — the places the premise needs, not filler.
- **Depth 3**: one to three grandchildren under at least two of those.
- **Depth 4**: at most one branch goes one further, where the story's core sits.
- Eight to twelve layers in total is the sweet spot. More costs tokens without adding play; fewer feels like a picture, not a world.

Build in this order, so an interrupted turn leaves something coherent: (1) every README and door, so the tree exists; (2) openings and objects; (3) characters; (4) pictures; (5) pins and the final read-back. Delegate a whole sub-branch to a `scene-init` subagent when it is self-contained — put the premise, the parent's README, the style line and §4's picture rules in the brief, because the child sees none of this conversation.

## 3. Every layer's README carries the play

`README.md` is the scene AND its rules. The engine reads these frontmatter fields; prose alone does nothing.

```yaml
---
type: readme                      # child README files too; never `gate` on a README
name: Old Lighthouse             # display name, in the world's language
title: Old Lighthouse · The Twelve Dark Minutes   # optional longer caption
material: parchment
bg: .airpworld/assets/gen/<scene picture>.png     # §4 — what you see standing here
ambient: snow-wind                # what you hear standing here — a key from the shared pool below
intent: >-                        # what this scene is FOR: what can be learned or won here,
  what the writer should do when the player acts, what must not be skipped
choice:
  options:                        # 2–4, stable ids, labels in world language
    - id: read-logbook
      label: Open the watch log
    - id: climb
      label: Climb to the lamp room
  allow_free: true                # free-text actions welcome here
choice_actions:                   # one recipe per option id — the option's real effect
  read-logbook: { kind: read, paths: [world/old-lighthouse/logbook.md] }
  climb:        { kind: enter, target: world/old-lighthouse/lamp-room }
map:
  kind: interior                  # region | town | interior | detail
  sketch: stone lighthouse ground floor, spiral stair, the watch desk under the window
  pins:                           # where things sit on the SCENE picture, x y in 0..1 from top-left
    logbook: [0.62, 0.7]
    lamp-room: [0.5, 0.18]
    player: [0.2, 0.86]
  plan:
    picture: .airpworld/assets/gen/<map picture>.png   # §4 — the place from above
    pins:                         # where things sit on the MAP picture
      logbook: [0.6, 0.55]
      lamp-room: [0.5, 0.2]
      player: [0.15, 0.8]
---
Prose: the space, its relation to the parent, what is at stake. No outcomes.
```

`choice_actions` kinds: `read` / `take` (`paths:` of `.md` entities; `take` moves them into the player's bag), `enter` (`target:` a child layer), `character` (`character:` id — talk to them), `reply` (`text:`), `writer` (`prompt:` — hand the beat to you), `search` (`spot:` — a spot this README declares under `search:`; see below). A risky beat declares `roll_dice: { type: "1d100", desc: …, expect: ">50" }` on the entity instead of a choice.

`ambient:` is the layer's sound bed, a bare key from the shared pool (`assets/audio/ambient`): `rain`, `storm`, `snow-wind`, `fireplace`, `forge`, `cellar-drip`, `cave-drip`, `harbor-waves`, `library`, `office-night`, `city-night`, `tavern-chatter`, `cafe-murmur`, `bell-church`. Pick the one that fits what the player would hear (weather, fire, water, a room full of people). A child without `ambient:` inherits the root layer's, so give a child its own when it sounds different (a kitchen fire under a snowy courtyard, a dripping culvert under a rain-swept dam); `ambient: null` means silence. Do not invent keys or paths. The world's music is world.json `audio.theme`, already set from the world's type when it was made; leave it alone.

Searchable loot is never pre-placed. Declare it on the place's README as `search:` — a list of spots, each with `id`, `label`, `title`, `body`, `roll_dice` and per-band `dice_outcomes` whose `rewards` (`path`, `title`, `body`, optional `portable: false`) are the items the roll creates, or an `on.roll_resolved` world command that `give`s them. A search button (`kind: search`) lands the spot's dice chalk; the items exist only after the player rolls. Key clues live only here, and every edition of the world declares the same spots, bands and paths.

Pin keys are what the board can place: a child directory name, an object file's stem (`03-logbook.md` → `logbook`), a character id, and `player`.

**Gates are the author's, not yours.** Do not add `requires.items` / `blocked` to doors when building; the author locks doors later with God Hand once they see the world. Only when the premise itself is a lock ("the vault needs the key") declare it, and say so in the report.

Each layer also gets `01-opening.md` (`type: chalk`, the arrival beat, brief, decides nothing) and one to three objects (`get_component` first, then the real frontmatter and a sensory line; every object is introduced by the opening or a same-layer link). Doors to children are the children's own READMEs; the parent lists them through `enter` options and pins.

## 4. Two pictures per layer

Every layer has **a scene picture** (what you see standing there — `bg:`) and **a map picture** (the same place from above — `map.plan.picture`). Both come from `generate_image`; use the path it returns exactly (`.airpworld/assets/gen/…`), never invent one. The root's scene picture is the cover the author already gave; paint only its map.

Before the first picture, write `assets/maps/PROMPTS.md`: one **style line** for the world (period, palette, light, brushwork — five to twelve words), then each prompt you send, so a later edition can repaint consistently. Paste the style line at the front of every prompt.

Also write each prompt into the owner's frontmatter `art:`: `art.scene` / `art.map` on the layer README, `art.portrait` on a character README or `type: npc` card, `art.scene` on an ending README, `art.cg` on `world/README.md` — each `{ path: assets/…, prompt }`. The author's art panel lists every picture from these blocks and repaints from them; a picture you could not paint still gets its `art:` entry so the author can generate or upload it.

| Picture | Size | Camera | Prompt must say |
|---|---|---|---|
| scene (`bg`) | `width: 1536, height: 1024` | eye level, cinematic, where the player stands | style line; the space; light and weather; the one or two landmarks the pins name; **no text, no people** |
| map, `kind: town` / `region` | `width: 1536, height: 1024` | high bird's-eye 45° isometric game map | style line; "isometric game map, no text, no labels, no people"; every pinned place as a **clear landmark**, and **where** ("lighthouse top-left, berths along the bottom, workshop right") |
| map, `kind: interior` / `detail` | `width: 1536, height: 1024` | straight top-down floor plan, tabletop-RPG style | style line; "top-down floor plan, no text, no people"; every pinned object and door, and where |
| character avatar | `width: 1024, height: 1024` | portrait, plain background | style line; the face and clothes the README describes |

Because the painter will not hit coordinates exactly, **you decide the layout in the prompt and set the pins to that layout** ("top-left" → `[0.2, 0.2]`). Keep a 6% margin at the edges and leave the bottom-centre calm: the caption and the player sit there.

One picture per prompt; if the painter refuses or times out, describe the place in prose and move on — never retry the same prompt twice. Do not paint objects; their cards are text.

## 5. Characters

Two to four people make a world inhabited. For each: paint the avatar, then `create_char` (`id`, `name`, `desc`, `avatar`, plus `identity` / `personality` / `memory` / `voice`), then place them with `move_to` in the layer they belong to. Give the one who should meet the player a `greeting:` line in their README and set `opening.greeter` in `world.json` to their id (edit the file; keep every other key). A world with no one to greet keeps the narrator's `opening.greeting`. **Music**: the world starts with its type's theme; if the premise wants another, `set_music` with `layer: "world"` and a catalog id picked by mood tag. Give at most two or three places their own track or ambient bed (`set_music` with that layer id) where it changes how the place feels — a tavern, a crypt, the place the story ends. Catalog ids only, never a file name.

Someone who only needs to say what they saw (a witness, a cook, a guard) is an NPC card, not a character: `type: npc` with `persona`, `knows`, optional `gives` — see `references/npc.md`. You may add one during play too.

## 6. Revisions

After the build, every author request is a **change to the world** — a new place, a locked door, a rewritten scene, a new person — not a player action. Read what exists, change the files that need changing, keep ids and paths stable, repaint only what the change invalidates. Small request, small turn.

## 7. Report

Three lines (what exists now · the one detail worth noticing · what was skipped or failed), then the tree:

```
world (interior) · 3 objects · 2 people · bg ✓ map ✓
├── harbour (town) · … 
│   ├── seventh-berth (interior) · …
│   └── old-lighthouse (interior) · …
│       └── lamp-room (detail) · …
└── workshop (interior) · …
```

Read back every README, opening and object before reporting; a layer missing any of them is unfinished, and saying so is better than a report that looks complete.
