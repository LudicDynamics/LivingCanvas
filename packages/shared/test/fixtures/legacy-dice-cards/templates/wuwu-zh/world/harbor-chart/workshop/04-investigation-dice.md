---
type: chalk
title: 在薇拉的台钳上拆开扣件
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
    text: 销子在台钳里崩断了，新擦痕跟着断下的那一截一起没了。纹章还认得出，可零件已经没法凭痕迹和哪艘船对上——只剩薇拉记得谁订过这种零件。
    options:
      - id: tell-vera
        label: 告诉薇拉弄坏了什么
        action:
          kind: character
          character: vera
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/workshop/snapped-pin.md
        title: 崩断的扣件销子
        body: |-
          拆扣件时销子崩断了。那道新擦痕在断掉的那一截上，已经没了。

          领主家的纹章还认得出。现在要把这个零件和某艘船连起来，只能问薇拉：谁用这个纹章订过船舵零件。
  - min: 5
    max: 10
    text: 扣件打开了，可纹章底下的订货印被锈盖住了。你用炭笔拓了一张：领主家的纹章，和一个淡得读不出的印。
    options:
      - id: ask-vera
        label: 问薇拉谁用这个纹章订零件
        action:
          kind: character
          character: vera
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/workshop/crest-rubbing.md
        title: 纹章与生锈印记的拓印
        body: |-
          一张炭笔拓印：领主家的纹章，底下是一个锈得读不出的订货印。

          纹章说明是哪一家，说明不了是哪艘船。薇拉也许知道谁用这个纹章订过船舵零件。
  - min: 11
    max: 17
    text: 锈一片片剥落。纹章底下是一个订货印，出自领主家的账目——订给一艘不在港口船册里的船。
    options:
      - id: to-berth
        label: 拿去和7号码头的擦痕比一比
        action:
          kind: enter
          target: world/harbor-chart/seventh-berth
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/workshop/order-stamp.md
        title: 扣件里的订货印
        body: |-
          纹章底下：一个出自领主家账目的订货编号，订给一艘不在港口船册里的船。

          这不能证明领主就是犯人。它证明的是：领主家为一艘没人登记过的船付了钱。
  - min: 18
    max: 20
    text: 订货印清清楚楚，而那道新擦痕的高度，正好和7号码头无人船上的擦痕一样。这个扣件，就装在挤过诱饵船的那艘船上。
    options:
      - id: to-lighthouse
        label: 去查那艘船什么时候能通过
        action:
          kind: enter
          target: world/harbor-chart/old-lighthouse
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/workshop/matched-clasp.md
        title: 订货印与对得上的擦痕
        body: |-
          一个出自领主家账目的订货编号，订给一艘不在船册里的船——还有一道和7号码头擦痕同样高度的新擦痕。

          那艘没登记的船，就是贴着诱饵船挤过去的那艘。它什么时候能不被看见地通过，要去灯塔问。
---

扣件还是完整的。夹在台钳上拆开，也许能看见纹章底下藏着的订货印——也可能销子一断，连那道新擦痕一起毁掉。

这一掷决定的是扣件本身，以及它还能证明多少。点数好，能读出订货印；点数差，只能拓下纹章；点数很糟，零件会坏，只剩薇拉的记忆能把它和某艘船连起来。

不需要掷骰、随时可以做的事：阅读零件的说明，向薇拉询问物主。

2d10：掷两颗十面骰，合计11以上为成功。
2–4（6%）：销子断了，新擦痕没了。你留下的是断掉的销子，只能改去问薇拉。
5–10（39%）：锈盖住了订货印。你留下一张纹章的拓印，薇拉也许知道谁订这种零件。
11–17（49%）：订货印清清楚楚：领主家的账目，订给一艘不在港口船册里的船。
18–20（6%）：订货印之外，新擦痕的高度和7号码头的擦痕正好对得上。

只能掷一次。找到的东西会作为物品留在这里，可以拿走。
