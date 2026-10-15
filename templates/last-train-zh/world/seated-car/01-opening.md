---
type: chalk
title: "2车 · 硬座车"
intent: "第一幕（开局入口）。苏禾的座位（17号）和玩家的座位（18号）都在这里。节拍：夏澄开口 → 拿起笔记本 → 用骰子问20号的学生（证词靠这一掷；不再把「去和他聊聊」作为默认选项）→ 拿到证词 → 去3车卧铺或回整列车地图（拿到证词、或在这节车厢待了四拍以后，选项最前面会出现这两条出口）。学生周子航（20号）是 NPC 卡 zhou-zihang.md（点他「对话」），只能说出 witness-account.md 里的内容：他没看清老人的脸，只记得灰呢大衣和花白头发。"
status:
  data:
    skipped: "no"
choice:
  options:
    - id: skip-act-one
      label: "序章里已经问过学生了——直接去整列车地图"
      for: from-prologue
      when: skipped != "yes"
on:
  choice_selected:
    - when: choice.option_id == "skip-act-one"
      run: prologue-carry
      on_error: continue
---

硬座车里大多数人都睡着，有人裹着外套打呼。17号座位上放着一只帆布包、一个保温杯，还有一本摊开的笔记本。

隔两个座位的学生周子航戴着耳机，好像一直没睡。
