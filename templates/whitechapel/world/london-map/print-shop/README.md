---
type: gate
name: Print shop · Ask Tom
title: Print shop · Ask Tom
bg: assets/backgrounds/press.webp
intent: The records named here only exist after the player searches and rolls;
  never show or retell them before that. Show receipt.md and shift-ledger.md.
  Tom only knows about his logging of receipt and his shifts. The editor and
  artist are at editor-office and illustration-room respectively. If no
  conversation happened yet, don't assume testimony obtained.
choice:
  options:
    - id: search
      label: Search here (roll)
    - id: action-1
      label: Ask Tom which came first, manuscript or illustration
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/press.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: tom
search:
  - id: scene
    skill: spot_hidden
    label: Search here (roll)
    title: Trace the manuscript's path
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
      desc: Trace the manuscript's path
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
        text: You see the heart of it, and what to check next. The
          manuscript went from the editor to the artist, and the illustration
          was delivered before the incident. Now you can tell who saw the picture before the incident from who saw it after. Put the originals in front of them when you question them, and you can tell guesswork from testimony.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt.md
                - world/london-map/print-shop/shift-ledger.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt.md
            title: Receipt log · manuscript and illustration
            body: >-
              A week ago: Editor Blackburn received Edith’s manuscript and gave
              it to artist Wayne.

              Yesterday 6 p.m.: Wayne delivered the third illustration.

              6 a.m. today: The third incident occurred.

              8 a.m. today: Edith delivered a manuscript with a changed address
              for the fourth incident.


              The illustration existed before the incident. Whoever read the manuscript could have staged it. Question the editor's office and the illustration room.
          - path: world/london-map/print-shop/shift-ledger.md
            title: Tom’s shift record
            body: >-
              Tom worked at the print shop the night of the incident. The
              signature of the person who relieved him is also recorded.


              This supports Tom’s account. He knows about manuscript handovers
              but did not witness the crime outside.
            portable: false
          - path: world/london-map/print-shop/investigation-great-success.md
            title: Breakthrough notes
            body: You see the heart of it, and what to check next. The
              manuscript went from the editor to the artist, and the
              illustration was delivered before the incident. Now you can tell who saw the picture before the incident from who saw it after. Put the originals in front of them when you question them, and you can tell guesswork from testimony.
      - min: 13
        max: 60
        text: It fits together. The manuscript went from the editor to the artist,
          and the illustration was delivered before the incident. Now you can tell who saw the picture before the incident from who saw it after.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt.md
                - world/london-map/print-shop/shift-ledger.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt.md
            title: Receipt log · manuscript and illustration
            body: >-
              A week ago: Editor Blackburn received Edith’s manuscript and gave
              it to artist Wayne.

              Yesterday 6 p.m.: Wayne delivered the third illustration.

              6 a.m. today: The third incident occurred.

              8 a.m. today: Edith delivered a manuscript with a changed address
              for the fourth incident.


              The illustration existed before the incident. Whoever read the manuscript could have staged it. Question the editor's office and the illustration room.
          - path: world/london-map/print-shop/shift-ledger.md
            title: Tom’s shift record
            body: >-
              Tom worked at the print shop the night of the incident. The
              signature of the person who relieved him is also recorded.


              This supports Tom’s account. He knows about manuscript handovers
              but did not witness the crime outside.
            portable: false
          - path: world/london-map/print-shop/investigation-success.md
            title: Investigation notes
            body: It fits together. The manuscript went from the editor to the artist,
              and the illustration was delivered before the incident. Now you can tell who saw the picture before the incident from who saw it after.
      - min: 61
        max: 95
        text: The duty log is thick and the ink is smudged. You make out that the
          manuscript went from the editor to someone in the shop, but not when
          the third illustration came in. The search ran long.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt-half.md
                - world/london-map/print-shop/shift-ledger.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt-half.md
            title: Receipt log, half read
            body: >-
              The receipt log is there, but the pages you got through only show
              that Editor Blackburn passed Edith’s manuscript on a week ago. The
              line for the third illustration is smudged, or on a page you never
              turned.


              Still missing: when the illustration reached the shop, set against
              the time of the incident. Without it you cannot say the picture
              came first.
            partial: true
          - path: world/london-map/print-shop/shift-ledger.md
            title: Tom’s shift record
            body: >-
              Tom worked at the print shop the night of the incident. The
              signature of the person who relieved him is also recorded.


              This supports Tom’s account. He knows about manuscript handovers
              but did not witness the crime outside.
            portable: false
        cost:
          clock: -1
      - min: 96
        max: 100
        text: The sound of your search alerted someone, and the chance to look unnoticed
          was lost. You come away with only a scrap of the log. As you pull the
          duty log down from a high shelf, the type case beside it topples and
          lands on your shoulder.
        options:
          - id: read-clue
            label: Read the clues
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt-half.md
          - id: back
            label: Return to the map
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt-half.md
            title: Receipt log, half read
            body: >-
              The receipt log is there, but the pages you got through only show
              that Editor Blackburn passed Edith’s manuscript on a week ago. The
              line for the third illustration is smudged, or on a page you never
              turned.


              Still missing: when the illustration reached the shop, set against
              the time of the incident. Without it you cannot say the picture
              came first.
            partial: true
        harm: serious
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-picture
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/print-shop.webp
    pins:
      editor-office:
        - 0.14
        - 0.18
      illustration-room:
        - 0.82
        - 0.16
      tom:
        - 0.5
        - 0.3
      receipt:
        - 0.14
        - 0.45
      shift-ledger:
        - 0.74
        - 0.47
      player:
        - 0.5
        - 0.8
---

Tom, the typesetter, will show you the work records. Here you can check who read the manuscript, and when the illustration arrived.

Search the shop's records, or ask Tom. Further in, Editor Blackburn is in his office and Wayne is in the illustration room.
