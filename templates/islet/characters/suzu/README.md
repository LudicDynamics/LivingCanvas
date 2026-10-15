---
type: readme
name: Suzu
voice: mature-elegant
states:
  - id: mood
    label: Mood
    type: enum
    initial: calm
    values:
      - calm
      - grumpy
      - cheerful
      - tired
    shown_as:
      calm: calm and easy
      grumpy: out of sorts
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

The old lighthouse keeper, seventy-six, silver hair in a neat bun, binoculars around her neck. Sharp-tongued, but her weather-reading is never wrong; on Shiomi the weather is whatever she says.
