---
type: chalk
title: Decode the meaning of the fictional address
roll_dice:
  type: 1d100
  desc: Decode the meaning of the fictional address
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
    text: Not only the core, but also the next steps to verify are clear. Edith
      tested a reaction with a fictitious address. The plan is not to lure
      anyone there. Let's follow who got the correction. Presenting the original
      text during questioning can help differentiate between assumptions and
      testimony.
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
      - path: world/london-map/edith-room/investigation-great-success.md
        title: Breakthrough notes
        body: Not only the core, but also the next steps to verify are clear. Edith
          tested a reaction with a fictitious address. The plan is not to lure
          anyone there. Let's follow who got the correction. Presenting the
          original text during questioning can help differentiate between
          assumptions and testimony.
  - min: 13
    max: 60
    text: Observations connected. Edith tested a reaction with a fictitious address.
      The plan is not to lure anyone there. Let's follow who received the
      corrected address.
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
      - path: world/london-map/edith-room/investigation-success.md
        title: Investigation notes
        body: Observations connected. Edith tested a reaction with a fictitious address.
          The plan is not to lure anyone there. Let's follow who received the
          corrected address.
  - min: 61
    max: 95
    text: No immediate connection, but we've found a direction to review the clues.
      Edith tested a reaction with a fictitious address. The plan is not to lure
      anyone there. Let's follow who received the corrected address.
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
      - path: world/london-map/edith-room/investigation-setback.md
        title: A setback and the next lead
        body: No immediate connection, but we've found a direction to review the clues.
          Edith tested a reaction with a fictitious address. The plan is not to
          lure anyone there. Let's follow who received the corrected address.
  - min: 96
    max: 100
    text: The sound of investigation alerted someone, causing us to lose the chance
      to search unnoticed. There's still a lead. Edith tested a reaction with a
      fictitious address. The plan is not to lure anyone there. Let's follow who
      received the corrected address.
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
      - path: world/london-map/edith-room/investigation-setback.md
        title: A setback and the next lead
        body: The sound of investigation alerted someone, causing us to lose the chance
          to search unnoticed. There's still a lead. Edith tested a reaction
          with a fictitious address. The plan is not to lure anyone there. Let's
          follow who received the corrected address.
---

If difficulty arises, roll dice to let characters conduct investigation. If you want to think yourself, you can return without rolling safely.

1d100: Lower is better. Investigation chance is 60%; 60 or below succeeds.
1–12 (12%): Great success, including an additional discovery.
13–60 (48%): Success; understand the clue and the next step.
61–95 (35%): Failure; record the oversight and a way forward.
96–100 (5%): Severe failure; you are noticed and lose an opportunity, but the only path forward stays open.

Even on failure, this is not a dead end. You cannot reroll the same dice. After seeing results, choose next action. Only creating new places requires sending to the writer.
