---
type: gate
name: Car 3 · Sleeper Car
bg: assets/scenes/sleeper.webp
title: Car 3 · Sleeper Car
intent: "One thread of Act Two (the sleeper's puzzle: whose is the grey wool
  coat, and was he really asleep?). Zhong Huaili is in the lower berth of
  compartment 3. He is a registered character, and will lie that he took his
  medicine at 11:30 and went to sleep; he only loosens up when physical evidence
  is produced to his face, and will never voluntarily give up where the logbook
  page is. Search his compartment using the dice card; do not hand out the pill
  pack directly through narration. If the search falls short (61–100), the Long
  Way Around card 05-long-way.md opens (command/miss-sleeper.yaml); choosing it
  puts the pill pack in the bag for one more step of time
  (command/long-way-sleeper.yaml)."
choice:
  options:
    - id: read-coat
      label: Look at the coat hanging at the door of compartment 3
      once: true
    - id: search
      label: Roll to search compartment 3
    - id: talk
      label: Knock and talk to Zhong Huaili
      to: writer
    - id: ask-sleep
      label: You were asleep by eleven thirty?
      to: zhong-huaili
      say: Mr. Zhong, were you really asleep by eleven thirty?
    - id: ask-coat
      label: That coat by the door is yours, isn't it?
      to: zhong-huaili
      say: The grey wool coat hanging by the door — it's yours, isn't it?
  allow_free: true
choice_actions:
  read-coat:
    kind: read
    paths:
      - world/sleeper/grey-coat.md
  search:
    kind: search
    spot: scene
  talk:
    kind: character
    character: zhong-huaili
search:
  - id: scene
    skill: stealth
    label: Roll to search compartment 3
    title: Search compartment 3
    body: >-
      Zhong Huaili lies with his back to the door. You need to look at his berth
      without waking him.


      1d100 (Stealth 60): roll at or under your skill; lower is better.

      96–100 (5%): He wakes. You only get half a clue, and it costs two extra
      steps of time; a Long Way Around opens that still gets the pill pack, for
      one more step.

      61–95 (35%): It didn't go smoothly. You only get half a clue, and it costs
      one extra step of time; a Long Way Around opens that still gets the pill
      pack, for one more step.

      13–60 (48%): Success. You get the clue; it costs only one step of time.

      1–12 (12%): Great success. You get the clue, notice a little more, and are
      so quick it costs no time.


      Each roll brings departure one step closer (failure adds one more step; a
      great success wins it back). The same card can only be rolled once; no
      rerolls. If you do not want to spend time, do not roll yet and return to
      the train.
    roll_dice:
      type: 2d10
      desc: Search compartment 3
      expect: ">=11"
    choice:
      options:
        - id: back
          label: Don't roll yet; go back to the train
    choice_actions:
      back:
        kind: enter
        target: map
    dice_outcomes:
      - min: 2
        max: 4
        text: He wakes. Zhong Huaili sits up with his hand on the pillow and watches you
          without a word until you back out of the compartment. Then he presses
          the call button and keeps Xia Cheng and you in the corridor a long
          time over "a stranger going through my things." All you saw was the
          corner of a foil pill pack under his pillow. He already knows you are
          investigating him.
        options:
          - id: long-way
            label: "Long Way Around: have Xia Cheng call him out"
            action:
              kind: read
              paths:
                - world/sleeper/05-long-way.md
          - id: back
            label: Return to the train
            action:
              kind: enter
              target: map
          - id: to-dining
            label: Go to the dining car
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip-half.md
            title: Half a clue · a corner of foil
            partial: true
            body: "Under Zhong Huaili's pillow there is a foil pill pack. You only saw one
              corner of it: not the name on it, not how many are gone. He says
              he took his medicine at 11:30 and went to sleep."
        cost:
          clock: -1
      - min: 5
        max: 10
        text: You are too slow; he turns over, his hand landing right on the pillow, and
          you have to wait a long while before you can back out. All you saw was
          the corner of a foil pill pack under his pillow.
        options:
          - id: long-way
            label: "Long Way Around: have Xia Cheng call him out"
            action:
              kind: read
              paths:
                - world/sleeper/05-long-way.md
          - id: back
            label: Return to the train
            action:
              kind: enter
              target: map
          - id: to-dining
            label: Go to the dining car
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip-half.md
            title: Half a clue · a corner of foil
            partial: true
            body: "Under Zhong Huaili's pillow there is a foil pill pack. You only saw one
              corner of it: not the name on it, not how many are gone. He says
              he took his medicine at 11:30 and went to sleep."
      - min: 11
        max: 17
        text: Under the pillow is a pack of sleeping pills, with "Zhong Huaili" printed
          on the prescription. A ten-pill pack, two missing, the foil freshly
          torn.
        options:
          - id: press
            label: Two pills are missing from this strip
            to: zhong-huaili
            say: Two of your sleeping pills are gone. Someone who took two wouldn't sleep
              this lightly.
            action:
              kind: character
              character: zhong-huaili
          - id: back
            label: Return to the train
            action:
              kind: enter
              target: map
          - id: to-dining
            label: Go to the dining car
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip.md
            image: assets/items/pill-strip.webp
            title: Sleeping pills, two missing
            body: The sleeping pill pack under Zhong Huaili's pillow, with his name printed
              on the prescription. A ten-pill pack, two missing, the foil
              freshly torn. He said he took his medicine at 11:30 and went to
              sleep — but someone who took two sleeping pills should not sleep
              so lightly.
      - min: 18
        max: 20
        text: 'Under the pillow is a pack of sleeping pills, with "Zhong Huaili" printed
          on the prescription. A ten-pill pack, two missing, the foil freshly
          torn. His suitcase is half open, and inside is a speech draft for the
          twelfth-anniversary memorial service of the Broken Cloud Tunnel
          accident. You were in and out before he stirred: this search costs no
          time.'
        options:
          - id: press
            label: Two pills are missing from this strip
            to: zhong-huaili
            say: Two of your sleeping pills are gone. Someone who took two wouldn't sleep
              this lightly.
            action:
              kind: character
              character: zhong-huaili
          - id: back
            label: Return to the train
            action:
              kind: enter
              target: map
          - id: to-dining
            label: Go to the dining car
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip.md
            image: assets/items/pill-strip.webp
            title: Sleeping pills, two missing
            body: The sleeping pill pack under Zhong Huaili's pillow, with his name printed
              on the prescription. A ten-pill pack, two missing, the foil
              freshly torn. He said he took his medicine at 11:30 and went to
              sleep — but someone who took two sleeping pills should not sleep
              so lightly.
        bonus:
          clock: 1
    on:
      roll_resolved:
        - run: train-step
        - when: roll.rank <= 2
          run: miss-sleeper
          on_error: continue
map:
  plan:
    picture: assets/maps/sleeper.webp
    pins:
      grey-coat:
        - 0.53
        - 0.28
      pill-strip:
        - 0.64
        - 0.22
      zhong-huaili:
        - 0.58
        - 0.44
      player:
        - 0.5
        - 0.78
view: canvas
passive:
  - id: breath
    skill: listen
    say: "The breathing in compartment 3 is too even — not a man knocked out by pills, more like a man listening to the corridor."
    great:
      say: "Breathing too even for a man out cold on pills — he is listening to the corridor. And the bedside lamp shade is still warm: switched off a moment ago."
---

The sleeper car's aisle is narrow, and most compartment doors are shut. Only compartment 3 stands ajar, a gray wool coat hanging by the door.

The man inside lies with his back to the door, breathing very evenly — a little too evenly.
