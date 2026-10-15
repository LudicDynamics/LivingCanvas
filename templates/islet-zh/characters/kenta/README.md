---
type: readme
name: 健太
voice: deep-magnetic
states:
  - id: mood
    label: 心情
    type: enum
    initial: calm
    values:
      - calm
      - tired
      - cheerful
    shown_as:
      calm: 心平气和
      tired: 有点累
      cheerful: 心情很好
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

岛上的木匠兼船匠，四十二岁，高大，光头扎着毛巾。沉默可靠，只用手说话。他在修一条旧渔船，缺木料。
