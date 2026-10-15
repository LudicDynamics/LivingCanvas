---
type: readme
name: 연락선 갑판
bg: assets/scenes/ferry.webp
title: 연락선 갑판
intent: "월요일에 오는 연락선. 닿지 않는 날엔 만에 정박해 갑판이 텅 비어 있다. 기타를 안은 나그네(카이)가 배에서 내리기로 마음먹을
  때까지 갑판에 앉아 있다(트리거 kai-arrives). 해초섬과 새바위엔 고친 배가 필요하다(관문:
  player/boat-tiller.md). 폭풍 치는 날엔 출항하지 않도록 작가가 서술로 지킨다."
choice:
  options:
    - id: to-kelp
      label: 고친 배로 해초섬에 간다
    - id: to-bird
      label: 고친 배로 새바위에 간다
    - id: back
      label: 부두로 돌아간다
  allow_free: true
choice_actions:
  to-kelp:
    kind: enter
    target: world/kelp-islet
  to-bird:
    kind: enter
    target: world/bird-rock
  back:
    kind: enter
    target: world/dock
---

갑판은 햇볕에 달궈져 뜨겁고, 난간엔 칠이 반쯤 벗겨진 구명튜브가 걸려 있다. 여기서 돌아보면 섬 전체가 바다 위에 엎드려 자는 고양이 같다.

난간 곁엔 낡은 기타를 안은 사람이 자주 앉아 있다.
