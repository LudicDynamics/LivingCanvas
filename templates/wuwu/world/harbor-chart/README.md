---
type: gate
name: Harbor Map · Investigate the Ship
title: Harbor Map · Investigate the Ship
bg: assets/scenes/harbor-chart.webp
requires:
  items:
    - player/commission-letter.md
    - player/investigator-badge.md
blocked: Take both the commission and the Investigator's Badge first.
intent: "This is the list of locations. The order in which you gather evidence is free. The way back is the Harbor Office. You may not cross to something you do not hold just by narrating it. This is a closed game: there are only three endings (Exposed, Lost, Swallowed), and endings are triggered only by the engine's end. The Writer does not declare endings or invent new locations (beyond the fog or anywhere else)."
bgVideo: assets/motion/seedance/backgrounds/map.webm
choice:
  options:
    - id: search
      label: "Decisive Check: find the Second Wake in the fog (roll dice)"
    - id: go-accuse
      label: "Look at the Accuse card: which threads are already pinned"
  allow_free: true
choice_actions:
  search:
    kind: search
    spot: fog
  go-accuse:
    kind: read
    paths:
      - world/harbor-chart/05-accuse.md
search:
  - id: fog
    skill: navigate
    label: "Decisive Check: find the Second Wake in the fog (roll dice)"
    title: Decisive Check · Find the Second Wake in the Fog
    body: |-
      This is the most dangerous check of the whole game: before the tide returns, stand at the outermost foothold of the harbor and find the Second Wake in the fog. This card can only be rolled once.

      This roll decides whether the line on the chart can be pinned on the spot, and whether you will be Swallowed by Fog. With a good roll, you see the wake and the evidence goes straight into your bag; with a poor roll, you get only Half a Thread (a single wake) and must take the Long Way Around to follow it alongshore; with a very bad roll, if you have lamp oil you burn it to steady yourself, and if you have no lamp oil, the game ends here.

      Things you can do at any time without rolling: lay out your materials and talk it through in "Find the Other Ship," reread clues, ask people. They cost no tide, but they won't pin the thread for you.

      1d100 (Navigate 60): roll at or under your skill; lower is better.
      96–100 (5%): Your foot slips and you fall hard onto the rocks, badly hurt, and the fog closes in. **If you have lamp oil, you light the lamp and steady yourself, but that portion of oil burns out, you see nothing, and you can only take the long way around; if you have no oil to light (never borrowed any, or it is already burned out), you are swallowed by the fog and this game ends here.** The tide costs one extra step.
      61–95 (35%): You don't see the ship, only get half a thread (a single wake). You can only take the long way around.
      13–60 (48%): You see the second wake clearly, the evidence goes in your bag, and the Accuse card gets a check.
      1–12 (12%): Same as above; you even see how deep it sits in the water, and this roll costs no tide.

      Tide: each roll costs one step (except a critical success); landing on 96–100 costs one more step; taking the long way around costs one more step. Going to the Old Lighthouse to borrow a portion of lamp oil first makes things much safer.
    roll_dice:
      type: 2d10
      desc: Search for the Second Wake in the Fog
      expect: ">=11"
    choice:
      options:
        - id: back
          label: Don't roll yet; return to the map
    choice_actions:
      back:
        kind: enter
        target: world/harbor-chart
    dice_outcomes:
      - min: 2
        max: 4
        harm: grave
        text: The wet stone underfoot slips, and you fall off the rocks, half your body soaking in the returning tide as the fog closes in at once. If you have lamp oil, you light the lamp and steady yourself, and that portion of oil burns out too — you see nothing, this thread isn't pinned, and you can only take the long way around. If you have no oil to light, the fog swallows you.
        options:
          - id: long-way
            label: "Long Way Around: Follow the Wake Alongshore"
            action:
              kind: read
              paths:
                - world/harbor-chart/06-long-way.md
          - id: back
            label: Return to the Investigation
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: You don't see the ship, only a churned wake in the fog, turning out from the mouth of the Old Customs Tunnel and vanishing back into the fog. What you have is half a thread; to pin it you must take the long way around.
        options:
          - id: long-way
            label: "Long Way Around: Follow the Wake Alongshore"
            action:
              kind: read
              paths:
                - world/harbor-chart/06-long-way.md
          - id: back
            label: Return to the Investigation
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: "The fog thins for a moment: the second wake comes out from the mouth of the Old Customs Tunnel, grazes past the unmanned ship, and turns back into the fog. The thread is pinned on the chart."
        options:
          - id: read-wake
            label: Look at the Second Wake
            action:
              kind: read
              paths:
                - player/second-wake.md
          - id: back
            label: Return to the Investigation
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: "The moment the fog parts, the second wake is perfectly clear: it comes out from the mouth of the Old Customs Tunnel, grazes past the unmanned ship, and sits deep in the water, like a fully laden vessel. The thread is pinned on the chart, and you investigated so quickly that the tide barely moved."
        options:
          - id: read-wake
            label: Look at the Second Wake
            action:
              kind: read
              paths:
                - player/second-wake.md
          - id: back
            label: Return to the Investigation
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank == 1 && has("player/empty-oil-flask.md") || roll.rank == 1 && has("world/harbor-chart/old-lighthouse/lamp-oil.md")
          run: fog-swallows
          on_error: continue
        - when: roll.rank == 1 && has("player/lamp-oil.md")
          run: burn-lamp-oil
          on_error: continue
        - when: roll.rank >= 3
          run: evidence-wake
          on_error: continue
        - when: roll.rank <= 2
          run: miss-chart
          on_error: continue
        - when: roll.rank <= 3
          run: tide-step
          on_error: continue
        - when: roll.rank == 1
          run: tide-surge
          on_error: continue
map:
  pins:
    old-lighthouse:
      - 0.22
      - 0.24
    seventh-berth:
      - 0.42
      - 0.52
    workshop:
      - 0.64
      - 0.62
    player:
      - 0.17
      - 0.87
  plan:
    picture: assets/maps/harbor-chart.webp
    pins:
      old-lighthouse:
        - 0.19
        - 0.12
      seventh-berth:
        - 0.47
        - 0.5
      workshop:
        - 0.85
        - 0.48
      player:
        - 0.16
        - 0.73
---

Go to Berth 7 first and look at the scars left on the ship. At the Workshop you can investigate the ship's parts, and at the Lighthouse you can investigate the time the lamp went out. The order is up to you.

Reading clues, asking people and laying out materials cost no tide and need no dice. Each place also has one investigation dice card, which can be rolled only once: the number decides whether that thread is pinned on the spot. On a success the evidence goes into your bag; on a failure you get only half a thread, or someone is alarmed, and you must take the long way around to pin it, costing extra tide. The chart itself holds the riskiest roll of all, the decisive check: searching for the second wake in the fog. Borrow a portion of lamp oil from the Old Lighthouse first if you can. A bad roll can also injure you — slippery rocks, gangways, lighthouse stairs, the returning tide — and if you are hurt too badly, you won't make it to the Accuse step.

Once all four threads are pinned, make your accusation on the Accuse card. If you haven't accused anyone by the time the tide returns, the second ship will vanish into the fog.
