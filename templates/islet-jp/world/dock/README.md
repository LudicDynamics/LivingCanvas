---
type: readme
name: 桟橋
bg: assets/scenes/dock.webp
title: 桟橋
intent: 灯真が桟橋と渡し船の無線を守る。その隣が健太の船小屋で、古い漁船が伏せられて木材を待っている（進み具合は world/README.md の
  boat_progress）。渡し船は毎週月曜の朝から昼に着く（嵐の日は欠航）。釣りは command/go-fishing.yaml、灯真に付き合うのは
  command/chat-toma.yaml、乗船は world/ferry に入ること。
choice:
  options:
    - id: fish
      label: 桟橋の先でしばらく釣りをする
    - id: keep-toma-company
      label: 灯真と一緒に桟橋の番をする
    - id: board
      label: 渡し船の甲板に上がる
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

木の桟橋が海へ伸び、係柱には日に焼けた縄が巻きついている。突端の小屋では、ときどき無線がざらざらと鳴る。

隣の船小屋では、古い漁船が腹を上にして、誰かに直してもらうのを待っている。
