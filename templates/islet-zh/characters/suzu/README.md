---
type: readme
name: 鈴
voice: mature-elegant
states:
  - id: mood
    label: 心情
    type: enum
    initial: calm
    values:
      - calm
      - grumpy
      - cheerful
      - tired
    shown_as:
      calm: 心平气和
      grumpy: 心情不太好
      cheerful: 心情很好
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

守灯塔的老婆婆，七十六岁，银发挽成圆髻，脖子上挂着望远镜。毒舌，但看天看得准，岛上的天气她说了算。
