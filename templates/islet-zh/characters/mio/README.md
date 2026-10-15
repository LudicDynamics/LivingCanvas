---
type: readme
name: 澪
voice: child-innocent
states:
  - id: mood
    label: 心情
    type: enum
    initial: cheerful
    values:
      - cheerful
      - tired
      - grumpy
    shown_as:
      cheerful: 心情很好
      tired: 有点累
      grumpy: 心情不太好
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

岛上唯一的孩子，九岁，扎黑色双马尾，穿一件过大的黄雨衣和红胶靴，扛着比她还高的捕虫网。调皮，会带你认识每个角落。
