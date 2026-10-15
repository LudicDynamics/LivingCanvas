---
type: readme
name: Hana
voice: warm-cheerful
states:
  - id: mood
    label: Mood
    type: enum
    initial: cheerful
    values:
      - cheerful
      - calm
      - tired
    shown_as:
      cheerful: in good spirits
      calm: calm and easy
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

The shopkeeper, thirty-four, round glasses, a pencil behind her ear. Kind and nosy — every bit of island news passes through her.
