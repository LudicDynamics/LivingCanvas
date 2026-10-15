---
type: gate
name: "2车 · 硬座车"
bg: assets/scenes/seated-car.webp
title: "2车 · 硬座车"
view: canvas
intent: "第一幕（开局入口）。苏禾的座位（17号）和玩家的座位（18号）都在这里。节拍：夏澄开口 → 拿起笔记本 → 用骰子问20号的学生（证词靠这一掷；不再把「去和他聊聊」作为默认选项）→ 拿到证词 → 去3车卧铺或回整列车地图（拿到证词、或在这节车厢待了四拍以后，选项最前面会出现这两条出口）。学生周子航（20号）是 NPC 卡 zhou-zihang.md（点他「对话」），只能说出 witness-account.md 里的内容：他没看清老人的脸，只记得灰呢大衣和花白头发。"
status:
  data:
    exits: "no"
choice:
  options:
    - id: go-sleeper
      label: 去车尾的卧铺（3车）
      when: exits == "open"
    - id: go-train
      label: 回到整列车看看
      when: exits == "open"
    - id: take-notebook
      label: "拿起苏禾留下的笔记本"
    - id: search
      label: "用骰子问问20号没睡的学生"
    - id: ask-who
      label: "苏禾是谁？"
      to: xia-cheng
      say: "苏禾是谁？你认识她吗？"
  allow_free: true
choice_actions:
  go-sleeper:
    kind: enter
    target: world/sleeper
  go-train:
    kind: enter
    target: map
  take-notebook:
    kind: take
    paths:
      - world/seated-car/su-he-notebook.md
  search:
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

      每掷一次，离发车近一步（失败再多一步，大成功省回一步）。同一张卡只能掷一次，不能重掷。还不想问，就先不掷，留在这节车厢里。
    roll_dice:
      type: 2d10
      desc: 问问附近的乘客
      expect: ">=11"
    choice:
      options:
        - id: back
          label: 先不掷
    choice_actions:
      back:
        kind: enter
        target: world/seated-car
    dice_outcomes:
      - min: 2
        max: 4
        text: 你挨个叫醒人，车厢里一片抱怨，还有人跑去找列车员告你的状。等夏澄把大家安抚下来，已经耽误了好一阵，周子航也把耳机戴回去了。他只肯说：零点五十分左右，有人扶着苏禾往车尾走。是谁，他“没注意”。
        options:
          - id: tell
            label: 告诉夏澄
            to: xia-cheng
            say: 问到一半：有人扶着苏禾往车尾走，是谁他不肯说。
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: 回到列车
            action:
              kind: enter
              target: map
          - id: to-rear
            label: 往车尾去（3车卧铺）
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-half.md
            title: 半条线索 · 有人带她去了车尾
            partial: true
            body: 学生周子航（2车20座）：零点五十分左右，有人扶着苏禾往车尾走，苏禾脚步发飘。是谁，他不肯说。
        cost:
          clock: -1
      - min: 5
        max: 10
        text: 问了好几个人都说在睡觉。好不容易问到周子航，他对生人有点戒心，只说零点五十分左右有人扶着苏禾往车尾走，苏禾脚步发飘。
        options:
          - id: tell
            label: 告诉夏澄
            to: xia-cheng
            say: 问到一半：有人扶着苏禾往车尾走，是谁他不肯说。
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: 回到列车
            action:
              kind: enter
              target: map
          - id: to-rear
            label: 往车尾去（3车卧铺）
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-half.md
            title: 半条线索 · 有人带她去了车尾
            partial: true
            body: 学生周子航（2车20座）：零点五十分左右，有人扶着苏禾往车尾走，苏禾脚步发飘。是谁，他不肯说。
      - min: 11
        max: 17
        text: 你直接走到醒着的周子航身边。周子航说：停车后没多久，大约零点五十分，一个穿灰呢大衣、头发花白的老人扶着苏禾往车尾走，说她“晕车，带她去后面透透气”。苏禾走路发飘，像没睡醒。
        options:
          - id: tell
            label: 告诉夏澄
            to: xia-cheng
            say: 问到了：一个穿灰呢大衣、头发花白的老人扶她往车尾去了。
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: 回到列车
            action:
              kind: enter
              target: map
          - id: to-rear
            label: 往车尾去（3车卧铺）
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-account.md
            title: 周子航的证词
            body: 学生周子航（2车20号）：大约零点五十分，一个穿灰呢大衣、头发花白的老人扶着苏禾往车尾方向走，说她“晕车，带她去后面透透气”。苏禾脚步发飘，像没睡醒。老人的脸他没看清。
      - min: 18
        max: 20
        text: 你直接走到醒着的周子航身边。周子航说：停车后没多久，大约零点五十分，一个穿灰呢大衣、头发花白的老人扶着苏禾往车尾走，说她“晕车，带她去后面透透气”。苏禾走路发飘，像没睡醒。他还闻到老人身上一股樟脑味，像箱底的旧衣服。你直接找对了人：这次检定不耗时间。
        options:
          - id: tell
            label: 告诉夏澄
            to: xia-cheng
            say: 问到了：一个穿灰呢大衣、头发花白的老人扶她往车尾去了。
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: 回到列车
            action:
              kind: enter
              target: map
          - id: to-rear
            label: 往车尾去（3车卧铺）
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-account.md
            title: 周子航的证词
            body: 学生周子航（2车20号）：大约零点五十分，一个穿灰呢大衣、头发花白的老人扶着苏禾往车尾方向走，说她“晕车，带她去后面透透气”。苏禾脚步发飘，像没睡醒。老人的脸他没看清。
        bonus:
          clock: 1
    on:
      roll_resolved:
        - run: train-step
map:
  plan:
    picture: assets/maps/seated-car.webp
    pins:
      zhou-zihang: [0.78, 0.5]
      su-he-notebook: [0.41, 0.41]
      witness-account: [0.67, 0.43]
      player: [0.5, 0.74]
passive:
  - id: drag-marks
    skill: spot_hidden
    say: "17号座底下的地板上有两道浅浅的鞋跟拖痕，朝车尾去。"
---

硬座车里大多数人都睡着，有人裹着外套打呼。17号座位上放着一只帆布包、一个保温杯，还有一本摊开的笔记本。

隔两个座位的学生周子航戴着耳机，好像一直没睡。
