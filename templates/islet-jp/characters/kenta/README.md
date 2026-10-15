---
type: readme
name: 健太
voice: deep-magnetic
states:
  - id: mood
    label: 気分
    type: enum
    initial: calm
    values:
      - calm
      - tired
      - cheerful
    shown_as:
      calm: 穏やか
      tired: 少し疲れている
      cheerful: 機嫌がいい
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

島の大工で船大工、四十二歳。大柄で、坊主頭に手ぬぐいを巻いている。無口で頼れる、手で語る男。古い漁船を直しているが、木材が足りない。
