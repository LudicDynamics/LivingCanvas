---
type: readme
name: 码头 · 渡轮栈桥
bg: assets/scenes/dock.webp
title: 码头 · 渡轮栈桥
intent: 灯真守着栈桥和渡轮无线电；健太的船坞在栈桥旁边，那条旧渔船翻扣在那里等木料（进度是 world/README.md 的
  boat_progress）。渡轮每周一上午到中午靠港（暴风雨停航）。钓鱼走 command/go-fishing.yaml；陪灯真走
  command/chat-toma.yaml；上渡轮是进入 world/ferry。
choice:
  options:
    - id: fish
      label: 在栈桥尽头钓一会儿鱼
    - id: keep-toma-company
      label: 陪灯真守一会儿栈桥
    - id: board
      label: 上渡轮甲板
  allow_free: true
choice_actions:
  board:
    kind: enter
    target: world/ferry
on:
  choice_selected:
    - when: choice.option_id == "fish"
      run: go-fishing
      on_error: continue
    - when: choice.option_id == "keep-toma-company"
      run: chat-toma
      on_error: continue
---

木头栈桥伸进海里，缆桩上缠着晒白的绳子。栈桥尽头有个小棚子，里面的无线电偶尔沙沙响。

旁边的船坞里，一条旧渔船肚皮朝天，等着有人把它补好。
