# The effect list

The 16 verbs a `do` step may name, with the arguments each one accepts. Write the verb, not
the action method behind it: `give`, never `createEntity`.

This file is GENERATED from `packages/shared/src/commands/effects.ts` — do not edit it by hand.
To change an effect, follow `docs/command/04` and run
`node tools/check-command-effects.mjs --write-ref`.

| Effect | Arguments | Required | Exactly one | Array form | What it does |
|---|---|---|---|---|---|
| `give` | `path`, `title`, `body`, `frontmatter`, `link_to`, `rewards` | — | `path` | `rewards` | `rewards` (list-args) | Creates one entity, or one per element when `rewards` is an array. `path` and `rewards` are mutually exclusive. |
| `move` | `from`, `to`, `near` | `from` + `to` | — | — | Moves an entity to another path, or to a layer directory (the filename is kept). |
| `edit` | `path`, `frontmatter`, `body`, `append_body` | `path` | — | — | Edits an entity in place: `frontmatter` shallow-merges, `body` replaces, `append_body` appends. |
| `set_status` | `path`, `values` | `path` + `values` | — | — | Writes scalar keys into the entity's `status.data`. This is the deep-merge form of `edit`. |
| `consume` | `from`, `to`, `mark`, `append_body`, `title` | `from` | — | `from` (scalar) | Takes the first existing path from `from`, then either moves it away (`to`) or changes it in place. |
| `enter` | `layer` | `layer` | — | — | Enters a layer. Usable only when the layer's gate requirement is satisfied. |
| `link` | `from`, `to`, `style`, `label` | `from` + `to` | — | — | A rider of `give`; it writes no event of its own. Prefer `give` with `link_to`. |
| `tick` | `by` | — | — | — | Closed worlds only: moves the world clock by `by` (default -1, never below 0); running it out reaches the clock ending. |
| `end` | `ending` | `ending` | — | — | Closed worlds only: ends the story with the ending named in world.json `endings`. A second `end` changes nothing. |
| `event` | `target`, `title`, `text` | `target` + `title` + `text` | — | — | Says in words what just happened to a character (`characters/<id>`), an item (a card path) or a place (a layer directory). The player sees an event card; agents in that layer read it on their next turn. |
| `set_state` | `target`, `state`, `value` | `target` + `state` + `value` | — | — | Sets a declared state (`states:` on `player`, `world` or `characters/<id>` README) to `value`, checked against its type and clamped to its range. See docs/gameplay/触发器.md. |
| `add_state` | `target`, `state`, `by` | `target` + `state` + `by` | — | — | Moves a declared number state by `by` (negative to lower it), clamped to its range — e.g. `target: player, state: hp, by: -1`. |
| `show_cg` | `path`, `caption`, `once` | `path` | — | — | Shows a pre-made picture (`assets/…`, must exist) full-screen, with an optional `caption`. Recorded in the save, so the ending can list the CGs seen; `once` (default `"true"`) skips a CG this save has already shown. |
| `swap_background` | `layer`, `path` | `layer` + `path` | — | — | Changes the scene background of `layer` (`map` or a `world/…` layer) to the picture at `path` for good: it writes that layer README's `bg:`, so a reload keeps it and a rollback undoes it. |
| `pass_time` | `minutes`, `until` | — | `minutes` | `until` | — | Living worlds only (world.json `living`): lets `minutes` of world time pass, or `until` the next start of a phase (e.g. `morning` after sleeping). Residents walk, days turn and pictures change when the action settles. See docs/worlds/活着的世界.md. |
| `loop_reset` | `reason` | — | — | — | Looping worlds only (world.json `loop`): puts the world back to the run's loop-start snapshot — cards, items, backgrounds, clock, triggers, character files and conversations — while the player keeps their notes, clue board and the states / files `loop.persist` declares; `player.loop` goes up by one. Put it last in a command a trigger runs. Once per turn. See docs/gameplay/循环重置.md. |

## Rules that apply to every effect

- `path` values are world-root-relative: `world/`, `player/`, or `characters/`, and a `.md` file.
- The exceptions are `show_cg` and `swap_background`: their `path` is a picture under `assets/`
  that already exists in the world (`check:worlds` refuses a missing one). Nothing is generated at play time.
- An array argument is passed WHOLE, as a static reference: `"{{ trigger.entry.rewards }}"`. A
  literal array is refused — content lives on the entity, not in the command.
- These keys are never writable: `roll_dice`, `command_log`, `command_error`, `on`, `trigger_log`, `cg_log`, `living`, `run`, `tick`.
  They carry already-settled facts, and writing them would forge a result the player has seen.
- Whether an effect CAN happen is not checked at write time (a missing file, an item the player
  does not have). Those fail at trigger time, visibly.
