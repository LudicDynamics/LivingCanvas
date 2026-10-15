---
type: chalk
title: "Long Way Around: Ask Old Mo to check the logbook minute by minute"
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: Ask Old Mo to check the logbook and tide table minute by minute (costs an extra stretch of tide)
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: evidence-tunnel
      on_error: continue
    - when: choice.option_id == "long-way"
      run: long-way-lighthouse
      on_error: continue
---

This path only opens after the Old Lighthouse investigation roll was not fully explored (61-100).

Go beg Old Mo: ask him to open the logbook and check it minute by minute against tonight's tide table - if you just broke his telescope, apologize properly first. The twelve dark minutes will fall exactly within the stretch when the tunnel mouth is above water.

This can also pin the Old Lighthouse thread, it just costs an extra stretch of tide (a dozen or so minutes). Once the thread is pinned, there is no need to come back here.
