---
type: gate
name: 验尸室 · 事件是何时发生的？
title: 验尸室 · 事件是何时发生的？
bg: assets/backgrounds/morgue.webp
intent: 这里提到的记录，要等玩家搜查并掷骰之后才会出现；在那之前不要出示或复述。比较 time-record.md
  和印刷所的签收单。不能说仅凭时间就证明了特定人物的罪行。
choice:
  options:
    - id: search
      label: 搜查这里（掷骰）
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/morgue.webm
choice_actions:
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: library_use
    label: 搜查这里（掷骰）
    title: 理清画与事件的先后
    body: |-
      你决定亲手搜查这里。线索还没有找到——要等掷完骰子才会出现。

      1d100：数字越小越好，60及以下为成功。
      1–12：大成功。找到线索，还多留下一份记下核心的备忘。
      13–60：成功。找到线索，并留下一份调查备忘。
      61–95：失败。只看清了一半：拿到的是写着还缺什么的半条线索，不是线索本身，而且多花了时间。
      96–100：大失败。只剩半条线索，耽误了大量时间，搜查的动静也被人察觉了。

      时间一直走向正午：失败多花一格时间，大失败多花两格。漏掉的线索不会从案子里消失，别的地方仍可能把你引向真相。每个地方只能搜一次，不能重掷。骰子停下后，作家会讲述你搜到了什么。
    roll_dice:
      type: 1d100
      desc: 理清画与事件的先后
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
        text: 不仅看清了核心，连下一步要核实的步骤也清楚了。交稿是昨天下午6点，事件是今早6点。画在事件之前。“看过现场才画的”这种说法，时间顺序对不上。出示原件再提问，就能把推测和证词分开核实。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record.md
            title: 事件时间 · 今早6点
            body: |-
              第三起事件发生在今天早上6点左右。

              和印刷所里插图的签收记录比一比。如果画在前，就有可能是有人照着画制造了事件。
          - path: world/london-map/morgue/investigation-great-success.md
            title: 记下核心的备忘
            body: 不仅看清了核心，连下一步要核实的步骤也清楚了。交稿是昨天下午6点，事件是今早6点。画在事件之前。“看过现场才画的”这种说法，时间顺序对不上。出示原件再提问，就能把推测和证词分开核实。
      - min: 13
        max: 60
        text: 观察串联起来了。交稿是昨天下午6点，事件是今早6点。画在事件之前。“看过现场才画的”这种说法，时间顺序对不上。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record.md
            title: 事件时间 · 今早6点
            body: |-
              第三起事件发生在今天早上6点左右。

              和印刷所里插图的签收记录比一比。如果画在前，就有可能是有人照着画制造了事件。
          - path: world/london-map/morgue/investigation-success.md
            title: 调查备忘
            body: 观察串联起来了。交稿是昨天下午6点，事件是今早6点。画在事件之前。“看过现场才画的”这种说法，时间顺序对不上。
      - min: 61
        max: 95
        text: 登记簿上改了又改。你知道第三起事件发生在今天早上，却看不出要和印刷所记录对照的那个钟点。这次搜查花了太久。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record-half.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record-half.md
            title: 看不清的事件时间
            body: |-
              停尸房的登记簿上写着第三名受害者“今天清晨”送到，可具体几点被划掉又改写过。

              还缺：事件的确切时间。没有它，插图的交稿时间就没有东西可以对照。
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 搜查的动静传了出去，失去了悄悄查看的机会。你还没看清钟点，看守就把登记簿收走了。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record-half.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record-half.md
            title: 看不清的事件时间
            body: |-
              停尸房的登记簿上写着第三名受害者“今天清晨”送到，可具体几点被划掉又改写过。

              还缺：事件的确切时间。没有它，插图的交稿时间就没有东西可以对照。
            partial: true
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-picture
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/morgue.webp
    pins:
      time-record:
        - 0.83
        - 0.44
      player:
        - 0.26
        - 0.84
---

第三起事件发生在今天早上6点左右。

如果画是在那之前画好的，就不能说是“看了事件之后才画的”。去和印刷所的记录比一比吧。
