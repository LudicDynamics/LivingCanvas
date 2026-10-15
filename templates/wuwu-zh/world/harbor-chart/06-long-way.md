---
type: chalk
title: 绕远路 · 沿着岸边追水痕
status:
  data:
    open: "no"
    done: "no"
choice:
  options:
    - id: long-way
      label: 沿着岸边追着水痕走（多耗一段潮水）
      when: 'open == "yes" && done != "yes"'
on:
  choice_selected:
    - when: 'choice.option_id == "long-way"'
      run: evidence-wake
      on_error: continue
    - when: 'choice.option_id == "long-way"'
      run: long-way-chart
      on_error: continue
---

这条路只在海图上的决定性判定没看清（61–95，或落在 96–100 时点灯稳住了）之后才打开。

不再站在最外头的落脚处硬看，而是沿着岸边一路追着水痕走到旧海关隧道口外。走得慢，但每一步都踩得实：那道航迹从隧道口出来，贴着无人船擦过去，又拐回雾里。

这样也能把海图上的线钉上，只是要多耗一段潮水（十几分钟）。线钉上之后，这里就不用再来了。
