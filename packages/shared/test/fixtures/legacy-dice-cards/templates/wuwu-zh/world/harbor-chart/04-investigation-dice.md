---
type: chalk
title: 在港口出口的防波堤上搜寻雾里的船
roll_dice:
  type: 2d10
  desc: 在港口出口的防波堤上搜寻雾里的船
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
    text: 脚下的湿石头一滑，手里的提灯晃了一下，码头上的守夜人就喊了起来。雾合拢了。你什么也没看见，今晚也不能再从港口出口搜寻了。
    options:
      - id: lay-out-clues
        label: 改为摆出手上的线索
        action:
          kind: read
          paths:
            - world/harbor-chart/02-two-wakes.md
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/harbor-watch-notice.md
        title: 守夜人的警告
        body: |-
          港口守夜人看见了你在防波堤上的提灯。今晚不许再从港口出口搜寻。

          第二艘船还是能找到：把手上的线索摆出来，再找老莫借灯塔的光。
  - min: 5
    max: 10
    text: 没有船。但一线翻起的泡沫，和防波堤石头上一道新鲜的湿痕，说明有个大家伙刚从近处经过，沿着海岸往旧海关那边去了。
    options:
      - id: follow-tide-mark
        label: 沿着潮痕步行去追
        action:
          kind: writer
          prompt: 阅读实际点数和这张卡 world/harbor-chart/04-investigation-dice.md，以及它掉落的物品 world/harbor-chart/tide-mark-rubbing.md（如果玩家移动过，就读移动后的位置）。这次只找到了潮痕，没看见船。生成一个短的步行场景 world/harbor-chart/tidal-approach/，沿着潮痕往旧海关一侧走：README、两件物品、带行动的 Chalk、返回的出口。这里不揭示第二艘船，也不打开岸边小路。图片之后再补。文字已完成时不重新生成。
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/tide-mark-rubbing.md
        title: 新鲜潮痕的拓印
        body: |-
          没看见船。但翻起的泡沫和防波堤石头上一道新鲜的痕迹，说明有个大家伙刚从近处经过。

          痕迹沿着海岸指向旧海关一侧，可以步行去追。
  - min: 11
    max: 17
    text: 有那么一口气的工夫，雾变薄了：一艘不点灯的黑船，吃水很深，正转向一条沿岸的小路。
    options:
      - id: follow-the-ship
        label: 追着那艘船走进雾里
        action:
          kind: writer
          prompt: 阅读实际点数和这张卡 world/harbor-chart/04-investigation-dice.md，以及它掉落的物品 world/harbor-chart/second-ship-outline.md（如果玩家移动过，就读移动后的位置）。这次看见了第二艘船。根据它的轮廓，生成第一段岸边小路 world/harbor-chart/beyond-the-fog/：README、两件物品、带行动的 Chalk、返回的出口。这一档不发介绍信。图片之后再补。文字已完成时不重新生成。
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/second-ship-outline.md
        title: 第二艘船的轮廓
        body: |-
          雾薄了一瞬：一艘不点灯的黑船，吃水很深，正转向一条沿岸的小路。

          第二艘船是真的。它去的方向，就是那条岸边小路。
  - min: 18
    max: 20
    text: 雾变薄了，黑船露了出来——岸边小路上，还有一盏小灯朝你闪了两下。那边也有人看见了它，而且愿意和你见面。
    options:
      - id: meet-the-lantern
        label: 追着那艘船，去见提灯的人
        action:
          kind: writer
          prompt: 阅读实际点数和这张卡 world/harbor-chart/04-investigation-dice.md，以及它掉落的物品 world/harbor-chart/shore-lantern.md（如果玩家移动过，就读移动后的位置）。这次看见了第二艘船，也遇到了接应的人。按成功的方式生成 world/harbor-chart/beyond-the-fog/（README、两件物品、带行动的 Chalk、返回的出口），并以提灯的人的口吻创建 player/introduction-letter.md，内容只依据玩家手上已有的证据。图片之后再补。文字已完成时不重新生成。
      - id: back
        label: 返回地图
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/shore-lantern.md
        title: 回应你的那盏灯
        body: |-
          黑船从雾里露了出来，岸边小路上一盏小灯朝你闪了两下。

          岸边小路上也有人看见了那艘船，而且愿意和你见面。
---

走到港口出口的防波堤上，在雾里找第二艘船——没有灯，脚下是湿滑的石头。

这一掷决定的是哪条路会打开。看见了，雾那边的岸边小路就会打开；差一点，只能留下一道潮痕，沿着它步行去追；脚下一滑，会被港口守夜人看见，这条捷径就此关闭，只剩慢的那条路：摆出线索，向灯塔借光。

不需要掷骰、随时可以做的事：摆出收集到的线索（“寻找另一艘船”）、重读任何线索、问这里的人。

2d10：掷两颗十面骰，合计11以上为成功。
2–4（6%）：脚下一滑，被守夜人看见。什么也没看见，今晚这条捷径关闭。你会拿到守夜人的警告。
5–10（39%）：没看见船，但有一道新鲜的潮痕，可以沿岸步行去追。
11–17（49%）：看见第二艘船的轮廓，雾那边的岸边小路打开。
18–20（6%）：看见船，岸边小路上还有一盏灯回应你。小路打开，那边有人愿意和你见面。

只能掷一次。找到的东西会作为物品留在这里，可以拿走；接下来能走哪条路，取决于它。
