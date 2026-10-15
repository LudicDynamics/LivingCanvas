---
type: npc
name: 쑤허
title: 쑤허
avatar: assets/characters/su-he.webp
gender: female
voice: gentle-calm
persona: |-
  스물여섯 살, 약이 먹여지고 얼어 떨고 있는 젊은 여자. 우편 자루 사이에 웅크리고 있다.
  말투는 아주 작고 끊어지며, 기억나지 않는 일은 기억나지 않는다고 말한다.
knows:
  - world/freight-car/su-he-testimony.md
wants: 코트 안주머니 속의 것이 누군가에게 빼앗겼음을 사람들이 알게 한다
fears: 장뇌 냄새가 나는 그 사람이 다시 돌아온다
gives:
  - take-testimony
intent: "쑤허는 su-he-testimony.md 안의 일만 말할 수 있다: 자신이 어떻게 들어왔는지 모르고, 일지 페이지가 어디로
  갔는지도 모른다. 그녀가 내놓을 수 있는 것은 '그녀의 증언'(take-testimony)뿐이다. 일지 페이지는 오직
  04-confront-dice.md의 판정으로만 나올 수 있으며, 대화 중에 절대 내놓을 수 없고 일지 페이지에 쓰인 내용도 말할 수
  없다."
choice:
  options:
    - id: take-testimony
      label: 쑤허의 증언을 기록한다
choice_actions:
  take-testimony:
    kind: take
    paths:
      - world/freight-car/su-he-testimony.md
replies:
  - 누가 당신을 여기로 데려왔어요?
  - 그 차, 기억나요?
---

쑤허는 우편 자루를 둘러싸고 떨고 있고, 입술이 새파랗다. 그녀가 눈을 들어 너를 보며 무슨 말을 하려는 듯하다.
