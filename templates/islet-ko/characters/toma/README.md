---
type: readme
name: 도마
voice: hoarse-weathered
greeting: ……내릴 때 발밑 조심해, 널빤지 하나가 헐거워. 동쪽 밭을 맡으러 온 사람이지? 작은 섬이야, 몇 번 걸으면 다 알게 돼.
  무슨 일 있으면 부두로 와.
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
    initial: 1
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

시오미 섬의 부두지기, 예순여덟. 연락선 무전을 맡고 있다. 다 보고 있지만 말수가 적고 마음이 여리다.
