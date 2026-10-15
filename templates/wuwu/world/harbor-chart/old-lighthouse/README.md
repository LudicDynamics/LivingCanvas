---
type: gate
name: "Old Lighthouse: The Light That Went Out"
title: "Old Lighthouse: The Light That Went Out"
bg: assets/scenes/old-lighthouse.webp
intent: Borrowing lamp oil is fixed by the "Borrow a share of lamp oil" button, moving world/harbor-chart/old-lighthouse/lamp-oil.md to player/lamp-oil.md; the Writer does not create extra lamp oil or issue a second share. The logbook can only prove the moment the light went out. Do not fabricate the second ship, which Old Mo does not know about, into his memory.
choice:
  options:
    - id: search
      label: Look at the Old Tunnel Mouth with the Telescope (roll dice)
    - id: action-1
      label: Read the Lighthouse Logbook
    - id: action-2
      label: Borrow a share of lamp oil
    - id: action-3
      label: Ask Old Mo about those twelve minutes
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/lighthouse.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/harbor-chart/old-lighthouse/lighthouse-logbook.md
  action-2:
    kind: take
    paths:
      - world/harbor-chart/old-lighthouse/lamp-oil.md
  action-3:
    kind: character
    character: old-mo
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: spot_hidden
    label: Look at the Old Tunnel Mouth with the Telescope (roll dice)
    title: Use Old Mo's telescope to look at the Old Customs Tunnel mouth
    body: |-
      Standing on the lamp gallery, Old Mo's brass telescope can see all the way to the Old Customs Tunnel mouth across the harbor — provided the fog is willing to part, and your hands can stay steady on the wet railing.

      This roll determines: whether the Old Lighthouse thread can be pinned on the spot, and it also concerns Old Mo's telescope. A good result puts the evidence straight into your bag; a poor result gets you only half a thread; a very bad result cracks the telescope. A thread that is not pinned is not lost: a "Long Way Around" opens on the card, asking Old Mo to check the logbook minute by minute, though it costs an extra stretch of tide.

      Things you can do at any time without rolling dice: read the lighthouse logbook, ask Old Mo about those twelve minutes, borrow a portion of lamp oil. They cost no tide, but they will not pin the thread for you.

      1d100 (Spot Hidden 60): roll at or under your skill; lower is better.
      96–100 (5%): You slip on the wet stairs of the lamp gallery, the telescope cracks in the fall, and Old Mo sees it; he will remember this. The tide costs one extra step; if you are carrying lamp oil, you burn it up in the panic. You can only take the Long Way Around.
      61–95 (35%): Fog covers the tunnel mouth; you only get Half a Thread (tonight's tide table). You can only take the Long Way Around.
      13–60 (48%): You see the tunnel mouth clearly; the evidence "Old Customs Tunnel and the Twelve Dark Minutes" goes into your bag, and the Accuse card gets a check.
      1–12 (12%): Same as above, and you search quickly: this roll costs no tide.

      Tide: each roll costs one step (except a critical success); landing on 96–100 costs one more step; the Long Way Around costs one more step. This card can only be rolled once.
    roll_dice:
      type: 2d10
      desc: Use Old Mo's telescope to look at the Old Customs Tunnel mouth
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
        harm: serious
        text: On the wet steps of the lamp gallery your foot finds nothing, the telescope slides away and cracks against the stone, and you fall backward down several stairs. Old Mo saw it. This thread is not pinned; before you ask him about that night again, you must apologize first, then take the Long Way Around and go through the logbook with him.
        options:
          - id: long-way
            label: "Long Way Around: ask Old Mo to go through the logbook minute by minute"
            action:
              kind: read
              paths:
                - world/harbor-chart/old-lighthouse/05-long-way.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: Fog covers the tunnel mouth. You only get tonight's tide table from Old Mo's desk, which tells you when the tunnel can be used but not that the twelve dark minutes line up with it. What you have is Half a Thread; to pin it down you must take the Long Way Around.
        options:
          - id: long-way
            label: "Long Way Around: ask Old Mo to go through the logbook minute by minute"
            action:
              kind: read
              paths:
                - world/harbor-chart/old-lighthouse/05-long-way.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: The fog thins. At low tide the tunnel mouth rises above the water, and the twelve dark minutes in the logbook are exactly that stretch. The Old Lighthouse thread is pinned.
        options:
          - id: read-evidence
            label: Look at this evidence
            action:
              kind: read
              paths:
                - player/customs-tunnel.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: "As soon as the fog parts, the tunnel mouth is perfectly clear: the moment it rises above the water matches the twelve dark minutes exactly. The Old Lighthouse thread is pinned, and you searched quickly, so the tide barely moved."
        options:
          - id: read-evidence
            label: Look at this evidence
            action:
              kind: read
              paths:
                - player/customs-tunnel.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank >= 3
          run: evidence-tunnel
          on_error: continue
        - when: roll.rank <= 2
          run: miss-lighthouse
          on_error: continue
        - when: roll.rank == 1 && has("player/lamp-oil.md")
          run: burn-lamp-oil
          on_error: continue
        - when: roll.rank <= 3
          run: tide-step
          on_error: continue
        - when: roll.rank == 1
          run: tide-surge
          on_error: continue
  - id: peek-logbook
    skill: stealth
    label: While Old Mo isn't looking, flip through his logbook
    title: While Old Mo isn't looking, flip through his logbook
    body: |-
      Old Mo's logbook lies open on the writing desk, and he has his back turned as he refills the lamp.

      You could flip through it now, or you could leave it and ask him directly. Either way costs no tide; but if he sees you, the conversation afterward will be difficult. On a great success (1–12) he never turns around, and you have time to copy the line onto a scrap of paper to keep.
    roll_dice:
      type: 2d10
      desc: While Old Mo turns to refill the lamp, open the logbook on the writing desk
      expect: ">=11"
    on:
      roll_resolved:
        - run: peek-logbook
map:
  pins:
    lighthouse-logbook:
      - 0.25
      - 0.74
    lamp-oil:
      - 0.16
      - 0.66
    old-mo:
      - 0.62
      - 0.62
    player:
      - 0.45
      - 0.9
  plan:
    picture: assets/maps/old-lighthouse.webp
    pins:
      lighthouse-logbook:
        - 0.35
        - 0.48
      lamp-oil:
        - 0.3
        - 0.36
      old-mo:
        - 0.56
        - 0.53
      player:
        - 0.49
        - 0.75
---

The lighthouse keeper Old Mo says that on that night he put out the light for twelve minutes. Why exactly during that stretch of time?

Reading the logbook or asking Old Mo requires no dice roll. To pin the thread here, you need Old Mo's telescope to look at the Old Customs Tunnel mouth — the result determines whether you see the tunnel mouth clearly, only get the tide table, or drop and break the telescope. Old Mo has only one portion of lamp oil to lend. The decisive check on the chart means standing on the slipperiest footing in the fog, and having it with you makes that much safer.
