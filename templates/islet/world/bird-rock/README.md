---
type: gate
name: Bird Rock
bg: assets/scenes/bird-rock.webp
title: Bird Rock
requires:
  items:
    - player/boat-tiller.md
blocked: Bird Rock is all cliffs and hidden reefs; only a boat can land there.
  You will need the old boat mended first — help Kenta.
intent: The seabirds' island, reachable only once the boat is mended. In spring
  and summer thousands of birds nest on the cliffs. Grandma Suzu used to come
  here to count them when she was young. Exploring runs
  command/explore-islet.yaml. Do not disturb the colony, and put no danger here.
choice:
  options:
    - id: explore
      label: Walk slowly along the foot of the cliffs and watch the birds
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

The black cliffs are packed with nests; the seabirds' cries drown out the waves. Tufts of tiny white flowers grow in the cracks.

From here you can see all of Shiomi; the lighthouse is as small as a matchstick.
