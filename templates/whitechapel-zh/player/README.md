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
    - id: library_use
      label: 图书馆使用
      value: 60
    - id: psychology
      label: 心理学
      value: 60
    - id: stealth
      label: 潜行
      value: 60
    - id: science
      label: 科学（化学）
      value: 75
    - id: disguise
      label: 乔装
      value: 65
    - id: fighting
      label: 格斗（拳击）
      value: 55
    - id: listen
      label: 聆听
      value: 55
    - id: fast_talk
      label: 话术
      value: 50
    - id: locksmith
      label: 锁匠
      value: 45
    - id: firearms
      label: 射击
      value: 40
---

你是夏洛克·福尔摩斯。这桩案子里没有怪物，只有湿滑的栏杆、沉重的铅字架，和一个不想被看穿的人。
