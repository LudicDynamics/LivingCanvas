---
type: gate
name: 5호차 · 화물차
bg: assets/scenes/freight-car.webp
title: 5호차 · 화물차
requires:
  items:
    - player/freight-key.md
blocked: 화물차 문은 잠겨 있다. "5호차" 빨간 팻말이 달린 열쇠가 필요하다—운전실 열쇠판에서 그것이 사라졌으니, 다른 차량에서 찾아보라.
intent: '제3막. 쑤허가 여기 있다: 약이 먹여지고 얼어 떨고 있지만 살아 있다. 그녀는 NPC 카드 su-he.md이며(그녀를 클릭해
  "대화"), su-he-testimony.md 안의 일만 말할 수 있고, 내놓을 수 있는 것은 그녀의 말뿐이다: 자신이 어떻게 들어왔는지
  모르고, 일지 페이지가 어디로 갔는지도 모른다. 결정적 판정은 04-confront-dice.md(중화이리를 막아선다)이다: 60 이하이면
  logbook-page를 얻고, 10 이하이면 torn-corner만 얻는다. 판정 밖의 서술로 일지 페이지를 내주게 해서는 안 된다.'
choice:
  options:
    - id: take-testimony
      label: 쑤허를 일으켜 세우고 그녀의 말을 듣는다
    - id: confront
      label: 중화이리가 문 어귀를 막고 있다—주사위로 그를 막아선다
    - id: back
      label: 열차로 돌아가기
    - id: warm-her
      label: 먼저 그녀를 따뜻하게
      to: companion
      say: 샤청, 당신 솜 코트를 그녀에게 덮어줘요. 먼저 몸부터 녹이자.
  allow_free: true
choice_actions:
  take-testimony:
    kind: take
    paths:
      - world/freight-car/su-he-testimony.md
  confront:
    kind: read
    paths:
      - world/freight-car/04-confront-dice.md
  back:
    kind: enter
    target: map
map:
  plan:
    picture: assets/maps/freight-car.webp
    pins:
      su-he:
        - 0.24
        - 0.52
      su-he-testimony:
        - 0.35
        - 0.45
      04-confront-dice:
        - 0.83
        - 0.25
      player:
        - 0.5
        - 0.78
      06-radio-relay:
        - 0.62
        - 0.2
view: canvas
---

화물차에는 난방이 없어 내쉬는 숨이 하얗다. 우편 자루가 산처럼 쌓여 있고, 구석의 양철 난로에는 아직 불이 조금 타고 있다.

우편 자루 사이에 한 사람이 웅크리고 있다—쑤허다. 입술이 새파랗지만 아직 숨을 쉬고 있다.

당신 뒤에서 차문이 또 한 번 울린다.
