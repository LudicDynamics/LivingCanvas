---
type: chalk
title: 理清原稿的去向
roll_dice:
  type: 1d100
  desc: 理清原稿的去向
  expect: <=60
choice:
  options:
    - id: back
      label: 暂不掷骰，返回地图
choice_actions:
  back:
    kind: enter
    target: world/london-map
dice_outcomes:
  - min: 1
    max: 12
    text: 不仅看清了核心，连下一步要核实的步骤也清楚了。原稿从编辑手里交到了画师手里，画在事件之前就已交付。可以把事先知道作品内容的人和事后才知道的人区分开。出示原件再提问，就能把推测和证词分开核实。
    options:
      - id: read-clue
        label: 阅读线索
        action:
          kind: read
          paths:
            - world/london-map/print-shop/receipt.md
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/print-shop/investigation-great-success.md
        title: 记下核心的备忘
        body: 不仅看清了核心，连下一步要核实的步骤也清楚了。原稿从编辑手里交到了画师手里，画在事件之前就已交付。可以把事先知道作品内容的人和事后才知道的人区分开。出示原件再提问，就能把推测和证词分开核实。
  - min: 13
    max: 60
    text: 观察串联起来了。原稿从编辑手里交到了画师手里，画在事件之前就已交付。可以把事先知道作品内容的人和事后才知道的人区分开。
    options:
      - id: read-clue
        label: 阅读线索
        action:
          kind: read
          paths:
            - world/london-map/print-shop/receipt.md
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/print-shop/investigation-success.md
        title: 调查备忘
        body: 观察串联起来了。原稿从编辑手里交到了画师手里，画在事件之前就已交付。可以把事先知道作品内容的人和事后才知道的人区分开。
  - min: 61
    max: 95
    text: 一时没能串起来，但找到了重新审视线索的方向。原稿从编辑手里交到了画师手里，画在事件之前就已交付。可以把事先知道作品内容的人和事后才知道的人区分开。
    options:
      - id: read-clue
        label: 阅读线索
        action:
          kind: read
          paths:
            - world/london-map/print-shop/receipt.md
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/print-shop/investigation-setback.md
        title: 疏漏与下一条线索
        body: 一时没能串起来，但找到了重新审视线索的方向。原稿从编辑手里交到了画师手里，画在事件之前就已交付。可以把事先知道作品内容的人和事后才知道的人区分开。
  - min: 96
    max: 100
    text: 调查的动静传了出去，失去了悄悄查看的机会。但线索还在。原稿从编辑手里交到了画师手里，画在事件之前就已交付。可以把事先知道作品内容的人和事后才知道的人区分开。
    options:
      - id: read-clue
        label: 阅读线索
        action:
          kind: read
          paths:
            - world/london-map/print-shop/receipt.md
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/print-shop/investigation-setback.md
        title: 疏漏与下一条线索
        body: 调查的动静传了出去，失去了悄悄查看的机会。但线索还在。原稿从编辑手里交到了画师手里，画在事件之前就已交付。可以把事先知道作品内容的人和事后才知道的人区分开。
---

觉得难的时候，可以用骰子把调查交给登场人物。想自己思考时，不掷骰直接返回也没关系。

1d100：数字越小结果越好。调查成功率60%，60及以下为成功。
1–12（12%）：大成功。获得包含额外发现的记录。
13–60（48%）：成功。获得线索的含义和下一步。
61–95（35%）：失败。记下疏漏和下一条线索。
96–100（5%）：严重失败。被人察觉，失去一次调查机会，但唯一的路不会被堵死。

即使失败，这里也不是死路。同一次骰子不能重掷。看过结果后，再选择接下来怎么做。只有要创建新地点时，才需要发送给作家。
