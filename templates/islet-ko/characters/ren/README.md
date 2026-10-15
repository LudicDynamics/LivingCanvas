---
type: readme
name: 렌
voice: casual-drawl
states:
  - id: mood
    label: 기분
    type: enum
    initial: calm
    values:
      - calm
      - cheerful
      - tired
    shown_as:
      calm: 차분하다
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

이웃에 사는 젊은 농부, 스물넷. 키 크고 마른 몸에 해진 밀짚모자를 썼다. 말하다 얼굴이 빨개질 만큼 수줍지만 농사 솜씨는 일품이라, 말하자면 당신의 스승이다.
