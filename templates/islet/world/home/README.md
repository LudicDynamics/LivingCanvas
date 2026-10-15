---
type: readme
name: Your Cottage
bg: assets/scenes/home.webp
title: Your Cottage
intent: Where you live. Sleeping runs command/sleep.yaml (until the next dawn;
  the engine works out each islander's night). Nothing here pushes the player to
  sleep, and staying up costs nothing.
choice:
  options:
    - id: sleep
      label: Lie down and sleep until dawn
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "sleep"
      run: sleep
      on_error: continue
---

The cottage the last tenant left: a bed, a table, a small wood stove. A row of shells sits on the windowsill — nobody knows who collected them.

From the window you can just see the lighthouse beam sweep the sea.
