---
type: readme
title: 你
states:
  - id: hp
    label: 伤势
    type: number
    initial: 10
    range: [0, 10]
    shown_as:
      - { min: 8, text: 毫发无伤 }
      - { min: 4, text: 受了伤 }
      - { min: 1, text: 伤得很重 }
      - { max: 0, text: 奄奄一息 }
sheet:
  skills:
    - id: spot_hidden
      label: 侦查
      value: 60
    - id: persuade
      label: 说服
      value: 60
    - id: stealth
      label: 潜行
      value: 60
    - id: fighting
      label: 格斗（扭打）
      value: 60
    - id: listen
      label: 聆听
      value: 50
    - id: climb
      label: 攀爬
      value: 45
    - id: first_aid
      label: 急救
      value: 40
    - id: psychology
      label: 心理学
      value: 40
    - id: mechanical_repair
      label: 机械维修
      value: 30
---

你是K7次末班车2车18号的乘客，就坐在苏禾旁边。你们一路上只说过一句话：她问你，断云隧道还有多远。

这趟车上没有人存心要害你；可没有暖气的车厢、漆黑的车厢连接处、塌方口松动的碎石，用不着谁来动手。
