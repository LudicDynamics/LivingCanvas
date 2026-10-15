---
type: gate
name: Unnamed Street · An Address Not on the Map
title: Unnamed Street · An Address Not on the Map
bg: assets/backgrounds/fourth.webp
intent: The records named here only exist after the player searches and rolls;
  never show or retell them before that. revision-scrap.md is the result of map
  verification. meeting-options.md is known methods for consultation. No
  invitation has been issued yet. Only execute agreed plans.
choice:
  options:
    - id: search
      label: Search here (roll)
    - id: action-2
      label: Ask Watson for a safe way to draw the suspect out
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/fourth.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-2:
    kind: character
    character: watson
search:
  - id: scene
    skill: stealth
    label: Search here (roll)
    title: Choose a place to lie in wait
    body: >-
      You decide to search this place yourself. Nothing has been found yet — the
      clue only turns up after the roll.


      1d100: lower is better; 60 or less succeeds.

      1–12: Critical success. You find the clue, and one more thing everyone else
      missed.

      13–60: Success. You find the clue and an investigation note.

      61–95: Failure. You only half-see it: you get a half clue that says what
      is still missing, not the clue itself, and the search takes extra time.

      96–100: Critical failure. Only the half clue, a lot of time lost, and you
      search too hastily and may get hurt.


      The clock runs toward noon: a failure costs one step of time, a critical
      failure two. A missed clue is not gone from the case; other places can
      still lead you to the truth. Each place is searched once; no rerolls. When
      the dice settle, the Writer tells you what the search turned up.
    roll_dice:
      type: 1d100
      desc: Choose a place to lie in wait
      expect: <=60
    choice:
      options:
        - id: back
          label: Return to the map now without rolling
    choice_actions:
      back:
        kind: enter
        target: world/london-map
    dice_outcomes:
      - min: 1
        max: 12
        text: You see the heart of it, and what to check next. You can’t wait on a street that doesn’t exist. Use the real courtyard instead, and have the editor send for the suspect to confirm the address. There’s no need to use Edith as bait. Put the originals in front of them when you question them, and you can tell guesswork from testimony. The old map-seller on the corner remembers
          who asked the way this morning.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap.md
                - world/london-map/unnamed-street/meeting-options.md
                - world/london-map/unnamed-street/asked-the-way.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap.md
            title: The new address does not exist
            body: >-
              The new address is not on city maps or address books. The plan to
              go there and wait cannot be used.


              Instead, you can ask to meet in the print shop courtyard to verify
              the address. Decide with Watson who to call and what to ask.
          - path: world/london-map/unnamed-street/meeting-options.md
            title: Plan for verification in the courtyard
            body: >-
              We can ask the editor to say “I want to confirm the address” and
              call the suspect to the courtyard. You can arrange signals and
              return routes with Watson. Edith stays in 221B’s guest room, using
              only a manuscript copy.


              No one has been called yet. When you decide to try this plan,
              check the suspect’s response and proceed.
            portable: false
          - path: world/london-map/unnamed-street/asked-the-way.md
            title: The Man Who Asked the Way
            body: >-
              The old map-seller on the corner says that around nine this
              morning a young man with a streak of blue on his cuff asked for
              this street — three times — keeping his right hand inside his
              coat.


              “I told him there’s no such street in London. He went white.”


              After 8:15, only one person had read Edith’s changed address.
      - min: 13
        max: 60
        text: It fits together. You can’t wait on a street that doesn’t exist. Use the real courtyard instead, and have the editor send for the suspect to confirm the address. There’s no need to use Edith as bait.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap.md
                - world/london-map/unnamed-street/meeting-options.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap.md
            title: The new address does not exist
            body: >-
              The new address is not on city maps or address books. The plan to
              go there and wait cannot be used.


              Instead, you can ask to meet in the print shop courtyard to verify
              the address. Decide with Watson who to call and what to ask.
          - path: world/london-map/unnamed-street/meeting-options.md
            title: Plan for verification in the courtyard
            body: >-
              We can ask the editor to say “I want to confirm the address” and
              call the suspect to the courtyard. You can arrange signals and
              return routes with Watson. Edith stays in 221B’s guest room, using
              only a manuscript copy.


              No one has been called yet. When you decide to try this plan,
              check the suspect’s response and proceed.
            portable: false
          - path: world/london-map/unnamed-street/investigation-success.md
            title: Investigation notes
            body: It fits together. You can’t wait on a street that doesn’t exist. Use the real courtyard instead, and have the editor send for the suspect to confirm the address. There’s no need to use Edith as bait.
      - min: 61
        max: 95
        text: You walk the area twice and cannot find the new street, but you never get
          to the map or the directory to be sure. The search ran long.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap-half.md
                - world/london-map/unnamed-street/meeting-options.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap-half.md
            title: The new street, not found yet
            body: >-
              You walked the streets around the new address and could not find
              it, but there was no time to check the city map or the directory.


              Still missing: proof that the street does not exist at all, and so
              where a meeting could really be arranged.
            partial: true
          - path: world/london-map/unnamed-street/meeting-options.md
            title: Plan for verification in the courtyard
            body: >-
              We can ask the editor to say “I want to confirm the address” and
              call the suspect to the courtyard. You can arrange signals and
              return routes with Watson. Edith stays in 221B’s guest room, using
              only a manuscript copy.


              No one has been called yet. When you decide to try this plan,
              check the suspect’s response and proceed.
            portable: false
        cost:
          clock: -1
      - min: 96
        max: 100
        text: The sound of your search alerted someone, and the chance to look unnoticed
          was lost. All you know is that you could not find the street. A coal
          cart comes tearing out of the alley; you jump aside too fast and hit
          the wall.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap-half.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap-half.md
            title: The new street, not found yet
            body: >-
              You walked the streets around the new address and could not find
              it, but there was no time to check the city map or the directory.


              Still missing: proof that the street does not exist at all, and so
              where a meeting could really be arranged.
            partial: true
        harm: light
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-address
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/unnamed-street.webp
    pins:
      revision-scrap:
        - 0.34
        - 0.4
      meeting-options:
        - 0.66
        - 0.42
      player:
        - 0.5
        - 0.82
---

The new address in the novel does not exist, so there is nowhere to go and wait. The print shop’s courtyard is real, though, and you can meet someone there face to face.

You could have the editor send for the suspect on the pretext of confirming the address. Talk it over with Watson: who to send for, and what to check. There’s no need to put Edith in danger.
