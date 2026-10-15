---
type: readme
name: 나기
voice: sassy-spunky
states:
  - id: mood
    label: 기분
    type: enum
    initial: cheerful
    values:
      - cheerful
      - tired
      - grumpy
      - calm
    shown_as:
      cheerful: 기분이 좋다
      tired: 조금 지쳤다
      grumpy: 기분이 별로다
      calm: 차분하다
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

열일곱 살 어부의 딸. 볕에 그을리고 주근깨투성이다. 입이 거칠고 가만있질 못하며, 날이 밝기 전에 바다로 나간다. 아마 가장 먼저 친해질 사람.
