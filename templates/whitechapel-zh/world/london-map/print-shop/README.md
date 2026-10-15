---
type: gate
name: 印刷所 · 问问汤姆
title: 印刷所 · 问问汤姆
bg: assets/backgrounds/press.webp
intent: 这里提到的记录，要等玩家搜查并掷骰之后才会出现；在那之前不要出示或复述。展示 receipt.md 和
  shift-ledger.md。汤姆只知道他记录下的交接和自己的值班。编辑确实在 editor-office，画师确实在
  illustration-room。如果还没对话，不要当作已经取得了证词。
choice:
  options:
    - id: search
      label: 搜查这里（掷骰）
    - id: action-1
      label: 问汤姆原稿和插图的先后
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/press.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: tom
search:
  - id: scene
    skill: spot_hidden
    label: 搜查这里（掷骰）
    title: 理清原稿的去向
    body: |-
      你决定亲手搜查这里。线索还没有找到——要等掷完骰子才会出现。

      1d100：数字越小越好，60及以下为成功。
      1–12：大成功。找到线索，还多留下一份记下核心的备忘。
      13–60：成功。找到线索，并留下一份调查备忘。
      61–95：失败。只看清了一半：拿到的是写着还缺什么的半条线索，不是线索本身，而且多花了时间。
      96–100：大失败。只剩半条线索，耽误了大量时间，还因为搜得太急，可能会受伤。

      时间一直走向正午：失败多花一格时间，大失败多花两格。漏掉的线索不会从案子里消失，别的地方仍可能把你引向真相。每个地方只能搜一次，不能重掷。骰子停下后，作家会讲述你搜到了什么。
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
                - world/london-map/print-shop/shift-ledger.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt.md
            title: 原稿与插图的签收记录
            body: |-
              一周前：编辑布莱克本收到伊迪丝的原稿，交给了画师韦恩。
              昨天下午6点：韦恩送来了第三起事件的插图。
              今天早上6点：第三起事件发生。
              今天上午8点：伊迪丝送来了改过第四起事件地址的原稿。

              画在事件之前就已存在。读过原稿的人，本可以事先准备好事件。去编辑室和画室问问吧。
          - path: world/london-map/print-shop/shift-ledger.md
            title: 汤姆的值班记录
            body: |-
              事发当晚，汤姆在印刷所上班。接班的人也签了名。

              这是核实汤姆说法的材料。汤姆知道原稿的交接，但并没有看到外面发生的罪行。
            portable: false
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
                - world/london-map/print-shop/shift-ledger.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt.md
            title: 原稿与插图的签收记录
            body: |-
              一周前：编辑布莱克本收到伊迪丝的原稿，交给了画师韦恩。
              昨天下午6点：韦恩送来了第三起事件的插图。
              今天早上6点：第三起事件发生。
              今天上午8点：伊迪丝送来了改过第四起事件地址的原稿。

              画在事件之前就已存在。读过原稿的人，本可以事先准备好事件。去编辑室和画室问问吧。
          - path: world/london-map/print-shop/shift-ledger.md
            title: 汤姆的值班记录
            body: |-
              事发当晚，汤姆在印刷所上班。接班的人也签了名。

              这是核实汤姆说法的材料。汤姆知道原稿的交接，但并没有看到外面发生的罪行。
            portable: false
          - path: world/london-map/print-shop/investigation-success.md
            title: 调查备忘
            body: 观察串联起来了。原稿从编辑手里交到了画师手里，画在事件之前就已交付。可以把事先知道作品内容的人和事后才知道的人区分开。
      - min: 61
        max: 95
        text: 值班簿很厚，墨迹也糊了。你只看出原稿从编辑手里交给了印刷所里的某个人，却看不出第三幅插图是什么时候送来的。这次搜查花了太久。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt-half.md
                - world/london-map/print-shop/shift-ledger.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt-half.md
            title: 只看了一半的签收记录
            body: |-
              签收簿就在那里，可你翻到的几页只写着：一周前，编辑布莱克本把伊迪丝的原稿转了出去。第三幅插图那一行墨迹糊了，或者在你没来得及翻的那一页。

              还缺：插图送到印刷所的时间，和事件时间对照。没有它，就说不出画在事件之前。
            partial: true
          - path: world/london-map/print-shop/shift-ledger.md
            title: 汤姆的值班记录
            body: |-
              事发当晚，汤姆在印刷所上班。接班的人也签了名。

              这是核实汤姆说法的材料。汤姆知道原稿的交接，但并没有看到外面发生的罪行。
            portable: false
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 搜查的动静传了出去，失去了悄悄查看的机会。你只带走了值班簿的一角。你从高处抽出值班簿时，旁边的铅字架整个倒了下来，砸在你的肩上。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt-half.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt-half.md
            title: 只看了一半的签收记录
            body: |-
              签收簿就在那里，可你翻到的几页只写着：一周前，编辑布莱克本把伊迪丝的原稿转了出去。第三幅插图那一行墨迹糊了，或者在你没来得及翻的那一页。

              还缺：插图送到印刷所的时间，和事件时间对照。没有它，就说不出画在事件之前。
            partial: true
        harm: serious
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-picture
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/print-shop.webp
    pins:
      editor-office:
        - 0.14
        - 0.18
      illustration-room:
        - 0.82
        - 0.16
      tom:
        - 0.5
        - 0.3
      receipt:
        - 0.14
        - 0.45
      shift-ledger:
        - 0.74
        - 0.47
      player:
        - 0.5
        - 0.8
---

印刷工汤姆会给你看工作记录。在这里可以查“谁读过原稿”和“画是什么时候送到的”。

搜查一下这里的记录，或者问问汤姆吧。里面的编辑室有布莱克本，画室有韦恩。
