---
type: chalk
title: Send Xia Cheng to radio from the cab
intent: "Act Three's shortcut to the end: the player need not walk back to Car
  1; Xia Cheng runs to the cab and radios, and the engine runs the same
  command/report-truth.yaml as world/cab/02-radio-report.md: only with all the
  evidence does it end found; otherwise tick -1. The writer must not announce
  the ending for the engine; when the evidence is incomplete, Xia Cheng brings
  back the dispatcher's questions (where is the person, what makes you say it
  was him), only pointing the direction, not listing a checklist."
choice:
  options:
    - id: relay
      label: Send Xia Cheng to the cab to radio the Lingkou dispatcher
on:
  choice_selected:
    - when: choice.option_id == "relay"
      run: report-truth
---
Xia Cheng presses the flashlight into your hand. "I'm faster. You stay with her — I'll go call Lingkou dispatch from the cab."

The dispatcher only trusts evidence: where is she, who did it, and how do you know? Calling without enough just wastes a step of time — and calling again with nothing new gets the same answer.
