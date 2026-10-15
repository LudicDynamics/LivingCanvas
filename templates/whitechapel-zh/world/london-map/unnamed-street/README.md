---
type: gate
name: 无名街 · 地图上没有的地址
title: 无名街 · 地图上没有的地址
bg: assets/backgrounds/fourth.webp
intent: 这里提到的记录，要等玩家搜查并掷骰之后才会出现；在那之前不要出示或复述。revision-scrap.md
  是地图核对的结果。meeting-options.md 是供商量用的已知手段。不要当作已经发出邀约。只执行已商定的计划。
choice:
  options:
    - id: search
      label: 搜查这里（掷骰）
    - id: action-2
      label: 和华生商量安全地把对方叫来的办法
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/fourth.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-2:
    kind: character
    character: watson
search:
  - id: scene
    skill: stealth
    label: 搜查这里（掷骰）
    title: 选择可以埋伏的地点
    body: |-
      你决定亲手搜查这里。线索还没有找到——要等掷完骰子才会出现。

      1d100：数字越小越好，60及以下为成功。
      1–12：大成功。找到线索，还多发现一件别人漏掉的东西。
      13–60：成功。找到线索，并留下一份调查备忘。
      61–95：失败。只看清了一半：拿到的是写着还缺什么的半条线索，不是线索本身，而且多花了时间。
      96–100：大失败。只剩半条线索，耽误了大量时间，还因为搜得太急，可能会受伤。

      时间一直走向正午：失败多花一格时间，大失败多花两格。漏掉的线索不会从案子里消失，别的地方仍可能把你引向真相。每个地方只能搜一次，不能重掷。骰子停下后，作家会讲述你搜到了什么。
    roll_dice:
      type: 1d100
      desc: 选择可以埋伏的地点
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
        text: 不仅看清了核心，连下一步要核实的步骤也清楚了。虚构的街道去不了。可以利用真实存在的中庭，请编辑以确认地址为由居中安排。没必要让伊迪丝本人当诱饵。出示原件再提问，就能把推测和证词分开核实。街角卖地图的老人还记得今早来问路的人。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap.md
                - world/london-map/unnamed-street/meeting-options.md
                - world/london-map/unnamed-street/asked-the-way.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap.md
            title: 新地址并不存在
            body: |-
              新地址在市区地图和住址簿上都找不到。去那里守候的作战行不通。

              作为替代，可以请求在印刷所中庭安排一次核对地址的会面。和华生商量好叫谁、问什么吧。
          - path: world/london-map/unnamed-street/meeting-options.md
            title: 在中庭核实的作战
            body: |-
              有一个办法：请编辑转达“想确认一下地址”，把你在意的人叫到中庭来。可以和华生商定暗号和回去的路线。伊迪丝留在221B，只使用原稿的副本。

              现在还没有叫任何人。你决定尝试这个方案后，再确认对方的回复，继续推进。
            portable: false
          - path: world/london-map/unnamed-street/asked-the-way.md
            title: 打听那条街的人
            body: |-
              街角卖地图的老人说，今天上午九点前后，有个袖口沾着一抹蓝的年轻人来问过这条街，问了三遍，右手一直揣在怀里。

              “我说伦敦没这条街，他脸都白了。”

              伊迪丝改的地址，在8:15之后只有一个人读到过。
      - min: 13
        max: 60
        text: 观察串联起来了。虚构的街道去不了。可以利用真实存在的中庭，请编辑以确认地址为由居中安排。没必要让伊迪丝本人当诱饵。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap.md
                - world/london-map/unnamed-street/meeting-options.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap.md
            title: 新地址并不存在
            body: |-
              新地址在市区地图和住址簿上都找不到。去那里守候的作战行不通。

              作为替代，可以请求在印刷所中庭安排一次核对地址的会面。和华生商量好叫谁、问什么吧。
          - path: world/london-map/unnamed-street/meeting-options.md
            title: 在中庭核实的作战
            body: |-
              有一个办法：请编辑转达“想确认一下地址”，把你在意的人叫到中庭来。可以和华生商定暗号和回去的路线。伊迪丝留在221B，只使用原稿的副本。

              现在还没有叫任何人。你决定尝试这个方案后，再确认对方的回复，继续推进。
            portable: false
          - path: world/london-map/unnamed-street/investigation-success.md
            title: 调查备忘
            body: 观察串联起来了。虚构的街道去不了。可以利用真实存在的中庭，请编辑以确认地址为由居中安排。没必要让伊迪丝本人当诱饵。
      - min: 61
        max: 95
        text: 你在附近走了两圈，没找到那条新街，却始终没机会查地图和住址簿确认。这次搜查花了太久。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap-half.md
                - world/london-map/unnamed-street/meeting-options.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap-half.md
            title: 还没找到的新街道
            body: |-
              你在新地址附近的街上走了一圈，没找到那条街，可也没来得及去查市区地图和住址簿。

              还缺：那条街根本不存在的证据，也就不知道会面真正能安排在哪里。
            partial: true
          - path: world/london-map/unnamed-street/meeting-options.md
            title: 在中庭核实的作战
            body: |-
              有一个办法：请编辑转达“想确认一下地址”，把你在意的人叫到中庭来。可以和华生商定暗号和回去的路线。伊迪丝留在221B，只使用原稿的副本。

              现在还没有叫任何人。你决定尝试这个方案后，再确认对方的回复，继续推进。
            portable: false
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 搜查的动静传了出去，失去了悄悄查看的机会。你只知道自己没找到那条街。巷口冲出一辆送煤的马车，你躲得太急，撞在了墙上。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap-half.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap-half.md
            title: 还没找到的新街道
            body: |-
              你在新地址附近的街上走了一圈，没找到那条街，可也没来得及去查市区地图和住址簿。

              还缺：那条街根本不存在的证据，也就不知道会面真正能安排在哪里。
            partial: true
        harm: light
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-address
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/unnamed-street.webp
    pins:
      revision-scrap:
        - 0.34
        - 0.4
      meeting-options:
        - 0.66
        - 0.42
      player:
        - 0.5
        - 0.82
---

小说里的新地址并不存在。没法去那里守着。你现在所在的，是可以实际见面谈话的印刷所中庭。

有一个办法：请编辑以确认地址为由，把你在意的人叫到这里来。和华生商量一下，叫谁、要确认什么。没必要把伊迪丝带到危险的地方去。
