---
type: readme
name: Nagi
voice: sassy-spunky
states:
  - id: mood
    label: Mood
    type: enum
    initial: cheerful
    values:
      - cheerful
      - tired
      - grumpy
      - calm
    shown_as:
      cheerful: in good spirits
      tired: a little tired
      grumpy: out of sorts
      calm: calm and easy
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

A seventeen-year-old fisher girl, sun-browned and freckled. Blunt, restless, out at sea before daybreak. Likely the first to warm to you.
