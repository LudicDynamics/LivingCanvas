---
type: gate
name: Morgue · When did the incident happen?
title: Morgue · When did the incident happen?
bg: assets/backgrounds/morgue.webp
intent: The records named here only exist after the player searches and rolls;
  never show or retell them before that. Compare time-record.md with the
  print shop's receipt. The time alone doesn't prove a specific person
  committed the crime.
choice:
  options:
    - id: search
      label: Search here (roll)
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/morgue.webm
choice_actions:
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: library_use
    label: Search here (roll)
    title: Work out which came first, picture or incident
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
      desc: Work out which came first, picture or incident
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
        text: You see the heart of it, and what to check next. Delivery
          was yesterday at 6 p.m., the incident at 6 a.m. the next day. The illustration came before the incident; it can't have been drawn from the scene. Put the originals in front of them when you question them, and you can tell guesswork from testimony.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record.md
            title: Incident time · 6 a.m. this morning
            body: >-
              The third incident happened around 6 a.m. this morning.


              Compare it with the print shop's receipt for the illustration. If the illustration arrived first, someone may have staged the incident to match it.
          - path: world/london-map/morgue/investigation-great-success.md
            title: Breakthrough notes
            body: You see the heart of it, and what to check next. Delivery
              was yesterday at 6 p.m., the incident at 6 a.m. the next day. The illustration came before the incident; it can't have been drawn from the scene. Put the originals in front of them when you question them, and you can tell guesswork from testimony.
      - min: 13
        max: 60
        text: It fits together. Delivery was yesterday at 6 p.m., the incident at
          6 a.m. the next day. The illustration came before the incident; it can't have been drawn from the scene.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record.md
            title: Incident time · 6 a.m. this morning
            body: >-
              The third incident happened around 6 a.m. this morning.


              Compare it with the print shop's receipt for the illustration. If the illustration arrived first, someone may have staged the incident to match it.
          - path: world/london-map/morgue/investigation-success.md
            title: Investigation notes
            body: It fits together. Delivery was yesterday at 6 p.m., the incident at
              6 a.m. the next day. The illustration came before the incident; it can't have been drawn from the scene.
      - min: 61
        max: 95
        text: The register is full of corrections. You know the third incident happened
          this morning, but not the hour you need to set beside the print shop’s
          records. The search ran long.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record-half.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record-half.md
            title: Incident time, unclear
            body: >-
              The morgue register puts the third victim’s arrival “early this
              morning”, but the hour itself has been crossed out and rewritten.


              Still missing: the exact hour of the incident. Without it, the
              illustration’s delivery time has nothing to be compared with.
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: The sound of your search alerted someone, and the chance to look unnoticed
          was lost. The attendant takes the register away before you can read
          the hour.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record-half.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record-half.md
            title: Incident time, unclear
            body: >-
              The morgue register puts the third victim’s arrival “early this
              morning”, but the hour itself has been crossed out and rewritten.


              Still missing: the exact hour of the incident. Without it, the
              illustration’s delivery time has nothing to be compared with.
            partial: true
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-picture
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/morgue.webp
    pins:
      time-record:
        - 0.83
        - 0.44
      player:
        - 0.26
        - 0.84
---

The third incident happened around 6 a.m. this morning.

If the illustration was drawn before then, no one can claim it was drawn after the crime. Compare it with the print shop's records.
