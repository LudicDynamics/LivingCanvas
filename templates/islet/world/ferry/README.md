---
type: readme
name: The Ferry Deck
bg: assets/scenes/ferry.webp
title: The Ferry Deck
intent: "The Monday ferry. On other days it rides at anchor in the bay with an
  empty deck. A traveler with a guitar (Kai) sits on deck until he decides to
  get off (trigger kai-arrives). Kelp Islet and Bird Rock need the mended boat
  (gate: player/boat-tiller.md); the writer keeps anyone from sailing in a
  storm."
choice:
  options:
    - id: to-kelp
      label: Take the mended boat to Kelp Islet
    - id: to-bird
      label: Take the mended boat to Bird Rock
    - id: back
      label: Back to the dock
  allow_free: true
choice_actions:
  to-kelp:
    kind: enter
    target: world/kelp-islet
  to-bird:
    kind: enter
    target: world/bird-rock
  back:
    kind: enter
    target: world/dock
---

The deck is hot underfoot; a life ring with half its paint gone hangs on the rail. Looking back from here, the whole island looks like a cat asleep on the sea.

Someone with an old guitar is often sitting by the rail.
