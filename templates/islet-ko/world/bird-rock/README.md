---
type: gate
name: 바깥섬 · 새바위
bg: assets/scenes/bird-rock.webp
title: 바깥섬 · 새바위
requires:
  items:
    - player/boat-tiller.md
blocked: 새바위는 사방이 절벽과 암초라 배로만 댈 수 있다. 먼저 겐타를 도와 낡은 고깃배를 고쳐야 한다.
intent: 바닷새의 섬. 배를 고친 뒤에야 올 수 있다. 봄과 여름엔 수천 마리 새가 절벽에 둥지를 튼다. 스즈 할머니는 젊을 때 자주 여기
  와서 새를 셌다. 탐험은 command/explore-islet.yaml. 새 무리를 놀라게 하지 말고, 위험도 두지 마라.
choice:
  options:
    - id: explore
      label: 절벽 아래를 천천히 걸으며 바닷새를 본다
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

검은 절벽엔 둥지가 빼곡하고, 바닷새 울음이 파도 소리를 덮는다. 바위 틈엔 작은 흰 꽃이 핀 풀이 무더기로 자란다.

여기서 시오미 섬 전체가 보이고, 등대는 성냥개비만 하다.
