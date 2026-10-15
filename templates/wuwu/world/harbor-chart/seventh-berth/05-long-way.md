---
type: chalk
title: Long Way Around · Ask Silver Kite to Open the Cargo Hold in Person
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: Ask Silver Kite to open the cargo hold in person and inventory it together (costs an extra stretch of tide)
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: evidence-decoy
      on_error: continue
    - when: choice.option_id == "long-way"
      run: long-way-berth
      on_error: continue
---

This path only opens after the investigation die at Berth 7 fails to investigate fully (61–100).

Go to Silver Kite openly: show the record of the scrape marks and explain why you need to see the cargo hold — if he just caught you, clear the air first. He won't draw conclusions for you, but he will pry open the hatch in front of you: ballast stones, nailed-shut empty crates.

This also pins the thread at Berth 7, only costing an extra stretch of tide (a dozen minutes or so). Once the thread is pinned, there is no need to come back here.
