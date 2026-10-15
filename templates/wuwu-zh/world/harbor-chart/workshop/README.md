---
type: gate
name: 工坊 · 从船上脱落的零件
title: 工坊 · 从船上脱落的零件
bg: assets/scenes/workshop.webp
choice:
  options:
    - id: search
      label: 在台钳上拆开扣件（掷骰）
    - id: action-1
      label: 调查船的零件
    - id: action-2
      label: 向薇拉询问物主
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/workshop.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/harbor-chart/workshop/crest-clasp.md
  action-2:
    kind: character
    character: vera
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: mechanical_repair
    label: 在台钳上拆开扣件（掷骰）
    title: 在薇拉的台钳上拆开扣件
    body: |-
      扣件还是完整的。夹在薇拉的台钳上拆开，也许能看见纹章底下藏着的订货印——也可能销子一断，连那道新擦痕一起毁掉。

      这一掷决定的是：工坊这条线能不能当场钉上，也关系到扣件本身。点数好，证据直接进包；点数差，只拿到半条线；点数很糟，零件会坏，薇拉会很难过。没钉上的线不会丢：卡上会打开一条“绕远路”，请薇拉去翻订货簿，只是要多耗一段潮水。

      不需要掷骰、随时可以做的事：阅读零件的说明，向薇拉询问物主。它们不耗潮水，但不会替你钉线。

      1d100（机械维修 60）：掷出小于等于技能值即成功，越低越好。
      96–100（5%）：销子崩断，划破了你的手，薇拉看见了，她会记住这件事；潮水多耗一步；带着灯油的话，慌乱里会把它烧光。只能绕远路。
      61–95（35%）：锈盖住订货印，只拿到半条线（纹章的拓印）。只能绕远路。
      13–60（48%）：读出订货印，证据“领主家账簿的一页”进包，指认卡打✓。
      1–12（12%）：同上，而且查得快：这一掷不耗潮水。

      潮水：每掷一次少一步（大成功除外）；落在 96–100 再少一步；绕远路再少一步。这张卡只能掷一次。
    roll_dice:
      type: 2d10
      desc: 在薇拉的台钳上拆开扣件
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
        text: 销子在台钳里崩断了，弹开的那一截划破了你的手，那道新擦痕跟着断下的一截一起没了。薇拉盯着断口没说话。这条线没钉上；零件已经不会说话了，只能绕远路，请薇拉去翻订货簿。
        options:
          - id: long-way
            label: 绕远路：请薇拉去翻订货簿
            action:
              kind: read
              paths:
                - world/harbor-chart/workshop/05-long-way.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: 扣件打开了，可订货印被锈盖住。你只拓下了领主家的纹章——说明是哪一家，说明不了是哪艘船。你拿到的是半条线，要钉上它得绕远路。
        options:
          - id: long-way
            label: 绕远路：请薇拉去翻订货簿
            action:
              kind: read
              paths:
                - world/harbor-chart/workshop/05-long-way.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: 锈一片片剥落，纹章底下的订货印清清楚楚：记在领主家的账上，订给一艘不在港口船册里的船。工坊的线钉上了。
        options:
          - id: read-evidence
            label: 看这条证据
            action:
              kind: read
              paths:
                - player/ledger-page.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: 台钳一松，订货印就露了出来，连那道新擦痕的高度都和7号码头的擦痕对得上。工坊的线钉上了，而且查得快，潮水几乎没动。
        options:
          - id: read-evidence
            label: 看这条证据
            action:
              kind: read
              paths:
                - player/ledger-page.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank >= 3
          run: evidence-ledger
          on_error: continue
        - when: roll.rank <= 2
          run: miss-workshop
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
    crest-clasp: [0.47, 0.52]
    player: [0.42, 0.88]
  plan:
    picture: assets/maps/workshop.webp
    pins:
      crest-clasp: [0.5, 0.39]
      player: [0.46, 0.72]
---

一个从船舵上脱落的零件搁在灯下的工作台上，是薇拉放在那儿的。零件上有领主家族的纹章。

它出自哪艘船，就是线索。读零件的说明、问薇拉物主，都不用掷骰。要把这里的线钉上，得在台钳上拆开扣件——点数决定你读出订货印、只拓下纹章，还是把销子弄断。
