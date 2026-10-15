---
type: readme
name: 부두
bg: assets/scenes/dock.webp
title: 부두
intent: 도마가 부두와 연락선 무전을 지킨다. 옆은 겐타의 조선소로, 낡은 고깃배가 뒤집힌 채 목재를 기다린다(진행은
  world/README.md의 boat_progress). 연락선은 매주 월요일 아침부터 한낮까지 닿는다(폭풍이면 결항). 낚시는
  command/go-fishing.yaml, 도마 곁에 있기는 command/chat-toma.yaml, 승선은 world/ferry로
  들어가는 것이다.
choice:
  options:
    - id: fish
      label: 부두 끝에서 낚시를 한다
    - id: keep-toma-company
      label: 도마와 함께 부두를 지킨다
    - id: board
      label: 연락선 갑판에 오른다
  allow_free: true
choice_actions:
  board:
    kind: enter
    target: world/ferry
on:
  choice_selected:
    - when: choice.option_id == "fish"
      run: go-fishing
      on_error: continue
    - when: choice.option_id == "keep-toma-company"
      run: chat-toma
      on_error: continue
---

나무 부두가 바다로 뻗어 있고, 계선주에는 햇볕에 바랜 밧줄이 감겨 있다. 끝의 작은 오두막에서 이따금 무전기가 지직거린다.

옆 조선소에는 낡은 고깃배가 배를 드러낸 채 누군가 고쳐 주기를 기다린다.
