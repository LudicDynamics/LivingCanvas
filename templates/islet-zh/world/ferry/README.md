---
type: readme
name: 渡轮甲板
bg: assets/scenes/ferry.webp
title: 渡轮甲板
intent: 每周一来的渡轮。不靠港的日子它泊在湾里，甲板上空荡荡的。一个抱着吉他的旅人（海）一直坐在甲板上，直到他决定下船（触发器
  kai-arrives）。去海藻岛、鸟岩要坐修好的船（门槛：player/boat-tiller.md）；暴风雨天不出海由作家在叙述里守住。
choice:
  options:
    - id: to-kelp
      label: 开修好的船去海藻岛
    - id: to-bird
      label: 开修好的船去鸟岩
    - id: back
      label: 回到码头
  allow_free: true
choice_actions:
  to-kelp:
    kind: enter
    target: world/kelp-islet
  to-bird:
    kind: enter
    target: world/bird-rock
  back:
    kind: enter
    target: world/dock
---

甲板被太阳晒得发烫，救生圈挂在栏杆上，漆掉了一半。从这里回头看，整座岛像一只趴在海上睡觉的猫。

栏杆边常坐着一个抱着旧吉他的人。
