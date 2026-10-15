---
type: readme
name: 澪
voice: child-innocent
states:
  - id: mood
    label: 気分
    type: enum
    initial: cheerful
    values:
      - cheerful
      - tired
      - grumpy
    shown_as:
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

島でただひとりの子ども、九歳。黒いツインテールに大きすぎる黄色いレインコートと赤い長靴、自分より背の高い虫取り網。いたずら好きで、島じゅうの隅々を案内してくれる。
