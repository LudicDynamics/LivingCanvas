---
type: chalk
title: 지목 · 실마리를 해도에 못 박기
status:
  data:
    decoy: no
    tunnel: no
    ledger: no
    wake: no
choice:
  options:
    - id: accuse
      label: "해도 위에서 지목하기: 네 실마리를 하나로 못 박기"
      when: decoy == "yes" && tunnel == "yes" && ledger == "yes" && wake == "yes"
    - id: not-ready
      label: "해도와 대조하기: 어떤 실마리가 아직 빠졌는지"
      when: decoy != "yes" || tunnel != "yes" || ledger != "yes" || wake != "yes"
on:
  choice_selected:
    - run: accuse
      on_error: continue
---

해도가 항무소에서 빌린 탁자 위에 펼쳐져 있다. 이 일을 폭로하려면 네 실마리를 하나로 못 박아야 한다: 7번 부두의 배, 옛 등대의 십이 분, 공방의 고정쇠, 그리고 안개 속의 항적.

네 실마리 모두 ✓가 찍혀야 '지목'이 나타난다. 실마리가 다 못 박히지 않았을 때는 먼저 해도와 대조해 무엇이 빠졌는지 볼 수 있다—아무것도 끝나지 않고 조수도 들지 않는다. 지목한 뒤 아무 일도 일어나지 않으면, 증거 하나가 가방에 없다는 뜻이다—그것을 되찾아 다시 지목하라.

해도 위의 실마리 (✓ 못 박힘, ✗ 아직):
