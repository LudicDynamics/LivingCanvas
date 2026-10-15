---
type: chalk
title: Radio · Report to the Lingkou dispatcher
intent: 'The only convergence point. When the player chooses "report", the engine runs command/report-truth.yaml: only with all the evidence does it end found; otherwise tick -1. The writer must not announce the ending for the engine, nor make the dispatcher "believe" when the evidence is incomplete. When evidence is incomplete, the dispatcher asks about the missing link (where is the person, what makes you say it was him), only pointing the direction, not listing a checklist.'
choice:
  options:
    - id: report
      label: "Report: Su He was locked in the baggage car by Zhong Huaili"
on:
  choice_selected:
    - when: choice.option_id == "report"
      run: report-truth
---

On the other end of the radio is the Lingkou dispatcher, the voice pressed far away by the tunnel. The dispatcher will ask three things: Where is the person? Who is it? What makes you say so?

Only if you have found Su He herself and can produce something that links Zhong Huaili to this matter will this call count. Calling with insufficient evidence will only waste a step of time — and calling again with nothing new gets you the same answer.
