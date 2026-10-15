---
name: scene-initialization
description: Use for scene-init or airp-init work when a world layer needs a README, object components, opening chalk, choice, or roll_dice before it is ready to enter.
---
# Scene initialization

Use this tutorial to turn one empty `world/...` layer into a playable first pass. It is a content workflow, not a replacement for `airp-init`.

## 1. Read before writing

1. Read the target directory, its direct `README.md` if present, the parent layer README, the world skill, and relevant existing cards.
2. Use complete world-root-relative POSIX paths such as `world/baker-street`; never use an absolute path, `./`, `..`, a hidden segment, or a display name as a path. `map` is only the virtual id for the `world/` root, never a directory.
3. Confirm that the target is a `world/**` layer. `player/**` is the player's bag/private space and `characters/{id}/` is a character nook, not a scene target.
4. For delegated initialization, put every fact the child needs in the request. Do not rely on implicit `knownClues`; a child without a fact must report the gap instead of guessing.

If a real, direct `README.md` already exists, stop and report `already initialized`. Do not overwrite a scene that players may have seen. A directory containing cards or child directories but no direct README is still a stub.

## 2. The minimum complete scene

Deliver all five items:

- A direct `README.md` with `type: readme`, stable `name`, and only known `material`/`bg` facts. Describe the space and its relation to the parent; do not reveal an outcome.
- Match the scene with a background image: put its path in the directory's `README.md` frontmatter `bg` field (for example `bg: assets/scenes/example.webp`); do not leave the image reference only in the body prose.
- Give the scene a sound bed when it has an obvious one: `ambient:` in the same frontmatter, a bare key from the shared pool — `rain`, `storm`, `snow-wind`, `fireplace`, `forge`, `cellar-drip`, `cave-drip`, `harbor-waves`, `library`, `office-night`, `city-night`, `tavern-chatter`, `cafe-murmur`, `bell-church`. A child without it inherits the root layer's; never invent a key or a path.
- One to three object components. First call `get_component` for each kind, then write the real frontmatter and a short, sensory introduction. Give each object a short chalk introduction (or a same-layer `link_to` from an opening). Make objects observable, usable, or carryable; do not add props merely to reach a count.
- One or two authored opening chalks. New authored files use `01-opening.md` and, only when useful, `02-opening.md`; each has `type: chalk`, stays brief, and gives the arrival beat without deciding for the player.
- At least one interaction option and one action option. Use existing `choice` with stable ids/labels, and use existing actions such as `choose`, `use_item_on`, or `roll_dice` when the declared interaction calls for them. An interaction option is what the player selects; an action option is the concrete operation the Writer performs afterward.
- Prefer one to three child directories for meaningful subspaces. Each child must have its own direct `README.md`; a parent README never initializes a child.

Example shape (illustrative paths, not a required story):

```text
world/<parent>/
├── README.md
├── 01-object.md
├── 01-opening.md
├── 02-opening.md
└── <child>/README.md
```

Layer-root README files, including child README files, use `type: readme`. Only an authored `<child>-door.md` in the parent may use `type: gate` with a complete `target: world/...`. Do not put a gate type on a child README.

## 3. Put interaction in real fields

Declare `choice` in the entity frontmatter, then call `choose({ path, choice })` with a visible 1-based option or exact look-at text. `choose` records `choice_selected`; it does not rewrite files, remove options, enter a child, or decide a consequence. Read that event and write the consequence yourself with an appropriate existing action.

For genuine uncertainty, declare:

```yaml
roll_dice:
  type: "1d100"
  desc: "Reach the jammed drawer without breaking the seal"
  expect: ">50"
```

A person who only reports what they saw is an NPC card (`type: npc`, `persona`, `knows`; see `world-workshop/references/npc.md`), placed and pinned in this layer.

Do not pre-place loot the player has to search for, and do not pre-place a dice card that hands it out: a searchable find belongs in the layer README's `search:` list and appears only after the player's roll.

Call `roll_dice({ path })`; the engine writes `result` and `passed` and records `roll_resolved`. Do not pass a result, reroll an entity that already has one, or use an invented `action:` field. Use `use_item_on` for an item/tool behavior that the registered component kind supports.

## 4. Choose the right writing path

- When Writer writes an opening directly, use the `chalk` action so naming and the normal narrative event are preserved. Do not fake a chalk with shell commands or chat text.
- When R1 `subagent` or R2 `/airp-init` delegates `scene-init`, the initializer uses native `write` for the README, components, and a `type: chalk` opening file. It must not depend on Writer's `chalk` action. The initialization command performs its existing product check and records `layer_initialized` or a failure.
- For a complex parent, finish the parent design and README first. Then prepare an explicit brief for each different child target and launch those child initializers in parallel. This is a Writer workflow; current `airp-init` handles one target at a time and provides no parent barrier or batch command.

## 5. Verify and recover honestly

Read back the parent, every child README, each component, and each opening. Check that every object is introduced by an opening or same-layer link, options name real paths, and the five deliverables are present. A missing component or opening is a partial scene even if a README makes the layer non-empty.

Keep the existing lifecycle and event channel: `layer_entered`, `layer_initialized`, `layer_init_failed`, `choice_selected`, and `roll_resolved` are facts, not a new scene state. Report successful and failed files separately, including timeout, cancellation, in-flight duplicate, or fallback results. Do not add a second state file, a second WebSocket, or browser markup. Continue the story only after reading each delegated child's three-line report (path, summary, notable detail).
