---
type: gate
name: 바깥섬 · 해초섬
bg: assets/scenes/kelp-islet.webp
title: 바깥섬 · 해초섬
requires:
  items:
    - player/boat-tiller.md
blocked: 해초섬 사이엔 거센 조류가 흘러 헤엄쳐 건널 수 없다. 먼저 겐타를 도와 낡은 고깃배를 고쳐야 한다.
intent: 배를 고친 뒤에야 올 수 있는 작은 섬. 물이 빠지면 해초 숲이 수면 위로 드러난다. 아무도 살지 않고, 가끔 나기가 배를 몰고
  해초를 따러 온다. 탐험은 command/explore-islet.yaml(오후 대부분이 걸린다). 보물이나 비밀을 숨기지 마라. 그저
  아름답고 조용한 곳이다.
choice:
  options:
    - id: explore
      label: 얕은 물을 건너 해초 숲을 거닌다
    - id: back
      label: 배를 몰아 연락선 갑판으로 돌아간다
  allow_free: true
choice_actions:
  back:
    kind: enter
    target: world/ferry
on:
  choice_selected:
    - when: choice.option_id == "explore"
      run: explore-islet
      on_error: continue
---

물이 빠진 해초섬은 초록 벨벳 깔개 같고, 얕은 물에서 해초가 천천히 흔들린다. 바위 위엔 불가사리 몇 마리가 볕을 쬔다.

다른 소리는 없고, 파도와 바람뿐이다.
