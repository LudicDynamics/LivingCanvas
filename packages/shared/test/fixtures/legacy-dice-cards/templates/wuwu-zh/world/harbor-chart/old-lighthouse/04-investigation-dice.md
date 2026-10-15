---
type: chalk
title: 用老莫的望远镜看旧隧道口
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
    text: 望远镜在湿栏杆上一滑，磕在石头上裂了。老莫看见了。再谈那天夜里的事之前，他会要你先赔个不是——隧道口也只能换别的办法去查了。
    options:
      - id: apologize
        label: 向老莫道歉
        action:
          kind: character
          character: old-mo
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/old-lighthouse/cracked-spyglass.md
        title: 老莫摔裂的望远镜
        body: |-
          望远镜从灯廊的栏杆上滑落，镜片裂了。老莫亲眼看见了。

          再谈那天夜里的事之前，他会要你先道歉。隧道口还是得查——现在只能靠日志，或者走过去看。
  - min: 5
    max: 10
    text: 雾盖住了隧道口。不过灯廊的桌上摊着老莫今晚的潮汐表：上面写着隧道口什么时候会露出水面。
    options:
      - id: read-log
        label: 把它和灯塔日志放在一起看
        action:
          kind: read
          paths:
            - world/harbor-chart/old-lighthouse/lighthouse-logbook.md
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/old-lighthouse/tide-table.md
        title: 今晚的潮汐表
        body: |-
          老莫今晚的潮汐表，写着旧海关隧道口什么时候会露出水面。

          它说明船什么时候能用那条隧道，说明不了真的有船用过。把它和灯塔日志里的十二分钟放在一起看。
  - min: 11
    max: 17
    text: 雾变薄了。低潮把隧道口的淤泥露了出来，一道新鲜的龙骨拖痕从隧道里一直拖到水边。最近有船从那里出来过。
    options:
      - id: read-log
        label: 和日志里的十二分钟对一对
        action:
          kind: read
          paths:
            - world/harbor-chart/old-lighthouse/lighthouse-logbook.md
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/old-lighthouse/tunnel-mouth-sketch.md
        title: 隧道口的速写
        body: |-
          低潮时，旧海关隧道口露出了水面，一道新鲜的龙骨拖痕从隧道口一直拖到水边。

          最近有船用过这条隧道。它什么时候能不被看见地出来，灯塔日志里写着。
  - min: 18
    max: 20
    text: 隧道口有两道拖痕：一道浅的，一道很深，是满载的船压出来的。有很重的东西从隧道运走了——那艘船也许还在雾里某处。
    options:
      - id: search-fog
        label: 到雾里去找那艘满载的船
        action:
          kind: read
          paths:
            - world/harbor-chart/04-investigation-dice.md
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/old-lighthouse/two-keel-grooves.md
        title: 隧道口的两道龙骨拖痕
        body: |-
          旧海关隧道口的淤泥里有两道新鲜的拖痕：一道浅的，一道很深，是满载的船压出来的。

          有很重的东西从隧道运走了。那艘船也许还在港外的雾里。
---

站在灯廊上，老莫那支黄铜望远镜能一直看到港口对面的旧海关隧道口——前提是雾肯让开，而你的手在湿栏杆上稳得住。

这一掷决定你能在隧道口看见什么，也关系到老莫的望远镜。点数好，能看出有没有船用过那条隧道；点数差，只能拿到今晚的潮汐表；点数很糟，望远镜会摔裂，老莫会要你先赔个不是。

不需要掷骰、随时可以做的事：阅读灯塔日志，找老莫商量借灯油。

2d10：掷两颗十面骰，合计11以上为成功。
2–4（6%）：望远镜摔裂，老莫看见了。什么也没看见；再问他之前，得先道歉。
5–10（39%）：雾盖住了隧道口。你拿到今晚的潮汐表：说明隧道什么时候能用，说明不了有没有人用。
11–17（49%）：隧道口有一道新鲜的龙骨拖痕：最近有船从那里出来过。
18–20（6%）：两道拖痕，其中一道是满载的船压出来的——那艘船也许还在雾里。

只能掷一次。找到的东西会作为物品留在这里，可以拿走。
