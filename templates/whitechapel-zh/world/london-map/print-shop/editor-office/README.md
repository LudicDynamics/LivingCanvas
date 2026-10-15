---
type: gate
name: 编辑室 · 原稿交给了谁
title: 编辑室 · 原稿交给了谁
bg: assets/backgrounds/press.webp
intent: 这里提到的记录，要等玩家搜查并掷骰之后才会出现；在那之前不要出示或复述。以 correction-log.md
  为依据，把原稿流转的责任与参与犯罪分开。不透露病人的所在。
choice:
  options:
    - id: search
      label: 搜查这里（掷骰）
    - id: action-1
      label: 问订正稿传给了谁
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/press.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: blackburn
search:
  - id: scene
    skill: library_use
    label: 搜查这里（掷骰）
    title: 追查订正稿的去向
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
      desc: 追查订正稿的去向
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
        text: 不仅看清了核心，连下一步要核实的步骤也清楚了。编辑在上午8点收到，8:15转给了韦恩。订正后的地址并不只是作者和编辑之间的秘密。出示原件再提问，就能把推测和证词分开核实。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log.md
            title: 改了地址的原稿去了哪里
            body: |-
              今天上午8点：布莱克本从伊迪丝那里收到了原稿。
              8:15：他把那份原稿交给了韦恩。签收人的名字也是韦恩。

              新地址韦恩也能读到。去画室问问他是否真的读过。仅仅收到原稿，并不能断定就是他作的案。
          - path: world/london-map/print-shop/editor-office/investigation-great-success.md
            title: 记下核心的备忘
            body: 不仅看清了核心，连下一步要核实的步骤也清楚了。编辑在上午8点收到，8:15转给了韦恩。订正后的地址并不只是作者和编辑之间的秘密。出示原件再提问，就能把推测和证词分开核实。
      - min: 13
        max: 60
        text: 观察串联起来了。编辑在上午8点收到，8:15转给了韦恩。订正后的地址并不只是作者和编辑之间的秘密。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log.md
            title: 改了地址的原稿去了哪里
            body: |-
              今天上午8点：布莱克本从伊迪丝那里收到了原稿。
              8:15：他把那份原稿交给了韦恩。签收人的名字也是韦恩。

              新地址韦恩也能读到。去画室问问他是否真的读过。仅仅收到原稿，并不能断定就是他作的案。
          - path: world/london-map/print-shop/editor-office/investigation-success.md
            title: 调查备忘
            body: 观察串联起来了。编辑在上午8点收到，8:15转给了韦恩。订正后的地址并不只是作者和编辑之间的秘密。
      - min: 61
        max: 95
        text: 布莱克本一直守在桌边。你看到改过的原稿上午8点送到，却没看到它接下来去了哪里。这次搜查花了太久。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log-half.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log-half.md
            title: 只看了一半的传阅记录
            body: |-
              布莱克本的传阅记录上写着，伊迪丝改过的原稿上午8点送到。下一行写着交给了谁，却压在吸墨纸下面，他不让你掀开。

              还缺：8点以后原稿交到了谁手里，签收的又是谁。
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 搜查的动静传了出去，失去了悄悄查看的机会。布莱克本合上记录簿，冷冷地请你别再碰他的文件。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log-half.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log-half.md
            title: 只看了一半的传阅记录
            body: |-
              布莱克本的传阅记录上写着，伊迪丝改过的原稿上午8点送到。下一行写着交给了谁，却压在吸墨纸下面，他不让你掀开。

              还缺：8点以后原稿交到了谁手里，签收的又是谁。
            partial: true
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-address
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/editor-office.webp
    pins:
      correction-log:
        - 0.5
        - 0.42
      blackburn:
        - 0.73
        - 0.27
      player:
        - 0.27
        - 0.8
---

编辑布莱克本管理着原稿。今天早上，伊迪丝送来了改过地址的原稿。

那份原稿，接下来交给了谁？搜查一下他的桌子，或者直接问他本人吧。
