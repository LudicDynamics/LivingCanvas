---
type: chalk
title: 交给福尔摩斯推理
roll_dice:
  type: 1d100
  desc: 交给福尔摩斯推理
  expect: <=60
choice:
  options:
    - id: back
      label: 暂不掷骰，返回地图
choice_actions:
  back:
    kind: enter
    target: world/london-map
dice_outcomes:
  - min: 1
    max: 12
    text: 不仅看清了核心，连下一步要核实的步骤也清楚了。最可疑的是：韦恩先读到了文稿，再让事件去配合他画的构图。伊迪丝改地址是一种试探。在中庭核实，把保护和取证分开进行。下一个场景会把这份余裕变成一次具体的额外观察机会。
    options:
      - id: play-result
        label: 越过发现，继续推进
        action:
          kind: writer
          prompt: 读取判定来源 world/london-map/04-investigation-dice.md。玩家把福尔摩斯的推理交给骰子，并尝试这个安全方案：重点调查韦恩，请编辑在中庭进行地址确认，让伊迪丝留在221B受保护，与华生商定暗号和退路。不需要两篇文书或标准答案。把这次发送视为对尝试的确认。利用得到的观察推进布局。固定的真凶不变，对方的回答或拒绝也要演出来。按现有的结局规约生成结果场景和归路。
      - id: back
        label: 返回调查
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/investigation-great-success.md
        title: 记下核心的备忘
        body: 不仅看清了核心，连下一步要核实的步骤也清楚了。最可疑的是：韦恩先读到了文稿，再让事件去配合他画的构图。伊迪丝改地址是一种试探。在中庭核实，把保护和取证分开进行。下一个场景会把这份余裕变成一次具体的额外观察机会。
  - min: 13
    max: 60
    text: 观察串联起来了。最可疑的是：韦恩先读到了文稿，再让事件去配合他画的构图。伊迪丝改地址是一种试探。在中庭核实，把保护和取证分开进行。
    options:
      - id: play-result
        label: 越过发现，继续推进
        action:
          kind: writer
          prompt: 读取判定来源 world/london-map/04-investigation-dice.md。玩家把福尔摩斯的推理交给骰子，并尝试这个安全方案：重点调查韦恩，请编辑在中庭进行地址确认，让伊迪丝留在221B受保护，与华生商定暗号和退路。不需要两篇文书或标准答案。把这次发送视为对尝试的确认。利用得到的观察推进布局。固定的真凶不变，对方的回答或拒绝也要演出来。按现有的结局规约生成结果场景和归路。
      - id: back
        label: 返回调查
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/investigation-success.md
        title: 调查备忘
        body: 观察串联起来了。最可疑的是：韦恩先读到了文稿，再让事件去配合他画的构图。伊迪丝改地址是一种试探。在中庭核实，把保护和取证分开进行。
  - min: 61
    max: 95
    text: 一时没能串起来，但找到了重新审视线索的方向。最可疑的是：韦恩先读到了文稿，再让事件去配合他画的构图。伊迪丝改地址是一种试探。在中庭核实，把保护和取证分开进行。
    options:
      - id: play-result
        label: 从线索出发，换一条路试试
        action:
          kind: writer
          prompt: 读取判定来源 world/london-map/04-investigation-dice.md。玩家把福尔摩斯的推理交给骰子，并尝试这个安全方案：重点调查韦恩，请编辑在中庭进行地址确认，让伊迪丝留在221B受保护，与华生商定暗号和退路。不需要两篇文书或标准答案。把这次发送视为对尝试的确认。这个场景要写成包含疏漏或对方拒绝的简短失败／部分成果。固定的真凶不变，对方的回答或拒绝也要演出来。按现有的结局规约生成结果场景和归路。
      - id: back
        label: 返回调查
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/investigation-setback.md
        title: 疏漏与下一条线索
        body: 一时没能串起来，但找到了重新审视线索的方向。最可疑的是：韦恩先读到了文稿，再让事件去配合他画的构图。伊迪丝改地址是一种试探。在中庭核实，把保护和取证分开进行。
  - min: 96
    max: 100
    text: 调查的动静传了出去，失去了悄悄查看的机会。但线索还在。最可疑的是：韦恩先读到了文稿，再让事件去配合他画的构图。伊迪丝改地址是一种试探。在中庭核实，把保护和取证分开进行。
    options:
      - id: play-result
        label: 从线索出发，换一条路试试
        action:
          kind: writer
          prompt: 读取判定来源 world/london-map/04-investigation-dice.md。玩家把福尔摩斯的推理交给骰子，并尝试这个安全方案：重点调查韦恩，请编辑在中庭进行地址确认，让伊迪丝留在221B受保护，与华生商定暗号和退路。不需要两篇文书或标准答案。把这次发送视为对尝试的确认。这个场景要写成包含疏漏或对方拒绝的简短失败／部分成果。固定的真凶不变，对方的回答或拒绝也要演出来。按现有的结局规约生成结果场景和归路。
      - id: back
        label: 返回调查
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/investigation-setback.md
        title: 疏漏与下一条线索
        body: 调查的动静传了出去，失去了悄悄查看的机会。但线索还在。最可疑的是：韦恩先读到了文稿，再让事件去配合他画的构图。伊迪丝改地址是一种试探。在中庭核实，把保护和取证分开进行。
---

觉得难的时候，可以用骰子把调查交给登场人物。想自己思考时，不掷骰直接返回也没关系。

1d100：数字越小结果越好。调查成功率60%，60及以下为成功。
1–12（12%）：大成功。获得包含额外发现的记录。
13–60（48%）：成功。获得线索的含义和下一步。
61–95（35%）：失败。记下疏漏和下一条线索。
96–100（5%）：严重失败。被人察觉，失去一次调查机会，但唯一的路不会被堵死。

即使失败，这里也不是死路。同一次骰子不能重掷。看过结果后，再选择接下来怎么做。只有要创建新地点时，才需要发送给作家。
