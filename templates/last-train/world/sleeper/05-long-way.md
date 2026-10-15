---
type: chalk
title: Long Way Around · Have Xia Cheng call him out for a ticket check
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: Have Xia Cheng call Zhong Huaili into the corridor to check his ticket, and look under the pillow (costs one more step of time)
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: long-way-sleeper
      on_error: continue
---

This path only opens after the compartment search fell short (61–100).

Ask Xia Cheng to check Zhong Huaili's ticket out in the corridor and keep him talking. For a minute the compartment is empty: lift the pillow and take the pill pack.

It gets you the pill pack all the same; it just costs one more step of time. Once you have it, there is no need to come back here.
