---
type: chalk
title: 绕远路 · 请夏澄叫他出来查票
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: 请夏澄把钟怀礼叫到过道里查票，趁机翻枕头（多耗一步时间）
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: long-way-sleeper
      on_error: continue
---

这条路只在包厢没搜成（61–100）之后才打开。

请夏澄在过道里查钟怀礼的票，能拖多久拖多久。包厢空了一分钟：掀开枕头，把药板拿走。

一样能拿到药板，只是多耗一步时间。拿到之后，就不用再回来了。
