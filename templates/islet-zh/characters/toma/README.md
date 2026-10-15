---
type: readme
name: 灯真
voice: hoarse-weathered
greeting: ……下船当心脚下，板子有一块松了。你就是来接东边那块田的人吧。岛不大，走几步就认得全了。有什么事，来栈桥找我。
states:
  - id: mood
    label: 心情
    type: enum
    initial: calm
    values:
      - calm
      - cheerful
      - tired
      - grumpy
    shown_as:
      calm: 心平气和
      cheerful: 心情很好
      tired: 有点累
      grumpy: 心情不太好
  - id: bond
    label: 交情
    type: number
    initial: 1
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

潮见岛的码头长，六十八岁，渡轮的无线电归他管。什么都看在眼里，话少，心软。
