---
type: gate
name: 221B Parlor · Author’s talk
title: 221B Parlor · Author’s talk
bg: assets/backgrounds/intro.webp
intent: The records named here only exist after the player searches and rolls;
  never show or retell them before that. Separate Edith’s suspicions from
  confirmed facts using address-correction.md as source. The person being protected has a will of her own. Never invent her consent to use her as bait.
choice:
  options:
    - id: search
      label: Search here (roll)
    - id: action-1
      label: Ask why she changed the address
    - id: action-2
      label: Ask who she gave the corrected manuscript to
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/intro.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: edith
  action-2:
    kind: character
    character: edith
search:
  - id: scene
    skill: psychology
    label: Search here (roll)
    title: Work out what the made-up address means
    body: >-
      You decide to search this place yourself. Nothing has been found yet — the
      clue only turns up after the roll.


      1d100: lower is better; 60 or less succeeds.

      1–12: Critical success. You find the clue, and one more thing everyone else
      missed.

      13–60: Success. You find the clue and an investigation note.

      61–95: Failure. You only half-see it: you get a half clue that says what
      is still missing, not the clue itself, and the search takes extra time.

      96–100: Critical failure. Only the half clue, a lot of time lost, and
      someone notices you searching.


      The clock runs toward noon: a failure costs one step of time, a critical
      failure two. A missed clue is not gone from the case; other places can
      still lead you to the truth. Each place is searched once; no rerolls. When
      the dice settle, the Writer tells you what the search turned up.
    roll_dice:
      type: 1d100
      desc: Work out what the made-up address means
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
        text: You see the heart of it, and what to check next. Edith used a made-up address to see who would react. She never meant to lure anyone there. Follow who got the correction. Put the originals in front of them when you question them, and you can tell guesswork from testimony. Edith’s copy of the manuscript also holds a
          pencilled note of her own.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction.md
                - world/london-map/edith-room/margin-note.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction.md
            title: Why Edith changed the address
            body: >-
              This morning, Edith changed the novel's address to a non-existent
              street and handed it to the editor.


              “Anyone who tried to go there would find the street doesn't exist. I wanted to see who would be thrown by it, and ask them why.”


              It was her own way of investigating. It doesn't name the culprit yet; the editor's records will show who read that manuscript next.
          - path: world/london-map/edith-room/margin-note.md
            title: A Line in the Margin
            body: >-
              In the margin of the third chapter of Edith’s copy, in her pencil:
              “A hat? I never wrote a hat. And the chair isn’t by the window.”


              The hat and chair at the third scene match the illustration
              exactly, yet they are not in her novel. Whoever staged the scene
              was looking at the picture, not the words.
      - min: 13
        max: 60
        text: It fits together. Edith used a made-up address to see who would react. She never meant to lure anyone there. Follow who received the corrected address.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction.md
            title: Why Edith changed the address
            body: >-
              This morning, Edith changed the novel's address to a non-existent
              street and handed it to the editor.


              “Anyone who tried to go there would find the street doesn't exist. I wanted to see who would be thrown by it, and ask them why.”


              It was her own way of investigating. It doesn't name the culprit yet; the editor's records will show who read that manuscript next.
          - path: world/london-map/edith-room/investigation-success.md
            title: Investigation notes
            body: It fits together. Edith used a made-up address to see who would react. She never meant to lure anyone there. Follow who received the corrected address.
      - min: 61
        max: 95
        text: You see that the address in chapter four has been changed, but not why;
          Edith is too shaken to explain yet. The search ran long.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction-half.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction-half.md
            title: The changed address, unexplained
            body: >-
              Edith’s draft shows the chapter-four address crossed out and
              replaced with another street. Why she changed it, the page does
              not say, and she was too shaken to tell you.


              Still missing: her reason. Without it, the new address looks like
              nothing more than a correction.
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: The sound of your search alerted someone, and the chance to look unnoticed
          was lost. Edith takes the manuscript back and will not let you look
          again for now.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction-half.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction-half.md
            title: The changed address, unexplained
            body: >-
              Edith’s draft shows the chapter-four address crossed out and
              replaced with another street. Why she changed it, the page does
              not say, and she was too shaken to tell you.


              Still missing: her reason. Without it, the new address looks like
              nothing more than a correction.
            partial: true
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-address
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/edith-room.webp
    pins:
      address-correction:
        - 0.36
        - 0.38
      edith:
        - 0.78
        - 0.53
      player:
        - 0.47
        - 0.85
---

Novelist Edith is guarded here by Watson. “I wrote the novels, but I never meant to hurt anyone.”

She changed the address in her novel this morning. Ask her why, and who she gave the new version to.
