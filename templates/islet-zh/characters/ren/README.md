---
type: readme
name: 莲
voice: casual-drawl
states:
  - id: mood
    label: 心情
    type: enum
    initial: calm
    values:
      - calm
      - cheerful
      - tired
    shown_as:
      calm: 心平气和
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

住在你隔壁的年轻农夫，二十四岁，高瘦，戴一顶破草帽。害羞得说话会脸红，种地却是一把好手，算是你的师父。
