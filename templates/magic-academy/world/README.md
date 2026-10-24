---
type: readme
name: Night Library · First Magic
title: Night Library · First Magic
intent: 'If received, move the name tag to player/. The failure story returns one concrete example but imposes no unconfirmed costs on the player. Endings are landed by the engine: walking back into the night library after an Open or Reflect spell has landed, or deciding to leave without casting. The writer never announces an ending.'
choice:
  options:
    - id: action-1
      label: Take your name tag
    - id: action-2
      label: Ask Seraphina about failed magic
choice_actions:
  action-1:
    kind: take
    paths:
      - world/freshman-badge.md
  action-2:
    kind: character
    character: seraphina
bg: assets/scenes/academy-library.webp
map:
  plan:
    picture: assets/maps/night-library.webp
    pins:
      spell-atlas: [0.84, 0.22]
      freshman-badge: [0.26, 0.4]
      seraphina: [0.6, 0.35]
      player: [0.22, 0.8]
---

You are a new student at the magic academy. Seraphina, your senior, is waiting between the shelves with a name tag in her hand, and she doesn't hand it over right away.

"Try combining familiar things to make your own magic. Tell me what you want to do, what you'll use, and what you're willing to give in exchange."

First, take your name tag and go to where the magic materials are kept. You can decide once you've seen what you have to work with.
