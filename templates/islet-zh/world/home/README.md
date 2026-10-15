---
type: readme
name: 你的小屋
bg: assets/scenes/home.webp
title: 你的小屋
intent: 你住的地方。睡觉走 command/sleep.yaml（睡到第二天清晨，过夜时岛民各自的日子由引擎算好）。这里不催玩家睡觉，熬夜也没有惩罚。
choice:
  options:
    - id: sleep
      label: 躺下，睡到天亮
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "sleep"
      run: sleep
      on_error: continue
---

前任留下的小屋：一张床，一张桌子，一个烧柴的小炉子。窗台上摆着一排贝壳，不知道是谁捡的。

从窗户望出去，正好能看见灯塔的光一圈圈扫过海面。
