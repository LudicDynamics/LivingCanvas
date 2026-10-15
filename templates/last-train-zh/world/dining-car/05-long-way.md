---
type: chalk
title: 绕远路 · 和老贺把煤斗倒出来
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: 请老贺帮你把煤斗一铲一铲倒出来（多耗一步时间）
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: long-way-dining
      on_error: continue
---

这条路只在餐车没搜成（61–100）之后才打开。

老贺不知道自己煤斗里有什么，但他肯帮你一铲一铲倒在地上，一边嘟囔着弄脏了地。压在煤块底下的，是一把拴着红牌的钥匙。

一样能拿到钥匙，只是多耗一步时间。拿到之后，就不用再回来了。
