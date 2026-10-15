---
name: world-commands
description: "Use when a consequence has to happen whether or not you are the one running — a player's own dice roll, a choice button they press, an item they use on something — and you want it to come out the same way every time instead of depending on your prose. Covers when to write one at all, the command file, and binding it to an entity with on."
---

# World commands: consequences that do not need you

You narrate meaning. A world command executes consequence. When the two mix — when a published
table of outcomes is executed by your memory instead of by the engine — the player eventually
sees the same rule come out two different ways, and has no way to tell which run was the real one.

## Default: narrate. Write a command only when one of these is true.

Ask these in order. If none is true, narrating is the correct answer, not a shortcut.

**1. Does this have to happen when you are not the one running?** The player's own dice button,
their own choice button, their own item use — none of those reach you at all. Your prose is never
executed on those paths. Not "runs slowly": never runs. This is the strongest test, and it is the
one this whole feature exists for.

**2. Will the same card and the same action be triggered more than once?** Repetition is where
narration drifts. Two runs of the same rule, described twice from memory, can leave two different
files with two different names — and the player who re-reads the first one has been told something
that is no longer true.

**3. Must the player see the consequence before they decide?** A published four-tier table on the
card is a promise. A promise needs a mechanism; memory is not a mechanism. If you wrote
"1-12: great success, 13-60: success" on the card, the player has already been shown what they
are buying.

**If all three are no, do NOT write a command.** A command that runs once is permanent world
complexity for one beat: it enters the command list, it enters the translation question, and the
next writer reads it as precedent. A one-off consequence belongs in chalk.

## Two files, two edits — and the second one is the one people forget

The command file and the binding are different files, and neither does anything alone.

1. **Write the command** at `command/<id>.yaml`. The id comes from the filename. Four top-level
   keys, nothing else: `name`, `desc`, `params`, `do`. Effects are verbs — `give`, `move`, `edit`,
   `set_status`, `consume`, `enter`, `link` — never action-method names.
2. **Read it back before you bind it.** A command that parses is a command that can run; a command
   that does not parse will fail at the moment a player rolls, where you cannot fix it.
3. **Bind it on the entity that should trigger it**, with a second edit:

   ```yaml
   on:
     roll_resolved:
       - when: "13..60"
         run: investigate-clue
         from: dice_outcomes
   ```

   `from` names a key **on this same entity** whose list holds the per-entry content. The command
   file holds the rule; the entity holds the words. That is why one command can serve thirty-six
   cards — you read their text with `{{ trigger.entry.* }}` instead of copying it in.

**What skipping step 3 looks like**: the command exists, sits in `command/`, and nothing ever
calls it. Every technical signal is green — the file parses, the id is legal, the directory is
right — and the outcome a player was promised simply never happens. There is no error to notice,
which is what makes it the most expensive mistake in this file.

## Reading the entity's own content

Content stays on the entity; the rule stays in the command. Reference it with a static path:

```yaml
do:
  - action: give
    with:
      rewards: "{{ trigger.entry.rewards }}"
```

The array is passed whole — the engine iterates it, you do not write a loop. Indexing with a
literal (`{{ trigger.entry.rewards[0].title }}`) is legal; a computed index is not, because it
would make the amount of work impossible to know before running.

## What a wrong write costs, and what you get back

Writing a command file, or an entity with a bad `on`, is refused — and the refusal comes back to
you in the same turn with the line, the column, and the legal alternatives. Nothing was written to
disk, so sending the whole file again is safe and is usually faster than patching.

The one thing that is **not** checked is whether the effect can actually happen when it runs: a
path that points at a file that does not exist yet, a resource the player does not have, a
`status` key nothing sets. Those fail at trigger time, visibly, to the player and to you. Write
against things you have looked at, not against things you expect to exist.

## Where the rest is written down

The exact fields, limits, template roots, and every error code live in `docs/command/01` (the
command file) and `docs/command/02` (`on`). The effect list, with each effect's arguments and guard
conditions, is in `references/effects.md`. Read those rather than reconstructing the syntax from
this page — this page is the judgment, those are the contract.
