---
type: gate
name: "1车 · 驾驶室"
bg: assets/scenes/cab.webp
title: "1车 · 驾驶室"
view: canvas
intent: "第二幕的一条线（驾驶室：抢修通知和电台）。司机老秦守着电台。老秦是 NPC 卡 lao-qin.md（点他「对话」）：他只知道自己零点四十二分提灯下车查看塌方、一点零五分回来，下车前5车钥匙还挂在板上，现在钩子是空的。02-radio-report.md 是唯一的收束点（5车的 06-radio-relay.md 跑同一条命令）：只有 command/report-truth.yaml 的 end 能结束这一局，作家不要替它宣布结局。"
choice:
  options:
    - id: read-notice
      label: "读抢修通知"
      once: true
    - id: radio
      label: "用电台向岭口调度报告"
    - id: talk-laoqin
      label: "和老秦聊聊"
    - id: ask-proof
      label: "调度只信证据……我们手里够了吗？"
      to: companion
      say: "调度只信证据。我们手里的东西，够不够？"
  allow_free: true
choice_actions:
  read-notice:
    kind: read
    paths:
      - world/cab/repair-notice.md
  radio:
    kind: read
    paths:
      - world/cab/02-radio-report.md
  talk-laoqin:
    kind: talk
    npc: world/cab/lao-qin.md
map:
  plan:
    picture: assets/maps/cab.webp
    pins:
      lao-qin: [0.66, 0.46]
      repair-notice: [0.3, 0.25]
      02-radio-report: [0.51, 0.21]
      player: [0.5, 0.87]
---

驾驶室里暖一些，仪表盘上只亮着电台的一盏小绿灯。司机老秦刚从隧道前头回来，靴子上全是碎石灰。

墙上挂着钥匙板，每把钥匙拴着一块红牌；挂“5车 行李车”的那个钩子空着。电台能直接接通岭口调度——但调度只信证据。
