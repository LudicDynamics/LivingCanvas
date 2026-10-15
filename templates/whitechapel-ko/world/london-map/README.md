---
type: gate
name: 런던 · 다음은 어디를 조사할까?
title: 런던 · 다음은 어디를 조사할까?
bg: assets/backgrounds/map.webp
requires:
  items:
    - player/blue-brass-cap.md
blocked: 221B에서 사건을 맡고 삽화 통 뚜껑을 가져간다.
bgVideo: assets/motion/seedance/backgrounds/map.webm
map:
  plan:
    picture: assets/maps/london-map.webp
    pins:
      edith-room:
        - 0.22
        - 0.23
      print-shop:
        - 0.47
        - 0.36
      unnamed-street:
        - 0.55
        - 0.53
      morgue:
        - 0.76
        - 0.29
      third-crime-scene:
        - 0.89
        - 0.51
      player:
        - 0.26
        - 0.57
      03-before-noon:
        - 0.4
        - 0.72
intent: 런던 지도다. 각 장소의 단서는 플레이어가 직접 손으로 찾을 때(주사위 굴리기)만 나타난다. 퀴즈도, 제출하는 추리나 작전 계획도, 추리 채점도 없다. 충분히 밝혀지면 웨인이 플레이어에게 직접 찾아온다(world/london-map/03-before-noon.md, 엔진이 발동). 그때까지 그는 진실을 흘리지 않으며, 누구도 플레이어 대신 범인을 지목하지 않는다.
---

다음 사건은 오늘 정오다. 먼저 세 번째 현장으로 가서 그림과 그 장소를 비교한다. 그다음 인쇄소로 가서 누가 원고를 가장 먼저 읽을 수 있었는지 알아낸다. 221B 응접실로 돌아가 작가 이디스에게 주소를 왜 바꿨는지 들을 수도 있다.

순서는 상관없다. 각 장소는 직접 손으로 한 번씩 조사할 수 있다. 써 내려갈 추리도, 너를 시험하는 사람도 없다. 충분히 밝혀지면, 그 남자는 가만히 앉아 있지 못할 것이다.
