---
type: readme
name: 凪
voice: sassy-spunky
states:
  - id: mood
    label: 心情
    type: enum
    initial: cheerful
    values:
      - cheerful
      - tired
      - grumpy
      - calm
    shown_as:
      cheerful: 心情很好
      tired: 有点累
      grumpy: 心情不太好
      calm: 心平气和
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

十七岁的渔家少女，晒得黝黑，一脸雀斑。嘴硬，闲不住，天不亮就出海。多半会第一个跟你混熟。
