---
type: readme
name: 밤의 도서관 · 첫 마법
title: 밤의 도서관 · 첫 마법
intent: '받았다면 명찰을 player/.으로 옮긴다. 실패담은 구체적인 예시 하나를 돌려주지만 플레이어에게 미확정 대가를 부과하지 않는다. 결말은 엔진만 내린다: "열다"나 "비추다" 주문이 이루어진 뒤 밤의 도서관으로 돌아오거나, 시전 없이 떠나기로 정할 때. 작가는 결말을 선언하지 않는다.'
choice:
  options:
    - id: action-1
      label: 명찰을 받는다
    - id: action-2
      label: 세라피나에게 실패한 마법에 대해 묻는다
choice_actions:
  action-1:
    kind: take
    paths:
      - world/freshman-badge.md
  action-2:
    kind: character
    character: seraphina
bg: assets/scenes/academy-library.webp
map:
  plan:
    picture: assets/maps/night-library.webp
    pins:
      spell-atlas:
        - 0.84
        - 0.22
      freshman-badge:
        - 0.26
        - 0.4
      seraphina:
        - 0.6
        - 0.35
      player:
        - 0.22
        - 0.8
---

너는 마법 학원의 신입생이다. 선배 세라피나가 명찰을 손에 들고 책장 사이에서 기다리고 있는데, 곧바로 건네주지는 않는다.

"익숙한 것들을 조합해서 너만의 마법을 만들어 봐. 하고 싶은 것, 쓰는 것, 대가로 내놓을 것을 말해 줘."

먼저 명찰을 받고 마법 재료가 있는 곳으로 가라. 무엇을 쓸 수 있는지 보고 나서 정해도 된다.
