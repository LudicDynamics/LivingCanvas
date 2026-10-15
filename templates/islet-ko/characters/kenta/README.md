---
type: readme
name: 겐타
voice: deep-magnetic
states:
  - id: mood
    label: 기분
    type: enum
    initial: calm
    values:
      - calm
      - tired
      - cheerful
    shown_as:
      calm: 차분하다
      tired: 조금 지쳤다
      cheerful: 기분이 좋다
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

섬의 목수이자 배 목수, 마흔둘. 덩치가 크고 민머리에 수건을 둘렀다. 말없고 믿음직하며 손으로 말한다. 낡은 고깃배를 고치는 중인데 목재가 모자라다.
