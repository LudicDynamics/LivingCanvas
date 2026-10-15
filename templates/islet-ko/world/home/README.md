---
type: readme
name: 당신의 오두막
bg: assets/scenes/home.webp
title: 당신의 오두막
intent: 당신이 사는 곳. 잠자기는 command/sleep.yaml(다음 날 새벽까지. 밤사이 섬사람들의 하루는 엔진이 계산한다).
  여기선 플레이어에게 자라고 재촉하지 않고, 밤을 새워도 아무 벌이 없다.
choice:
  options:
    - id: sleep
      label: 누워서 새벽까지 잔다
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "sleep"
      run: sleep
      on_error: continue
---

전 주인이 남긴 오두막: 침대 하나, 탁자 하나, 작은 장작 난로. 창턱엔 조개껍데기가 줄지어 있는데, 누가 주워 왔는지는 모른다.

창밖으로 등대 불빛이 바다 위를 빙 도는 것이 딱 보인다.
