---
type: readme
name: 断雲トンネル · 停まった終電
bg: assets/scenes/tunnel-train.webp
title: 断雲トンネル · 停まった終電
intent: 序章の全体図。プレイヤーはここには来ない。turns はターン数で、command/turn-end.yaml だけが変える。
states:
- id: turns
  label: ターン
  type: number
  initial: 0
  range:
  - 0
  - 99
  hidden: true
---

午前一時十分。嶺口行きのK7終電は断雲トンネルの真ん中で止まった。前方で落盤があり、車内には非常灯しか点いていない。
