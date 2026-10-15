---
type: readme
name: 花的杂货店
bg: assets/scenes/store.webp
title: 花的杂货店
intent: 全岛唯一的店，什么都卖一点，也收岛民的鱼和菜寄卖；花消息最灵通。把鱼交给花走
  command/sell-fish.yaml（鱼篓清空，和花的交情加深）。下雨天健太、莲常来躲雨。
choice:
  options:
    - id: sell-fish
      label: 把鱼篓里的鱼交给花寄卖
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "sell-fish"
      run: sell-fish
      on_error: continue
---

门铃叮当一声。货架从地板顶到天花板：罐头、种子、麻绳、手电筒、一罐罐腌梅子。收银台上摊着一本写满了字的账本。

柜台后面总有一壶热茶。
