---
type: gate
name: Illustration room · Ask Wayne
title: Illustration room · Ask Wayne
bg: assets/backgrounds/press.webp
intent: The records named here only exist after the player searches and rolls;
  never show or retell them before that. Use visible-details.md and the
  circulation records as basis for questions. Do not convict based on attitude
  or injury alone. Do not mark unseen evidence as seen, and record the actual
  responses.
choice:
  options:
    - id: search
      label: Search here (roll)
    - id: action-1
      label: Ask Wayne about his wrist injury and the delivery of the illustration
    - id: action-2
      label: Ask whether Wayne read the corrected address
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/press.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: wayne
  action-2:
    kind: character
    character: wayne
search:
  - id: scene
    skill: psychology
    label: Search here (roll)
    title: Verify the artist’s explanation
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
      desc: Verify the artist’s explanation
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
        text: You see the heart of it, and what to check next. A fresh bandage on the right wrist, ultramarine on the sleeve, and an illustration delivered before the incident. There are grounds to look hard at Wayne, but an injury alone can't justify an arrest. Put the originals in front of them when you question them, and you can tell guesswork from testimony. Behind the easel lies a
          stack of returned proofs.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details.md
                - world/london-map/print-shop/illustration-room/returned-proofs.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details.md
            title: Wayne’s injury and paint details
            body: >-
              He has a fresh bandage on his right wrist. Blue paint on the
              sleeve. The altered manuscript is on the desk.


              There was blue paint and a mark where someone hit their right hand
              at the scene. Ask Wayne when and where he got injured. The
              illustration arrived before the incident, so if he claims he drew
              it after seeing the scene, the timeline doesn’t fit.
            portable: false
          - path: world/london-map/print-shop/illustration-room/returned-proofs.md
            title: The Returned Proofs
            body: >-
              Behind the easel lies a stack of returned proofs, every one an
              illustration by Wayne. Editor Blackburn’s red pencil runs down the
              margin: “No illustrations for the serial from next month — save
              the space.”


              On the bottom sheet, in Wayne’s own hand: “They will see — the
              picture comes before the words.”


              This says why he needed the events to follow the pictures. The
              paper itself is not proof of a crime; it is only what weighs on
              him.
      - min: 13
        max: 60
        text: It fits together. A fresh bandage on the right wrist, ultramarine on the sleeve, and an illustration delivered before the incident. There are grounds to look hard at Wayne, but an injury alone can't justify an arrest.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details.md
            title: Wayne’s injury and paint details
            body: >-
              He has a fresh bandage on his right wrist. Blue paint on the
              sleeve. The altered manuscript is on the desk.


              There was blue paint and a mark where someone hit their right hand
              at the scene. Ask Wayne when and where he got injured. The
              illustration arrived before the incident, so if he claims he drew
              it after seeing the scene, the timeline doesn’t fit.
            portable: false
          - path: world/london-map/print-shop/illustration-room/investigation-success.md
            title: Investigation notes
            body: It fits together. A fresh bandage on the right wrist, ultramarine on the sleeve, and an illustration delivered before the incident. There are grounds to look hard at Wayne, but an injury alone can't justify an arrest.
      - min: 61
        max: 95
        text: Wayne keeps his right arm out of sight and talks the whole time. You
          glimpse a stain at his cuff, but nothing you could put to him. The
          search ran long.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details-half.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details-half.md
            title: Wayne’s sleeve, glimpsed
            body: >-
              Wayne keeps his right arm behind the easel and his sleeves rolled
              down. You glimpsed a stain at his cuff, nothing more.


              Still missing: his wrist, the color of the stain, and what lies
              on his desk. Without them there is nothing to put to him.
            partial: true
            portable: false
        cost:
          clock: -1
      - min: 96
        max: 100
        text: The sound of your search alerted someone, and the chance to look unnoticed
          was lost. Wayne turns the papers on his desk face down and steps
          between you and the easel.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details-half.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details-half.md
            title: Wayne’s sleeve, glimpsed
            body: >-
              Wayne keeps his right arm behind the easel and his sleeves rolled
              down. You glimpsed a stain at his cuff, nothing more.


              Still missing: his wrist, the color of the stain, and what lies
              on his desk. Without them there is nothing to put to him.
            partial: true
            portable: false
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-hand
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/illustration-room.webp
    pins:
      visible-details:
        - 0.39
        - 0.4
      wayne:
        - 0.59
        - 0.44
      player:
        - 0.26
        - 0.86
---

Wayne, who drew the illustration, has a fresh bandage on his right wrist. There is blue paint on his sleeve. On the desk is the manuscript with the changed address.

It may connect to the scene. Ask about the injury, and when the illustration was delivered. An injury alone does not prove guilt.
