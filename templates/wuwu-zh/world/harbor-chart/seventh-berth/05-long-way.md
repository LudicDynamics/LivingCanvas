---
type: chalk
title: 绕远路 · 当面请银鸢打开货舱
status:
  data:
    open: "no"
    done: "no"
choice:
  options:
    - id: long-way
      label: 当面请银鸢打开货舱，一起清点（多耗一段潮水）
      when: 'open == "yes" && done != "yes"'
on:
  choice_selected:
    - when: 'choice.option_id == "long-way"'
      run: evidence-decoy
      on_error: continue
    - when: 'choice.option_id == "long-way"'
      run: long-way-berth
      on_error: continue
---

这条路只在7号码头的调查骰没查全（61–100）之后才打开。

光明正大地去找银鸢：拿出擦痕的记录，说清你为什么要看货舱——要是刚才被他撞见了，先把话说开。他不会替你下结论，但会当着你的面撬开舱盖：压舱石，钉死的空箱。

这样也能把7号码头的线钉上，只是要多耗一段潮水（十几分钟）。线钉上之后，这里就不用再来了。
