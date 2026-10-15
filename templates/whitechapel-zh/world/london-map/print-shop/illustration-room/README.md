---
type: gate
name: 画室 · 问问韦恩
title: 画室 · 问问韦恩
bg: assets/backgrounds/press.webp
intent: 这里提到的记录，要等玩家搜查并掷骰之后才会出现；在那之前不要出示或复述。以 visible-details.md
  和传阅记录为依据回应提问。不能仅凭态度或伤势就定罪。不要把尚未出示的证据当作已出示，记下实际的回答。
choice:
  options:
    - id: search
      label: 搜查这里（掷骰）
    - id: action-1
      label: 问韦恩手腕的伤和交画的时间
    - id: action-2
      label: 确认他是否读过订正后的地址
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/press.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: wayne
  action-2:
    kind: character
    character: wayne
search:
  - id: scene
    skill: psychology
    label: 搜查这里（掷骰）
    title: 检验画师的说法
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
      desc: 检验画师的说法
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
        text: 不仅看清了核心，连下一步要核实的步骤也清楚了。右手的新绷带、群青色的袖口、事件前就送到的画。这足以成为重点调查韦恩的依据，但仅凭伤势还不能逮捕。出示原件再提问，就能把推测和证词分开核实。画架后面还压着一叠被退回的校样。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details.md
                - world/london-map/print-shop/illustration-room/returned-proofs.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details.md
            title: 韦恩的伤与颜料
            body: |-
              右手腕缠着新绷带。袖子上有蓝色颜料。桌上放着改过地址的原稿。

              现场也有蓝色颜料，以及右手撞到的痕迹。可以问韦恩是什么时候、在哪里受的伤。画在事件之前就已送到，所以如果他说“看了现场才画的”，时间就对不上。
            portable: false
          - path: world/london-map/print-shop/illustration-room/returned-proofs.md
            title: 退回的校样
            body: |-
              画架背后压着一叠被退回的校样，每一张都是韦恩画的插图。布莱克本主编的红笔批语写在页边：“下月起连载不配插图，省下版面。”

              最底下一张，是韦恩自己的字：“他们会看到的——画比字先到。”

              这说明他为什么非要让事件照着画发生。但这叠纸本身不是罪证，只是他的心事。
      - min: 13
        max: 60
        text: 观察串联起来了。右手的新绷带、群青色的袖口、事件前就送到的画。这足以成为重点调查韦恩的依据，但仅凭伤势还不能逮捕。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details.md
            title: 韦恩的伤与颜料
            body: |-
              右手腕缠着新绷带。袖子上有蓝色颜料。桌上放着改过地址的原稿。

              现场也有蓝色颜料，以及右手撞到的痕迹。可以问韦恩是什么时候、在哪里受的伤。画在事件之前就已送到，所以如果他说“看了现场才画的”，时间就对不上。
            portable: false
          - path: world/london-map/print-shop/illustration-room/investigation-success.md
            title: 调查备忘
            body: 观察串联起来了。右手的新绷带、群青色的袖口、事件前就送到的画。这足以成为重点调查韦恩的依据，但仅凭伤势还不能逮捕。
      - min: 61
        max: 95
        text: 韦恩一直把右臂藏着，嘴上说个不停。你瞥见他袖口有一块污渍，却没有能拿来问他的东西。这次搜查花了太久。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details-half.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details-half.md
            title: 瞥见的韦恩袖口
            body: |-
              韦恩把右臂藏在画架后面，袖子也放了下来。你只瞥见他袖口有一块污渍，别的什么也没看到。

              还缺：他的手腕、污渍的颜色，以及他桌上放着的东西。没有这些，就没有什么能拿来问他。
            partial: true
            portable: false
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 搜查的动静传了出去，失去了悄悄查看的机会。韦恩把桌上的纸翻过去扣着，挡在你和画架之间。
        options:
          - id: read-clue
            label: 阅读线索
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details-half.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details-half.md
            title: 瞥见的韦恩袖口
            body: |-
              韦恩把右臂藏在画架后面，袖子也放了下来。你只瞥见他袖口有一块污渍，别的什么也没看到。

              还缺：他的手腕、污渍的颜色，以及他桌上放着的东西。没有这些，就没有什么能拿来问他。
            partial: true
            portable: false
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-hand
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/illustration-room.webp
    pins:
      visible-details:
        - 0.39
        - 0.4
      wayne:
        - 0.59
        - 0.44
      player:
        - 0.26
        - 0.86
---

画插图的韦恩，右手腕缠着新绷带。袖子上有蓝色颜料。桌上放着改过地址的原稿。

这也许和现场的痕迹有关。问问他手上的伤，以及交画的时间吧。但光凭伤，还不能断定他就是犯人。
