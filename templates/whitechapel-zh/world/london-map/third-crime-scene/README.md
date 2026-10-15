---
type: gate
name: 第三现场 · 和画一模一样
title: 第三现场 · 和画一模一样
bg: assets/backgrounds/scene3.webp
intent: 这里提到的记录，要等玩家搜查并掷骰之后才会出现；在那之前不要出示或复述。以 pigment-record.md
  为依据回答。不能仅凭群青就断定是谁。画和事件孰先孰后，引导去看验尸室的时间记录；谁能看到原稿，引导去印刷所。
choice:
  options:
    - id: search
      label: 搜查这里（掷骰）
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/scene3.webm
choice_actions:
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: spot_hidden
    label: 搜查这里（掷骰）
    title: 看穿构图的违和之处
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
      desc: 看穿构图的违和之处
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
        text: 不仅看清了核心，连下一步要核实的步骤也清楚了。连椅子和帽子都一样。这不是巧合，很可能是有人照着画布置了现场。去向画师确认群青颜料和右手的痕迹。出示原件再提问，就能把推测和证词分开核实。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record.md
            title: 现场留下的蓝色颜料
            body: |-
              栏杆上沾着与画筒盖相似的蓝色颜料。从旁边的痕迹看，有人似乎撞到了右手。椅子和帽子也和小说插图的位置相同。

              可能是熟悉这幅画的人布置了现场。去印刷所查查画这幅画的人，确认他右手有没有受伤。
          - path: world/london-map/third-crime-scene/investigation-great-success.md
            title: 记下核心的备忘
            body: 不仅看清了核心，连下一步要核实的步骤也清楚了。连椅子和帽子都一样。这不是巧合，很可能是有人照着画布置了现场。去向画师确认群青颜料和右手的痕迹。出示原件再提问，就能把推测和证词分开核实。
      - min: 13
        max: 60
        text: 观察串联起来了。连椅子和帽子都一样。这不是巧合，很可能是有人照着画布置了现场。去向画师确认群青颜料和右手的痕迹。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record.md
            title: 现场留下的蓝色颜料
            body: |-
              栏杆上沾着与画筒盖相似的蓝色颜料。从旁边的痕迹看，有人似乎撞到了右手。椅子和帽子也和小说插图的位置相同。

              可能是熟悉这幅画的人布置了现场。去印刷所查查画这幅画的人，确认他右手有没有受伤。
          - path: world/london-map/third-crime-scene/investigation-success.md
            title: 调查备忘
            body: 观察串联起来了。连椅子和帽子都一样。这不是巧合，很可能是有人照着画布置了现场。去向画师确认群青颜料和右手的痕迹。
      - min: 61
        max: 95
        text: 雾气和围观的人群。你瞥见栏杆上的一抹蓝色和摆得太整齐的椅子，却看不清那是什么、是谁留下的。这次搜查花了太久。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record-half.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record-half.md
            title: 只看到一半的现场蓝痕
            body: |-
              栏杆上某处有一抹蓝色，椅子也摆得过分整齐。可地上湿、人又多，你没看清那蓝色是什么，也不知道有没有人在这里受过伤。

              还缺：那是什么颜料，以及右手撞过的痕迹。没有这些，现场指不向任何人。
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 搜查的动静传了出去，失去了悄悄查看的机会。你只瞥见一抹蓝色。你探身去看栏杆外侧时，湿滑的铁栏一晃，你从台阶上摔了下去，重重磕在石阶上。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record-half.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record-half.md
            title: 只看到一半的现场蓝痕
            body: |-
              栏杆上某处有一抹蓝色，椅子也摆得过分整齐。可地上湿、人又多，你没看清那蓝色是什么，也不知道有没有人在这里受过伤。

              还缺：那是什么颜料，以及右手撞过的痕迹。没有这些，现场指不向任何人。
            partial: true
        harm: serious
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-hand
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/third-crime-scene.webp
    pins:
      pigment-record:
        - 0.3
        - 0.29
      player:
        - 0.5
        - 0.82
---

椅子和帽子，都摆在和小说插图相同的位置。似乎有人故意照着画布置了现场。栏杆上有蓝色颜料，还有手撞上去的痕迹。

先搜查一下现场吧，找到什么要等掷完骰子才知道。画和事件哪个在先，可以去验尸室和印刷所确认。
