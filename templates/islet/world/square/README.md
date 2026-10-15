---
type: readme
name: The Village Square
bg: assets/scenes/square.webp
title: The Village Square
intent: Islanders like to sit here in the evening; there is a market on Sunday
  mornings, and the festivals (the Lantern Festival, the Harvest Supper) are
  held here. Playing with Mio runs command/play-with-mio.yaml; listening to Kai
  play runs command/listen-kai.yaml (before Kai lands he is not here, and the
  option is just you sitting a while).
choice:
  options:
    - id: play-mio
      label: Play with Mio for a while
    - id: listen-kai
      label: Sit in the shade and listen for a guitar
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "play-mio"
      run: play-with-mio
      on_error: continue
    - when: choice.option_id == "listen-kai"
      run: listen-kai
      on_error: continue
---

An old camphor tree spreads its shade over two benches and a well nobody uses anymore. The flagstone lanes branch off from here — one to the dock, one up to the lighthouse.

In the evening, when the lamp over Hana's door comes on, people drift over.
