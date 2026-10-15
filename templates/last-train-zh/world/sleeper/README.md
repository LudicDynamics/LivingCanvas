---
type: gate
name: "3车 · 卧铺车"
bg: assets/scenes/sleeper.webp
title: "3车 · 卧铺车"
view: canvas
intent: "第二幕的一条线（卧铺之谜：灰呢大衣是谁的、他真的睡了吗）。钟怀礼在3号包厢下铺。他是登记角色，会撒谎说自己十一点半吃了药就睡了；只有被当面拿出实物时才会松口，而且绝不主动交出日志页的下落。搜他的包厢走骰子卡，不要靠叙述直接给出药板。搜查没成（61–100）时会打开绕远路卡 05-long-way.md（command/miss-sleeper.yaml）；选它多耗一步时间，药板进包（command/long-way-sleeper.yaml）。"
choice:
  options:
    - id: read-coat
      label: "看挂在3号包厢门口的大衣"
      once: true
    - id: search
      label: "用骰子搜3号包厢"
    - id: talk
      label: "敲门，和钟怀礼说话"
      to: writer
    - id: ask-sleep
      label: "您十一点半就睡了？"
      to: zhong-huaili
      say: "钟先生，您十一点半就睡了？"
    - id: ask-coat
      label: "门口这件大衣是您的吧？"
      to: zhong-huaili
      say: "门口挂着的那件灰呢大衣，是您的吧？"
  allow_free: true
choice_actions:
  read-coat:
    kind: read
    paths:
      - world/sleeper/grey-coat.md
  search:
    kind: search
    spot: scene
  talk:
    kind: character
    character: zhong-huaili
search:
  - id: scene
    skill: stealth
    label: 用骰子搜3号包厢
    title: 搜3号包厢
    body: |-
      钟怀礼背对着门躺着。你得在不吵醒他的情况下看看他的铺位。

      1d100（潜行 60）：掷出小于等于技能值即成功，越低越好。
      96–100（5%）：他醒了。只拿到半条线索，还多耗两步时间；会开一条“绕远路”，多耗一步仍能拿到药板。
      61–95（35%）：没查顺。只拿到半条线索，还多耗一步时间；会开一条“绕远路”，多耗一步仍能拿到药板。
      13–60（48%）：成功。拿到线索，只耗一步时间。
      1–12（12%）：大成功。拿到线索，还多看见一点东西，而且快得不耗时间。

      每掷一次，离发车近一步（失败再多一步，大成功省回一步）。同一张卡只能掷一次，不能重掷。不想花时间，就先不掷，回到列车。
    roll_dice:
      type: 2d10
      desc: 搜3号包厢
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
        text: 他醒了。钟怀礼坐起来，一只手按在枕头上，一言不发地看着你，直到你退出包厢。接着他按了呼叫铃，为“生人翻我东西”把夏澄和你在过道里拦了好半天。你只看见他枕头底下露出一角锡箔药板。他已经知道你在查他了。
        options:
          - id: long-way
            label: 绕远路：请夏澄把他叫出来
            action:
              kind: read
              paths:
                - world/sleeper/05-long-way.md
          - id: back
            label: 回到列车
            action:
              kind: enter
              target: map
          - id: to-dining
            label: 去餐车
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip-half.md
            title: 半条线索 · 一角锡箔
            partial: true
            body: 钟怀礼枕头底下有一板锡箔药片。你只看见一角：看不清上面的名字，也不知道少了几粒。他说自己十一点半吃了药就睡了。
        cost:
          clock: -1
      - min: 5
        max: 10
        text: 你动作太慢，他翻了个身，手正好落在枕头上，你等了好一阵才退出来。你只看见他枕头底下露出一角锡箔药板。
        options:
          - id: long-way
            label: 绕远路：请夏澄把他叫出来
            action:
              kind: read
              paths:
                - world/sleeper/05-long-way.md
          - id: back
            label: 回到列车
            action:
              kind: enter
              target: map
          - id: to-dining
            label: 去餐车
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip-half.md
            title: 半条线索 · 一角锡箔
            partial: true
            body: 钟怀礼枕头底下有一板锡箔药片。你只看见一角：看不清上面的名字，也不知道少了几粒。他说自己十一点半吃了药就睡了。
      - min: 11
        max: 17
        text: 枕头底下压着一板安眠药，处方上印着“钟怀礼”。十粒装，少了两粒，锡纸是新撕开的。
        options:
          - id: press
            label: 这板药少了两粒
            to: zhong-huaili
            say: 您的安眠药少了两粒。吃了两粒的人，睡得可没这么浅。
            action:
              kind: character
              character: zhong-huaili
          - id: back
            label: 回到列车
            action:
              kind: enter
              target: map
          - id: to-dining
            label: 去餐车
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip.md
            image: assets/items/pill-strip.webp
            title: 少了两粒的安眠药板
            body: 钟怀礼枕头下的安眠药板，处方上印着他的名字。十粒装，少了两粒，锡纸是新撕开的。他说自己十一点半吃了药就睡了——可一个吃了两粒安眠药的人，睡得不该这么浅。
      - min: 18
        max: 20
        text: 枕头底下压着一板安眠药，处方上印着“钟怀礼”。十粒装，少了两粒，锡纸是新撕开的。他的手提箱半开着，里面有一份断云隧道事故十二周年纪念会的发言稿。他还没动一下你就出来了：这次搜查不耗时间。
        options:
          - id: press
            label: 这板药少了两粒
            to: zhong-huaili
            say: 您的安眠药少了两粒。吃了两粒的人，睡得可没这么浅。
            action:
              kind: character
              character: zhong-huaili
          - id: back
            label: 回到列车
            action:
              kind: enter
              target: map
          - id: to-dining
            label: 去餐车
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip.md
            image: assets/items/pill-strip.webp
            title: 少了两粒的安眠药板
            body: 钟怀礼枕头下的安眠药板，处方上印着他的名字。十粒装，少了两粒，锡纸是新撕开的。他说自己十一点半吃了药就睡了——可一个吃了两粒安眠药的人，睡得不该这么浅。
        bonus:
          clock: 1
    on:
      roll_resolved:
        - run: train-step
        - when: roll.rank <= 2
          run: miss-sleeper
          on_error: continue
map:
  plan:
    picture: assets/maps/sleeper.webp
    pins:
      grey-coat: [0.53, 0.28]
      pill-strip: [0.64, 0.22]
      zhong-huaili: [0.58, 0.44]
      player: [0.5, 0.78]
passive:
  - id: breath
    skill: listen
    say: "3号包厢里的呼吸太匀了，一下一下，不像吃了药睡死的人，倒像在听门外的动静。"
    great:
      say: "3号包厢里的呼吸太匀了，一下一下，不像吃了药睡死的人，倒像在听门外的动静。床头那盏小灯的灯罩还是温的——刚关上没多久。"
---

卧铺车的过道很窄，包厢门大多关着。只有3号包厢的门虚掩，门口挂着一件灰呢大衣。

里面的人背对着门躺着，呼吸很匀——匀得有点刻意。
