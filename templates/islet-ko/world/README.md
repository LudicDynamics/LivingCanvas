---
type: readme
name: 시오미 섬
bg: assets/maps/island.webp
title: 시오미 섬
intent: "섬 전체: 부두, 광장, 하나의 가게, 당신의 밭, 해변, 등대, 당신의 오두막, 연락선 갑판, 그리고 배를 고쳐야만 갈 수
  있는 해초섬과 새바위. 이곳은 살아 있는 세계다: 시간, 날씨, 축제, 섬사람들의 위치는 모두 엔진이 정한다(컨텍스트의 [The living
  world] 참고). 몇 시간이 지났다고 알리지 말고, 장면을 위해 섬사람을 옮기지 말고, 결말을 만들지 마라. 낡은 고깃배와 밭의 진행은
  이 파일에 선언된 상태이며 명령만이 바꾼다."
states:
  - id: boat_progress
    label: 낡은 고깃배
    type: number
    initial: 0
    range:
      - 0
      - 3
    shown_as:
      - min: 3
        text: 고쳐져서 부두에 매여 있다
      - min: 2
        text: 널빤지 몇 장만 남았다
      - min: 1
        text: 절반쯤 고쳤고 용골이 아직 드러나 있다
      - max: 0
        text: 조선소에 뒤집혀 목재를 기다린다
  - id: farm_growth
    label: 당신의 밭
    type: number
    initial: 0
    range:
      - 0
      - 4
    shown_as:
      - min: 4
        text: 거둘 때가 됐다
      - min: 3
        text: 무릎 높이까지 자랐다
      - min: 2
        text: 새싹이 줄지어 돋았다
      - min: 1
        text: 막 갈고 씨를 뿌렸다
      - max: 0
        text: 아직 잡초밭이다
  - id: boat_fixed
    label: 배 수리
    type: flag
    initial: false
    hidden: true
  - id: kai_arrived
    label: 카이 상륙
    type: flag
    initial: false
    hidden: true
---

시오미 섬은 작아서 부두에서 등대까지 걸어도 십오 분이 안 걸린다. 섬에는 일곱 사람이 살고, 매주 월요일에 연락선이 온다.

당신은 마을 동쪽, 몇 년째 버려진 밭을 물려받으러 왔다. 아무도 재촉하지 않는다. 물고기는 물고, 씨앗은 싹트고, 연락선은 제때 닿고, 섬사람들은 각자의 하루를 오간다 — 당신이 없는 동안에도.
