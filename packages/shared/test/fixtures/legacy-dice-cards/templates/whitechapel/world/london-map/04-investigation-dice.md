---
type: chalk
title: Let Holmes deduce by dice
roll_dice:
  type: 1d100
  desc: Let Holmes deduce by dice
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
    text: Not only the core, but the next verification steps are clear. Wayne likely
      read the text first, aligning the composition to the incident. Edith’s
      address correction was a probe. Verify in the courtyard, separating
      protection and evidence. Next scene will make this grace a concrete added
      observation opportunity.
    options:
      - id: play-result
        label: Advance beyond discoveries
        action:
          kind: writer
          prompt: "Read judgment source world/london-map/04-investigation-dice.md. The
            player entrusts Holmes’ inference to dice and tries this safe plan:
            focus on Wayne, ask editor to confirm the courtyard address, protect
            Edith at 221B, signal and plan retreat with Watson. No need for two
            documents or correct text. Treat as trial confirmation. Use
            observations to continue the setup. Fixed culprit and responses
            remain. Use existing ending rules."
      - id: back
        label: Return to investigation
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/investigation-great-success.md
        title: Breakthrough notes
        body: Not only the core, but the next verification steps are clear. Wayne likely
          read the text first, aligning the composition to the incident. Edith’s
          address correction was a probe. Verify in the courtyard, separating
          protection and evidence. Next scene will make this grace a concrete
          added observation opportunity.
  - min: 13
    max: 60
    text: Observations connected. Wayne likely read the text first and aligned the
      depicted composition to the incident. Edith’s address correction was a
      probe. Verify in the courtyard, separating protection and evidence
      gathering.
    options:
      - id: play-result
        label: Advance beyond discoveries
        action:
          kind: writer
          prompt: "Read judgment source world/london-map/04-investigation-dice.md. The
            player entrusts Holmes’ inference to dice and tries this safe plan:
            focus on Wayne, ask editor to confirm the courtyard address, protect
            Edith at 221B, signal and plan retreat with Watson. No need for two
            documents or correct text. Treat as trial confirmation. Use
            observations to continue the setup. Fixed culprit and responses
            remain. Use existing ending rules."
      - id: back
        label: Return to investigation
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/investigation-success.md
        title: Investigation notes
        body: Observations connected. Wayne likely read the text first and aligned the
          depicted composition to the incident. Edith’s address correction was a
          probe. Verify in the courtyard, separating protection and evidence
          gathering.
  - min: 61
    max: 95
    text: No immediate conclusions, but you identify a direction to revisit clues.
      Wayne likely read the text first, matching the depicted composition to the
      incident. Edith’s address correction was a probe. Verify in the courtyard,
      separating protection and evidence gathering.
    options:
      - id: play-result
        label: Try a different path from the clues
        action:
          kind: writer
          prompt: "Read judgment source world/london-map/04-investigation-dice.md. The
            player entrusts Holmes’ inference to dice and tries this safe plan:
            focus on Wayne, ask the editor to confirm the courtyard address,
            protect Edith at 221B, signal and plan retreat with Watson. No need
            for two documents or correct text. Treat this submission as trial
            confirmation. This scene will be a brief failure/partial success
            including misses and refusals, playing fixed culprit and responses.
            Use existing ending rules to create result scene and route."
      - id: back
        label: Return to investigation
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/investigation-setback.md
        title: A setback and the next lead
        body: No immediate conclusions, but you identify a direction to revisit clues.
          Wayne likely read the text first, matching the depicted composition to
          the incident. Edith’s address correction was a probe. Verify in the
          courtyard, separating protection and evidence gathering.
  - min: 96
    max: 100
    text: "Sounds indicate investigation, but you lose the chance to check
      unnoticed. Clues remain. Strongest suspicion: Wayne read the text first
      and aligned the depicted composition to the incident. Edith’s address
      change was a probe. Verify in the courtyard, separating protection and
      evidence gathering."
    options:
      - id: play-result
        label: Try a different path from the clues
        action:
          kind: writer
          prompt: "Read judgment source world/london-map/04-investigation-dice.md. The
            player entrusts Holmes’ inference to dice and tries this safe plan:
            focus on Wayne, ask the editor to confirm the courtyard address,
            protect Edith at 221B, signal and plan retreat with Watson. No need
            for two documents or correct text. Treat this submission as trial
            confirmation. This scene will be a brief failure/partial success
            including misses and refusals, playing fixed culprit and responses.
            Use existing ending rules to create result scene and route."
      - id: back
        label: Return to investigation
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/investigation-setback.md
        title: A setback and the next lead
        body: "Sounds indicate investigation, but you lose the chance to check
          unnoticed. Clues remain. Strongest suspicion: Wayne read the text
          first and aligned the depicted composition to the incident. Edith’s
          address change was a probe. Verify in the courtyard, separating
          protection and evidence gathering."
---

If difficulty arises, roll dice to let characters conduct investigation. If you want to think yourself, you can return without rolling safely.

1d100: Lower is better. Investigation chance is 60%; 60 or below succeeds.
1–12 (12%): Great success, including an additional discovery.
13–60 (48%): Success; understand the clue and the next step.
61–95 (35%): Failure; record the oversight and a way forward.
96–100 (5%): Severe failure; you are noticed and lose an opportunity, but the only path forward stays open.

Even on failure, this is not a dead end. You cannot reroll the same dice. After seeing results, choose next action. Only creating new places requires sending to the writer.
