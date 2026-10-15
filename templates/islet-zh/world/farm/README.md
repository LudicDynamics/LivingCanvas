---
type: readme
name: 你的田
bg: assets/scenes/farm.webp
title: 你的田
intent: 你接手的田，莲的田就在隔壁。照料田地走 command/tend-farm.yaml（world/README.md 的 farm_growth
  加一；到「可以收了」由触发器收成，第一次收成会得到 player/first-turnip.md）；帮莲干活走
  command/help-ren.yaml。场景图随季节换（引擎的变体图），不要叙述成别的季节。
choice:
  options:
    - id: tend
      label: 翻土、浇水、照料你的田
    - id: help-ren
      label: 去隔壁帮莲干会儿活
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "tend"
      run: tend-farm
      on_error: continue
    - when: choice.option_id == "help-ren"
      run: help-ren
      on_error: continue
---

一块向阳的坡地，石头矮墙围着，墙根下长满了野草。旧农具靠在工具棚边上，锄头柄已经发黑。

隔壁莲的田一垄一垄整整齐齐，像是在替你做示范。
