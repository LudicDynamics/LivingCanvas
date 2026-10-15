---
type: gate
name: Car 2 · Hard Seat Car
bg: assets/scenes/seated-car.webp
title: Car 2 · Hard Seat Car
intent: The only car of the prologue. Su He's seat (17) and the player's seat (18) are here. After the first turn the engine drops su-he-notebook.md; the dice for questioning passengers comes from the search declaration; once asked (or by turn eight) the engine drops freight-door.md, the door to Car 5. Never open a door, drop a card or declare an ending through narration; never name any suspect.
choice:
  options:
  - id: ask-student
    label: Roll to question the student in seat 20 who is still awake
  allow_free: true
choice_actions:
  ask-student:
    kind: search
    spot: scene
search:
- id: scene
  skill: persuade
  label: Roll to question the student in seat 20 who is still awake
  title: Question the nearby passengers
  body: |-
    Most people are asleep. The only ones awake are the student in seat 20, and a few people you woke up who are not too pleased.

    1d100 (Persuade 60): roll at or under your skill; lower is better.
    96–100 (5%): Too much noise, you alerted people. You only get half a clue, and it costs two extra steps of time.
    61–95 (35%): It didn't go smoothly. You only get half a clue, and it costs one extra step of time.
    13–60 (48%): Success. You get the clue; it costs only one step of time.
    1–12 (12%): Great success. You get the clue, notice a little more, and are so quick it costs no time.

    Each card can be rolled only once; no rerolls.
  roll_dice:
    type: 2d10
    desc: Question the nearby passengers
    expect: '>=11'
  dice_outcomes:
  - min: 2
    max: 4
    text: You wake people one after another; the car fills with complaints and someone shouts for the conductor. By the time Xia Cheng has calmed everyone down, a good while is gone. Zhou Zihang, the student in seat 20, will only say that around 12:50 someone helped Su He toward the rear, unsteady on her feet. Who it was, he "didn't see."
    options:
    - id: talk
      label: Tell Xia Cheng
      say: "Only half of it: someone helped Su He toward the rear, and he didn't see who."
      action:
        kind: character
        character: xia-cheng
    rewards:
    - &id001
      path: world/seated-car/witness-half.md
      title: Half a clue · Someone took her to the rear
      partial: true
      body: 'Student Zhou Zihang (Car 2 seat 20): around 12:50 someone helped Su He toward the rear of the train; her steps were unsteady. He didn''t see who it was.'
    cost:
      clock: -1
  - min: 5
    max: 10
    text: Everyone you ask says they were asleep. When you finally reach Zhou Zihang he is wary of strangers, and only says that around 12:50 someone helped Su He toward the rear, unsteady on her feet.
    options:
    - id: talk
      label: Tell Xia Cheng
      say: "Only half of it: someone helped Su He toward the rear, and he didn't see who."
      action:
        kind: character
        character: xia-cheng
    rewards:
    - *id001
  - min: 11
    max: 17
    text: 'You go straight to Zhou Zihang, who is awake. He takes out one earbud: not long after the train stopped, around 12:50, a gray-haired old man in a gray wool coat helped Su He toward the rear, saying she was "carsick, taking her to the back for some air." Su He was unsteady, as if she hadn''t woken up.'
    options:
    - id: talk
      label: Tell Xia Cheng
      say: "Got it: a grey-haired old man in a grey wool coat helped her toward the rear."
      action:
        kind: character
        character: xia-cheng
    rewards:
    - &id002
      path: world/seated-car/witness-account.md
      title: Zhou Zihang's Testimony
      body: 'Student Zhou Zihang (Car 2 seat 20): around 12:50, a gray-haired old man in a gray wool coat helped Su He toward the rear of the train, saying she was "carsick, taking her to the back for some air." Su He''s steps were unsteady, as if she hadn''t woken up. He didn''t see the old man''s face clearly.'
  - min: 18
    max: 20
    text: 'You go straight to Zhou Zihang, who is awake. He takes out one earbud: not long after the train stopped, around 12:50, a gray-haired old man in a gray wool coat helped Su He toward the rear, saying she was "carsick, taking her to the back for some air." Su He was unsteady, as if she hadn''t woken up. He also caught a smell of camphor on the old man, like clothes kept at the bottom of a trunk. You asked the right person at once: this check costs no time.'
    options:
    - id: talk
      label: Tell Xia Cheng
      say: "Got it: a grey-haired old man in a grey wool coat helped her toward the rear."
      action:
        kind: character
        character: xia-cheng
    rewards:
    - *id002
    bonus:
      clock: 1
  'on':
    roll_resolved:
    - run: train-step
map:
  plan:
    picture: assets/maps/seated-car.webp
    pins:
      su-he-notebook:
      - 0.41
      - 0.41
      witness-account:
      - 0.67
      - 0.43
      witness-half:
      - 0.67
      - 0.43
      freight-car:
      - 0.93
      - 0.45
      xia-cheng:
      - 0.3
      - 0.6
      player:
      - 0.5
      - 0.74
---

1:10 a.m. The K7 last train to Lingkou has stopped in the middle of Broken Cloud Tunnel, lit only by its emergency lights.

Seat 17 beside you is empty; a canvas bag and a thermos are still on it. The conductor, Xia Cheng, stands in the aisle with her flashlight on the empty seat.
