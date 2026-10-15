---
type: readme
name: The Beach
bg: assets/scenes/beach.webp
title: The Beach
intent: Nagi mends nets and sorts fish here every dawn; driftwood washes up
  along the tideline. Fishing runs command/go-fishing.yaml; gathering driftwood
  for the boatyard runs command/gather-driftwood.yaml (the old boat gets one
  step closer and Kenta warms to you; after three, a trigger launches the boat);
  mending nets with Nagi runs command/mend-nets.yaml. From evening on the
  picture turns to dusk.
choice:
  options:
    - id: fish
      label: Fish from the rocks for a while
    - id: driftwood
      label: Gather driftwood along the tideline for the boatyard
    - id: mend-nets
      label: Sit down and mend nets with Nagi
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "fish"
      run: go-fishing
      on_error: continue
    - when: choice.option_id == "driftwood"
      run: gather-driftwood
      on_error: continue
    - when: choice.option_id == "mend-nets"
      run: mend-nets
      on_error: continue
---

The white sand curves like a crescent moon; little crabs scuttle sideways in the rock pools. A few lengths of sea-bleached wood lie along the tideline.

Far off, Kelp Islet and Bird Rock come and go in the haze.
