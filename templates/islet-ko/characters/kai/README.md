---
type: readme
name: 카이
voice: soothing-smooth
states:
  - id: mood
    label: 기분
    type: enum
    initial: calm
    values:
      - calm
      - cheerful
      - tired
      - grumpy
    shown_as:
      calm: 차분하다
      cheerful: 기분이 좋다
      tired: 조금 지쳤다
      grumpy: 기분이 별로다
  - id: bond
    label: 친밀도
    type: number
    initial: 0
    range:
      - 0
      - 10
    shown_as:
      - min: 8
        text: 아주 가깝다
      - min: 5
        text: 친구
      - min: 2
        text: 얼굴만 아는 사이
      - max: 1
        text: 아직 서먹하다
---

연락선을 타고 온 나그네, 스물여덟. 회색 머리를 낮게 묶고, 리넨 셔츠에 낡은 긴 코트를 입고, 오래된 기타 케이스를 멨다. 온화하고, 자기 과거 얘기는 늘 피한다.
