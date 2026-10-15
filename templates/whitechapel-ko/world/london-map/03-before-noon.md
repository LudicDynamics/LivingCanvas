---
type: chalk
title: 정오 전
status:
  data:
    left: 10
    arrived: no
    picture: no
    hand: no
    address: no
choice:
  options:
    - id: confront
      label: "그를 추궁한다: 그림이 먼저였고 그의 손이 현장에 있었다는 것을 늘어놓는다"
      when: arrived == "yes" && picture == "yes" && hand == "yes"
    - id: trap
      label: "맞장구친다: 붉은 봉투를 받아 그에게 정오에 인쇄소 안뜰에서 “이디스에게” 전해 달라 하고 — 그곳에서 기다린다"
      when: arrived == "yes" && address == "yes"
    - id: edith-first
      label: "이디스를 먼저: 왓슨에게 그녀를 221B 뒷문으로 데리고 나가게 한다"
      when: arrived == "yes"
    - id: follow-him
      label: 모르는 척 보내고, 조용히 뒤따른다
      when: arrived == "yes"
intent: "이 카드는 정오 전의 압박이다. 웨인이 등장하기 전(도착은 아니오)에는 시간만 재촉할 뿐, 누구도 퀴즈를 내거나 추리를 요구하거나 플레이어에게 무언가를 채우게 하지 않는다. 플레이어가 충분히 밝혀내면, 엔진이 웨인 자신이 홈즈를 막게 한다(command/wayne-turns-up.yaml): 예의 바르고 완강하게, 겨드랑이에 붉은 봉투를 낀 채, 네 번째 그림의 증거를 이디스에게 직접 건네겠다며 물러서지 않는 그를 연기한다. 왓슨은 홈즈에게 지금 결정하라고 재촉하고, 이디스는 자신이 직접 맞서고 싶어 한다. 어떤 행동이 열려 있는지는 플레이어가 실제로 무엇을 찾아냈는지에 달려 있다. 이 카드의 결정은 엔진이 수행한다(command/confront-wayne.yaml, set-trap.yaml, edith-first.yaml, follow-wayne.yaml). 작가는 산문으로 결말을 알리지 않으며 플레이어 대신 결정하지 않는다."
on:
  choice_selected:
    - run: confront-wayne
      when: choice.option_id == "confront"
    - run: set-trap
      when: choice.option_id == "trap"
    - run: edith-first
      when: choice.option_id == "edith-first"
    - run: follow-wayne
      when: choice.option_id == "follow-him"
---

정오까지 두 시간. 수색이 꼬이면 오전 시간이 깎인다. 정오가 먼저 오면 네 번째 그림이 현실이 된다.

추측도, 글로 쓴 추리도 없다. 현장과 검시실, 인쇄소, 응접실을 직접 손으로 뒤진다. 충분히 밝혀내면, 소설을 실제 사건으로 바꾸는 자가 가만히 앉아 있지 못하고 너를 찾아온다. 그때 네가 쥔 것이 무엇을 할 수 있는지를 정한다.
