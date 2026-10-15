---
type: chalk
title: Slip aboard and search the empty hold
roll_dice:
  type: 2d10
  desc: Slip aboard and search the empty hold
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
    text: Silver Kite's hand closes on your collar at the top of the gangway. He says nothing about the hold — only that the ship is closed to you. If you want to know what it carried, you will have to face him.
    options:
      - id: face-silver-kite
        label: Face Silver Kite
        action:
          kind: character
          character: silver-kite
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/seventh-berth/gangway-warning.md
        title: Silver Kite's warning
        body: |-
          Silver Kite caught you boarding the empty ship. He has closed the gangway to you.

          He will talk about the hold only if you come to him openly: show him the scrape record and say why you went aboard.
  - min: 5
    max: 10
    text: No time for the hold. From the scrape above the high-tide line you peel a flake of tar-black paint that is not this ship's. Another hull pressed against it — the flake cannot say whose.
    options:
      - id: to-workshop
        label: Compare the flake at the workshop
        action:
          kind: enter
          target: world/harbor-chart/workshop
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/seventh-berth/hull-paint-flake.md
        title: Flake of another ship's paint
        body: |-
          Tar-black paint peeled from the scrape above the high-tide line. It does not match the empty ship's hull; another ship pressed against it.

          It proves there was a second ship, not whose. The rudder part at the workshop may say more.
  - min: 11
    max: 17
    text: "The hatch gives. Inside: ballast stones and empty crates nailed shut, nothing else. Nobody sails a ship full of stones for profit — it was sent out empty, on purpose, so every eye would turn to Berth 7."
    options:
      - id: show-silver-kite
        label: Show Silver Kite what you found
        action:
          kind: character
          character: silver-kite
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/seventh-berth/ballast-stone.md
        title: Ballast stone from the empty hold
        body: |-
          The hold held only ballast and nailed-shut empty crates.

          The ship was sent out empty on purpose: a decoy to draw every eye to Berth 7 while something else moved elsewhere.
  - min: 18
    max: 20
    text: "The hatch gives, and under your lantern the ballast stones show a stamp: the old customs yard's mark. The decoy was loaded where the old customs tunnel opens out."
    options:
      - id: to-lighthouse
        label: Ask at the lighthouse when the tunnel could be used
        action:
          kind: enter
          target: world/harbor-chart/old-lighthouse
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/seventh-berth/customs-stamped-ballast.md
        title: Ballast stone with the old customs stamp
        body: |-
          Ballast from the empty hold, stamped with the old customs yard's mark. The ship was sent out empty on purpose, and loaded at the yard where the old tunnel opens.

          The decoy and the tunnel belong to one plan. The lighthouse log says when that tunnel could be used.
---

Silver Kite is changing the watch. For a minute the gangway is unguarded — long enough to slip aboard the empty ship and open its hold.

What is at stake is what you carry off the ship. A good roll finds what the ship was really loaded with. A poor one gets you only a scrap from the hull. A bad one gets you caught, and Silver Kite closes the ship to you.

Free, no roll needed: reading the scrape record, and asking Silver Kite about the box.

2d10: roll two ten-sided dice. 11 or more succeeds.
2–4 (6%): Silver Kite catches you. You leave with his warning, not a clue; to learn about the hold now, you must face him.
5–10 (39%): No time for the hold. A flake of another ship's paint from the scrape — it proves a second hull, not whose.
11–17 (49%): The hold holds only ballast and empty crates. A ballast stone proves the ship was sent out empty on purpose.
18–20 (6%): The ballast carries the old customs yard's stamp. The decoy was loaded where the old tunnel opens.

One roll only. What you find is left here as an item to take.
