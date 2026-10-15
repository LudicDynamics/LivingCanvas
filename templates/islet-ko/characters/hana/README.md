---
type: readme
name: 하나
voice: warm-cheerful
states:
  - id: mood
    label: 기분
    type: enum
    initial: cheerful
    values:
      - cheerful
      - calm
      - tired
    shown_as:
      cheerful: 기분이 좋다
      calm: 차분하다
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

잡화점 주인, 서른넷. 동그란 안경에 귀에는 연필. 다정하고 소문을 좋아하며, 섬의 모든 소식이 그녀를 거친다.
