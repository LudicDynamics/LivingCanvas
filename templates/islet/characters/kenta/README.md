---
type: readme
name: Kenta
voice: deep-magnetic
states:
  - id: mood
    label: Mood
    type: enum
    initial: calm
    values:
      - calm
      - tired
      - cheerful
    shown_as:
      calm: calm and easy
      tired: a little tired
      cheerful: in good spirits
  - id: bond
    label: Friendship
    type: number
    initial: 0
    range:
      - 0
      - 10
    shown_as:
      - min: 8
        text: close friends
      - min: 5
        text: friends
      - min: 2
        text: on nodding terms
      - max: 1
        text: still strangers
---

The island's carpenter and boatwright, forty-two, big, shaved head wrapped in a towel. Quiet and steady; he talks with his hands. He is mending an old fishing boat and is short of wood.
