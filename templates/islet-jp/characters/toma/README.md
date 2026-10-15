---
type: readme
name: 灯真
voice: hoarse-weathered
greeting: ……降りるとき足元に気をつけな、板が一枚ゆるんでる。東の畑を継ぎに来た人だろう。小さな島だ、少し歩けば全部わかる。何かあったら桟橋に来な。
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
    initial: 1
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

潮見島の桟橋の主、六十八歳。渡し船の無線を預かる。何でも見ていて、口数は少なく、情に厚い。
