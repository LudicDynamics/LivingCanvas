---
type: chalk
title: Long Way Around · Ask Vera to Dig Out the Order Book
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: Ask Vera to dig out the workshop's order book (costs an extra stretch of tide)
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: evidence-ledger
      on_error: continue
    - when: choice.option_id == "long-way"
      run: long-way-workshop
      on_error: continue
---

This path only opens after the investigation die at the Workshop fails to investigate fully (61–100).

Ask Vera to haul out the workshop's dusty order book and leaf through it page by page by the Lord's family crest — if you just snapped the clasp, apologize to her first. The entry ordering this kind of rudder clasp lists, in the payment column, a ship not in the harbor's ship register.

This also pins the Workshop thread, only costing an extra stretch of tide (a dozen minutes or so). Once the thread is pinned, there is no need to come back here.
