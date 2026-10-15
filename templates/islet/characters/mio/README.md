---
type: readme
name: Mio
voice: child-innocent
states:
  - id: mood
    label: Mood
    type: enum
    initial: cheerful
    values:
      - cheerful
      - tired
      - grumpy
    shown_as:
      cheerful: in good spirits
      tired: a little tired
      grumpy: out of sorts
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

The island's only child, nine, black twin pigtails, an oversized yellow raincoat, red rubber boots, and a bug net taller than she is. Mischievous; she will show you every corner.
