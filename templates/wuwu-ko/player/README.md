---
type: readme
title: 당신
states:
  - id: hp
    label: 부상
    type: number
    initial: 10
    range:
      - 0
      - 10
    shown_as:
      - min: 8
        text: 무사하다
      - min: 4
        text: 다쳤다
      - min: 1
        text: 크게 다쳤다
      - max: 0
        text: 죽음의 문턱
sheet:
  skills:
    - id: spot_hidden
      label: 관찰력
      value: 60
    - id: navigate
      label: 항법
      value: 60
    - id: stealth
      label: 은밀행동
      value: 60
    - id: mechanical_repair
      label: 기계수리
      value: 60
    - id: listen
      label: 듣기
      value: 50
    - id: persuade
      label: 설득
      value: 50
    - id: psychology
      label: 심리학
      value: 45
    - id: climb
      label: 오르기
      value: 40
    - id: first_aid
      label: 응급처치
      value: 35
---

너는 항무소가 불러들인 조사원이고, 조수가 다시 밀려오기 전에 그 밤의 실마리를 해도 위에 못 박아야 한다. 여기서 너를 해치려는 사람은 없다. 그러나 안개와 미끄러운 암초, 옛 세관 터널과 다시 밀려오는 조수는 누가 손을 쓸 필요도 없다.
