---
type: readme
name: 花
voice: warm-cheerful
states:
  - id: mood
    label: 気分
    type: enum
    initial: cheerful
    values:
      - cheerful
      - calm
      - tired
    shown_as:
      cheerful: 機嫌がいい
      calm: 穏やか
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

雑貨屋の店主、三十四歳。丸眼鏡に、耳には鉛筆。世話好きで噂好き、島の話はみんな彼女を通る。
