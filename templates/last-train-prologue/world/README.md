---
type: readme
name: Broken Cloud Tunnel · The Last Train, Stopped
bg: assets/scenes/tunnel-train.webp
title: Broken Cloud Tunnel · The Last Train, Stopped
intent: Overview of the prologue; the player never comes here. turns is the turn count; only command/turn-end.yaml changes it.
states:
- id: turns
  label: Turns
  type: number
  initial: 0
  range:
  - 0
  - 99
  hidden: true
---

1:10 a.m. The K7 last train to Lingkou has stopped in the middle of Broken Cloud Tunnel: there has been a rockfall ahead, and only the emergency lights are on.
