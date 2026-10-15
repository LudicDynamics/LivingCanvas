---
type: readme
name: 断云隧道 · 停下的末班车
bg: assets/scenes/tunnel-train.webp
title: 断云隧道 · 停下的末班车
intent: 序章的总览，玩家不会来到这里。turns 是回合计数，只有 command/turn-end.yaml 能改它。
states:
- id: turns
  label: 回合
  type: number
  initial: 0
  range:
  - 0
  - 99
  hidden: true
---

凌晨一点十分。开往岭口的K7次末班车停在了断云隧道正中间：前方塌方，车厢里只剩应急灯。
