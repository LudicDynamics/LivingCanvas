---
type: gate
name: 外岛 · 海藻岛
bg: assets/scenes/kelp-islet.webp
title: 外岛 · 海藻岛
requires:
  items:
    - player/boat-tiller.md
blocked: 海藻岛隔着一片急流，游不过去。得先帮健太把那条旧渔船修好。
intent: 修好船之后才来得了的小岛，潮退时海藻林露出水面。这里没有人住，偶尔凪会开船来捞海藻。探索走
  command/explore-islet.yaml（花掉大半个下午）。不要在这里藏宝藏或秘密，它只是一处美丽、安静的地方。
choice:
  options:
    - id: explore
      label: 蹚着浅水在海藻林里走走
    - id: back
      label: 开船回渡轮甲板
  allow_free: true
choice_actions:
  back:
    kind: enter
    target: world/ferry
on:
  choice_selected:
    - when: choice.option_id == "explore"
      run: explore-islet
      on_error: continue
---

退潮后的海藻岛像一块绿色的绒毯，海藻在浅水里慢慢摇。礁石上晒着几只海星。

这里听不到别的声音，只有浪和风。
