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
    - id: navigate
      label: 导航
      value: 60
    - id: stealth
      label: 潜行
      value: 60
    - id: mechanical_repair
      label: 机械维修
      value: 60
    - id: listen
      label: 聆听
      value: 50
    - id: persuade
      label: 说服
      value: 50
    - id: psychology
      label: 心理学
      value: 45
    - id: climb
      label: 攀爬
      value: 40
    - id: first_aid
      label: 急救
      value: 35
---

你是港务所请来的调查员，得赶在潮水回涨前把那一夜的线钉上海图。这里没有人想害你；可雾、湿滑的礁石、旧海关隧道和回涨的潮水，用不着谁来动手。
