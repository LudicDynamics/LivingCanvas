---
type: readme
name: Ren
voice: casual-drawl
states:
  - id: mood
    label: Mood
    type: enum
    initial: calm
    values:
      - calm
      - cheerful
      - tired
    shown_as:
      calm: calm and easy
      cheerful: in good spirits
      tired: a little tired
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

The young farmer next door, twenty-four, tall and lanky under a frayed straw hat. So shy he blushes mid-sentence, but a fine hand at farming — your teacher, more or less.
