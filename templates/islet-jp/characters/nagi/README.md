---
type: readme
name: 凪
voice: sassy-spunky
states:
  - id: mood
    label: 気分
    type: enum
    initial: cheerful
    values:
      - cheerful
      - tired
      - grumpy
      - calm
    shown_as:
      cheerful: 機嫌がいい
      tired: 少し疲れている
      grumpy: 虫の居所が悪い
      calm: 穏やか
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

十七歳の漁師の娘。日に焼けて、そばかすだらけ。口が悪く、じっとしていられず、夜明け前に海に出る。たぶん最初に打ち解ける相手。
