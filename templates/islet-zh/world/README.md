---
type: readme
name: 潮见岛
bg: assets/maps/island.webp
title: 潮见岛
intent: 全岛总览：码头、广场、花的店、你的田、海滩、灯塔、你的小屋、渡轮甲板，以及要修好船才去得了的海藻岛和鸟岩。这是一个活着的世界：时间、天气、节日、岛民去哪儿全由引擎决定（见注入里的
  [The living world]），作家不要宣布过了几小时、不要为了凑场景挪动岛民、不要发明结局。旧渔船和田的进度是本文件声明的状态，只有命令能改。
states:
  - id: boat_progress
    label: 旧渔船
    type: number
    initial: 0
    range:
      - 0
      - 3
    shown_as:
      - min: 3
        text: 船修好了，泊在码头
      - min: 2
        text: 就差最后几块船板
      - min: 1
        text: 补了一半，龙骨还露着
      - max: 0
        text: 翻扣在船坞里，等着木料
  - id: farm_growth
    label: 你的田
    type: number
    initial: 0
    range:
      - 0
      - 4
    shown_as:
      - min: 4
        text: 可以收了
      - min: 3
        text: 长得齐膝高
      - min: 2
        text: 冒出了一排排嫩芽
      - min: 1
        text: 刚翻过土、播下种
      - max: 0
        text: 还是一片荒地
  - id: boat_fixed
    label: 船修好了
    type: flag
    initial: false
    hidden: true
  - id: kai_arrived
    label: 海上岸了
    type: flag
    initial: false
    hidden: true
---

潮见岛不大，从码头走到灯塔用不了一刻钟。岛上住着七个人，每周一有一班渡轮。

你搬来接手村子东边那块荒了好几年的田。没人催你做什么——鱼会上钩，种子会发芽，渡轮会准时靠港，岛民会按自己的日子来来去去。你不在的时候也一样。
