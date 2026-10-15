---
type: letter
title: 封好的信封
visual: envelope
portable: true
choice:
  options:
    - id: action-1
      label: 拆开信封
    - id: action-2
      label: 查看外表
status:
  data:
    opened: false
intent: 只有拆开才会看到一条简短而具体的消息。保存完整消息、公开的 Context 和 opened=true。看外表不等于拆开。重访时保持同样的文字。
choice_actions:
  action-1:
    kind: writer
  action-2:
    kind: reply
    text: 信封上的笔迹很陌生。封口完好无损。只看外表，既没有拆开它，也看不出任何名字。
---

一个用陌生笔迹写着收件人的信封。

## 状况
信还没有被拆开。
