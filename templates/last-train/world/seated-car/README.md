---
type: gate
name: Car 2 · Hard Seat Car
bg: assets/scenes/seated-car.webp
title: Car 2 · Hard Seat Car
intent: "Act One (the entry). Su He's seat (17) and the player's seat (18) are
  both here. Beats: Xia Cheng speaks first → the player picks up the notebook →
  rolls to ask the student in seat 20 (the roll is how his account is got; going to
  talk to him is no longer a default option) → gets his account → heads to
  Car 3, the sleeper, or back to the train map (once he has the account, or
  after four beats in this car, both exits lead the options). Student Zhou Zihang
  (20) is NPC card zhou-zihang.md (click him to \"Talk\"), and can only speak of
  what is in witness-account.md: he didn't see the old man's face clearly, and
  only remembers the grey wool coat and greying hair."
status:
  data:
    exits: "no"
choice:
  options:
    - id: go-sleeper
      label: Go to the sleeper at the rear (Car 3)
      when: exits == "open"
    - id: go-train
      label: Back to the whole train
      when: exits == "open"
    - id: take-notebook
      label: Pick up the notebook Su He left behind
    - id: search
      label: Roll to ask the student in seat 20 who's still awake
    - id: ask-who
      label: Who is Su He?
      to: xia-cheng
      say: Who is Su He? Do you know her?
  allow_free: true
choice_actions:
  go-sleeper:
    kind: enter
    target: world/sleeper
  go-train:
    kind: enter
    target: map
  take-notebook:
    kind: take
    paths:
      - world/seated-car/su-he-notebook.md
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: persuade
    label: Roll to ask the student in seat 20 who's still awake
    title: Question the nearby passengers
    body: >-
      Most people are asleep. The only ones awake are the student in seat 20,
      and a few people you woke up who are not too pleased.


      1d100 (Persuade 60): roll at or under your skill; lower is better.

      96–100 (5%): Too much noise, you alerted people. You only get half a clue,
      and it costs two extra steps of time.

      61–95 (35%): It didn't go smoothly. You only get half a clue, and it costs
      one extra step of time.

      13–60 (48%): Success. You get the clue; it costs only one step of time.

      1–12 (12%): Great success. You get the clue, notice a little more, and are
      so quick it costs no time.


      Each roll brings departure one step closer (failure adds one more step; a
      great success wins it back). The same card can only be rolled once; no
      rerolls. Not ready to ask yet? Don't roll, and stay in this car.
    roll_dice:
      type: 2d10
      desc: Question the nearby passengers
      expect: ">=11"
    choice:
      options:
        - id: back
          label: Not yet
    choice_actions:
      back:
        kind: enter
        target: world/seated-car
    dice_outcomes:
      - min: 2
        max: 4
        text: You wake people one by one, the car fills with complaints, and someone
          goes to fetch the conductor to complain about you. By the time Xia
          Cheng has calmed everyone down a good while is lost, and Zhou Zihang
          has put his headphones back on. All he will say is that around 12:50
          someone helped Su He toward the rear of the train. Who it was, he
          "didn't notice."
        options:
          - id: tell
            label: Tell Xia Cheng
            to: xia-cheng
            say: "Only half of it: someone helped Su He toward the rear, and he won't say
              who."
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: Return to the train
            action:
              kind: enter
              target: map
          - id: to-rear
            label: Go toward the rear (Car 3, the sleeper)
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-half.md
            title: Half a clue · Someone took her to the rear
            partial: true
            body: "Student Zhou Zihang (Car 2 seat 20): around 12:50 someone helped Su He
              toward the rear of the train; her steps were unsteady. He would
              not say who it was."
        cost:
          clock: -1
      - min: 5
        max: 10
        text: "Several people you ask all say they were asleep. When you finally get to
          Zhou Zihang he is wary of a stranger: all he says is that around 12:50
          someone helped Su He toward the rear of the train, and that her steps
          were unsteady."
        options:
          - id: tell
            label: Tell Xia Cheng
            to: xia-cheng
            say: "Only half of it: someone helped Su He toward the rear, and he won't say
              who."
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: Return to the train
            action:
              kind: enter
              target: map
          - id: to-rear
            label: Go toward the rear (Car 3, the sleeper)
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-half.md
            title: Half a clue · Someone took her to the rear
            partial: true
            body: "Student Zhou Zihang (Car 2 seat 20): around 12:50 someone helped Su He
              toward the rear of the train; her steps were unsteady. He would
              not say who it was."
      - min: 11
        max: 17
        text: "You go straight over to Zhou Zihang, who is still awake. He says: not
          long after the stop, around 12:50, a gray-haired old man in a gray
          wool coat helped Su He toward the rear of the train, saying she was
          \"carsick, taking her to the back for some air.\" Su He's steps were
          unsteady, as if she hadn't woken up."
        options:
          - id: tell
            label: Tell Xia Cheng
            to: xia-cheng
            say: "Got it: a grey-haired old man in a grey wool coat helped her toward the
              rear."
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: Return to the train
            action:
              kind: enter
              target: map
          - id: to-rear
            label: Go toward the rear (Car 3, the sleeper)
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-account.md
            title: Zhou Zihang's Testimony
            body: "Student Zhou Zihang (Car 2 seat 20): around 12:50, a gray-haired old man
              in a gray wool coat helped Su He toward the rear of the train,
              saying she was \"carsick, taking her to the back for some air.\"
              Su He's steps were unsteady, as if she hadn't woken up. He didn't
              see the old man's face clearly."
      - min: 18
        max: 20
        text: "You go straight over to Zhou Zihang, who is still awake. He says: not
          long after the stop, around 12:50, a gray-haired old man in a gray
          wool coat helped Su He toward the rear of the train, saying she was
          \"carsick, taking her to the back for some air.\" Su He's steps were
          unsteady, as if she hadn't woken up. He also smelled camphor on the
          old man, like old clothes from the bottom of a trunk. You went
          straight to the right person: this check costs no time."
        options:
          - id: tell
            label: Tell Xia Cheng
            to: xia-cheng
            say: "Got it: a grey-haired old man in a grey wool coat helped her toward the
              rear."
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: Return to the train
            action:
              kind: enter
              target: map
          - id: to-rear
            label: Go toward the rear (Car 3, the sleeper)
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-account.md
            title: Zhou Zihang's Testimony
            body: "Student Zhou Zihang (Car 2 seat 20): around 12:50, a gray-haired old man
              in a gray wool coat helped Su He toward the rear of the train,
              saying she was \"carsick, taking her to the back for some air.\"
              Su He's steps were unsteady, as if she hadn't woken up. He didn't
              see the old man's face clearly."
        bonus:
          clock: 1
    on:
      roll_resolved:
        - run: train-step
map:
  plan:
    picture: assets/maps/seated-car.webp
    pins:
      zhou-zihang:
        - 0.78
        - 0.5
      su-he-notebook:
        - 0.41
        - 0.41
      witness-account:
        - 0.67
        - 0.43
      player:
        - 0.5
        - 0.74
view: canvas
passive:
  - id: drag-marks
    skill: spot_hidden
    say: "Under seat 17 there are two faint heel drag marks on the floor, heading towards the rear."
---

Most of the hard-seat car is asleep, a few people snoring under their coats. On seat 17 sit a canvas bag, a thermos and an open notebook.

Two seats away, Zhou Zihang, a student, sits with his earphones in. He doesn't look like he has slept at all.
