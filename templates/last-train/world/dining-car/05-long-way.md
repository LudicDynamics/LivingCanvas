---
type: chalk
title: Long Way Around · Tip out the coal scuttle with Old He
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: Ask Old He to help you tip the coal scuttle out, shovel by shovel (costs one more step of time)
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: long-way-dining
      on_error: continue
---

This path only opens after the dining car search fell short (61–100).

Old He does not know what is in his coal scuttle, but he will help you tip it out onto the floor a shovel at a time, grumbling about the mess. Buried under the coal is a key with a red tag.

It gets you the key all the same; it just costs one more step of time. Once you have it, there is no need to come back here.
