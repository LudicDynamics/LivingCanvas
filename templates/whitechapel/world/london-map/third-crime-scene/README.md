---
type: gate
name: Third scene · Almost identical to the illustration
title: Third scene · Almost identical to the illustration
bg: assets/backgrounds/scene3.webp
intent: The records named here only exist after the player searches and rolls;
  never show or retell them before that. Answer based on pigment-record.md and
  do not convict just by ultramarine presence. Check the timeline from the
  morgue records; those who saw the manuscript can be directed to the print
  shop.
choice:
  options:
    - id: search
      label: Search here (roll)
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/scene3.webm
choice_actions:
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: spot_hidden
    label: Search here (roll)
    title: Compare the scene with the picture
    body: >-
      You decide to search this place yourself. Nothing has been found yet — the
      clue only turns up after the roll.


      1d100: lower is better; 60 or less succeeds.

      1–12: Critical success. You find the clue and write down an extra note on its
      core.

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
      desc: Compare the scene with the picture
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
        text: You see the heart of it, and what to check next. The chair and hat match the picture. Someone seems to have arranged the scene to match the illustration. Ask the artist about the ultramarine and an injured right hand. Put the originals in front of them when you question them, and you can tell guesswork from testimony.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record.md
            title: Blue paint found at the scene
            body: >-
              On the railing there’s blue paint like the paint on the tube cap. Nearby is a mark where someone seems to have struck their right hand. The chair and hat match the novel’s illustration.


              Someone familiar with the illustration may have arranged the
              scene. Find out at the print shop who drew the illustration, and whether their right hand is injured.
          - path: world/london-map/third-crime-scene/investigation-great-success.md
            title: Breakthrough notes
            body: You see the heart of it, and what to check next. The chair and hat match the picture. Someone seems to have arranged the scene to match the illustration. Ask the artist about the ultramarine and an injured right hand. Put the originals in front of them when you question them, and you can tell guesswork from testimony.
      - min: 13
        max: 60
        text: It fits together. The chair and hat match the picture. Someone seems to have arranged the scene to match the illustration. Ask the artist about the ultramarine and an injured right hand.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record.md
            title: Blue paint found at the scene
            body: >-
              On the railing there’s blue paint like the paint on the tube cap. Nearby is a mark where someone seems to have struck their right hand. The chair and hat match the novel’s illustration.


              Someone familiar with the illustration may have arranged the
              scene. Find out at the print shop who drew the illustration, and whether their right hand is injured.
          - path: world/london-map/third-crime-scene/investigation-success.md
            title: Investigation notes
            body: It fits together. The chair and hat match the picture. Someone seems to have arranged the scene to match the illustration. Ask the artist about the ultramarine and an injured right hand.
      - min: 61
        max: 95
        text: Fog and onlookers. You catch a smear of blue on the railing and a chair
          set too neatly, but not what the blue is or who left it. The search
          ran long.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record-half.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record-half.md
            title: A blue mark at the scene, half seen
            body: >-
              There is a smear of blue somewhere on the railing, and the chair
              looks placed with care. In the wet and the crowd you could not
              tell what the blue is, or whether anyone was hurt there.


              Still missing: what the paint is, and the mark of a struck right
              hand. Without them the scene points at no one.
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: The sound of your search alerted someone, and the chance to look unnoticed
          was lost. You glimpse only a smear of blue. As you lean out to look at
          the far side of the railing, the wet iron gives, and you fall hard
          down the stone steps.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record-half.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record-half.md
            title: A blue mark at the scene, half seen
            body: >-
              There is a smear of blue somewhere on the railing, and the chair
              looks placed with care. In the wet and the crowd you could not
              tell what the blue is, or whether anyone was hurt there.


              Still missing: what the paint is, and the mark of a struck right
              hand. Without them the scene points at no one.
            partial: true
        harm: serious
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-hand
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/third-crime-scene.webp
    pins:
      pigment-record:
        - 0.3
        - 0.29
      player:
        - 0.5
        - 0.82
---

The chair and hat are exactly where they are in the novel’s illustration. Someone seems to have arranged the scene on purpose to match the picture. There is blue paint, and a mark where a hand struck the railing.

Search the scene first — what you find turns up after the roll. Whether the illustration or the incident came first can be checked at the morgue and print shop.
