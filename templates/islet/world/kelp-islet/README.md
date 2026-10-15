---
type: gate
name: Kelp Islet
bg: assets/scenes/kelp-islet.webp
title: Kelp Islet
requires:
  items:
    - player/boat-tiller.md
blocked: A fast current runs between here and Kelp Islet; nobody swims it. You
  will need the old boat mended first — help Kenta.
intent: An islet you can reach only once the boat is mended; at low tide its
  kelp forest breaks the surface. Nobody lives here; Nagi sometimes sails over
  for kelp. Exploring runs command/explore-islet.yaml (most of an afternoon).
  Hide no treasure or secrets here — it is simply a beautiful, quiet place.
choice:
  options:
    - id: explore
      label: Wade through the shallows among the kelp
    - id: back
      label: Sail back to the ferry deck
  allow_free: true
choice_actions:
  back:
    kind: enter
    target: world/ferry
on:
  choice_selected:
    - when: choice.option_id == "explore"
      run: explore-islet
      on_error: continue
---

At low tide Kelp Islet is a green velvet rug, the kelp swaying slowly in the shallows. A few starfish sun themselves on the rocks.

There is no other sound here, only waves and wind.
