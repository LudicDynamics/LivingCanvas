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
        text: 무사
      - min: 4
        text: 부상
      - min: 1
        text: 중상
      - max: 0
        text: 빈사
sheet:
  skills:
    - id: spot_hidden
      label: 관찰력
      value: 60
    - id: persuade
      label: 설득
      value: 60
    - id: stealth
      label: 은밀행동
      value: 60
    - id: fighting
      label: 근접전(몸싸움)
      value: 60
    - id: listen
      label: 듣기
      value: 50
    - id: climb
      label: 오르기
      value: 45
    - id: first_aid
      label: 응급처치
      value: 40
    - id: psychology
      label: 심리학
      value: 40
    - id: mechanical_repair
      label: 기계수리
      value: 30
---

당신은 K7 열차 막차 2호차 18번 승객으로, 쑤허 바로 옆에 앉아 있었다. 두 사람은 가는 동안 한 마디만 나눴다: 그녀가 당신에게 단운 터널이 얼마나 남았는지 물었다.

이 열차에는 아무도 당신을 해치려 하지 않는다. 하지만 난방이 없는 객차, 캄캄한 객차 연결부, 산사태 입구의 헐거운 자갈은 누가 손을 쓸 필요도 없다.
