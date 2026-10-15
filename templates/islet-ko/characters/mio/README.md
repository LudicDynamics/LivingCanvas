---
type: readme
name: 미오
voice: child-innocent
states:
  - id: mood
    label: 기분
    type: enum
    initial: cheerful
    values:
      - cheerful
      - tired
      - grumpy
    shown_as:
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

섬의 유일한 아이, 아홉 살. 까만 양 갈래 머리에 커다란 노란 우비와 빨간 장화, 자기보다 큰 잠자리채를 메고 다닌다. 장난꾸러기라 섬 구석구석을 안내해 준다.
