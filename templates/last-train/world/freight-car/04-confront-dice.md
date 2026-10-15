---
type: chalk
title: Confront Zhong Huaili
roll_dice:
  type: 2d10
  desc: Confront Zhong Huaili and seize the logbook page
  expect: ">=11"
choice:
  options:
    - id: back
      label: Don't roll yet; go back to the train
choice_actions:
  back:
    kind: enter
    target: map
on:
  roll_resolved:
    - run: train-step
dice_outcomes:
  - min: 2
    max: 4
    harm: serious
    text: He is faster than you. The logbook page goes into the stove; you lunge to snatch it, he shoves you away, your back hits the sharp edge of the tin stove, and you fall into the pile of mail sacks, gasping for a long while. You only tear a scorched corner out of the stove mouth, and the back of your hand is burned too. Zhong Huaili takes the confusion to return to the sleeper car. That corner alone will not convince the dispatcher - you will still need his pill board and the dining car receipt.
    options:
      - id: radio
        label: Go to the radio in the cab
        action:
          kind: enter
          target: world/cab
      - id: back
        label: Return to the train
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/torn-corner.md
        image: assets/items/torn-corner.webp
        title: Scorched corner
        body: The scorched corner left from the burned logbook page. You can make out half of the "Zhong" signature and the words "proceed past the red signal..." It shows Zhong Huaili wanted to burn something, but this corner alone won't convince the Lingkou dispatcher.
        partial: true
  - min: 5
    max: 10
    harm: light
    text: 'He shoved the logbook page into the stove. Your hands had long since gone numb in this unheated car; you reached into the stove mouth twice before you caught it, blisters rising on your fingers, and only pulled out the scorched corner: you can still make out half of the "Zhong" signature and the words "proceed past the red signal..." Zhong Huaili said nothing more and turned back to the sleeper car. That corner alone will not convince the dispatcher - you will still need his pill board and the dining car receipt.'
    options:
      - id: radio
        label: Go to the radio in the cab
        action:
          kind: enter
          target: world/cab
      - id: back
        label: Return to the train
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/torn-corner.md
        image: assets/items/torn-corner.webp
        title: Scorched corner
        body: The scorched corner left from the burned logbook page. You can make out half of the "Zhong" signature and the words "proceed past the red signal..." It shows Zhong Huaili wanted to burn something, but this corner alone won't convince the Lingkou dispatcher.
        partial: true
  - min: 11
    max: 17
    text: "You caught his wrist before he could move. The logbook page fell onto the mail sacks: the train logbook from November twelve years ago, \"01:12 received Dispatcher Zhong Huaili's verbal order: proceed past the red signal.\" Zhong Huaili let go and leaned against the door frame."
    options:
      - id: radio
        label: Go to the radio in the cab
        action:
          kind: enter
          target: world/cab
      - id: back
        label: Return to the train
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/logbook-page.md
        image: assets/items/logbook-page.webp
        title: Su Changgeng's logbook page
        body: "November 7, twelve years ago, Broken Cloud Tunnel signal station. \"01:12 received Dispatcher Zhong Huaili's verbal order: Train K7 proceed past the red signal. I raised an objection; the dispatcher insisted.\" Below is Su Changgeng's signature. After the accident, this page disappeared from the archives."
  - min: 18
    max: 20
    text: 'You have the logbook page, and Zhong Huaili does not try to snatch it again. He sits down on the mail sacks and says one sentence: "I waited twelve years for someone to come and ask." It was over in a moment: this check costs no time.'
    options:
      - id: radio
        label: Go to the radio in the cab
        action:
          kind: enter
          target: world/cab
      - id: back
        label: Return to the train
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/logbook-page.md
        image: assets/items/logbook-page.webp
        title: Su Changgeng's logbook page
        body: "November 7, twelve years ago, Broken Cloud Tunnel signal station. \"01:12 received Dispatcher Zhong Huaili's verbal order: Train K7 proceed past the red signal. I raised an objection; the dispatcher insisted.\" Below is Su Changgeng's signature. After the accident, this page disappeared from the archives."
    bonus:
      clock: 1
skill_check:
  skill: fighting
  label: Fighting (Brawl)
  system: coc
  actor: player
  difficulty: regular
  target: 60
  value: 60
---

Zhong Huaili stands in the doorway holding an emergency lamp, coal ash on his grey wool coat. His right hand is pressed against the inside pocket of the coat. "Young man, close the door, it's cold in here."

The tin stove in the corner is still burning, and he is only two steps from it. This is the decisive roll: seize the logbook page and you have ironclad proof; fail, and you can only link him to this affair through the pill board and the receipt.

1d100 (Fighting (Brawl) 60): roll at or under your skill; lower is better.
96-100 (5%): The logbook page is burned, you only snatch out the scorched corner, and it costs one extra step of time; he shoves you away and you take a serious injury. Afterward you must make up the evidence with the pill board and the receipt.
61-95 (35%): The logbook page is burned, you only snatch out the scorched corner, and it costs one extra step of time; your numb hands are burned by the stove mouth (minor injury). Afterward you must make up the evidence with the pill board and the receipt.
13–60 (48%): Seize the logbook page, costing only one step of time.
1–12 (12%): Seize the logbook page so fast that it costs no time.

The same card can only be rolled once, no rerolls. If you do not want to act now, go back to the train first.
