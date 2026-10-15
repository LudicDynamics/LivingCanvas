---
type: gate
name: 魔法材料 · 要做什么呢？
title: 魔法材料 · 要做什么呢？
intent: 通过自由输入询问动词、对象物品、想要的结果和能接受的代价。确认物品确实存在且已持有，再记录组合提议。仅凭选择不会自动施法。
choice:
  options:
    - id: action-1
      label: 提议一个组合
    - id: action-2
      label: 查看能用的物品
choice_actions:
  action-1:
    kind: writer
  action-2:
    kind: read
    paths:
      - world/spell-atlas/star-fragment.md
      - world/spell-atlas/small-hand-mirror.md
      - world/spell-atlas/reflection-fragment.md
bg: assets/scenes/academy-library.webp
map:
  plan:
    picture: assets/maps/spell-atlas.webp
    pins:
      star-fragment: [0.25, 0.35]
      small-hand-mirror: [0.4, 0.23]
      opening-fragment: [0.6, 0.25]
      reflection-fragment: [0.75, 0.36]
      librarian: [0.7, 0.57]
      player: [0.5, 0.85]
---

能用的有：星星碎片、手镜，以及「开启」「映照」这两个魔法词。先读读材料的说明吧。

比如「我想让手镜映出星空」这样简短的提议就可以。先问清楚能做到什么、需要付出什么作为交换，等你同意之后才会施法。只是商量的话，不会失去任何重要的东西。
