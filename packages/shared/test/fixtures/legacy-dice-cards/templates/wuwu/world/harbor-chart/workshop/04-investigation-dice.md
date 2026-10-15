---
type: chalk
title: Open the clasp in Vera's vise
roll_dice:
  type: 2d10
  desc: Open the clasp in Vera's vise
  expect: ">=11"
choice:
  options:
    - id: back
      label: Return to the map without rolling
choice_actions:
  back:
    kind: enter
    target: world/harbor-chart
dice_outcomes:
  - min: 2
    max: 4
    text: The pin snaps in the vise. The fresh scratch goes with the broken piece. The crest is still readable, but the part can no longer be matched to a ship by its marks — only Vera's memory of who orders these can.
    options:
      - id: tell-vera
        label: Tell Vera what broke
        action:
          kind: character
          character: vera
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/workshop/snapped-pin.md
        title: Snapped clasp pin
        body: |-
          The pin snapped while you opened the clasp. The fresh scratch was on the broken piece and is gone.

          The lord's crest is still readable. To tie this part to a ship now, ask Vera who orders rudder parts under that crest.
  - min: 5
    max: 10
    text: "The clasp opens, but rust hides the order stamp under the crest. You take a charcoal rubbing: the lord's crest, and a stamp too faint to read."
    options:
      - id: ask-vera
        label: Ask Vera who orders parts under this crest
        action:
          kind: character
          character: vera
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/workshop/crest-rubbing.md
        title: Rubbing of the crest and a rusted stamp
        body: |-
          A charcoal rubbing of the lord's crest and, beneath it, an order stamp too rusted to read.

          The crest says which house, not which ship. Vera may know who orders rudder parts under this crest.
  - min: 11
    max: 17
    text: The rust flakes away. Under the crest is an order stamp from the lord's household account — for a ship that is not in the harbor register.
    options:
      - id: to-berth
        label: Compare it with the scrape at Berth 7
        action:
          kind: enter
          target: world/harbor-chart/seventh-berth
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/workshop/order-stamp.md
        title: Order stamp inside the clasp
        body: |-
          Under the crest: an order number from the lord's household account, for a ship that is not in the harbor register.

          This does not prove the lord is the culprit. It proves the lord's house paid for a ship nobody has registered.
  - min: 18
    max: 20
    text: The stamp comes clean, and the fresh scratch sits exactly at the height of the scrape on the empty ship at Berth 7. This clasp was on the ship that pushed the decoy.
    options:
      - id: to-lighthouse
        label: Find out when that ship could pass
        action:
          kind: enter
          target: world/harbor-chart/old-lighthouse
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/workshop/matched-clasp.md
        title: Order stamp and a matching scratch
        body: |-
          An order number from the lord's household account, for a ship not in the harbor register — and a fresh scratch at the same height as the scrape at Berth 7.

          The unregistered ship is the one that pushed against the decoy. When it could slip past unseen is a question for the lighthouse.
---

The clasp is still in one piece. Opened in the vise, it may show the order stamp hidden under the crest — or the pin may snap and take the fresh scratch with it.

What is at stake is the clasp itself, and how much it can still prove. A good roll reads the stamp. A poor one gets only a rubbing of the crest. A bad one breaks the part, and only Vera's memory can tie it to a ship.

Free, no roll needed: reading the description of the part, and asking Vera about the owner.

2d10: roll two ten-sided dice. 11 or more succeeds.
2–4 (6%): The pin snaps and the fresh scratch is lost. You keep the broken pin; ask Vera instead.
5–10 (39%): Rust hides the stamp. You keep a rubbing of the crest; Vera may know who orders these.
11–17 (49%): The stamp reads clean: the lord's household account, for a ship not in the harbor register.
18–20 (6%): The stamp, and the fresh scratch matches the height of the scrape at Berth 7.

One roll only. What you find is left here as an item to take.
