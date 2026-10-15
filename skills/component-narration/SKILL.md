---
name: component-narration
description: Use when choosing what carries a piece of the scene — when plain chalk is enough, when the thing must be a note the player can pick up, when it must be a sealed letter that opens into a second layer, and when to look up a component kind's schema with get_component first. Covers the click and the second layer.
---

# Narrating with components

A component is not a different kind of story. It is another voice of the narration: the player
reads a note the way they read a passage of chalk, except a note is a *thing* that can be picked
up, and a letter is a thing whose inside only exists once it is opened. Choose the carrier by what
the player must be able to *do* with the text, not by how important the text feels.

## The four carriers

**chalk — the default.** Anything the player only has to read: a scene's first look, a beat of
prose, the outcome of an action. If the passage is not a thing and hides nothing, it is chalk.

**note — a thing with a surface.** Keys, tickets, scraps, object cards. Use it when the player must
be able to carry it, hand it over, or use it on something. A note has no second layer: everything
the player will ever read sits on the card face.

**letter — a sealed thing.** Use it when there is a *surface* and an *inside*: the card face shows a
title and a one-line preview, and opening it reveals the full body and a signature. If the reveal is
the point of the beat, the reveal needs the second layer.

**a behaviour kind — a mechanism.** One of the sixteen gameplay kinds: `lock`, `container`, `trap`,
`mechanism`, `map`, `clock`, `tape`, `anchor`, `instrument`, `board`, `book`, `ledger`, `photo`,
`cipher`, `diary`, `thread`. These carry gameplay: they react, they hold things, they open when used.
**Call `get_component` with the kind before you write one** — it returns the exact frontmatter fields
for that kind and a minimal example.

## Criteria (ask these in order)

1. Must the player keep it, give it, or apply it to something? → **note** (or the behaviour kind
   that owns the reaction). If no, continue.
2. Is there something hidden behind the surface that the player should open? → **letter**.
   Everything else, continue.
3. Does it react on its own — a lock that opens, a container that holds, a board that has a state?
   → **`get_component` first**, then write the kind it names.
4. Otherwise → **chalk**.

## What each mistake looks like

- **A key written as chalk** → the player can never pick it up; every later "use the key" line is a
  dead end they cannot act on.
- **A sealed letter written as a note** → the whole text lands on the card face, there is nothing to
  open, and the click the scene was built around does nothing.
- **A component kind written from memory** → an unregistered kind falls back to a plain note, so the
  card renders bare with none of the planned sizes or interactions and the mechanic never exists.
  `get_component` costs one call and removes this class of failure entirely.
- **Everything written as a letter** → the world turns into a mailbox; the player spends the scene
  opening things instead of living in it.

## The second layer

The second layer is a modal the player opens by clicking the card. For a letter, the layer is the
four-part form: **title** (card face) → **preview** (the card-face teaser) → **body** (the full text,
either the `body` field or the markdown body — either is legal) → **sign** (the signature line). The
card face and the inside are two different surfaces: write the teaser so it makes the player want the
inside, and put nothing in the teaser that the inside is supposed to reveal.

Interactive fields — `status`, `choice`, `roll_dice` — can ride on *any* landed entity, chalk
included. They are not part of this skill: see `tool-craft` for how and when to attach them.

For the full set of landed kinds and the second-layer forms, read `references/component-kinds.md`.
