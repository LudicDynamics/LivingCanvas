---
type: gate
name: Editor’s office · Who received the manuscript next?
title: Editor’s office · Who received the manuscript next?
bg: assets/backgrounds/press.webp
intent: The records named here only exist after the player searches and rolls;
  never show or retell them before that. Based on correction-log.md, separate
  responsibility for manuscript distribution from involvement in the crime. Do
  not disclose the patient's whereabouts.
choice:
  options:
    - id: search
      label: Search here (roll)
    - id: action-1
      label: Ask who the corrected manuscript went to
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/press.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: blackburn
search:
  - id: scene
    skill: library_use
    label: Search here (roll)
    title: Follow where the corrected manuscript went
    body: >-
      You decide to search this place yourself. Nothing has been found yet — the
      clue only turns up after the roll.


      1d100: lower is better; 60 or less succeeds.

      1–12: Critical success. You find the clue and write down an extra note on its
      core.

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
      desc: Follow where the corrected manuscript went
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
        text: You see the heart of it, and what to check next. The editor
          received it at 8 a.m. and forwarded it to Wayne at 8:15. The corrected address was never a secret between author and editor alone.
          Put the originals in front of them when you question them, and you can tell guesswork from testimony.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log.md
            title: Destination of the manuscript with the changed address
            body: >-
              At 8 a.m. this morning: Blackburn received the manuscript from
              Edith.

              At 8:15 a.m.: that manuscript was handed to Wayne, who also signed
              receipt.


              Wayne could read the new address. Let's ask if he actually read it
              in the illustration room. Receiving it alone does not prove
              involvement.
          - path: world/london-map/print-shop/editor-office/investigation-great-success.md
            title: Breakthrough notes
            body: You see the heart of it, and what to check next. The editor
              received it at 8 a.m. and forwarded it to Wayne at 8:15. The corrected address was never a secret between author and editor alone. Put the originals in front of them when you question them, and you can tell guesswork from testimony.
      - min: 13
        max: 60
        text: It fits together. The editor received it at 8 a.m. and forwarded it
          to Wayne at 8:15. The corrected address was never a secret between author and editor alone.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log.md
            title: Destination of the manuscript with the changed address
            body: >-
              At 8 a.m. this morning: Blackburn received the manuscript from
              Edith.

              At 8:15 a.m.: that manuscript was handed to Wayne, who also signed
              receipt.


              Wayne could read the new address. Let's ask if he actually read it
              in the illustration room. Receiving it alone does not prove
              involvement.
          - path: world/london-map/print-shop/editor-office/investigation-success.md
            title: Investigation notes
            body: It fits together. The editor received it at 8 a.m. and forwarded it
              to Wayne at 8:15. The corrected address was never a secret between author and editor alone.
      - min: 61
        max: 95
        text: Blackburn hovers over his desk. You read that the corrected manuscript
          arrived at 8 a.m., but not where it went next. The search ran long.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log-half.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log-half.md
            title: Circulation log, half read
            body: >-
              Blackburn’s circulation log shows that Edith’s corrected
              manuscript arrived at 8 a.m. The next line, where it went, is
              under a blotter you were not allowed to lift.


              Still missing: who the manuscript went to after 8 a.m., and whose
              signature is on it.
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: The sound of your search alerted someone, and the chance to look unnoticed
          was lost. Blackburn shuts the log and coldly asks you to leave his
          papers alone.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log-half.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log-half.md
            title: Circulation log, half read
            body: >-
              Blackburn’s circulation log shows that Edith’s corrected
              manuscript arrived at 8 a.m. The next line, where it went, is
              under a blotter you were not allowed to lift.


              Still missing: who the manuscript went to after 8 a.m., and whose
              signature is on it.
            partial: true
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-address
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/editor-office.webp
    pins:
      correction-log:
        - 0.5
        - 0.42
      blackburn:
        - 0.73
        - 0.27
      player:
        - 0.27
        - 0.8
---

Editor Blackburn handles the manuscripts. This morning a corrected manuscript arrived from Edith.

Who did he hand it to next? Search the desk, or ask Blackburn directly.
