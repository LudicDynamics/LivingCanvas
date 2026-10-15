---
type: chalk
title: Understand the flow of the manuscript
roll_dice:
  type: 1d100
  desc: Understand the flow of the manuscript
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
    text: Not only the core, but also the next steps to verify are clear. The
      manuscript went from the editor to the artist, and the illustration was
      delivered before the incident. We can distinguish those who knew the work
      before and after the incident. Presenting the original during questioning
      can differentiate assumptions from testimony.
    options:
      - id: read-clue
        label: Read the clues
        action:
          kind: read
          paths:
            - world/london-map/print-shop/receipt.md
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/print-shop/investigation-great-success.md
        title: Breakthrough notes
        body: Not only the core, but also the next steps to verify are clear. The
          manuscript went from the editor to the artist, and the illustration
          was delivered before the incident. We can distinguish those who knew
          the work before and after the incident. Presenting the original during
          questioning can differentiate assumptions from testimony.
  - min: 13
    max: 60
    text: Observations connected. The manuscript went from the editor to the artist,
      and the illustration was delivered before the incident. We can distinguish
      those who knew the work before and after the incident.
    options:
      - id: read-clue
        label: Read the clues
        action:
          kind: read
          paths:
            - world/london-map/print-shop/receipt.md
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/print-shop/investigation-success.md
        title: Investigation notes
        body: Observations connected. The manuscript went from the editor to the artist,
          and the illustration was delivered before the incident. We can
          distinguish those who knew the work before and after the incident.
  - min: 61
    max: 95
    text: No immediate connection, but we've found a direction to review the clues.
      The manuscript went from the editor to the artist, and the illustration
      was delivered before the incident. We can distinguish those who knew the
      work before and after the incident.
    options:
      - id: read-clue
        label: Read the clues
        action:
          kind: read
          paths:
            - world/london-map/print-shop/receipt.md
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/print-shop/investigation-setback.md
        title: A setback and the next lead
        body: No immediate connection, but we've found a direction to review the clues.
          The manuscript went from the editor to the artist, and the
          illustration was delivered before the incident. We can distinguish
          those who knew the work before and after the incident.
  - min: 96
    max: 100
    text: The sound of investigation alerted someone, so the chance to search
      unnoticed was lost. There's still a lead. The manuscript went from the
      editor to the artist, and the illustration was delivered before the
      incident. We can distinguish those who knew the work before and after the
      incident.
    options:
      - id: read-clue
        label: Read the clues
        action:
          kind: read
          paths:
            - world/london-map/print-shop/receipt.md
      - id: back
        label: Return to the map
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/print-shop/investigation-setback.md
        title: A setback and the next lead
        body: The sound of investigation alerted someone, so the chance to search
          unnoticed was lost. There's still a lead. The manuscript went from the
          editor to the artist, and the illustration was delivered before the
          incident. We can distinguish those who knew the work before and after
          the incident.
---

If difficulty arises, roll dice to let characters conduct investigation. If you want to think yourself, you can return without rolling safely.

1d100: Lower is better. Investigation chance is 60%; 60 or below succeeds.
1–12 (12%): Great success, including an additional discovery.
13–60 (48%): Success; understand the clue and the next step.
61–95 (35%): Failure; record the oversight and a way forward.
96–100 (5%): Severe failure; you are noticed and lose an opportunity, but the only path forward stays open.

Even on failure, this is not a dead end. You cannot reroll the same dice. After seeing results, choose next action. Only creating new places requires sending to the writer.
