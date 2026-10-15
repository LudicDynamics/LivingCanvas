---
type: chalk
title: "Accuse: Pin the Thread to the Chart"
status:
  data:
    decoy: no
    tunnel: no
    ledger: no
    wake: no
choice:
  options:
    - id: accuse
      label: "Accuse on the Chart: Pin all four threads together"
      when: decoy == "yes" && tunnel == "yes" && ledger == "yes" && wake == "yes"
    - id: not-ready
      label: "Check the chart: which thread is still missing?"
      when: decoy != "yes" || tunnel != "yes" || ledger != "yes" || wake != "yes"
on:
  choice_selected:
    - run: accuse
      on_error: continue
---

The chart is spread out on a table borrowed from the Harbor Office. To expose this, four threads must be pinned together: the ship at Berth 7, the Old Lighthouse's twelve dark minutes, the clasp from the Workshop, and the wake in the fog.

Only when all four threads are checked does "Accuse" appear. While the threads are not all pinned, you can check the chart to see what is still missing. Nothing ends, and no tide is spent. If nothing happens after you Accuse, it means one piece of evidence is not in your bag. Find it and Accuse again.

Threads on the chart (✓ pinned, ✗ still missing):
