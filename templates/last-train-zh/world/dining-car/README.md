---
type: gate
name: "4车 · 餐车"
bg: assets/scenes/dining-car.webp
title: "4车 · 餐车"
view: canvas
intent: "第二幕的一条线（餐车之谜：4号桌那两杯茶是谁的、5车钥匙去了哪）。厨师老贺在打瞌睡，是 NPC 卡 lao-he.md（点他「对话」）：他记得十一点多4号桌是一位老先生和一个年轻姑娘，姑娘给老先生看过一张发黄的纸；停车后他睡着了，什么也没看见。5车钥匙藏在开水炉旁的煤斗里，只能通过骰子卡找到。搜查没成（61–100）时会打开绕远路卡 05-long-way.md（command/miss-dining.yaml）；选它多耗一步时间，钥匙进包（command/long-way-dining.yaml）。"
choice:
  options:
    - id: take-bill
      label: "拿走4号桌的小票"
    - id: read-teacups
      label: "看4号桌上的两只茶杯"
      once: true
    - id: search
      label: "用骰子搜餐车"
    - id: talk-laohe
      label: "和老贺聊聊"
    - id: ask-cups
      label: "两杯茶……另一杯是谁的？"
      to: companion
      say: "两杯茶……另一杯是谁喝的？"
  allow_free: true
choice_actions:
  take-bill:
    kind: take
    paths:
      - world/dining-car/tea-bill.md
  read-teacups:
    kind: read
    paths:
      - world/dining-car/two-teacups.md
  search:
    kind: search
    spot: scene
  talk-laohe:
    kind: talk
    npc: world/dining-car/lao-he.md
search:
  - id: scene
    skill: spot_hidden
    label: 用骰子搜餐车
    title: 搜餐车
    body: |-
      柜台、餐桌、开水炉、煤斗。老贺还在打瞌睡。

      1d100（侦查 60）：掷出小于等于技能值即成功，越低越好。
      96–100（5%）：摸黑出了岔子，会受不轻的伤。只拿到半条线索，还多耗一步时间；会开一条“绕远路”，多耗一步仍能拿到钥匙。
      61–95（35%）：没查顺。只拿到半条线索，还多耗一步时间；会开一条“绕远路”，多耗一步仍能拿到钥匙。
      13–60（48%）：成功。拿到线索，只耗一步时间。
      1–12（12%）：大成功。拿到线索，还多看见一点东西，而且快得不耗时间。

      每掷一次，离发车近一步（失败再多一步，大成功省回一步）。同一张卡只能掷一次，不能重掷。不想花时间，就先不掷，回到列车。
    roll_dice:
      type: 2d10
      desc: 搜餐车
      expect: ">=11"
    choice:
      options:
        - id: back
          label: 先不掷骰，回到列车
    choice_actions:
      back:
        kind: enter
        target: map
    dice_outcomes:
      - min: 2
        max: 4
        harm: serious
        text: 你先摸到了车厢连接处：应急灯照不到那里，你跨过晃动的渡板想看看5车门口，一脚踩空，小腿重重磕在车钩上。动静吵醒了老贺，他拉着你问东问西，没等你走过柜台就把你轰了出去。出门时你瞥见开水炉旁煤斗边的煤灰被人翻动过；里面有什么，你没来得及看。
        options:
          - id: long-way
            label: 绕远路：把煤斗倒出来
            action:
              kind: read
              paths:
                - world/dining-car/05-long-way.md
          - id: back
            label: 回到列车
            action:
              kind: enter
              target: map
        rewards:
          - path: world/dining-car/freight-key-half.md
            title: 半条线索 · 被翻过的煤灰
            partial: true
            body: 餐车开水炉旁煤斗边的煤灰，在老贺醒来之前就被人翻动过。煤斗里有什么，你还没看见。
      - min: 5
        max: 10
        text: 你先翻了柜台和桌底，等想到开水炉那边，老贺已经醒了，自己拿着铲子往炉里添煤。你只注意到，在他过去之前，煤斗边的煤灰就被人翻动过。
        options:
          - id: long-way
            label: 绕远路：把煤斗倒出来
            action:
              kind: read
              paths:
                - world/dining-car/05-long-way.md
          - id: back
            label: 回到列车
            action:
              kind: enter
              target: map
        rewards:
          - path: world/dining-car/freight-key-half.md
            title: 半条线索 · 被翻过的煤灰
            partial: true
            body: 餐车开水炉旁煤斗边的煤灰，在老贺醒来之前就被人翻动过。煤斗里有什么，你还没看见。
      - min: 11
        max: 17
        text: 煤斗边上的煤灰被人拨乱过。开水炉旁边的煤斗里，压在煤块底下，有一把拴着“5车 行李车”红牌的钥匙。有人不敢把它挂回驾驶室，就随手扔在了这里。
        options:
          - id: back
            label: 回到列车
            action:
              kind: enter
              target: map
          - id: to-freight
            label: 去车尾的行李车
            action:
              kind: enter
              target: world/freight-car
        rewards:
          - path: world/dining-car/freight-key.md
            image: assets/items/freight-key.webp
            title: 挂红牌的5车钥匙
            body: 在餐车开水炉旁的煤斗里找到的钥匙，红牌上写着“5车 行李车”。有人不敢把它挂回驾驶室，就扔在了这里。拿着它，就能打开车尾的行李车。
      - min: 18
        max: 20
        text: 煤斗边上的煤灰被人拨乱过。开水炉旁边的煤斗里，压在煤块底下，有一把拴着“5车 行李车”红牌的钥匙。有人不敢把它挂回驾驶室，就随手扔在了这里。煤灰上还有半个皮鞋印，是老式的硬底皮鞋。你直奔煤斗：这次搜查不耗时间。
        options:
          - id: back
            label: 回到列车
            action:
              kind: enter
              target: map
          - id: to-freight
            label: 去车尾的行李车
            action:
              kind: enter
              target: world/freight-car
        rewards:
          - path: world/dining-car/freight-key.md
            image: assets/items/freight-key.webp
            title: 挂红牌的5车钥匙
            body: 在餐车开水炉旁的煤斗里找到的钥匙，红牌上写着“5车 行李车”。有人不敢把它挂回驾驶室，就扔在了这里。拿着它，就能打开车尾的行李车。
        bonus:
          clock: 1
    on:
      roll_resolved:
        - run: train-step
        - when: roll.rank <= 2
          run: miss-dining
          on_error: continue
map:
  plan:
    picture: assets/maps/dining-car.webp
    pins:
      lao-he: [0.7, 0.56]
      tea-bill: [0.39, 0.4]
      two-teacups: [0.42, 0.32]
      freight-key: [0.88, 0.4]
      player: [0.5, 0.74]
---

餐车里还留着一点饭菜味。厨师老贺趴在柜台上打瞌睡，开水炉在车厢尽头咕嘟作响。

4号桌上的两只茶杯还没收，桌角压着一张小票。再往后，就是锁着的行李车。
