---
type: readme
name: The Dock
bg: assets/scenes/dock.webp
title: The Dock
intent: "Toma keeps the pier and the ferry radio; Kenta's boatyard is beside it,
  the old fishing boat upturned there waiting for wood (progress: boat_progress
  in world/README.md). The ferry comes every Monday from morning to midday,
  never in a storm. Fishing runs command/go-fishing.yaml; keeping Toma company
  runs command/chat-toma.yaml; boarding enters world/ferry."
choice:
  options:
    - id: fish
      label: Fish off the end of the pier
    - id: keep-toma-company
      label: Keep Toma company on the pier
    - id: board
      label: Step onto the ferry deck
  allow_free: true
choice_actions:
  board:
    kind: enter
    target: world/ferry
on:
  choice_selected:
    - when: choice.option_id == "fish"
      run: go-fishing
      on_error: continue
    - when: choice.option_id == "keep-toma-company"
      run: chat-toma
      on_error: continue
---

A wooden pier runs out into the sea, sun-bleached rope wound around its bollards. In the hut at the end, a radio crackles now and then.

In the boatyard beside it, an old fishing boat lies belly-up, waiting for someone to patch it.
