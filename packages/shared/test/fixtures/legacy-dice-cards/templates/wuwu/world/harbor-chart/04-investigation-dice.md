---
type: chalk
title: Search the fog from the harbor mouth
roll_dice:
  type: 2d10
  desc: Search the fog from the harbor mouth
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
    text: Your foot slides on the wet stones, your lantern swings, and the harbor watch shouts from the pier. The fog closes. You saw nothing, and searching from the harbor mouth is closed to you tonight.
    options:
      - id: lay-out-clues
        label: Lay out your clues instead
        action:
          kind: read
          paths:
            - world/harbor-chart/02-two-wakes.md
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/harbor-watch-notice.md
        title: Harbor watch's notice
        body: |-
          The harbor watch saw your lantern on the breakwater. No more searching from the harbor mouth tonight.

          The second ship can still be found: lay out the clues you have, and ask Old Mo for the lighthouse's light.
  - min: 5
    max: 10
    text: No ship. But a line of churned foam and a fresh wet mark on the breakwater stones say something large passed close, heading along the shore toward the old customs side.
    options:
      - id: follow-tide-mark
        label: Follow the tide mark on foot
        action:
          kind: writer
          prompt: "Read the actual roll and this card, world/harbor-chart/04-investigation-dice.md, and the item it dropped, world/harbor-chart/tide-mark-rubbing.md (or wherever the player moved it). The roll found only a tide mark, not the ship. Generate a short on-foot scene world/harbor-chart/tidal-approach/ that follows the mark toward the old customs side: README, two objects, a Chalk with actions, and a return gate. Do not reveal the second ship or the shore path here. Image later. Do not regenerate if the text already exists."
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/tide-mark-rubbing.md
        title: Rubbing of a fresh tide mark
        body: |-
          No ship was seen. But churned foam and a fresh mark on the breakwater stones show something large passed close.

          The mark points along the shore toward the old customs side. It can be followed on foot.
  - min: 11
    max: 17
    text: "For one breath the fog thins: a dark ship without lights, riding low, turning toward a path along the shore."
    options:
      - id: follow-the-ship
        label: Follow the ship beyond the fog
        action:
          kind: writer
          prompt: "Read the actual roll and this card, world/harbor-chart/04-investigation-dice.md, and the item it dropped, world/harbor-chart/second-ship-outline.md (or wherever the player moved it). The roll sighted the second ship. Generate the first shore path world/harbor-chart/beyond-the-fog/ from its outline: README, two objects, a Chalk with actions, and a return gate. No introduction letter for this result. Image later. Do not regenerate if the text already exists."
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/second-ship-outline.md
        title: Outline of the second ship
        body: |-
          For a moment the fog thinned: a dark ship without lights, riding low, turning toward a path along the shore.

          The second ship is real. The shore path is where it went.
  - min: 18
    max: 20
    text: The fog thins and the dark ship shows — and on the shore path a small lantern blinks back at you, twice. Someone out there saw it too, and is willing to meet you.
    options:
      - id: meet-the-lantern
        label: Follow the ship and meet the lantern
        action:
          kind: writer
          prompt: Read the actual roll and this card, world/harbor-chart/04-investigation-dice.md, and the item it dropped, world/harbor-chart/shore-lantern.md (or wherever the player moved it). The roll sighted the second ship and a contact. Generate world/harbor-chart/beyond-the-fog/ as for a success (README, two objects, a Chalk with actions, a return gate), and create player/introduction-letter.md from the person with the lantern, based only on the evidence the player holds. Image later. Do not regenerate if the text already exists.
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/shore-lantern.md
        title: A lantern that answered
        body: |-
          The dark ship showed through the fog, and a small lantern on the shore path blinked back twice.

          Someone on the shore path saw the ship too, and is willing to meet you.
---

Walk out onto the breakwater at the harbor mouth and search the fog for the second ship — without a light, on wet stones.

What is at stake is which way forward opens. A sighting opens the shore path beyond the fog. A near miss leaves only a tide mark to follow on foot. A slip gets you seen by the harbor watch and closes this shortcut, so the long way remains: lay out your clues and borrow the lighthouse's light.

Free, no roll needed: laying out the clues you have collected ("Search for the other ship"), reading any clue again, and asking the people here.

2d10: roll two ten-sided dice. 11 or more succeeds.
2–4 (6%): You slip and the harbor watch sees you. Nothing sighted; this shortcut is closed tonight. You keep the watch's notice.
5–10 (39%): No ship, but a fresh tide mark. You can follow it on foot along the shore.
11–17 (49%): You see the second ship's outline. The shore path beyond the fog opens.
18–20 (6%): The ship, and a lantern on the shore path answering you. The shore path opens, with someone willing to meet you.

One roll only. What you find is left here as an item to take, and the next step depends on it.
