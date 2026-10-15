---
type: readme
name: 渡し船の甲板
bg: assets/scenes/ferry.webp
title: 渡し船の甲板
intent: 月曜に来る渡し船。着かない日は湾に停泊し、甲板はがらんとしている。ギターを抱えた旅人（海）が、船を降りると決めるまで甲板に座っている（トリガー
  kai-arrives）。海藻島と鳥岩へは直した船が要る（門：player/boat-tiller.md）。嵐の日に海に出ないよう作家が叙述で守る。
choice:
  options:
    - id: to-kelp
      label: 直した船で海藻島へ行く
    - id: to-bird
      label: 直した船で鳥岩へ行く
    - id: back
      label: 桟橋に戻る
  allow_free: true
choice_actions:
  to-kelp:
    kind: enter
    target: world/kelp-islet
  to-bird:
    kind: enter
    target: world/bird-rock
  back:
    kind: enter
    target: world/dock
---

甲板は日に焼けて熱く、手すりには塗装が半分はげた浮き輪がかかっている。ここから振り返ると、島全体が海の上で眠る猫のように見える。

手すりのそばには、古いギターを抱えた人がよく座っている。
