---
type: readme
title: あなた
states:
  - id: hp
    label: 傷
    type: number
    initial: 10
    range: [0, 10]
    shown_as:
      - { min: 8, text: 無傷 }
      - { min: 4, text: 傷を負っている }
      - { min: 1, text: 深手を負っている }
      - { max: 0, text: 虫の息 }
sheet:
  skills:
    - id: spot_hidden
      label: 目星
      value: 60
    - id: library_use
      label: 図書館
      value: 60
    - id: psychology
      label: 心理学
      value: 60
    - id: stealth
      label: 隠密
      value: 60
    - id: science
      label: 科学（化学）
      value: 75
    - id: disguise
      label: 変装
      value: 65
    - id: fighting
      label: 近接戦闘（ボクシング）
      value: 55
    - id: listen
      label: 聞き耳
      value: 55
    - id: fast_talk
      label: 言いくるめ
      value: 50
    - id: locksmith
      label: 鍵開け
      value: 45
    - id: firearms
      label: 射撃
      value: 40
---

あなたはシャーロック・ホームズ。この事件に怪物はいない。濡れた手すりと、重い活字棚と、見抜かれたくない一人の男がいるだけだ。
