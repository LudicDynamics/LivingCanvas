---
type: readme
name: "Harbor Office: Begin the Investigation"
title: "Harbor Office: Begin the Investigation"
bg: assets/scenes/intro.webp
intent: If accepted, move the physical world/commission-letter.md and world/investigator-badge.md to player/ under the same names. If one of them is already held, move only the missing one. After confirming what is actually held, guide the way to the Harbor Map.
choice:
  options:
    - id: action-1
      label: Take the commission and badge
    - id: action-2
      label: Read the commission
bgVideo: assets/motion/seedance/backgrounds/intro.webm
choice_actions:
  action-1:
    kind: take
    paths:
      - world/commission-letter.md
      - world/investigator-badge.md
  action-2:
    kind: read
    paths:
      - world/commission-letter.md
map:
  pins:
    harbor-chart:
      - 0.88
      - 0.4
    commission-letter:
      - 0.575
      - 0.83
    investigator-badge:
      - 0.4
      - 0.82
    vera:
      - 0.6
      - 0.58
    player:
      - 0.16
      - 0.9
  plan:
    picture: assets/maps/harbor-office.webp
    pins:
      harbor-chart:
        - 0.82
        - 0.36
      commission-letter:
        - 0.46
        - 0.48
      investigator-badge:
        - 0.53
        - 0.47
      vera:
        - 0.65
        - 0.3
      player:
        - 0.3
        - 0.83
---

The harbor office smells of cold iron and lamp oil. An unmanned ship, a missing person, a lighthouse that went dark the same night — someone wants you to find out whether all three are the same story.

Vera is already here, leaning on the desk where the commission and the badge lie. She's the one who wrote asking you to come, and she's been waiting long enough to have plenty to say.

The badge is your permit to move around the harbor. Take it, and she will show you the chart.

The tide board on the wall shows how many steps remain: once the tide comes in, the ship hidden in the fog will sail away. Pin every thread before then.
