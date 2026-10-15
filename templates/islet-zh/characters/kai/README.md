---
type: readme
name: 海
voice: soothing-smooth
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

坐渡轮来的旅人，二十八岁，灰发低束，穿亚麻衬衫和旧长外套，背着一只旧吉他盒。温和，总回避自己的过去。
