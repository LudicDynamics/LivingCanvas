---
type: gate
name: Magic Materials · What Will You Make?
title: Magic Materials · What Will You Make?
intent: Ask freely for verbs, target items, desired results, and acceptable
  costs. Confirm item existence and possession and record the combo proposal.
  Choosing alone does not auto-cast.
choice:
  options:
    - id: action-1
      label: Propose a combination
    - id: action-2
      label: Look at the materials
choice_actions:
  action-1:
    kind: writer
  action-2:
    kind: read
    paths:
      - world/spell-atlas/star-fragment.md
      - world/spell-atlas/small-hand-mirror.md
      - world/spell-atlas/reflection-fragment.md
bg: assets/scenes/academy-library.webp
map:
  plan:
    picture: assets/maps/spell-atlas.webp
    pins:
      star-fragment: [0.25, 0.35]
      small-hand-mirror: [0.4, 0.23]
      opening-fragment: [0.6, 0.25]
      reflection-fragment: [0.75, 0.36]
      librarian: [0.7, 0.57]
      player: [0.5, 0.85]
---

You have star fragments, a hand mirror, and two magic words, "Open" and "Reflect." Read what the materials say first.

A short proposal like "I want the hand mirror to reflect the starry sky" is fine. First we'll work out what it can do and what it will cost; the spell is cast only once you agree. Just talking it over won't cost you anything important.
