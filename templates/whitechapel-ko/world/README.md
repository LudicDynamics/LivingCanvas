---
type: readme
name: 221B · 다음 사건을 막는다
title: 221B · 다음 사건을 막는다
bg: assets/backgrounds/intro.webp
intent: world/watson-letter.md 파일과 fourth-illustration.md 파일을 읽고 보여준다. 받아들여 가져가면 world/blue-brass-cap.md 파일을 player/blue-brass-cap.md. 다음으로 옮긴다. 런던 지도에서 세 번째 현장으로 안내한다. 진실은 밝혀지지 않은 채 남는다. 정오는 이야기의 압박이며, 실제 독서 시간에 대한 벌은 없다.
choice:
  options:
    - id: action-1
      label: 편지와 네 번째 삽화를 읽는다
    - id: action-2
      label: 의뢰를 받아들이고 그림 통 뚜껑을 가져간다
bgVideo: assets/motion/seedance/backgrounds/intro.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/watson-letter.md
      - world/fourth-illustration.md
  action-2:
    kind: take
    paths:
      - world/blue-brass-cap.md
map:
  plan:
    picture: assets/maps/baker-street-sitting-room.webp
    pins:
      watson-letter:
        - 0.6
        - 0.53
      fourth-illustration:
        - 0.68
        - 0.58
      blue-brass-cap:
        - 0.6
        - 0.63
      london-map:
        - 0.75
        - 0.18
      watson:
        - 0.4
        - 0.45
      player:
        - 0.21
        - 0.77
---

당신은 셜록 홈즈다. 왓슨이 코트가 아직 젖은 채로 곧장 여기 와서 당신의 응접실에 서 있다.

"환자인 이디스는 소설가입니다. 그녀의 소설과 똑같은 사건이 세 번 일어났습니다. 다음 사건은 오늘 정오에 일어날 것입니다. 누군가 소설을 흉내 내고 있습니다. 그녀는 당신의 도움을 원합니다."

두 가지 임무: 소설을 흉내 내는 사람을 찾아내고, 오늘의 네 번째 사건을 막는다. 먼저 편지와 네 번째 그림을 읽고, 그림 통 뚜껑을 챙겨 런던 지도로 간다. 이디스는 이 집 응접실에서 기다린다.
