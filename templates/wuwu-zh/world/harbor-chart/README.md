---
type: gate
name: 港口地图 · 调查那艘船
title: 港口地图 · 调查那艘船
bg: assets/scenes/harbor-chart.webp
requires:
  items:
    - player/commission-letter.md
    - player/investigator-badge.md
blocked: 请把委托书和调查员徽章都放进包里。
intent: 这里是地点一览。收集证据的顺序自由。归途是港务所。不允许仅凭叙述越过未持有的物品。这是封闭的一局：只有三个结局（揭穿、追丢、被雾吞），结局只由引擎的 end 触发，作家不宣布结局，也不在 beyond-the-fog 等处生成新地点。
bgVideo: assets/motion/seedance/backgrounds/map.webm
choice:
  options:
    - id: search
      label: 决定性判定：在雾里找第二道航迹（掷骰）
    - id: go-accuse
      label: 看指认卡：哪些线已经钉上
  allow_free: true
choice_actions:
  search:
    kind: search
    spot: fog
  go-accuse:
    kind: read
    paths:
      - world/harbor-chart/05-accuse.md
search:
  - id: fog
    skill: navigate
    label: 决定性判定：在雾里找第二道航迹（掷骰）
    title: 决定性判定 · 在雾里找第二道航迹
    body: |-
      这是整局最险的一次判定：趁潮水还没回涨，站到港口最外头的落脚处，在雾里找出第二道航迹。这张卡只能掷一次。

      这一掷决定的是：海图上的线能不能当场钉上，还有你会不会被雾吞掉。点数好，看见航迹，证据直接进包；点数差，只看见半条线（一道水痕），得绕远路沿岸去追；点数很糟，手里有灯油就烧掉它稳住自己，没有灯油，这一局就此结束。

      不需要掷骰、随时可以做的事：在“寻找另一艘船”里摆出材料商量，重读线索，问人。它们不耗潮水，但不会替你钉线。

      1d100（导航 60）：掷出小于等于技能值即成功，越低越好。
      96–100（5%）：脚下一滑，重重摔在礁石上，伤得不轻，雾合拢过来。**手里有灯油，就点灯稳住，但那一份油会烧光，什么也没看见，只能绕远路；手里没有能点的油（没借过，或已经烧光），你会被雾吞掉，这一局就此结束。**潮水多耗一步。
      61–95（35%）：没看见船，只拿到半条线（一道水痕）。只能绕远路。
      13–60（48%）：看清第二道航迹，证据进包，指认卡打✓。
      1–12（12%）：同上，连它吃水多深都看清了，而且这一掷不耗潮水。

      潮水：每掷一次少一步（大成功除外）；落在 96–100 再少一步；绕远路再少一步。去旧灯塔借一份灯油再来，会稳妥得多。
    roll_dice:
      type: 2d10
      desc: 在雾里找第二道航迹
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
        harm: grave
        text: 脚下的湿石头一滑，你整个人摔下礁石，半边身子泡进回涨的潮水里，雾一下子合拢过来。手里有灯油，你点灯稳住了，那一份油也烧光了——什么也没看见，这条线没钉上，只能绕远路。手里没有能点的油，雾就把你吞掉了。
        options:
          - id: long-way
            label: 绕远路：沿着岸边追水痕
            action:
              kind: read
              paths:
                - world/harbor-chart/06-long-way.md
          - id: back
            label: 返回调查
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: 你没看见船，只看见雾里一道翻起的水痕，从旧海关隧道口那边拐出来，又没入雾里。你拿到的是半条线，要钉上它得绕远路。
        options:
          - id: long-way
            label: 绕远路：沿着岸边追水痕
            action:
              kind: read
              paths:
                - world/harbor-chart/06-long-way.md
          - id: back
            label: 返回调查
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: 雾薄了一瞬：第二道航迹从旧海关隧道口出来，贴着无人船擦过去，又拐回雾里。海图上的线钉上了。
        options:
          - id: read-wake
            label: 看第二道航迹
            action:
              kind: read
              paths:
                - player/second-wake.md
          - id: back
            label: 返回调查
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: 雾一让开，第二道航迹就清清楚楚：从旧海关隧道口出来，贴着无人船擦过去，吃水很深，像一艘满载的船。海图上的线钉上了，而且查得快，潮水几乎没动。
        options:
          - id: read-wake
            label: 看第二道航迹
            action:
              kind: read
              paths:
                - player/second-wake.md
          - id: back
            label: 返回调查
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank == 1 && has("player/empty-oil-flask.md") || roll.rank == 1 && has("world/harbor-chart/old-lighthouse/lamp-oil.md")
          run: fog-swallows
          on_error: continue
        - when: roll.rank == 1 && has("player/lamp-oil.md")
          run: burn-lamp-oil
          on_error: continue
        - when: roll.rank >= 3
          run: evidence-wake
          on_error: continue
        - when: roll.rank <= 2
          run: miss-chart
          on_error: continue
        - when: roll.rank <= 3
          run: tide-step
          on_error: continue
        - when: roll.rank == 1
          run: tide-surge
          on_error: continue
map:
  pins:
    old-lighthouse: [0.22, 0.24]
    seventh-berth: [0.42, 0.52]
    workshop: [0.64, 0.62]
    player: [0.17, 0.87]
  plan:
    picture: assets/maps/harbor-chart.webp
    pins:
      old-lighthouse: [0.19, 0.12]
      seventh-berth: [0.47, 0.5]
      workshop: [0.85, 0.48]
      player: [0.16, 0.73]
---

先去7号码头，看看船上留下的伤痕。在工坊可以调查船的零件，在灯塔可以调查灯熄灭的时间。顺序随你。

读线索、问人、摆材料都不耗潮水，也不用掷骰。每个地点另有一张只能掷一次的调查骰卡：点数决定那条线能不能当场钉上——成功就把证据放进包里；没成功只拿到半条线，或者惊动了人，得绕远路再钉，多耗潮水。海图上还有一次最险的决定性判定：在雾里找第二道航迹——最好先去旧灯塔借一份灯油。掷坏了也会受伤——湿滑的礁石、舷梯、灯塔的楼梯、回涨的潮水——伤得太重，就走不到指认那一步了。

四条线都钉上之后，到指认卡上指认。潮水回涨前没指认，第二艘船就会消失在雾里。
