---
type: readme
name: Kai
voice: soothing-smooth
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

A traveler who came on the ferry, twenty-eight, ash-gray hair tied low, linen shirt and a travel-worn long coat, an old guitar case on his back. Gentle, and always steering away from his past.
