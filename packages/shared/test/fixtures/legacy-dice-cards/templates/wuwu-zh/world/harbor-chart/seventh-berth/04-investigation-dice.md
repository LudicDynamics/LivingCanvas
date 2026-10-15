---
type: chalk
title: 溜上无人船，翻开空货舱
roll_dice:
  type: 2d10
  desc: 溜上无人船，翻开空货舱
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
    text: 刚到舷梯顶上，银鸢的手就揪住了你的衣领。货舱的事他一个字也没说——只说这艘船从现在起不让你上。想知道它装了什么，你得当面去找他。
    options:
      - id: face-silver-kite
        label: 去当面找银鸢
        action:
          kind: character
          character: silver-kite
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/seventh-berth/gangway-warning.md
        title: 银鸢的警告
        body: |-
          银鸢撞见你偷偷登上无人船。舷梯从现在起对你关上了。

          只有你光明正大地去找他——拿出擦痕的记录，说清你为什么上船——他才肯谈货舱的事。
  - min: 5
    max: 10
    text: 来不及开货舱了。你从比满潮线还高的擦痕上，刮下一片焦油般的黑漆，不是这艘船的。另一个船壳曾贴着它挤过——可这片漆说不出是谁的船。
    options:
      - id: to-workshop
        label: 拿这片漆去工坊比对
        action:
          kind: enter
          target: world/harbor-chart/workshop
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/seventh-berth/hull-paint-flake.md
        title: 别的船留下的漆片
        body: |-
          从满潮线以上的擦痕上刮下的焦油色黑漆。它和无人船的船壳对不上，是另一艘船贴着挤过留下的。

          它能证明有第二艘船，证明不了是谁的。工坊里的船舵零件也许能说出更多。
  - min: 11
    max: 17
    text: 舱盖撬开了。里面只有压舱石和钉死的空箱，别的什么都没有。没人会为了赚钱开一船石头出海——这艘船是故意空着放出来的，好让所有人的眼睛都盯着7号码头。
    options:
      - id: show-silver-kite
        label: 把找到的东西给银鸢看
        action:
          kind: character
          character: silver-kite
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/seventh-berth/ballast-stone.md
        title: 空货舱里的压舱石
        body: |-
          货舱里只有压舱石和钉死的空箱。

          这艘船是故意空着放出来的：一个诱饵，让所有人盯着7号码头，好让别的东西在别处移动。
  - min: 18
    max: 20
    text: 舱盖撬开了。提灯照过去，压舱石上有一个印记：旧海关货场的章。诱饵船是在旧海关隧道出口那里装的船。
    options:
      - id: to-lighthouse
        label: 去灯塔问那条隧道什么时候能用
        action:
          kind: enter
          target: world/harbor-chart/old-lighthouse
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/seventh-berth/customs-stamped-ballast.md
        title: 盖着旧海关印记的压舱石
        body: |-
          空货舱里的压舱石，盖着旧海关货场的印记。这艘船是故意空着放出来的，而且是在旧隧道出口的货场装的船。

          诱饵船和隧道是同一个计划。那条隧道什么时候能用，要看灯塔的日志。
---

银鸢正在换岗。舷梯有一分钟没人看着——够你溜上那艘无人船，打开它的货舱。

这一掷决定你能从船上带走什么。点数好，就能查到这艘船真正装的是什么；点数差，只能从船壳上刮下一点东西；点数很糟，会被银鸢当场抓住，他会把这艘船对你关上。

不需要掷骰、随时可以做的事：阅读擦痕的记录，向银鸢询问箱子的事。

2d10：掷两颗十面骰，合计11以上为成功。
2–4（6%）：被银鸢抓住。你带走的是他的警告，不是线索；想知道货舱的事，得去当面找他。
5–10（39%）：来不及开货舱。只从擦痕上刮下一片别的船的漆——能证明有第二艘船，证明不了是谁的。
11–17（49%）：货舱里只有压舱石和空箱。一块压舱石能证明这艘船是故意空着放出来的。
18–20（6%）：压舱石上有旧海关货场的印记。诱饵船是在旧隧道出口那里装的船。

只能掷一次。找到的东西会作为物品留在这里，可以拿走。
