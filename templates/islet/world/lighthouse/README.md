---
type: readme
name: The Lighthouse
bg: assets/scenes/lighthouse.webp
title: The Lighthouse
intent: "Grandma Suzu's domain. Her weather-reading is never wrong: the
  \"tomorrow's weather\" in your context is something only she may say aloud,
  and only in a weather-reader's words (the clouds, the wind, the seabirds),
  never as a forecast. Climbing up to keep her company runs
  command/visit-lighthouse.yaml. The Year-End Tea on the last day of winter is
  held here."
choice:
  options:
    - id: climb
      label: Climb up and watch the sky with Grandma Suzu
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "climb"
      run: visit-lighthouse
      on_error: continue
---

The white lighthouse stands on the island's highest headland, its spiral stair winding up and up. The lamp-room glass is spotless; a telescope points out over the western sea.

In the little room at its foot there is an old clock and a notebook of weather kept for decades.
