---
type: chalk
title: 绕远路 · 请老莫拿日志一分一分对
status:
  data:
    open: "no"
    done: "no"
choice:
  options:
    - id: long-way
      label: 请老莫拿日志和潮汐表一分一分对（多耗一段潮水）
      when: 'open == "yes" && done != "yes"'
on:
  choice_selected:
    - when: 'choice.option_id == "long-way"'
      run: evidence-tunnel
      on_error: continue
    - when: 'choice.option_id == "long-way"'
      run: long-way-lighthouse
      on_error: continue
---

这条路只在旧灯塔的调查骰没查全（61–100）之后才打开。

去求老莫：请他翻开日志，和今晚的潮汐表一分一分地对——要是刚才摔了他的望远镜，先好好道个歉。熄灯的那十二分钟，会一分不差地落在隧道口露出水面的那一段里。

这样也能把旧灯塔的线钉上，只是要多耗一段潮水（十几分钟）。线钉上之后，这里就不用再来了。
