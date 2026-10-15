---
type: chalk
title: "拦住钟怀礼"
roll_dice:
  type: 2d10
  desc: "拦住钟怀礼，抢下日志页"
  expect: ">=11"
choice:
  options:
    - id: back
      label: "先不掷骰，回到列车"
choice_actions:
  back:
    kind: enter
    target: map
on:
  roll_resolved:
    - run: train-step
dice_outcomes:
  - min: 2
    max: 4
    harm: serious
    text: "他比你快。日志页进了炉膛，你扑过去抢，被他一把推开，后背撞上铁皮炉子的棱角，摔进邮袋堆里，半天喘不上气。你只从炉口扯出烧焦的一角，手背也烫伤了。钟怀礼趁乱回了卧铺。光凭这一角，调度不会信——还得靠他的药板和餐车的小票。"
    options:
      - id: radio
        label: "去驾驶室的电台"
        action:
          kind: enter
          target: world/cab
      - id: back
        label: "回到列车"
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/torn-corner.md
        image: assets/items/torn-corner.webp
        title: "烧焦的一角"
        body: "日志页烧剩的一角。能认出“钟”字签名的半边，和“红灯放……”几个字。它说明钟怀礼想烧掉什么，但单凭这一角，岭口调度不会认。"
        partial: true
  - min: 5
    max: 10
    harm: light
    text: "他把日志页塞进了炉子。你的手早在这没有暖气的车厢里冻僵了，伸进炉口抓了两下才抓住，指头烫起了泡，只抢出烧焦的一角：还能认出“钟”字签名的半边，和“红灯放……”几个字。钟怀礼没再说话，转身回了卧铺。光凭这一角，调度不会信——还得靠他的药板和餐车的小票。"
    options:
      - id: radio
        label: "去驾驶室的电台"
        action:
          kind: enter
          target: world/cab
      - id: back
        label: "回到列车"
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/torn-corner.md
        image: assets/items/torn-corner.webp
        title: "烧焦的一角"
        body: "日志页烧剩的一角。能认出“钟”字签名的半边，和“红灯放……”几个字。它说明钟怀礼想烧掉什么，但单凭这一角，岭口调度不会认。"
        partial: true
  - min: 11
    max: 17
    text: "你抢在他前面扣住了他的手腕。日志页掉在邮袋上：十二年前十一月的行车日志，“01:12 接调度钟怀礼口令：红灯放行”。钟怀礼松开手，靠在门框上。"
    options:
      - id: radio
        label: "去驾驶室的电台"
        action:
          kind: enter
          target: world/cab
      - id: back
        label: "回到列车"
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/logbook-page.md
        image: assets/items/logbook-page.webp
        title: "苏长庚的行车日志页"
        body: "十二年前十一月七日，断云隧道信号所。“01:12 接调度钟怀礼口令：K7次红灯放行。本人提出异议，调度坚持。”下面是苏长庚的签名。事故之后，这一页从档案里消失了。"
  - min: 18
    max: 20
    text: "你拿到了日志页，钟怀礼没有再抢。他在邮袋上坐下，说了一句：“我等了十二年，等有人来问。”前后不过一眨眼：这次检定不耗时间。"
    options:
      - id: radio
        label: "去驾驶室的电台"
        action:
          kind: enter
          target: world/cab
      - id: back
        label: "回到列车"
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/logbook-page.md
        image: assets/items/logbook-page.webp
        title: "苏长庚的行车日志页"
        body: "十二年前十一月七日，断云隧道信号所。“01:12 接调度钟怀礼口令：K7次红灯放行。本人提出异议，调度坚持。”下面是苏长庚的签名。事故之后，这一页从档案里消失了。"
    bonus:
      clock: 1
skill_check:
  skill: fighting
  label: 格斗（扭打）
  system: coc
  actor: player
  difficulty: regular
  target: 60
  value: 60
---

钟怀礼提着应急灯站在门口，灰呢大衣上沾着煤灰。他的右手按在大衣内袋上。“年轻人，把门关上，这里冷。”

角落的铁皮炉子还烧着，他离炉子只有两步。这是决定性的一掷：抢下日志页，就有了铁证；抢不下，就只能靠药板和小票把他和这件事连起来。

1d100（格斗（扭打） 60）：掷出小于等于技能值即成功，越低越好。
96–100（5%）：日志页被烧了，只抢出烧焦的一角，多耗一步时间；他会把你推开，你会受不轻的伤。之后要靠药板和小票补上证据。
61–95（35%）：日志页被烧了，只抢出烧焦的一角，多耗一步时间；冻僵的手会被炉口烫伤（轻伤）。之后要靠药板和小票补上证据。
13–60（48%）：抢下日志页，只耗一步时间。
1–12（12%）：一下子就抢下日志页，不耗时间。

同一张卡只能掷一次，不能重掷。不想现在动手，就先回到列车。
