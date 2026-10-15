---
type: readme
name: 스즈
voice: mature-elegant
states:
  - id: mood
    label: 기분
    type: enum
    initial: calm
    values:
      - calm
      - grumpy
      - cheerful
      - tired
    shown_as:
      calm: 차분하다
      grumpy: 기분이 별로다
      cheerful: 기분이 좋다
      tired: 조금 지쳤다
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

등대를 지키는 할머니, 일흔여섯. 은발을 쪽지고 목에 망원경을 걸었다. 독설가지만 날씨는 정확히 읽어, 섬의 날씨는 그녀 말대로다.
