---
type: gate
name: Car 5 · Baggage Car
bg: assets/scenes/freight-car.webp
title: Car 5 · Baggage Car
requires:
  items:
    - player/freight-key.md
blocked: The baggage car door is locked. You need the key with the red tag
  reading "Car 5" - it is missing from the key board in the cab, so search the
  other cars.
intent: 'Act Three. Su He is here: drugged, shivering with cold, but alive. She
  is NPC card su-he.md (click her to "Talk"), can only tell what is in
  su-he-testimony.md, and the only thing she can hand over is her testimony: she
  does not know how she got in, and does not know where the logbook page went.
  The decisive check is 04-confront-dice.md (Confront Zhong Huaili): 60 or under
  gets logbook-page, below 10 gets only torn-corner. Do not let narration
  outside the check hand over the logbook page.'
choice:
  options:
    - id: take-testimony
      label: Help Su He up and listen to her
    - id: confront
      label: Zhong Huaili is blocking the door — roll to stop him
    - id: back
      label: Return to the train
    - id: warm-her
      label: Warm her up first
      to: companion
      say: Xia Cheng, give her your padded coat — let's get her warm first.
  allow_free: true
choice_actions:
  take-testimony:
    kind: take
    paths:
      - world/freight-car/su-he-testimony.md
  confront:
    kind: read
    paths:
      - world/freight-car/04-confront-dice.md
  back:
    kind: enter
    target: map
map:
  plan:
    picture: assets/maps/freight-car.webp
    pins:
      su-he:
        - 0.24
        - 0.52
      su-he-testimony:
        - 0.35
        - 0.45
      04-confront-dice:
        - 0.83
        - 0.25
      player:
        - 0.5
        - 0.78
      06-radio-relay:
        - 0.62
        - 0.2
view: canvas
---

There's no heat in the baggage car; every breath comes out white. Mail sacks are heaped into a small mountain, and a tin stove in the corner still holds a little fire.

Someone is curled up among the mail sacks — it's Su He. Her lips are blue, but she is still breathing.

Behind you, the car door opens again.
