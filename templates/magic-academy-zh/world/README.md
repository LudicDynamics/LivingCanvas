---
type: readme
name: 夜晚的图书馆 · 第一个魔法
title: 夜晚的图书馆 · 第一个魔法
intent: 若领取，就把名牌 move 到 player/。讲失败的故事时，举一个具体的例子，但不要把未确认的代价强加给玩家。结局只由引擎落下：「开启」或「映照」的咒语成形后回到夜晚的图书馆，或决定不施法就离开。作家不在正文里宣布结局。
choice:
  options:
    - id: action-1
      label: 领取名牌
    - id: action-2
      label: 向塞拉菲娜请教失败的魔法
choice_actions:
  action-1:
    kind: take
    paths:
      - world/freshman-badge.md
  action-2:
    kind: character
    character: seraphina
bg: assets/scenes/academy-library.webp
map:
  plan:
    picture: assets/maps/night-library.webp
    pins:
      spell-atlas: [0.84, 0.22]
      freshman-badge: [0.26, 0.4]
      seraphina: [0.6, 0.35]
      player: [0.22, 0.8]
---

你是魔法学院的新生。学姐塞拉菲娜在书架之间等着你，名牌就拿在她手里，却没有立刻递过来。

「试着把身边的东西组合起来，做出属于你自己的魔法吧。告诉我你想做什么、要用什么，以及愿意拿什么作为交换。」

先领取名牌，再前往存放魔法材料的地方吧。看过能用的东西之后再决定也没关系。
