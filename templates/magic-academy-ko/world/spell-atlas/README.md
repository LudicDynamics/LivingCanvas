---
type: gate
name: 마법 재료 · 무엇을 만들까?
title: 마법 재료 · 무엇을 만들까?
intent: 동사, 대상 아이템, 원하는 결과, 감당할 대가를 자유롭게 물어본다. 아이템의 존재와 소유를 확인하고 조합 제안을 기록한다. 선택만으로 자동 시전되지 않는다.
choice:
  options:
    - id: action-1
      label: 조합을 제안한다
    - id: action-2
      label: 쓸 수 있는 재료를 확인한다
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
      star-fragment:
        - 0.25
        - 0.35
      small-hand-mirror:
        - 0.4
        - 0.23
      opening-fragment:
        - 0.6
        - 0.25
      reflection-fragment:
        - 0.75
        - 0.36
      librarian:
        - 0.7
        - 0.57
      player:
        - 0.5
        - 0.85
---

별의 조각, 손거울, 그리고 "열다"와 "비추다"라는 마법 단어를 쓸 수 있다. 먼저 재료 설명을 읽어 보자.

예를 들어 "손거울에 별이 빛나는 하늘을 비추고 싶어" 같은 짧은 제안이면 된다. 무엇을 할 수 있는지, 대가로 무엇이 필요한지 물어볼게. 동의한 뒤에만 마법을 쓴다. 물어본다고 중요한 것을 잃지 않는다.
