---
type: readme
name: 항무소 · 조사 시작
title: 항무소 · 조사 시작
bg: assets/scenes/intro.webp
intent: 수락하면 world/commission-letter.md 파일과 world/investigator-badge.md의 실물을 각각 같은 이름의 move로 player/로 옮긴다. 그중 하나를 이미 가지고 있으면 없는 것만 옮긴다. 실제 소지를 확인한 뒤 항구 해도로 안내한다.
choice:
  options:
    - id: action-1
      label: 의뢰서와 휘장 수령
    - id: action-2
      label: 의뢰 조건 읽기
bgVideo: assets/motion/seedance/backgrounds/intro.webm
choice_actions:
  action-1:
    kind: take
    paths:
      - world/commission-letter.md
      - world/investigator-badge.md
  action-2:
    kind: read
    paths:
      - world/commission-letter.md
map:
  pins:
    harbor-chart:
      - 0.88
      - 0.4
    commission-letter:
      - 0.575
      - 0.83
    investigator-badge:
      - 0.4
      - 0.82
    vera:
      - 0.6
      - 0.58
    player:
      - 0.16
      - 0.9
  plan:
    picture: assets/maps/harbor-office.webp
    pins:
      harbor-chart:
        - 0.82
        - 0.36
      commission-letter:
        - 0.46
        - 0.48
      investigator-badge:
        - 0.53
        - 0.47
      vera:
        - 0.65
        - 0.3
      player:
        - 0.3
        - 0.83
---

항구 사무소 안은 차가운 쇠와 등유 냄새다. 무인선 한 척, 사람 하나의 실종, 같은 밤 꺼진 등대—누군가가 당신에게 이 세 가지가 같은 일인지 밝혀 달라고 청한다.

베라는 이미 여기 있다, 의뢰서와 휘장이 놓인 탁자에 기대어. 편지로 당신을 부른 사람이 바로 그녀였고, 그녀는 충분히 오래 기다려서 할 말을 꽤 쌓아 두었다.

휘장은 당신이 항구를 돌아다닐 수 있는 허가증이다. 이걸 받으면, 그녀가 해도를 보여 줄 것이다.

벽에 걸린 조위판에는 몇 걸음 남았는지 적혀 있다: 조수가 다시 밀려오면, 안개 속에 숨은 그 배는 떠나 버린다. 그 전에 실마리를 다 못 박아라.
