---
type: gate
name: 旧灯塔 · 熄灭的灯光
title: 旧灯塔 · 熄灭的灯光
bg: assets/scenes/old-lighthouse.webp
intent: 借灯油由“借一份灯油”按钮确定地把 world/harbor-chart/old-lighthouse/lamp-oil.md 移到 player/lamp-oil.md，作家不另造灯油、不补发第二份。日志只能证明熄灯的时刻。不要把老莫不知道的第二艘船捏造成他的记忆。
choice:
  options:
    - id: search
      label: 用望远镜看旧隧道口（掷骰）
    - id: action-1
      label: 阅读灯塔日志
    - id: action-2
      label: 借一份灯油
    - id: action-3
      label: 问老莫那十二分钟的事
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/lighthouse.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/harbor-chart/old-lighthouse/lighthouse-logbook.md
  action-2:
    kind: take
    paths:
      - world/harbor-chart/old-lighthouse/lamp-oil.md
  action-3:
    kind: character
    character: old-mo
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: spot_hidden
    label: 用望远镜看旧隧道口（掷骰）
    title: 用老莫的望远镜看旧隧道口
    body: |-
      站在灯廊上，老莫那支黄铜望远镜能一直看到港口对面的旧海关隧道口——前提是雾肯让开，而你的手在湿栏杆上稳得住。

      这一掷决定的是：旧灯塔这条线能不能当场钉上，也关系到老莫的望远镜。点数好，证据直接进包；点数差，只拿到半条线；点数很糟，望远镜会摔裂。没钉上的线不会丢：卡上会打开一条“绕远路”，请老莫拿日志一分一分对，只是要多耗一段潮水。

      不需要掷骰、随时可以做的事：阅读灯塔日志，问老莫那十二分钟的事，借一份灯油。它们不耗潮水，但不会替你钉线。

      1d100（侦查 60）：掷出小于等于技能值即成功，越低越好。
      96–100（5%）：你在湿滑的灯廊楼梯上摔了一跤，望远镜也摔裂了，老莫看见了，他会记住这件事；潮水多耗一步；带着灯油的话，慌乱里会把它烧光。只能绕远路。
      61–95（35%）：雾盖住隧道口，只拿到半条线（今晚的潮汐表）。只能绕远路。
      13–60（48%）：看清隧道口，证据“旧海关隧道与熄灯的十二分钟”进包，指认卡打✓。
      1–12（12%）：同上，而且查得快：这一掷不耗潮水。

      潮水：每掷一次少一步（大成功除外）；落在 96–100 再少一步；绕远路再少一步。这张卡只能掷一次。
    roll_dice:
      type: 2d10
      desc: 用老莫的望远镜看旧隧道口
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
        harm: serious
        text: 灯廊的湿台阶上你脚下一空，望远镜滑出去磕在石头上裂了，你自己也仰面摔下了几级楼梯。老莫看见了。这条线没钉上；再问他那夜的事之前，得先赔个不是，再绕远路和他一起对日志。
        options:
          - id: long-way
            label: 绕远路：请老莫拿日志一分一分对
            action:
              kind: read
              paths:
                - world/harbor-chart/old-lighthouse/05-long-way.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: 雾盖住了隧道口。你只拿到老莫桌上今晚的潮汐表——说明隧道什么时候能用，说明不了熄灯的十二分钟正好对着它。你拿到的是半条线，要钉上它得绕远路。
        options:
          - id: long-way
            label: 绕远路：请老莫拿日志一分一分对
            action:
              kind: read
              paths:
                - world/harbor-chart/old-lighthouse/05-long-way.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: 雾变薄了。低潮时隧道口露出水面，而日志上熄灯的十二分钟，正好就是那一段。旧灯塔的线钉上了。
        options:
          - id: read-evidence
            label: 看这条证据
            action:
              kind: read
              paths:
                - player/customs-tunnel.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: 雾一让开，隧道口就清清楚楚：露出水面的时刻和熄灯的十二分钟严丝合缝。旧灯塔的线钉上了，而且查得快，潮水几乎没动。
        options:
          - id: read-evidence
            label: 看这条证据
            action:
              kind: read
              paths:
                - player/customs-tunnel.md
          - id: back
            label: 返回地图
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank >= 3
          run: evidence-tunnel
          on_error: continue
        - when: roll.rank <= 2
          run: miss-lighthouse
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
  - id: peek-logbook
    skill: stealth
    label: 趁老莫不注意，翻他的日志
    title: 趁老莫不注意，翻他的日志
    body: |-
      老莫的日志摊在写字台上，他正背对着你往灯里添油。

      可以趁现在翻一翻——也可以不翻，直接问他。翻不翻都不耗潮水；只是要是被他看见，之后的话就不好说了。大成功（1–12）的话他一直没回头，你还来得及把那行字抄在纸片上带走。
    roll_dice:
      type: 2d10
      desc: 趁老莫转身添油，翻开写字台上的日志
      expect: ">=11"
    on:
      roll_resolved:
        - run: peek-logbook
map:
  pins:
    lighthouse-logbook: [0.25, 0.74]
    lamp-oil: [0.16, 0.66]
    old-mo: [0.62, 0.62]
    player: [0.45, 0.9]
  plan:
    picture: assets/maps/old-lighthouse.webp
    pins:
      lighthouse-logbook: [0.35, 0.48]
      lamp-oil: [0.3, 0.36]
      old-mo: [0.56, 0.53]
      player: [0.49, 0.75]
---

灯塔看守老莫说，那天夜里他把灯熄了十二分钟。为什么偏偏是那段时间呢？

读一读日志、问老莫，都不用掷骰。要把这里的线钉上，得用老莫的望远镜看旧隧道口——点数决定你看清隧道口、只拿到潮汐表，还是把望远镜摔了。老莫只有一份灯油可借：海图上的决定性判定要站到雾里最滑的落脚处，带着它会稳妥得多。
