---
type: readme
title: あなた
states:
  - id: hp
    label: 怪我
    type: number
    initial: 10
    range:
      - 0
      - 10
    shown_as:
      - min: 8
        text: 無傷
      - min: 4
        text: 負傷
      - min: 1
        text: 重傷
      - max: 0
        text: 瀕死
sheet:
  skills:
    - id: spot_hidden
      label: 目星
      value: 60
    - id: navigate
      label: ナビゲート
      value: 60
    - id: stealth
      label: 隠密
      value: 60
    - id: mechanical_repair
      label: 機械修理
      value: 60
    - id: listen
      label: 聞き耳
      value: 50
    - id: persuade
      label: 説得
      value: 50
    - id: psychology
      label: 心理学
      value: 45
    - id: climb
      label: 登攀
      value: 40
    - id: first_aid
      label: 応急手当
      value: 35
---

あなたは港務所に招かれた調査員で、潮が戻る前にあの夜の線を海図に留めなければならない。ここにはあなたを害そうとする者はいない。だが霧、濡れて滑る岩礁、旧税関隧道、そして戻る潮は、誰の手も借りずにあなたを脅かす。
