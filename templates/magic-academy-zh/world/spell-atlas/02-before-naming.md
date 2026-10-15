---
type: chalk
title: 这个魔法会改变什么？
choice:
  options:
    - id: action-1
      label: 写下魔法的组合
    - id: action-2
      label: 确认所提魔法的代价
  allow_free: true
  free_hint: 用你自己的话写下动词、所用物品、想要的变化和能接受的代价。
intent: 把实际的提议保存到 player/spell-draft.md。事先展示合理的结果和具体的代价，等待玩家决定是命名并施法，还是修改。
choice_actions:
  action-1:
    kind: writer
  action-2:
    kind: stage
    slots:
      - id: material-1
        title: 魔法与代价的提议
        required: true
        paths:
          - player/spell-draft.md
---

成功并不只是打开一扇大门。做一张能放进口袋的星图，也可以是你自己的魔法。
