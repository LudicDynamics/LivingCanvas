---
type: chalk
title: 绕远路 · 请薇拉去翻订货簿
status:
  data:
    open: "no"
    done: "no"
choice:
  options:
    - id: long-way
      label: 请薇拉去翻工坊的订货簿（多耗一段潮水）
      when: 'open == "yes" && done != "yes"'
on:
  choice_selected:
    - when: 'choice.option_id == "long-way"'
      run: evidence-ledger
      on_error: continue
    - when: 'choice.option_id == "long-way"'
      run: long-way-workshop
      on_error: continue
---

这条路只在工坊的调查骰没查全（61–100）之后才打开。

请薇拉把工坊积了灰的订货簿搬出来，按领主家的纹章一页页地翻——要是刚才弄断了扣件，先跟她说声对不起。订这种舵扣件的那一笔，付款栏写的是一艘不在港口船册里的船。

这样也能把工坊的线钉上，只是要多耗一段潮水（十几分钟）。线钉上之后，这里就不用再来了。
