# Writing a world

A LivingCanvas world is a folder of Markdown files plus one `world.json`. The engine reads the folder, the writer agent narrates on top of it, and character agents live inside it. Everything in this guide is plain text you can write in any editor, and every field named here is read by the code in [`packages/shared`](../packages/shared/src/).

The bundled worlds in [`templates/`](../templates/) are the best reference. Each section below points at one that uses the feature.

## Contents

1. [What a world is](#1-what-a-world-is)
2. [Places and cards](#2-places-and-cards)
3. [`world.json` reference](#3-worldjson-reference)
4. [Search points and the four dice tiers](#4-search-points-and-the-four-dice-tiers)
5. [World commands and triggers](#5-world-commands-and-triggers)
6. [The clock and player turns](#6-the-clock-and-player-turns)
7. [Endings and the debrief](#7-endings-and-the-debrief)
8. [Run variants and time loops](#8-run-variants-and-time-loops)
9. [Characters and NPC cards](#9-characters-and-npc-cards)
10. [Editions and languages](#10-editions-and-languages)
11. [Workflow: scaffold, play, check](#11-workflow-scaffold-play-check)
12. [Licensing](#12-licensing)

---

## 1. What a world is

```text
my-world/
├── world.json                 rules: name, cast, clock, endings, triggers…
├── world/                     the places (the root layer, id "map")
│   ├── README.md              the root place: background, sound, options, intent
│   ├── 01-opening.md          a card (narration, note, letter, prop…)
│   └── harbour/               a child place (layer id "world/harbour")
│       ├── README.md
│       └── logbook.md
├── player/                    the protagonist: README.md (states, skill sheet) + the bag
├── characters/<id>/           one folder per character agent
├── endings/<id>/README.md     ending passages (closed and semi-closed worlds)
├── command/<id>.yaml          world commands: consequences the engine runs
├── skills/<world-id>-play/SKILL.md   the writer's instructions for this world
├── assets/                    pictures, video, maps, audio the world ships
├── ambient/<character>.json   optional: idle one-liners for characters
├── hints.json                 optional: the companion's hint table
├── variants/                  optional: per-run overlays (§8)
└── loops/                     optional: per-loop overlays (§8)
```

Ground rules:

- **Paths are ASCII lower-kebab-case** (`world/old-lighthouse/logbook.md`). Display text — names, titles, prose, button labels — is in the world's language.
- **Layers come from directories.** Every directory under `world/` with a `README.md` is a place. You never list layers in `world.json`; the engine derives them.
- **A card is a `.md` file with YAML frontmatter.** The frontmatter is what the engine runs; the body is what the player reads.
- **`.airpworld/` is engine data** (event history, snapshots, generated pictures under `.airpworld/assets/gen/`). It is created when the world is played. Do not edit it by hand, and do not ship it in a template.
- **The writer sees everything, characters do not** (see [§9](#9-characters-and-npc-cards)). Put the truth of the story where only the writer can read it.

## 2. Places and cards

### A place: `README.md`

The README of a directory is the place itself: its picture, its sound, its buttons and the writer's notes on what the place is for.

```yaml
---
type: readme
name: Old Lighthouse
title: Old Lighthouse · The Twelve Dark Minutes
bg: assets/backgrounds/lighthouse.webp      # what you see standing here
bgVideo: assets/motion/lighthouse.webm      # optional moving background
ambient: snow-wind                          # sound bed: a catalog key, "none", or an assets/ path
intent: >-                                  # for the writer only: what can be learned here,
  The watch log names the hour the lamp went out.   # what must not be skipped, what not to reveal
  Never retell it before the player reads it.
choice:
  options:
    - id: read-logbook
      label: Open the watch log
    - id: climb
      label: Climb to the lamp room
  allow_free: true                          # free-text actions stay possible
choice_actions:
  read-logbook: { kind: read, paths: [world/old-lighthouse/logbook.md] }
  climb:        { kind: enter, target: world/old-lighthouse/lamp-room }
requires:                                   # optional lock on entering this place
  items: [player/lighthouse-key.md]
blocked: The door is locked. Someone in town has the key.
map:
  kind: interior                            # region | town | interior | detail
  plan:
    picture: assets/maps/lighthouse.webp    # the place seen from above (map view)
    pins:                                   # x, y in 0..1 from the top-left
      logbook: [0.62, 0.70]                 # a card's file stem
      lamp-room: [0.50, 0.18]               # a child directory
      vera: [0.40, 0.45]                    # a character id
      player: [0.20, 0.86]
---
Prose: the space, how it relates to the place above it, what is at stake. No outcomes.
```

`choice_actions` kinds: `read` (`paths`), `take` (`paths`; moves the cards into the player's bag), `enter` (`target`: a layer), `character` (`character`: an id — opens a conversation), `talk`, `reply` (`text`), `writer` (`prompt`; hands the beat to the writer), `search` (`spot`: a search point, [§4](#4-search-points-and-the-four-dice-tiers)) and `stage` (material slots). An option without an action goes to the writer as a request about this card. Options may also carry `when` (`key == value` over the card's own `status`), `hint`, `once`, `repeat`, and `to`/`say` to address a character.

Each place usually has an arrival card `01-opening.md` (`type: chalk`) and one to three objects. [`templates/whitechapel/world/README.md`](../templates/whitechapel/world/README.md) is a complete root place.

### Card types

`type` is a free string, but these are the ones the engine renders specially:

| `type` | What it is |
|---|---|
| `chalk` | Narration written straight onto the canvas (the writer's main voice). Style keys: `font: hand`, `big`, `tone: rust \| blue \| sage`, `aged`, `collapsed`. |
| `readme` / `gate` | A place. Any `README.md` is a place card; inside its parent it is the door. |
| `note` | A sticky-note card; the default for any `.md` without a known type. |
| `letter` | A paper letter. |
| `component` + `component: <kind>` | An interactive object: `diary`, `book`, `ledger`, `photo`, `cipher`, `lock`, `container`, `trap`, `mechanism`, `map`, `clock`, `tape`, `anchor`, `instrument`, `board`, `thread`, `portrait`. |
| `npc` | A person who is not an agent ([§9](#9-characters-and-npc-cards)). |
| `ending` | An ending page, only under `endings/` ([§7](#7-endings-and-the-debrief)). |

Three interactive keys work on any card:

```yaml
---
type: note
title: Tide Level · Before the Tide Returns
portable: false            # cannot be taken into the bag
status:                    # visible key/value table; flat scalars only
  data:
    left: 8
choice: [Look at the tide table]   # short form: a list of labels
roll_dice:                 # a die this card offers (see §4)
  type: 2d10
  desc: Read the tide table in the dark
  expect: ">=11"           # ALWAYS quoted
---
```

### The player and declared states

`player/README.md` describes the protagonist. Cards in `player/` are the bag. A world with rules gives the protagonist a skill sheet, and any of `player/README.md`, `world/README.md` or `characters/<id>/README.md` may declare **states** — typed values triggers and commands can read and change:

```yaml
---
type: readme
title: You
states:
  - id: hp                 # read as player.hp
    label: Wounds
    type: number           # number | flag | enum
    initial: 10
    range: [0, 10]
    shown_as:              # how the panel says it, in words; no HUD numbers
      - { min: 8, text: Unhurt }
      - { min: 4, text: Hurt }
      - { min: 1, text: Badly hurt }
      - { max: 0, text: Barely alive }
sheet:
  skills:
    - { id: spot_hidden, label: Spot Hidden, value: 60 }
    - { id: library_use, label: Library Use, value: 60 }
---
```

A state with `hidden: true` is never shown in a panel but is still readable by triggers. The current value lives in the same file's `status.data[id]`. Example: [`templates/whitechapel/player/README.md`](../templates/whitechapel/player/README.md).

### The world skill

`skills/<world-id>-play/SKILL.md` is the writer's handbook for this world: continuity rules, what never to reveal early, how dice are presented, what the people are like. Its frontmatter `name` must equal its directory name, and it needs a `description`. Keep the run's truth out of it when the truth changes per run ([§8](#8-run-variants-and-time-loops)). Example: [`templates/first-snow/skills/first-snow-play/SKILL.md`](../templates/first-snow/skills/first-snow-play/SKILL.md).

## 3. `world.json` reference

Required: `id`, `name`, `description`, `author`, `genre`, `createdAt`, `updatedAt`. Everything else is optional. Unknown keys are kept, so this table lists only the ones the engine reads.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable id; an edition adds `-jp` / `-ko` / `-zh` ([§10](#10-editions-and-languages)). |
| `name`, `description` | string | Title and one-paragraph pitch. |
| `author`, `genre` | string | Credit line and a free genre label. |
| `version`, `schema` | string, number | Defaults `1.0.0` and `1`. |
| `locale` | `en` \| `ja` \| `zh-CN` \| `ko` | The world's language; agents speak it, NPC replies use it. |
| `tags` | string[] | Free tags. |
| `cover` | path | Lobby cover, under `assets/`. |
| `material` | string | Paper skin of the canvas: `parchment`, `warm`, `kraft`, `stub`. |
| `entry` | layer id | Where play starts: `map` (the root) or `world/...`. |
| `intro` | object | The lobby card: `status`, `category` (`trpg` \| `story` \| `free`), `hook`, `genres`, `loop` (three lines), `minutes`, `difficulty`, `mechanics`, `endings` (count), `characters`, `for`, `unfinished`. Must be honest: a `clock` badge needs a clock, the ending count must match `endings`. |
| `audio.theme` | string | The world's music, a catalog id. |
| `player` | `{ id, name, avatar? }` | The protagonist. |
| `characters` | array | Character agents: `id`, `name`, `home` (layer id), `role` (`companion` \| `npc`), `avatar`, `avatarVideo`, `description`. |
| `opening` | object | `greeter` (a character id who speaks first, line in their README's `greeting:`), `greeting` (narrator fallback), `replies` (up to three one-tap first answers). |
| `ui.replyChips` | boolean | One-tap reply chips above the input. |
| `view.default` | `canvas` \| `map` | The view the world opens in. Use `map` when every layer has a map picture. |
| `rules` | object | `system: coc` (d100 under a skill) or `dnd` (d20 + modifier vs DC); `sanity`, `characterChecks`, `proficiency`. |
| `dice.consequences` | object | Default costs/bonuses for `crit_fail` / `crit_success` ([§4](#4-search-points-and-the-four-dice-tiers)). |
| `mode` | `open` \| `semi` \| `closed` | `semi` and `closed` worlds end; `open` (the default) never does. |
| `clock` | object | Time limit: `path`, `key`, `start`, `label`, `time`, `perTurns` ([§6](#6-the-clock-and-player-turns)). |
| `endings` | array | `{ id, title, path, when? }` ([§7](#7-endings-and-the-debrief)). |
| `triggers` | array | Condition → consequence rules ([§5](#5-world-commands-and-triggers)). |
| `mysteries`, `reckoning` | array, object | The post-ending debrief ([§7](#7-endings-and-the-debrief)). |
| `variants` | array | Per-run random truth ([§8](#8-run-variants-and-time-loops)). |
| `loop` | object | Time loop ([§8](#8-run-variants-and-time-loops)). Cannot be combined with `living`. |
| `living` | object | A living world: calendar, day phases, weather, residents' schedules, events, overnight drift. See [`templates/islet/world.json`](../templates/islet/world.json) and [`living.ts`](../packages/shared/src/schemas/living.ts). |
| `tick` | object | Character turns: every few beats a person shows an intent from a closed menu of moves, each a world command. See [`templates/last-train/world.json`](../templates/last-train/world.json) and [`tick.ts`](../packages/shared/src/schemas/tick.ts). |
| `inspiration` | object | The stuck-player hint roll, drawing only from `hints.json`. |
| `experience` | object | `kind` (`story` \| `prologue`), `turnEnd` (a command run after every player turn), `maxTurns`, `next`. |
| `writer.fastPath` | boolean | `false` keeps every save of this world on the full agent writer even when the server runs the optional one-call fast path ([configuration](configuration.md)). |
| `models` | object | Preferred models per role: `{ writer?, character? }`, each a model id or a list of `{ provider?, model, thinking? }`. The player's own choice wins. |
| `theme` | object | World type and structure flags set by the in-game workshop. |
| `exp` | boolean | Experimental: listed separately in the lobby and exempt from the edition set ([§11](#11-workflow-scaffold-play-check)). |
| `extensions` | array | `{ id, version, optional }` component packs the world needs. |

The schema itself is [`packages/shared/src/schemas/world.ts`](../packages/shared/src/schemas/world.ts).

## 4. Search points and the four dice tiers

### Searching is a roll, and the loot does not exist yet

Key clues are **never pre-placed**. A place declares what can be found on its README under `search:`. Pressing the search button (`kind: search`) puts a dice card on the table; the player rolls; the tier decides which files the engine creates; then the writer narrates what was found.

```yaml
choice:
  options:
    - { id: search, label: Search here (roll) }
choice_actions:
  search: { kind: search, spot: scene }
search:
  - id: scene                       # the dice card lands at search-scene.md
    label: Search here (roll)
    title: Work out which came first, picture or incident
    body: |-                        # shown before the roll: the stakes, the bands
      1d100, 60 or less succeeds. 1–12 critical success … 96–100 critical failure.
    skill: library_use              # optional: a skill on the protagonist's sheet
    alt_skills: [spot_hidden]       # optional: other skills that also count as this search
    roll_dice: { type: 1d100, desc: Work out which came first, expect: "<=60" }
    dice_outcomes:
      - min: 1
        max: 12
        text: You see the heart of it, and what to check next.
        rewards:                    # the files this tier creates
          - path: world/london-map/morgue/time-record.md
            title: Incident time · 6 a.m.
            body: The third incident happened around 6 a.m. this morning.
          - path: world/london-map/morgue/breakthrough.md
            title: Breakthrough notes
            body: The illustration came before the incident.
      - min: 13
        max: 60
        text: It fits together.
        rewards:
          - { path: world/london-map/morgue/time-record.md, title: Incident time · 6 a.m., body: … }
      - min: 61
        max: 95
        text: The register is full of corrections. The search ran long.
        rewards:
          - { path: world/london-map/morgue/time-record-half.md, title: Incident time, unclear, body: …, partial: true }
        cost: { clock: -1 }
      - min: 96
        max: 100
        text: The attendant takes the register away before you can read the hour.
        rewards:
          - { path: world/london-map/morgue/time-record-half.md, title: Incident time, unclear, body: …, partial: true }
        cost: { clock: -2 }
    on:
      roll_resolved:
        - { when: roll.rank >= 3, run: mark-picture }
```

The full version is [`templates/whitechapel/world/london-map/morgue/README.md`](../templates/whitechapel/world/london-map/morgue/README.md). A band may also carry `options` (buttons shown after the roll, e.g. *Read the clue*, *Return to the map*) and `harm: light | serious | grave` (lowers `player.hp` in a world with endings whose player declares `hp`). A reward may set `portable: false`.

Each spot is searched once per run. Supported dice for bundled worlds are `1d10`, `2d10` and `1d100`. In a world with `rules`, a spot with `skill` becomes a skill check against the protagonist's sheet value; the card's prose must name the die actually rolled. A protagonist's own skill check with the spot's `skill` (or one of its `alt_skills`) in that place, while the spot is unsearched, *is* that search: the engine pays the spot's own bands.

A card that is not a search point can still offer a roll: give it `roll_dice` plus `dice_outcomes` (same band shape) or an `on.roll_resolved` binding. The writer can also improvise a minor search or skill check during play; key clues should still come only from declared spots.

### The four tiers

Every roll resolves to exactly one tier. The tier names in data are:

| Tier (`roll.outcome`) | Engine grade (`roll.grade`) | `roll.rank` | 2d10 ≥ 11 | 1d100 ≤ 60 | What it should mean |
|---|---|---|---|---|---|
| `crit_success` — Critical success | `great` | 4 | 18–20 | 1–12 | Something extra: a hidden clue, an item, time saved |
| `success` — Success | `success` | 3 | 11–17 | 13–60 | What the check was for |
| `fail` — Failure | `setback` | 2 | 5–10 | 61–95 | A partial result plus a small cost |
| `crit_fail` — Critical failure | `failure` | 1 | 2–4 | 96–100 | A real cost: time, injury, a lost item, suspicion |

With `rules.system: coc`, the grades follow the skill check (critical, extreme/hard/regular success, failure, fumble); with `dnd`, a natural 20 or DC+10 is a critical and a natural 1 or DC−10 a critical failure. A plain NdM roll with no convention counts all-max dice as critical success and all-ones as critical failure.

### Consequence effects

A band's `cost:` and `bonus:` (one effect or a list) are applied by the engine when the roll resolves:

| Effect | Shape | Meaning |
|---|---|---|
| `clock` | `{ clock: -1 }` | Move the world clock (−3…3) |
| `state` | `{ state: { target: player, id: hp, by: -1 } }` | Change a declared state on `player`, `world` or `characters/<id>` |
| `harm` | `{ harm: light }` | Injury: `light`, `serious`, `grave` |
| `sanity` | `{ sanity: -1 }` | Sanity, where the world declares it |
| `relationship`, `resource` | `{ relationship: 1 }` | Resolved against a declared trust/bond or money/supplies state |
| `item` | `{ item: { path: player/lamp-oil.md, fate: lost } }` | `lost` or `broken` |
| `reveal` | `{ reveal: { title: …, body: … } }` | An extra discovery |
| `complication`, `boon` | `{ complication: The guard looks your way }` | A visible story beat when no number can move |

Bounds: a failure costs at most 1 (and at most `light` harm), a critical failure up to 3, a critical success gains up to 2; a plain success owes nothing extra.

**Who enforces it.** Tabletop worlds (`intro.category: trpg`, or any world with `rules` and no category) and any world that declares `dice.consequences` are *enforced*: if a critical roll's consequence is still unpaid when the writer's turn ends — the writer can pay it with its `dice_consequence` tool — the engine applies the world's default chain, the first candidate that can land:

```json
"dice": {
  "consequences": {
    "crit_fail": [{ "clock": -1 }, { "harm": "light" }, { "complication": true }],
    "crit_success": [{ "clock": 1 }, { "boon": true }]
  }
}
```

(The built-in tabletop default is exactly that, with `{ "sanity": -1 }` before the complication.) Story and free-play worlds show and narrate the four tiers but enforce no cost.

**Data rules `check:worlds` applies to authored dice:** all four tiers declared (four bands, bindings, or `dice_tiers: inherit`); failure and critical failure never hand over a full **key clue** (a path listed in `triggers[].clues` or `mysteries`) — give a half clue with `partial: true` instead; in enforced worlds a critical failure costs something a success does not (`harm`, `cost`, or a rank-1 binding), and a critical success gives something a success does not.

**The writer narrates, the engine pays.** After the roll, the writer is told which tier landed and which files the roll created, and writes the scene around them. It never creates declared loot itself.

## 5. World commands and triggers

### Commands: `command/<id>.yaml`

A command is a consequence the engine runs the same way every time — on a dice tier, a button, an item used on something, or a trigger — whether or not the writer is involved. Four top-level keys: `name`, `desc`, `params`, `do`.

```yaml
name: Accuse on the Chart
desc: Expose the smugglers only when all four threads are in the bag
do:
  - action: end
    when: has("player/decoy-ship.md") && has("player/ledger-page.md")
    with:
      ending: exposed
  - action: tick
    with:
      by: "-1"
```

A step's `when` uses the same condition grammar as triggers: comparisons (`==`, `!=`, `<`, `<=`, `>`, `>=`), `has("path")`, joined with `&&` and `||`. Real example: [`templates/wuwu/command/accuse.yaml`](../templates/wuwu/command/accuse.yaml).

Effects: `give`, `move`, `edit`, `set_status`, `consume`, `enter`, `link`, `tick`, `end`, `event`, `set_state`, `add_state`, `show_cg`, `swap_background`, `pass_time` (living worlds), `loop_reset` (looping worlds). Arguments are written as strings (`by: "-1"`). The arguments of each effect are listed in [`skills/world-commands/references/effects.md`](../skills/world-commands/references/effects.md), and [`skills/world-commands/SKILL.md`](../skills/world-commands/SKILL.md) explains when a command is worth writing at all.

A command does nothing until something runs it. Bind it on a card with `on:` — hooks are `roll_resolved`, `choice_selected` and `use_item_on`:

```yaml
on:
  roll_resolved:
    - { when: roll.rank >= 3, run: evidence-ledger }
    - { when: roll.rank <= 2, run: miss-workshop }
    - { when: roll.rank == 1 && has("player/lamp-oil.md"), run: burn-lamp-oil }
```

([`templates/wuwu/world/harbor-chart/workshop/README.md`](../templates/wuwu/world/harbor-chart/workshop/README.md))

### Triggers: `world.json` `triggers[]`

A trigger is *condition → consequence → fallback*. Five kinds:

| `kind` | `when` | Fires when |
|---|---|---|
| `clock` | `"clock <= 3"` | The clock reaches the value |
| `state` | a condition string | It holds: `has("path")`, `clues.held`, `clock.left`, `clock.turns`, `player.<id>`, `world.<id>`, `<character>.<id>`, combined with `&&` and `\|\|` |
| `keyword` | `{ intent, scope?, layers? }` | The player *means* this; judged by the writer, never by string matching |
| `place` | `{ layer }` | The player first enters that layer |
| `dice` | `{ card?, layer?, band?, passed?, fumble?, crit? }` | A matching roll resolves (`band`: `failure`, `setback`, `success`, `great`) |

Consequence: `do` (a command id), and/or `ending` (shorthand for `end`), and/or `assets` (a pre-made `cg` or `background` with its generation `prompt`), with `fallback` text the engine shows if nothing else narrates. `once` defaults to `true`; `false` re-arms when the condition stops holding. A `state` trigger may list `clues` for `clues.held` to count:

```json
{
  "id": "wayne-turns-up",
  "kind": "state",
  "when": "clues.held >= 3",
  "clues": ["world/london-map/morgue/time-record.md", "world/london-map/print-shop/receipt.md", "…"],
  "do": "wayne-turns-up",
  "fallback": "Someone calls to you from the corner. Arthur Wayne stands in the fog with a red envelope."
}
```

## 6. The clock and player turns

A clock is an ordinary card whose `status.data[key]` counts the steps left.

```json
"clock": {
  "path": "world/tide.md",
  "key": "left",
  "start": 8,
  "label": "Before the Tide Returns",
  "time": { "start": "23:00", "end": "01:00" }
}
```

- The card at `path` must exist and carry `status.data.left: 8` (the same number as `start`). See [`templates/wuwu/world/tide.md`](../templates/wuwu/world/tide.md).
- **What moves it:** the `tick` command effect (`by`, default `-1`, never below 0), a dice band's `cost`/`bonus` `clock` effect, and — if set — player turns.
- **What the player sees:** a clock badge with `label` and the steps left. With `time`, the badge shows the story's time instead: `start` is when the run begins, `end` the deadline (past midnight is fine), each step an equal slice.
- **What happens at a step:** clock triggers and clock endings (`"when": "clock <= 0"`) are checked right after every tick.

### `perTurns`: the clock follows the conversation

```json
"clock": { "path": "world/days.md", "key": "left", "start": 9, "label": "Hour", "perTurns": 6 }
```

Every `perTurns` player turns (1–50), the engine ticks once. **A player turn** is exactly one of: the player's own message to the writer; one line the player says to a character or an NPC card; the player choosing an option, rolling a die (search, skill check, dice card) or using an item. **Not** a turn: reading, entering a place, moving cards, notes, the writer's or a character's own actions, character turns, engine effects.

The count lives on the clock card as `status.data.turns`, so `clock.turns` can appear in trigger conditions (`clock.left <= 1 && clock.turns >= 5` = the last turn of the last hour). Don't name the clock's `key` `turns`, and don't also give the clock card a button that ticks. Example: [`templates/seven-days-inn-zh/world.json`](../templates/seven-days-inn-zh/world.json).

## 7. Endings and the debrief

### Declaring endings

```json
"mode": "closed",
"endings": [
  { "id": "found",    "title": "Found Her",           "path": "endings/found/README.md" },
  { "id": "departed", "title": "The Train Departed",  "path": "endings/departed/README.md", "when": "clock <= 0" }
]
```

An ending is reached in three ways: the `end` effect in a command (from a button, a dice tier, an item); a trigger with `ending` or a `do` that ends; or the clock, when an ending's `when` (`clock <op> <integer>`, nothing else) holds after a tick. The first ending reached wins; a second `end` does nothing. The writer never declares an ending in prose.

### The ending page

`endings/<id>/README.md` sits outside `world/`, so the player cannot walk into it and characters cannot read it.

```yaml
---
type: ending
title: The Train Departed
bg: assets/scenes/ending-departed.webp
passages:                                   # optional, read after the body, in order
  - when: 'player.hp <= 0'
    text: Xia Cheng has to help you off the train.
  - group: log                              # in a group, only the first that holds
    when: 'has("player/logbook-page.md")'
    text: The logbook page is still in your hands.
  - group: log
    text: The logbook page is never found again.   # no when: the group's fallback
---
At exactly five, the car shudders, and the last train pulls out of the tunnel.
```

`passages` let one ending read right for many different runs. Example: [`templates/last-train/endings/departed/README.md`](../templates/last-train/endings/departed/README.md).

### After the ending

Once a `semi` or `closed` world has ended, only reading and talking remain; the player can start a new game. The ending card shows a results panel built from what really happened: time played, clock used, rolls, places visited (unvisited ones as `???`), clues carried, and the **ending collection** — every ending of this world, the ones this player has reached by title and the rest as `???`. The collection is kept per world in the player's browser.

### The debrief: `mysteries` and `reckoning`

After an ending, the player may answer the world's secrets. Answers never change the ending; they score secrets solved and unlock epilogues.

```json
"mysteries": [{
  "id": "culprit",
  "question": "Who turned Edith's novel into real events?",
  "hint": "Whose hands touched those pictures first?",
  "options": [
    { "id": "edith", "label": "Edith herself", "tier": "wrong" },
    { "id": "wayne", "label": "Arthur Wayne, the illustrator", "tier": "surface",
      "clues": ["world/london-map/third-crime-scene/pigment-record.md"], "epilogue": "…" },
    { "id": "unseen", "label": "Wayne — the paper was dropping his illustrations", "tier": "hidden",
      "clues": ["world/london-map/print-shop/illustration-room/returned-proofs.md"],
      "title": "The Returned Proofs", "epilogue": "…" }
  ]
}],
"reckoning": { "epilogues": { "all": "…", "most": "…", "few": "…" } }
```

Each mystery has 3–4 options, at least one `surface` and one `wrong`. A `surface` or `hidden` answer counts only if one of its `clues` is in the save (at that path, or carried in `player/` under the same file name), and needs an `epilogue`; a `hidden` one also needs a `title`. `reckoning` gives the closing line for all / most / few secrets solved. Example: [`templates/whitechapel/world.json`](../templates/whitechapel/world.json).

## 8. Run variants and time loops

### Variants: a different truth each run

```json
"variants": [{ "id": "culprit", "options": ["eve", "ross", "koharu"], "state": "culprit" }]
```

The template carries one overlay per option, `variants/<id>/<option>/`, mirroring the world root (`world/…`, `command/…`, `player/…`). When a **new game** starts, the engine draws a seed, picks one option per variant, copies that overlay over the save, deletes `variants/` from the save (so no agent can read the other truths), writes the pick into the declared `state`, and records `run: { seed, variants }` in `world/README.md`. Set `AIRP_RUN_SEED` to reproduce a draw locally.

Rules for the template: the base files *are* the first option (byte-identical to `variants/<id>/<first>/`); every option overlays the same set of files; options differ only in prose, never in ids, paths, dice or conditions; `state` is an `enum` state in `world/README.md` (usually `hidden: true`) whose values are the options and whose `initial` is the first. Keep variable content in fixed "slot" paths so triggers need no per-variant copies, and put the run's truth only where the writer reads it (e.g. a suspect card's `intent`), never in the world skill. Example: [`templates/last-witness`](../templates/last-witness/).

### Loops: the world resets, the player remembers

```json
"loop": {
  "persist": {
    "notes": true,
    "board": true,
    "states": ["loop", "known_*"],
    "files": ["player/*.md"]
  },
  "counter": "loop",
  "stages": [
    { "from": 2, "overlay": "loops/second" },
    { "from": 2, "when": "player.known_register == true", "overlay": "loops/back-room" }
  ]
}
```

- The engine snapshots the loop's start when a run begins. A command with the `loop_reset` effect (as its **last** step, typically from a clock trigger) restores the world to that start.
- **What persists:** the player's sticky notes and clue board (`notes`, `board`, default `true`), the listed player states (`known_*` matches a prefix), and the listed `player/*.md` files byte for byte (`keep` is a shorthand for `persist.files`). Everything else — items, the clock, other states, triggers, character memories and conversations — goes back.
- `counter` is a declared number player state the engine adds one to per reset (default `loop`).
- `stages` bring new content to later loops: overlay directories `loops/<name>/`, applied when loop N ≥ `from` (and ≤ `until`, and `when` holds over kept player states), cumulatively in declaration order.
- The player sees a banner: a new loop has begun and only they remember. The writer is told which loop it is and what the player knows.

`loop` and `living` cannot be used together. None of the worlds in this repository uses a loop yet; the fields above are the whole contract, and `check:worlds` validates them.

## 9. Characters and NPC cards

### Character agents: `characters/<id>/`

A character is its own agent with its own memory. List it in `world.json` `characters`, and give it a folder:

| File | Holds |
|---|---|
| `README.md` | The public card: `name`, `avatar`, `avatarVideo`, `voice`, `greeting`, `invites_follow_line`, `arrival_line`, optional `sheet` and `states`; body = a one-paragraph description |
| `identity.md`, `personality.md`, `likes-and-fears.md`, `relationships.md` | Who they are |
| `memory.md`, `diary.md`, `near-term.md`, `long-term.md` | What they remember and want |
| `unspoken.md` | What they cannot say yet |
| `preset.json` | The agent's prompt assembly: a `profile` slot listing the files above, and a `world-language` block that opens with the language directive (`Speak English.`) |

Copy a folder from [`templates/moonlit-contract/characters/lyra/`](../templates/moonlit-contract/characters/lyra/) and rewrite it; the `profile` slot's `baseDir` must be `characters/<id>`.

**`voice`** is an alias from the voice table ([`voices.ts`](../packages/shared/src/rules/voices.ts)), such as `gentle-calm` or `warm-cheerful`, resolved to a voice that speaks the world's language.

### What a character can see

The writer reads everything. A character reads the world only as that person could:

- **Withheld:** `command/`, `endings/`, `variants/`, `hints.json`, engine data, and other characters' private files (only their `README.md` is visible).
- **Projected:** every card is shown without its writer-facing keys — no `intent`, no NPC brief (`persona`, `knows`, `wants`, `fears`, `gives`), no `search` / `dice_outcomes`, no `on` / `choice_actions`, no lock solutions, no hidden states. `world.json` is cut to what the lobby shows.

So: **put secrets in `intent`, NPC briefs, hidden states, commands or endings — never in a card's body.** The rule lives in [`character-view.ts`](../packages/shared/src/rules/character-view.ts).

### NPC cards

Someone who only needs to say what they saw — a witness, a driver, a cook — is a card, not an agent. The writer voices them from a brief, and they can only state what their `knows` cards say:

```yaml
---
type: npc
name: Old Qin
avatar: assets/characters/lao-qin.webp     # optional; must exist if set
gender: male                               # picks a default voice if no `voice`
voice: hoarse-weathered
persona: >-                                # 1–3 lines: who, how they talk
  A fifty-five-year-old driver guarding the radio. Few words, blunt.
knows:                                     # the only facts they can say (1–8 cards)
  - world/cab/repair-notice.md
  - world/cab/lao-qin.md
wants: Get the train out of the tunnel at five o'clock
fears: Something happened while he was out of the cab
gives: [take-notice]                       # option ids on this card they may hand over
choice:
  options: [{ id: take-notice, label: Take the repair notice }]
choice_actions:
  take-notice: { kind: take, paths: [world/cab/repair-notice.md] }
---
What the player sees on the card. Nothing beyond what `knows` says.
```

The conversation is stored on the card (`dialogue:`, written by the engine), so it survives reloads. Add the card's file stem to the place's `map.plan.pins` to show it on the map. Reference: [`skills/world-workshop/references/npc.md`](../skills/world-workshop/references/npc.md); examples in [`templates/last-train/world/`](../templates/last-train/world/).

## 10. Editions and languages

Bundled worlds ship as families of editions: `whitechapel` (English), `whitechapel-jp` (`locale: ja`), `whitechapel-ko` (`ko`), `whitechapel-zh` (`zh-CN`). Each edition is a complete folder.

- **Only words change.** Ids, paths, dice, bands, rewards, conditions, commands and triggers are identical in every edition; `check:worlds` compares each edition's executable structure with the English one and fails on drift. Asset files are shared byte for byte.
- Per edition: `world.json` `id` and `locale`; the world skill directory follows the edition id (`skills/whitechapel-jp-play/`); each character's `world-language` block opens in that language (`日本語で話す。`, `说中文。`, `한국어로 말한다.`).
- The edition families checked as a set are listed in `tools/world-editions.mjs`. A single-language world is fine: mark it `"exp": true` (several bundled worlds are Chinese-only this way) and it is checked on its own.

## 11. Workflow: scaffold, play, check

### Start from a template

```bash
pnpm build                                        # once: the tools read packages/shared/dist
node tools/scaffold.mjs --template moonlit-contract --out worlds/my-world --name "My World" --author "Your Name"
```

[`tools/scaffold.mjs`](../tools/scaffold.mjs) flags: `--template` / `-t` (a folder name under `templates/`, default `whitechapel`), `--out` / `-o` (default `worlds/<template>-play-NNNN`), `--name` / `-n`, `--author` / `-a`. It copies the template, gives the copy a unique id and fresh timestamps, and initializes `.airpworld/`. `worlds/` is never committed.

Good starting points: [`moonlit-contract`](../templates/moonlit-contract/) (story, one companion, no dice), [`whitechapel`](../templates/whitechapel/) (searches, triggers, debrief), [`wuwu`](../templates/wuwu/) (a timed investigation), [`last-train`](../templates/last-train/) (clock, NPC cards, character turns, ending passages), [`unwritten-door`](../templates/unwritten-door/) (an open world the writer grows), [`islet`](../templates/islet/) (living world, variants). All of them may be remixed under CC BY-NC 4.0 with credit ([CONTENT-LICENSE.md](../CONTENT-LICENSE.md)).

### Play it

A folder under `worlds/` is a **save**: it appears in the lobby and is played in place, so play state accumulates in it. To boot straight into it: `AIRP_WORLD=worlds/my-world pnpm dev`.

While you are still authoring, it is often easier to keep the source in `templates/my-world/` with `"exp": true`: the lobby lists it under experimental worlds, every *new game* is a fresh copy (with a fresh variant draw and loop start), and `check:worlds` validates it. Edit, start a new game, repeat.

### Grow it with the writer

- **In the lobby, *Make a world*** describes a world in a sentence or two; the writer builds the place tree, cards, characters and pictures following [`skills/world-workshop/SKILL.md`](../skills/world-workshop/SKILL.md). Later requests revise it.
- **During play**, the writer can add places as you walk into them, new NPC cards and world commands; NPC cards and commands it writes are checked against the same rules as above, and a malformed one is refused.

### Pictures and art prompts

Each place wants a scene picture (`bg`) and, for map view, a top-down map (`map.plan.picture`). Keep the world's style in `assets/maps/PROMPTS.md`: one style line, then each prompt, so pictures can be regenerated consistently. A README, NPC card, character README or ending may also declare `art:` (`scene`, `map`, `portrait`, `cg` entries of `{ path, prompt }`); the in-game art panel lists and repaints from these. After painting a map, move the pins onto what was drawn. Example: [`templates/first-snow/assets/maps/PROMPTS.md`](../templates/first-snow/assets/maps/PROMPTS.md).

### Validate

```bash
pnpm check:worlds                       # all templates
pnpm check:worlds -- --only=whitechapel # one edition family (plus the per-template checks)
```

[`tools/check-world-editions.mjs`](../tools/check-world-editions.mjs) checks **folders under `templates/` only** — not saves in `worlds/`. It has two parts:

- **For edition families:** every edition present; `world.json` parses against the schema; media paths exist; the `intro` card is honest; debrief clues are reachable; skill ids are on the sheet; the four-tier dice rules; variant overlays; search finds are not pre-placed and use supported dice; character folders are complete; executable structure matches the English edition.
- **For every template, experimental ones included:** triggers and declared states, living worlds, loops, the turn clock, NPC cards, ambient lines, character turns, `art:` blocks, music and ambient references, no option declared by two cards on one place, every command parses, `alt_skills`, dice prose naming the real die, hint routing, passive checks, and `intro` when present.

The contract tests under `tools/*-contract.test.mjs` show how bundled worlds prove every ending is reachable; `pnpm test` runs them with no model calls.

## 12. Licensing

The bundled worlds — text, characters, art, voice samples and world skills — are licensed under **CC BY-NC 4.0** ([CONTENT-LICENSE.md](../CONTENT-LICENSE.md)). A world adapted from one of them stays under those terms: credit the original and do not use it commercially.

A world you write from scratch is yours. License it however you like; nothing in the engine's Apache-2.0 license claims your content. If you want it bundled with the project, see [open-source.md](open-source.md) for how contributions work.

See also: [architecture.md](architecture.md) for how a player beat reaches the writer, the engine and the canvas, and [configuration.md](configuration.md) for model, voice and writer settings.
