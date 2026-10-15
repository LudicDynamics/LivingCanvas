---
type: chalk
title: 또 다른 배를 찾기
choice:
  options:
    - id: action-1
      label: "베라에게 묻기: 이 실마리들이 무엇을 뜻하는지"
    - id: action-2
      label: 더 조사한다
  allow_free: true
intent: "여기서는 서식을 채우거나 제출하지 않는다. 플레이어가 정리하고 싶어 할 때, 베라가 자기 말투로 이야기한다: 플레이어 가방에 실제로 있는 증거, 그것이 뜻하는 것, 다음에 갈 주사위 카드. 이야기만 하고, 증거를 지급하지 않고, 새 판정 카드를 만들지 않고, 새 장소를 생성하지 않고, 결말을 선언하지 않는다. 증거는 각지의 조사 주사위에서만 나온다; 폭로는 world/harbor-chart/05-accuse.md에서 엔진이 판정한다."
choice_actions:
  action-1:
    kind: character
    character: vera
  action-2:
    kind: enter
    target: world/harbor-chart
---

배에 남은 흔적, 그리고 등대가 꺼진 시간. 둘을 합쳐 보면, 안개 속에 또 다른 배가 있을지도 모른다.

정리하고 싶다면 베라에게 물어보라—말하는 데는 조수가 들지 않고 주사위도 필요 없다. 실제로 실마리를 해도에 못 박는 것은 각지의 조사 주사위와 해도 위의 결정적 판정이다; 굴리지 못한 실마리는 그곳의 '돌아가기'로 보충해야 한다.
