---
type: chalk
title: What does that magic change?
choice:
  options:
    - id: action-1
      label: Write down the combination
    - id: action-2
      label: Check what it will cost
  allow_free: true
  free_hint: In your own words, the verb, the items, the change you want, and the cost you'll accept.
intent: Save the actual proposal to player/spell-draft.md. Present reasonable results and concrete costs in advance and wait to name it, cast, modify, or quit.
choice_actions:
  action-1:
    kind: writer
  action-2:
    kind: stage
    slots:
      - id: material-1
        title: Magic and cost proposal
        required: true
        paths:
          - player/spell-draft.md
---

Success doesn't have to mean opening a great door. A star map small enough for your pocket can be your magic too.
