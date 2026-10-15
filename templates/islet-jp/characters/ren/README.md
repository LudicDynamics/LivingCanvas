---
type: readme
name: 蓮
voice: casual-drawl
states:
  - id: mood
    label: 気分
    type: enum
    initial: calm
    values:
      - calm
      - cheerful
      - tired
    shown_as:
      calm: 穏やか
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

隣に住む若い農夫、二十四歳。背が高くひょろりとして、破れた麦わら帽子をかぶっている。話すと赤くなるほどの恥ずかしがりだが、畑仕事は名人で、あなたの師匠のようなもの。
