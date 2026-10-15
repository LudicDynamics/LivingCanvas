---
type: readme
name: 해변
bg: assets/scenes/beach.webp
title: 해변
intent: 나기는 매일 새벽 여기서 그물을 깁고 생선을 고른다. 물때 선엔 유목이 자주 밀려온다. 낚시는
  command/go-fishing.yaml, 유목을 주워 조선소로 가져가기는 command/gather-driftwood.yaml(배 수리가
  한 단계 나아가고 겐타와 친해진다. 세 번이면 트리거로 배가 진수한다), 나기와 그물 깁기는 command/mend-nets.yaml.
  저녁부터는 노을 그림으로 바뀐다.
choice:
  options:
    - id: fish
      label: 바위에서 잠시 낚시를 한다
    - id: driftwood
      label: 물때 선을 따라 유목을 주워 조선소로 나른다
    - id: mend-nets
      label: 앉아서 나기와 함께 그물을 깁는다
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "fish"
      run: go-fishing
      on_error: continue
    - when: choice.option_id == "driftwood"
      run: gather-driftwood
      on_error: continue
    - when: choice.option_id == "mend-nets"
      run: mend-nets
      on_error: continue
---

흰 모래사장이 초승달처럼 휘어 있고, 바위 사이 조수 웅덩이에선 작은 게들이 옆으로 달린다. 물때 선엔 바닷물에 하얗게 바랜 나무 토막 몇 개가 누워 있다.

멀리 해초섬과 새바위가 안개 속에서 보였다 말았다 한다.
