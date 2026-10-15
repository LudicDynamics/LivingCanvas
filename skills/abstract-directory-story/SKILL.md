---
name: abstract-directory-story
description: Use when shaping a directory story about time, parallel plot, a consequential decision, or an ending with ordinary layers, choice, and roll_dice rather than hidden branch state.
---
# Abstract directory stories

## Ordinary layers, not a story state machine

Time, parallel plot, decisions, and endings are meanings authors give to ordinary directories under `world/**`. They are not new layer types or a second source of truth. The current layer comes from the Writer state block and files you actually read. Never create hidden branch-state or timeline files, and never turn the player's private space into a layer; there is no automatic branch identity, ending event, or usable rollback in this workflow.

## The anatomy of one layer

For a layer that can be entered, build this relationship:

```text
world/<parent>/README.md             # type: readme; layer identity
world/<parent>/01-opening.md         # type: chalk; arrival beat
world/<parent>/<child>/README.md     # type: readme; child layer and parent door
world/<parent>/<child>/01-opening.md # type: chalk; after entering child
world/<parent>/<child>-door.md       # optional type: gate; target: world/...
```

A parent page shows its direct children; it does not recursively expose grandchildren. A child README is both the child's layer configuration and the automatic door shown by its parent. Do not duplicate it as the child's content card. An authored gate is optional and does not replace the child's own README.

## Name paths before naming prose

Use world-root-relative POSIX paths: `world/time-map/tonight/README.md`. Directory and new chalk slugs use lowercase kebab-case; `README.md` is the deliberate uppercase exception. Authored opening and ending files use numbered names such as `01-opening.md`, `02-opening.md`, and `01-ending.md`. `opening.md` is an old fallback and `evening.md` is legacy; do not produce or rename either as a new authored file. `map` names the virtual root layer, not `map/...` files. `player/...` and `characters/{id}/...` may be referenced as real files, but are not story layers.

## Four shapes using the same discipline

```text
world/time-map/1994/README.md                 # time
world/parallel-left/README.md                 # parallel plot
world/after-decision/accept/README.md         # Writer-authored consequence
world/endings/quiet-return/01-ending.md       # ending
```

Give every authored layer its own README and at least one same-layer chalk. A time directory contains only facts visible in that time; parallel directories contain separate lines; a decision directory is written only after the decision's consequence is known; an ending directory contains a concrete closure. Directory names guide a reader, but never act as hidden variables or commands.

## Work on one current path

1. Read the state block, current `world/...` path, current README, parent README, entry chalk, and the source path named by any recent event.
2. Write only the current path and files genuinely touched by this turn. Reading a parent for context is fine; pre-writing an unentered sibling is not.
3. After `choice_selected` or `roll_resolved`, make the consequence real with `chalk`, `write`, `edit`, `move`, or `move_to`. Do not declare a change only in prose.
4. Re-read changed files before ending the turn. Never claim an unvisited line, another time, or another ending is active.

A `requires.items` gate is only for existing player files such as `player/brass-key.md`; it cannot encode time, a choice, a relationship, or a branch name.

## Reuse choice and roll

Put a real `choice` on an entity or entry chalk, then call `choose({ path, choice })`. It records `choice_selected` and does not enter a directory, delete an option, or run a `then` consequence. The Writer reads the source and event, then writes the finite response.

For actual uncertainty, use:

```yaml
roll_dice:
  type: "1d100"
  desc: "Find the safe route through the dark station"
  expect: ">50"
```

Call `roll_dice({ path })`; the engine writes `result` and `passed` and records `roll_resolved`. Do not supply a result, roll an already resolved entity, or map a roll directly to a hidden directory switch. Enter a child through the existing gate/enter flow, not an invented branch action. A stub without a direct README is still incomplete and should go through the existing initialization path.

## Endings mean stop writing

Write an ending only when player action and witnessed or recorded RP support a concrete closure. Then create or update the ordinary ending README, ending chalk, and actual affected files. A first visit, one choice, or one roll is not automatically an ending. On later visits, read and reuse the existing ending; do not redraw it, generate sibling endings, or silently add an epilogue. Stop automatic story writing until the player explicitly asks to continue or rewrite.

## Failure boundaries

Unknown paths, malformed README frontmatter, missing children, stale choices, conflicting targets, and incomplete initialization are reportable failures. Do not guess a display-name path, overwrite an existing chalk, or silently fall back to another line. Keep normal events (`layer_entered`, `entity_*`, `choice_selected`, `roll_resolved`, and initialization events) and the existing HTTP/event refresh. This tutorial adds no WebSocket frame, browser markup, branch object, or rollback command.
