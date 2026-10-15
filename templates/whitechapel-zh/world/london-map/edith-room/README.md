---
type: gate
name: 221B客厅 · 作者的讲述
title: 221B客厅 · 作者的讲述
bg: assets/backgrounds/intro.webp
intent: 这里提到的记录，要等玩家搜查并掷骰之后才会出现；在那之前不要出示或复述。以 address-correction.md
  为出处，把本人的怀疑与确定的事实分开。被保护的人也有自己的意愿。不要擅自编造她同意外出当诱饵。
choice:
  options:
    - id: search
      label: 搜查这里（掷骰）
    - id: action-1
      label: 问她为什么改地址
    - id: action-2
      label: 问她把订正稿交给了谁
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/intro.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: edith
  action-2:
    kind: character
    character: edith
search:
  - id: scene
    skill: psychology
    label: 搜查这里（掷骰）
    title: 解开虚构地址的用意
    body: |-
      你决定亲手搜查这里。线索还没有找到——要等掷完骰子才会出现。

      1d100：数字越小越好，60及以下为成功。
      1–12：大成功。找到线索，还多发现一件别人漏掉的东西。
      13–60：成功。找到线索，并留下一份调查备忘。
      61–95：失败。只看清了一半：拿到的是写着还缺什么的半条线索，不是线索本身，而且多花了时间。
      96–100：大失败。只剩半条线索，耽误了大量时间，搜查的动静也被人察觉了。

      时间一直走向正午：失败多花一格时间，大失败多花两格。漏掉的线索不会从案子里消失，别的地方仍可能把你引向真相。每个地方只能搜一次，不能重掷。骰子停下后，作家会讲述你搜到了什么。
    roll_dice:
      type: 1d100
      desc: 解开虚构地址的用意
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
        text: 不仅看清了核心，连下一步要核实的步骤也清楚了。伊迪丝用虚构的地址试探对方的反应，并不是打算把人叫到那里去。去追查订正稿交到了谁手里。出示原件再提问，就能把推测和证词分开核实。伊迪丝的原稿副本里，还夹着一行她自己的批注。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction.md
                - world/london-map/edith-room/margin-note.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction.md
            title: 伊迪丝改地址的理由
            body: |-
              今天早上，伊迪丝把小说里的地址改成了一条并不存在的街道，交给了编辑。

              “要是有人想去那里，就会发现根本没有这条街。我想知道，谁会因此犯难来问。”

              这是她自己想出的调查方法。还没有找到犯人。可以通过编辑室的记录核实，下一个读到那份原稿的是谁。
          - path: world/london-map/edith-room/margin-note.md
            title: 页边的一行字
            body: |-
              伊迪丝的原稿副本上，第三章那一页的页边有她的铅笔字：“帽子？我从没写过帽子。椅子也不在窗边。”

              第三现场的帽子和椅子，和插图一模一样，却不在她的小说里。照着布置现场的人，看的是画，不是字。
      - min: 13
        max: 60
        text: 观察串联起来了。伊迪丝用虚构的地址试探对方的反应，并不是打算把人叫到那里去。去追查订正稿交到了谁手里。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction.md
            title: 伊迪丝改地址的理由
            body: |-
              今天早上，伊迪丝把小说里的地址改成了一条并不存在的街道，交给了编辑。

              “要是有人想去那里，就会发现根本没有这条街。我想知道，谁会因此犯难来问。”

              这是她自己想出的调查方法。还没有找到犯人。可以通过编辑室的记录核实，下一个读到那份原稿的是谁。
          - path: world/london-map/edith-room/investigation-success.md
            title: 调查备忘
            body: 观察串联起来了。伊迪丝用虚构的地址试探对方的反应，并不是打算把人叫到那里去。去追查订正稿交到了谁手里。
      - min: 61
        max: 95
        text: 你看出第四章的地址被改过，却不知道为什么；伊迪丝还太害怕，没法解释。这次搜查花了太久。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction-half.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction-half.md
            title: 说不清理由的新地址
            body: |-
              伊迪丝的草稿上，第四章的地址被划掉，换成了另一条街。她为什么要改，稿子上没写，她也惊魂未定，说不出来。

              还缺：她的理由。没有它，新地址看起来只是一处普通的订正。
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 搜查的动静传了出去，失去了悄悄查看的机会。伊迪丝把原稿收了回去，暂时不肯再让你看。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction-half.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction-half.md
            title: 说不清理由的新地址
            body: |-
              伊迪丝的草稿上，第四章的地址被划掉，换成了另一条街。她为什么要改，稿子上没写，她也惊魂未定，说不出来。

              还缺：她的理由。没有它，新地址看起来只是一处普通的订正。
            partial: true
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-address
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/edith-room.webp
    pins:
      address-correction:
        - 0.36
        - 0.38
      edith:
        - 0.78
        - 0.53
      player:
        - 0.47
        - 0.85
---

小说家伊迪丝在这里受华生保护。“小说是我写的。可我从没想过要伤害任何人。”

她今早改了小说里的地址。问问她为什么改，又交给了谁。
