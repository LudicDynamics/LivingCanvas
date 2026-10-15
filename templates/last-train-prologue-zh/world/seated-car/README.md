---
type: gate
name: 2车 · 硬座车
bg: assets/scenes/seated-car.webp
title: 2车 · 硬座车
intent: 序章唯一的车厢。苏禾的座位（17号）和玩家的座位（18号）都在这里。第一回合结束后引擎放下 su-he-notebook.md；问乘客的骰子由 search 声明生成；问过之后（或第八回合）引擎放下 freight-door.md，那扇门通往5车。不要靠叙述开门、放卡或宣布结局；不要说出任何嫌疑人的名字。
choice:
  options:
  - id: ask-student
    label: 用骰子问问20号没睡的学生
  allow_free: true
choice_actions:
  ask-student:
    kind: search
    spot: scene
search:
- id: scene
  skill: persuade
  label: 用骰子问问20号没睡的学生
  title: 问问附近的乘客
  body: |-
    大多数人都睡着。醒着的只有20号的学生，还有几个被你吵醒、不太高兴的人。

    1d100（说服 60）：掷出小于等于技能值即成功，越低越好。
    96–100（5%）：动静太大，惊动了人。只拿到半条线索，还多耗两步时间。
    61–95（35%）：没查顺。只拿到半条线索，还多耗一步时间。
    13–60（48%）：成功。拿到线索，只耗一步时间。
    1–12（12%）：大成功。拿到线索，还多看见一点东西，而且快得不耗时间。

    同一张卡只能掷一次，不能重掷。
  roll_dice:
    type: 2d10
    desc: 问问附近的乘客
    expect: '>=11'
  dice_outcomes:
  - min: 2
    max: 4
    text: 你挨个叫醒人，车厢里一片抱怨，有人嚷着要找列车员。等夏澄把大家安抚下来，已经耽误了好一阵。20号的学生周子航只肯说：零点五十分左右，有人扶着苏禾往车尾走，她脚步发飘。是谁，他“没看清”。
    options:
    - id: talk
      label: 告诉夏澄
      say: "问到一半：有人扶着苏禾往车尾走，是谁他没看清。"
      action:
        kind: character
        character: xia-cheng
    rewards:
    - &id001
      path: world/seated-car/witness-half.md
      title: 半条线索 · 有人带她去了车尾
      partial: true
      body: 学生周子航（2车20号）：零点五十分左右，有人扶着苏禾往车尾走，苏禾脚步发飘。是谁，他没看清。
    cost:
      clock: -1
  - min: 5
    max: 10
    text: 问了好几个人都说在睡觉。好不容易问到周子航，他对生人有点戒心，只说零点五十分左右有人扶着苏禾往车尾走，她脚步发飘。
    options:
    - id: talk
      label: 告诉夏澄
      say: "问到一半：有人扶着苏禾往车尾走，是谁他没看清。"
      action:
        kind: character
        character: xia-cheng
    rewards:
    - *id001
  - min: 11
    max: 17
    text: 你直接走到醒着的周子航身边。他摘下一只耳机：停车后没多久，大约零点五十分，一个穿灰呢大衣、头发花白的老人扶着苏禾往车尾走，说她“晕车，带她去后面透透气”。苏禾走路发飘，像没睡醒。
    options:
    - id: talk
      label: 告诉夏澄
      say: "问到了：一个穿灰呢大衣、头发花白的老人扶她往车尾去了。"
      action:
        kind: character
        character: xia-cheng
    rewards:
    - &id002
      path: world/seated-car/witness-account.md
      title: 周子航的证词
      body: 学生周子航（2车20号）：大约零点五十分，一个穿灰呢大衣、头发花白的老人扶着苏禾往车尾方向走，说她“晕车，带她去后面透透气”。苏禾脚步发飘，像没睡醒。老人的脸他没看清。
  - min: 18
    max: 20
    text: 你直接走到醒着的周子航身边。他摘下一只耳机：停车后没多久，大约零点五十分，一个穿灰呢大衣、头发花白的老人扶着苏禾往车尾走，说她“晕车，带她去后面透透气”。苏禾走路发飘，像没睡醒。他还闻到老人身上一股樟脑味，像箱底的旧衣服。你一下就问对了人：这次检定不耗时间。
    options:
    - id: talk
      label: 告诉夏澄
      say: "问到了：一个穿灰呢大衣、头发花白的老人扶她往车尾去了。"
      action:
        kind: character
        character: xia-cheng
    rewards:
    - *id002
    bonus:
      clock: 1
  'on':
    roll_resolved:
    - run: train-step
map:
  plan:
    picture: assets/maps/seated-car.webp
    pins:
      su-he-notebook:
      - 0.41
      - 0.41
      witness-account:
      - 0.67
      - 0.43
      witness-half:
      - 0.67
      - 0.43
      freight-car:
      - 0.93
      - 0.45
      xia-cheng:
      - 0.3
      - 0.6
      player:
      - 0.5
      - 0.74
---

凌晨一点十分。开往岭口的K7次末班车停在了断云隧道正中间，车厢里只剩应急灯。

你旁边的17号座空着，帆布包和保温杯还在。列车员夏澄站在过道上，手电照着那个空座。
