---
type: readme
name: 단운 터널 · 멈춘 막차
bg: assets/scenes/tunnel-train.webp
title: 단운 터널 · 멈춘 막차
intent: 서장의 전체도. 플레이어는 여기 오지 않는다. turns는 턴 수이며, command/turn-end.yaml만 바꿀 수 있다.
states:
- id: turns
  label: 턴
  type: number
  initial: 0
  range:
  - 0
  - 99
  hidden: true
---

새벽 1시 10분. 링커우행 K7 막차가 단운 터널 한가운데 멈췄다. 앞쪽에 낙석이 있었고, 객실에는 비상등만 켜져 있다.
