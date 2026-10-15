---
type: readme
name: 港务所 · 开始调查
title: 港务所 · 开始调查
bg: assets/scenes/intro.webp
intent: 若接受，将 world/commission-letter.md 与 world/investigator-badge.md 的实物分别以同名 move 到 player/。若已持有其中一件，只移动缺少的。确认实际持有后，引导前往港口地图。
choice:
  options:
    - id: action-1
      label: 领取委托书与徽章
    - id: action-2
      label: 阅读委托条件
bgVideo: assets/motion/seedance/backgrounds/intro.webm
choice_actions:
  action-1:
    kind: take
    paths:
      - world/commission-letter.md
      - world/investigator-badge.md
  action-2:
    kind: read
    paths:
      - world/commission-letter.md
map:
  pins:
    harbor-chart: [0.88, 0.4]
    commission-letter: [0.575, 0.83]
    investigator-badge: [0.4, 0.82]
    vera: [0.6, 0.58]
    player: [0.16, 0.9]
  plan:
    picture: assets/maps/harbor-office.webp
    pins:
      harbor-chart: [0.82, 0.36]
      commission-letter: [0.46, 0.48]
      investigator-badge: [0.53, 0.47]
      vera: [0.65, 0.3]
      player: [0.3, 0.83]
---

港口事务所里是冷铁和灯油的气味。一艘无人的船、一个人的失踪、同一夜熄灭的灯塔——有人请你查清这三件事是不是同一件。

薇拉已经在这儿了，倚在摆着委托书和徽章的桌边。写信叫你来的人就是她，而她等得够久，久到攒下了不少要说的话。

徽章是你在港口走动的许可证。收下它，她就带你看海图。

墙上的潮位牌写着还剩几步：潮水一回涨，那艘藏在雾里的船就会开走。赶在那之前，把线钉齐。
