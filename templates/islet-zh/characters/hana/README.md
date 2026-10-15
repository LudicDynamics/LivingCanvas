---
type: readme
name: 花
voice: warm-cheerful
states:
  - id: mood
    label: 心情
    type: enum
    initial: cheerful
    values:
      - cheerful
      - calm
      - tired
    shown_as:
      cheerful: 心情很好
      calm: 心平气和
      tired: 有点累
  - id: bond
    label: 交情
    type: number
    initial: 0
    range:
      - 0
      - 10
    shown_as:
      - min: 8
        text: 很要好
      - min: 5
        text: 朋友
      - min: 2
        text: 点头之交
      - max: 1
        text: 还不太熟
---

杂货店主，三十四岁，戴圆眼镜，耳后夹着铅笔。热心又爱打听，全岛的消息都从她这儿过。
