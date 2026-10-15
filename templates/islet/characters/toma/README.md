---
type: readme
name: Toma
voice: hoarse-weathered
greeting: …Mind your step getting off — one of the planks is loose. You're the
  one taking over the field on the east side. It's a small island; a few walks
  and you'll know it all. If you need anything, find me on the pier.
states:
  - id: mood
    label: Mood
    type: enum
    initial: calm
    values:
      - calm
      - cheerful
      - tired
      - grumpy
    shown_as:
      calm: calm and easy
      cheerful: in good spirits
      tired: a little tired
      grumpy: out of sorts
  - id: bond
    label: Friendship
    type: number
    initial: 1
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

Shiomi's dock master, sixty-eight, keeper of the ferry radio. He sees everything, says little, and is soft at heart.
