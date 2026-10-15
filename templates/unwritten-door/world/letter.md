---
type: letter
title: The sealed envelope
visual: envelope
portable: true
choice:
  options:
    - id: action-1
      label: Open the envelope
    - id: action-2
      label: Examine the outside
status:
  data:
    opened: false
intent: Only opening reveals a short concrete message. Persist the full message, public Context and opened=true. Looking outside is not opening. On revisit keep the same text.
choice_actions:
  action-1:
    kind: writer
  action-2:
    kind: reply
    text: The handwriting on the envelope is unfamiliar. The seal is intact. Looking at the outside has not opened it or revealed a name.
---

An envelope addressed in unfamiliar handwriting.

## Context
The letter has not been opened.
