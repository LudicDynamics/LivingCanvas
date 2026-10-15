---
type: gate
name: "Berth 7: Scars on the Ship"
title: "Berth 7: Scars on the Ship"
bg: assets/scenes/seventh-berth.webp
intent: After the player investigates the waterline trace, let them read the actual record. Even if Silver Kite shows the empty crates, he does not claim to know the whole story of the unidentified ship.
choice:
  options:
    - id: search
      label: Slip aboard during the shift change and search the cargo hold (roll dice)
    - id: action-1
      label: Read the note on the scars on the ship
    - id: action-2
      label: Ask Silver Kite about the crates
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/dock.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/harbor-chart/seventh-berth/waterline-trace.md
  action-2:
    kind: character
    character: silver-kite
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: stealth
    label: Slip aboard during the shift change and search the cargo hold (roll dice)
    title: Slip aboard the unmanned ship during the shift change and open the empty cargo hold
    body: |-
      Silver Kite is changing shifts, and the gangway is unwatched for a minute — enough for you to slip aboard that unmanned ship and pry open its cargo hold.

      This roll decides: whether the thread at Berth 7 can be pinned on the spot. A good number puts the evidence straight into your bag; a poor number gets you only half a thread; a very bad number gets you caught red-handed by Silver Kite. A thread that isn't pinned isn't lost: the card opens a "Long Way Around," asking Silver Kite to open the hold in person, only costing an extra stretch of tide.

      Things you can do at any time without rolling dice: read the record of the scrape marks, ask Silver Kite about the crates. They cost no tide, but they won't pin the thread for you.

      1d100 (Stealth 60): roll at or under your skill; lower is better.
      96–100 (5%): Silver Kite catches you and you bruise yourself on the gangway. You get nothing, and he will remember this; the tide costs one extra step; if you are carrying lamp oil, you burn it up in the panic. You can only take the long way around.
      61–95 (35%): You don't have time to open the cargo hold and only get half a thread (a flake of another ship's paint). You can only take the long way around.
      13–60 (48%): You open the cargo hold, the evidence "that ship is a decoy" goes into your bag, and the Accuse card gets a check.
      1–12 (12%): Same as above, and you're so quick that this roll costs no tide.

      Tide: each roll costs one step (except a critical success); landing on 96–100 costs one more step; the Long Way Around costs one more step. This card can only be rolled once.
    roll_dice:
      type: 2d10
      desc: Slip aboard the unmanned ship during the shift change and open the empty cargo hold
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
        harm: light
        text: Just as you reach the top of the gangway, Silver Kite's hand grabs your collar and yanks you down, your ribs banging against the railing the whole way. He says not a word about the cargo hold — he only shuts the gangway on you. This thread isn't pinned; to learn what is in the cargo hold, you must take the long way around and go to him in person.
        options:
          - id: long-way
            label: "Long Way Around: Ask Silver Kite to Open the Cargo Hold in Person"
            action:
              kind: read
              paths:
                - world/harbor-chart/seventh-berth/05-long-way.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: No time to open the cargo hold. You only manage to scrape a flake of another ship's black paint from a scrape mark above the high-tide line — enough to prove a second ship exists, not enough to prove this one is a decoy. What you have is half a thread; to pin it you must take the long way around.
        options:
          - id: long-way
            label: "Long Way Around: Ask Silver Kite to Open the Cargo Hold in Person"
            action:
              kind: read
              paths:
                - world/harbor-chart/seventh-berth/05-long-way.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: The hatch pries open. Inside there is only ballast stone and nailed-shut empty crates. This ship was deliberately sent out empty — the thread at Berth 7 is pinned.
        options:
          - id: read-evidence
            label: Look at this evidence
            action:
              kind: read
              paths:
                - player/decoy-ship.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: "The hatch pries open at a touch, and you finish the inventory before Silver Kite returns: ballast stone and nailed-shut empty crates. The thread at Berth 7 is pinned, and you investigated so quickly that the tide barely moved."
        options:
          - id: read-evidence
            label: Look at this evidence
            action:
              kind: read
              paths:
                - player/decoy-ship.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank >= 3
          run: evidence-decoy
          on_error: continue
        - when: roll.rank <= 2
          run: miss-berth
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
map:
  pins:
    waterline-trace:
      - 0.22
      - 0.66
    silver-kite:
      - 0.68
      - 0.76
    player:
      - 0.5
      - 0.9
  plan:
    picture: assets/maps/seventh-berth.webp
    pins:
      waterline-trace:
        - 0.27
        - 0.3
      silver-kite:
        - 0.63
        - 0.63
      player:
        - 0.5
        - 0.88
---

Knight Silver Kite guards an empty, unmanned ship. There is a scar on its side, far higher than the waterline.

What struck the ship? Reading the record of the scars and asking Silver Kite about the empty crates need no dice. To pin the thread here, you must slip aboard during the shift change and search the cargo hold — the number decides whether you get the evidence, half a thread, or are caught red-handed by Silver Kite.
