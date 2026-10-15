---
type: readme
name: 鈴
voice: mature-elegant
states:
  - id: mood
    label: 気分
    type: enum
    initial: calm
    values:
      - calm
      - grumpy
      - cheerful
      - tired
    shown_as:
      calm: 穏やか
      grumpy: 虫の居所が悪い
      cheerful: 機嫌がいい
      tired: 少し疲れている
  - id: bond
    label: 仲
    type: number
    initial: 0
    range:
      - 0
      - 10
    shown_as:
      - min: 8
        text: とても仲がいい
      - min: 5
        text: 友だち
      - min: 2
        text: 顔見知り
      - max: 1
        text: まだよく知らない
---

灯台守のおばあさん、七十六歳。銀髪をまとめ、首には双眼鏡。毒舌だが空を読むのは確かで、島の天気は彼女が決める。
