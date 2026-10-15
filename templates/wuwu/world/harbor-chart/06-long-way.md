---
type: chalk
title: "Long Way: Follow the Wake Alongshore"
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: Follow the wake alongshore (costs an extra stretch of tide)
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: evidence-wake
      on_error: continue
    - when: choice.option_id == "long-way"
      run: long-way-chart
      on_error: continue
---

This route opens only after the decisive Check on the chart was unclear (61–95, or landed on 96–100 and the lamp held steady).

Instead of straining to see from the outermost foothold, you follow the wake alongshore all the way to the mouth of the Old Customs Tunnel. Slow going, but every step is solid: the wake comes out of the tunnel mouth, grazes past the unmanned ship, and turns back into the fog.

This also pins the thread on the chart, but costs an extra stretch of tide (a dozen minutes or so). Once the thread is pinned, there is no need to come back here.
