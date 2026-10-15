---
type: readme
name: 달빛 아래의 소환
title: 달빛 아래의 소환
bg: assets/backgrounds/opening.webp
intent: 이 세계의 행동에서는 항상 skills/moonlit-contract-ko-play/SKILL.md, 현재 리드미, 기본 초크, 그리고 실제 푸른 리본 파일을 읽는다. 처음에는 계약이 형성되지 않는다. 분명한 동의가 있을 때만 world/moonlit-courtyard을 생성한다. 질문이나 거절에는 생성하지 않는다. 기존 내용을 유지하며, 다음 장소는 플레이어의 명시적 단계마다 생성한다.
map:
  plan:
    picture: assets/maps/seaside-observatory.webp
    pins:
      moonlit-courtyard:
        - 0.49
        - 0.12
      blue-ribbon:
        - 0.43
        - 0.53
      lyra:
        - 0.62
        - 0.46
      player:
        - 0.33
        - 0.84
---

이름 없는 마을의 밤. 오래된 바닷가 천문대의 바닥에서 돌바닥에 새겨진 옅은 보라 잔광이 흔들린다. 라일라가 네 대답을 기다린다.

안에 있는 읽을거리는 한 페이지 opening.md, 하나의 실체적 아이템은 계약 증표인 푸른 리본이다. 문 너머는 아직 쓰이지 않았다. 캐릭터와 약속은 작가가 연기한다. 플레이어의 이름, 소원, 동의는 임의로 정하지 않는다.

첫 목적지는 world/moonlit-courtyard.이다. 계약에 동의하고 바깥으로 나아가려는 의사가 보이면, 한 층 README.md, opening.md, item.md 파일과 그 하위 폴더를 위한 배경 이미지 하나를 생성한다. 미리 자동 생성하지 않는다. 반환 경로는 상위 맵이다.
