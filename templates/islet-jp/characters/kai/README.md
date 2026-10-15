---
type: readme
name: 海
voice: soothing-smooth
states:
  - id: mood
    label: 気分
    type: enum
    initial: calm
    values:
      - calm
      - cheerful
      - tired
      - grumpy
    shown_as:
      calm: 穏やか
      cheerful: 機嫌がいい
      tired: 少し疲れている
      grumpy: 虫の居所が悪い
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

渡し船で来た旅人、二十八歳。灰色の髪を低く束ね、麻のシャツに着古したロングコート、古いギターケースを背負っている。穏やかで、自分の過去の話はいつもはぐらかす。
