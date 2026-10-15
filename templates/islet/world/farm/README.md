---
type: readme
name: Your Field
bg: assets/scenes/farm.webp
title: Your Field
intent: The field you have taken over; Ren's is next door. Tending it runs
  command/tend-farm.yaml (farm_growth in world/README.md goes up by one; at
  "ready to harvest" a trigger brings the harvest in, and the first harvest
  gives player/first-turnip.md). Helping Ren runs command/help-ren.yaml. The
  picture changes with the season (the engine's variants) — never describe
  another season.
choice:
  options:
    - id: tend
      label: Dig, water and tend your field
    - id: help-ren
      label: Go next door and help Ren for a while
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "tend"
      run: tend-farm
      on_error: continue
    - when: choice.option_id == "help-ren"
      run: help-ren
      on_error: continue
---

A sunny slope behind a low stone wall, weeds thick along its foot. Old tools lean against the shed, the hoe handle gone dark with use.

Next door, Ren's rows run neat and straight, as if laid out to show you how.
