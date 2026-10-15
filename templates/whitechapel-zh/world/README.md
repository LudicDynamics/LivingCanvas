---
type: readme
name: 221B · 阻止下一起事件
title: 221B · 阻止下一起事件
bg: assets/backgrounds/intro.webp
intent: 阅读并展示 world/watson-letter.md 和 fourth-illustration.md。玩家接受委托并说要拿走时，把 world/blue-brass-cap.md move 到 player/blue-brass-cap.md。接下来从伦敦地图引导前往第三现场。暂不揭晓真相。正午是故事里的压力，不因现实中的阅读时间施加惩罚。
choice:
  options:
    - id: action-1
      label: 阅读来信和第四幅画
    - id: action-2
      label: 接受委托，拿上画筒盖
bgVideo: assets/motion/seedance/backgrounds/intro.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/watson-letter.md
      - world/fourth-illustration.md
  action-2:
    kind: take
    paths:
      - world/blue-brass-cap.md
map:
  plan:
    picture: assets/maps/baker-street-sitting-room.webp
    pins:
      watson-letter: [0.6, 0.53]
      fourth-illustration: [0.68, 0.58]
      blue-brass-cap: [0.6, 0.63]
      london-map: [0.75, 0.18]
      watson: [0.4, 0.45]
      player: [0.21, 0.77]
---

你是夏洛克·福尔摩斯。华生大衣还湿着，径直赶来，此刻就站在你的起居室里。

“我的病人伊迪丝是位小说家。和她小说里一样的事件，已经接连发生了三起。下一起就在今天正午。有人在模仿她的小说。请你帮帮她。”

你要做两件事：查出是谁在模仿小说，并阻止今天的第四起事件。先读来信和第四幅画，拿上画筒盖，前往伦敦地图。伊迪丝就在这栋房子的客厅里。
