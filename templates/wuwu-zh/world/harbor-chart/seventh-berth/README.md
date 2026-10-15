---
type: gate
name: 7号码头 · 船上的伤痕
title: 7号码头 · 船上的伤痕
bg: assets/scenes/seventh-berth.webp
intent: 调查过水位痕迹后，让对方读实际的记录。银鸢即使出示空箱，也不会断定那艘不明船只的全貌。
choice:
  options:
    - id: search
      label: 趁换岗溜上船翻货舱（掷骰）
    - id: action-1
      label: 阅读船上伤痕的说明
    - id: action-2
      label: 向银鸢询问箱子的事
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/dock.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/harbor-chart/seventh-berth/waterline-trace.md
  action-2:
    kind: character
    character: silver-kite
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: stealth
    label: 趁换岗溜上船翻货舱（掷骰）
    title: 趁换岗溜上无人船，翻开空货舱
    body: |-
      银鸢正在换岗，舷梯有一分钟没人看着——够你溜上那艘无人船，撬开它的货舱。

      这一掷决定的是：7号码头这条线能不能当场钉上。点数好，证据直接进包；点数差，只拿到半条线；点数很糟，会被银鸢当场抓住。没钉上的线不会丢：卡上会打开一条“绕远路”，当面请银鸢开舱，只是要多耗一段潮水。

      不需要掷骰、随时可以做的事：阅读擦痕的记录，向银鸢询问箱子的事。它们不耗潮水，但不会替你钉线。

      1d100（潜行 60）：掷出小于等于技能值即成功，越低越好。
      96–100（5%）：被银鸢撞见，在舷梯上磕伤了。什么也没拿到，他会记住这件事；潮水多耗一步；带着灯油的话，慌乱里会把它烧光。只能绕远路。
      61–95（35%）：来不及开货舱，只拿到半条线（一片别的船的漆）。只能绕远路。
      13–60（48%）：打开货舱，证据“那艘船是诱饵”进包，指认卡打✓。
      1–12（12%）：同上，而且查得快：这一掷不耗潮水。

      潮水：每掷一次少一步（大成功除外）；落在 96–100 再少一步；绕远路再少一步。这张卡只能掷一次。
    roll_dice:
      type: 2d10
      desc: 趁换岗溜上无人船，翻开空货舱
      expect: ">=11"
    choice:
      options:
        - id: back
          label: 先不掷骰，返回地图
    choice_actions:
      back:
        kind: enter
        target: world/harbor-chart
    dice_outcomes:
      - min: 2
        max: 4
        harm: light
        text: 刚到舷梯顶上，银鸢的手就揪住了你的衣领，把你拽了下来，肋骨一路撞在栏杆上。货舱的事他一个字也没说——只把舷梯对你关上了。这条线没钉上；想知道货舱里有什么，得绕远路，当面去找他。
        options:
          - id: long-way
            label: 绕远路：当面请银鸢打开货舱
            action:
              kind: read
              paths:
                - world/harbor-chart/seventh-berth/05-long-way.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: 来不及开货舱。你只从比满潮线还高的擦痕上刮下一片别的船的黑漆——能证明有第二艘船，证明不了这艘是诱饵。你拿到的是半条线，要钉上它得绕远路。
        options:
          - id: long-way
            label: 绕远路：当面请银鸢打开货舱
            action:
              kind: read
              paths:
                - world/harbor-chart/seventh-berth/05-long-way.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: 舱盖撬开了。里面只有压舱石和钉死的空箱。这艘船是故意空着放出来的——7号码头的线钉上了。
        options:
          - id: read-evidence
            label: 看这条证据
            action:
              kind: read
              paths:
                - player/decoy-ship.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: 舱盖一撬就开，你趁银鸢回来之前就清点完了：压舱石和钉死的空箱。7号码头的线钉上了，而且查得快，潮水几乎没动。
        options:
          - id: read-evidence
            label: 看这条证据
            action:
              kind: read
              paths:
                - player/decoy-ship.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank >= 3
          run: evidence-decoy
          on_error: continue
        - when: roll.rank <= 2
          run: miss-berth
          on_error: continue
        - when: roll.rank == 1 && has("player/lamp-oil.md")
          run: burn-lamp-oil
          on_error: continue
        - when: roll.rank <= 3
          run: tide-step
          on_error: continue
        - when: roll.rank == 1
          run: tide-surge
          on_error: continue
map:
  pins:
    waterline-trace: [0.22, 0.66]
    silver-kite: [0.68, 0.76]
    player: [0.5, 0.9]
  plan:
    picture: assets/maps/seventh-berth.webp
    pins:
      waterline-trace: [0.27, 0.3]
      silver-kite: [0.63, 0.63]
      player: [0.5, 0.88]
---

骑士银鸢看守着一艘空无一人的船。船侧有一道伤痕，位置比水面高得多。

是什么撞上了船？读伤痕的记录、问银鸢空箱的事，都不用掷骰。要把这里的线钉上，得趁换岗溜上船翻货舱——点数决定你拿到证据、半条线，还是被银鸢当场抓住。
