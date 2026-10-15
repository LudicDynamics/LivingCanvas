---
type: gate
name: "Workshop: A Part Fallen from the Ship"
title: "Workshop: A Part Fallen from the Ship"
bg: assets/scenes/workshop.webp
choice:
  options:
    - id: search
      label: Take the clasp apart in the vise (roll dice)
    - id: action-1
      label: Investigate the ship's part
    - id: action-2
      label: Ask Vera about the owner
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/workshop.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/harbor-chart/workshop/crest-clasp.md
  action-2:
    kind: character
    character: vera
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: mechanical_repair
    label: Take the clasp apart in the vise (roll dice)
    title: Take the clasp apart in Vera's vise
    body: |-
      The clasp is still intact. Clamp it in Vera's vise and take it apart, and perhaps you can see the order stamp hidden under the crest — or perhaps the pin snaps and ruins that fresh scrape mark along with it.

      This roll decides: whether the Workshop thread can be pinned on the spot, and it also concerns the clasp itself. A good number puts the evidence straight into your bag; a poor number gets you only half a thread; a very bad number breaks the part and leaves Vera heartbroken. A thread that isn't pinned isn't lost: the card opens a "Long Way Around," asking Vera to dig out the order book, only costing an extra stretch of tide.

      Things you can do at any time without rolling dice: read the note on the part, ask Vera about the owner. They cost no tide, but they won't pin the thread for you.

      1d100 (Mechanical Repair 60): roll at or under your skill; lower is better.
      96–100 (5%): The pin snaps and cuts your hand. Vera sees it, and she will remember this; the tide costs one extra step; if you are carrying lamp oil, you burn it up in the panic. You can only take the long way around.
      61–95 (35%): Rust covers the order stamp, and you only get half a thread (a rubbing of the crest). You can only take the long way around.
      13–60 (48%): You read the order stamp, the evidence "a page from the Lord's ledger" goes into your bag, and the Accuse card gets a check.
      1–12 (12%): Same as above, and you're so quick that this roll costs no tide.

      Tide: each roll costs one step (except a critical success); landing on 96–100 costs one more step; the Long Way Around costs one more step. This card can only be rolled once.
    roll_dice:
      type: 2d10
      desc: Take the clasp apart in Vera's vise
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
        text: The pin snaps in the vise; a flying shard cuts your hand, and the fresh scrape mark goes with the broken piece. Vera stares at the break without a word. This thread isn't pinned; the part can no longer speak, and you can only take the long way around and ask Vera to dig out the order book.
        options:
          - id: long-way
            label: "Long Way Around: Ask Vera to Dig Out the Order Book"
            action:
              kind: read
              paths:
                - world/harbor-chart/workshop/05-long-way.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: The clasp opens, but the order stamp is covered by rust. You only take a rubbing of the Lord's family crest — enough to show which family, not enough to show which ship. What you have is half a thread; to pin it you must take the long way around.
        options:
          - id: long-way
            label: "Long Way Around: Ask Vera to Dig Out the Order Book"
            action:
              kind: read
              paths:
                - world/harbor-chart/workshop/05-long-way.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: "The rust peels away in flakes, and beneath the crest the order stamp is perfectly clear: charged to the Lord's ledger, ordered for a ship that is not in the harbor registry. The Workshop's thread is pinned."
        options:
          - id: read-evidence
            label: Look at this evidence
            action:
              kind: read
              paths:
                - player/ledger-page.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: The vise loosens and the order stamp comes clear; even the height of the fresh scrape matches the one on the ship at Berth 7. The Workshop's thread is pinned, and the search was quick, so the tide barely moved.
        options:
          - id: read-evidence
            label: Look at this evidence
            action:
              kind: read
              paths:
                - player/ledger-page.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank >= 3
          run: evidence-ledger
          on_error: continue
        - when: roll.rank <= 2
          run: miss-workshop
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
    crest-clasp:
      - 0.47
      - 0.52
    player:
      - 0.42
      - 0.88
  plan:
    picture: assets/maps/workshop.webp
    pins:
      crest-clasp:
        - 0.5
        - 0.39
      player:
        - 0.46
        - 0.72
---

A part fallen from a ship's rudder sits on the workbench under the lamp, placed there by Vera. The part bears the Lord's family crest.

Which ship it came from is the clue. Reading the note on the part and asking Vera about the owner need no dice. To pin the thread here, you must take the clasp apart in the vise — the number decides whether you read the order stamp, only take a rubbing of the crest, or snap the pin.
