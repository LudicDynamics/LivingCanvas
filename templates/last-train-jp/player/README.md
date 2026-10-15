---
type: readme
title: あなた
states:
  - id: hp
    label: 傷の具合
    type: number
    initial: 10
    range:
      - 0
      - 10
    shown_as:
      - min: 8
        text: 無傷
      - min: 4
        text: 負傷した
      - min: 1
        text: 重傷
      - max: 0
        text: 瀕死
sheet:
  skills:
    - id: spot_hidden
      label: 目星
      value: 60
    - id: persuade
      label: 説得
      value: 60
    - id: stealth
      label: 隠密
      value: 60
    - id: fighting
      label: 近接戦闘（組みつき）
      value: 60
    - id: listen
      label: 聞き耳
      value: 50
    - id: climb
      label: 登攀
      value: 45
    - id: first_aid
      label: 応急手当
      value: 40
    - id: psychology
      label: 心理学
      value: 40
    - id: mechanical_repair
      label: 機械修理
      value: 30
---

あなたはK7列車の終電2号車18番の乗客で、蘇禾の隣に座っている。道中交わした言葉はただ一言だけ。彼女があなたに尋ねた、断雲トンネルまであとどれくらいか、と。

この列車には誰もあなたを害そうとはしていない。だが暖房のない車両、真っ暗な車両の連結部、土砂崩れ口の緩んだバラストは、誰かが手を下すまでもない。
