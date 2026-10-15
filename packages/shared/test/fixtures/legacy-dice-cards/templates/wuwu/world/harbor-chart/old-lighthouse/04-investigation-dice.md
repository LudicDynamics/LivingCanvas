---
type: chalk
title: Watch the tunnel mouth through Old Mo's spyglass
roll_dice:
  type: 2d10
  desc: Watch the tunnel mouth through Old Mo's spyglass
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
    text: The spyglass slips on the wet rail and cracks against the stone. Old Mo saw it. He will want an apology before he talks about that night again — and the tunnel mouth must now be checked some other way.
    options:
      - id: apologize
        label: Apologize to Old Mo
        action:
          kind: character
          character: old-mo
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/old-lighthouse/cracked-spyglass.md
        title: Old Mo's cracked spyglass
        body: |-
          The spyglass slipped from the gallery rail and the lens cracked. Old Mo saw it happen.

          He will want an apology before he talks about that night again. The tunnel mouth still has to be checked, now through the log or on foot.
  - min: 5
    max: 10
    text: "Fog covers the tunnel mouth. On the gallery desk, though, lies Old Mo's tide table for tonight: it shows when the tunnel mouth clears the water."
    options:
      - id: read-log
        label: Lay it beside the lighthouse log
        action:
          kind: read
          paths:
            - world/harbor-chart/old-lighthouse/lighthouse-logbook.md
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/old-lighthouse/tide-table.md
        title: Tonight's tide table
        body: |-
          Old Mo's tide table for tonight. It shows when the old customs tunnel mouth clears the water.

          It says when a boat could use the tunnel, not that one did. Lay it beside the twelve minutes in the lighthouse log.
  - min: 11
    max: 17
    text: The fog thins. At the tunnel mouth the low tide has bared the mud, and a fresh keel groove runs out of the tunnel to the water. A boat came out there, recently.
    options:
      - id: read-log
        label: Match it with the twelve minutes in the log
        action:
          kind: read
          paths:
            - world/harbor-chart/old-lighthouse/lighthouse-logbook.md
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/old-lighthouse/tunnel-mouth-sketch.md
        title: Sketch of the tunnel mouth
        body: |-
          At low tide the old customs tunnel mouth stands clear, and a fresh keel groove runs from it to the water.

          A boat used the tunnel recently. The lighthouse log says when it could have done so unseen.
  - min: 18
    max: 20
    text: "Two grooves at the tunnel mouth: a shallow one, and a deep one cut by a heavily loaded ship. Something heavy left by the tunnel — and that ship may still be somewhere in the fog."
    options:
      - id: search-fog
        label: Search the fog for the loaded ship
        action:
          kind: read
          paths:
            - world/harbor-chart/04-investigation-dice.md
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/old-lighthouse/two-keel-grooves.md
        title: Two keel grooves at the tunnel mouth
        body: |-
          Two fresh grooves in the mud at the old customs tunnel mouth: a shallow one, and a deep one cut by a heavily loaded ship.

          Something heavy left by the tunnel. That ship may still be in the fog beyond the harbor.
---

From the gallery, Old Mo's brass spyglass can reach the old customs tunnel mouth across the harbor — if the fog allows, and if your hands stay steady on the wet rail.

What is at stake is what you can see at the tunnel mouth, and Old Mo's spyglass. A good roll sees whether a boat used the tunnel. A poor one gets only tonight's tide table. A bad one cracks the spyglass, and Old Mo will want an apology.

Free, no roll needed: reading the lighthouse log, and asking Old Mo about lamp oil.

2d10: roll two ten-sided dice. 11 or more succeeds.
2–4 (6%): The spyglass cracks and Old Mo sees it. Nothing seen; apologize before asking him more.
5–10 (39%): Fog covers the tunnel mouth. You keep tonight's tide table: when the tunnel could be used, not whether it was.
11–17 (49%): A fresh keel groove at the tunnel mouth: a boat came out there recently.
18–20 (6%): Two grooves, one cut by a heavily loaded ship — and it may still be in the fog.

One roll only. What you find is left here as an item to take.
